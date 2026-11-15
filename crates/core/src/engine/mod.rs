//! `engine` — interfaz [`TorrentEngine`] + implementaciones (NFR-02, ADR-03, ADR-04).
//!
//! Nadie fuera de este módulo sabe qué motor corre: `playback`, `preload` y `analyzer`
//! reciben un `Arc<dyn TorrentEngine>` creado por [`create`]. Cambiar webtorrent ↔ rqbit
//! es cambiar `EngineConfig::kind`.
//!
//! ## Requisitos que TODA implementación debe cumplir (spec 06, lecciones 1–6)
//! 1. Sin relleno de ceros (NFR-09): pieza-por-archivo o sparse. Probado con > 10 GB escribiendo el final primero.
//! 2. `add` arranca SIEMPRE sin nada seleccionado, y `prioritize_ranges` es EXCLUSIVO: mientras
//!    haya rangos pendientes, no se pide ninguna otra pieza (lección 3).
//! 3. Evento `RangeReady` cuando un rango está completo y verificado (lección 2).
//! 4. Acepta trackers extra (lección 4) y `max_connections` (lección 5).
//! 5. Servidor HTTP con Range solo en 127.0.0.1 (NFR-16).
//! 6. `remove(delete_data)` detiene TODO tráfico y borra la carpeta (FR-12, lección 6).
//! 7. Si el proceso sidecar muere, el motor emite `Error` + `Exited` y `cleanup` recupera (T-05).

#[cfg(feature = "rqbit")]
mod rqbit;
mod webtorrent;

use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use tokio::sync::broadcast;

use crate::config::{EngineConfig, EngineKind};
use crate::magnet::{InfoHash, Magnet};
use crate::paths::AppPaths;
use crate::{CoreError, Result};

/// Identificador opaco de un torrent dentro de un motor.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct TorrentHandle(pub u64);

#[derive(Debug, Clone)]
pub enum TorrentSource {
    /// Con los trackers de la config ya agregados (FR-10).
    Magnet(Magnet),
    /// `.torrent` en caché → sin esperar metadatos (FR-13, lección 5).
    TorrentFile(PathBuf),
}

#[derive(Debug, Clone)]
pub struct AddOptions {
    /// Trackers adicionales (también como announce).
    pub trackers: Vec<String>,
    /// Carpeta exclusiva de este torrent: `paths.downloads_dir()/<hash>-<id>`.
    pub download_dir: PathBuf,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct FileInfo {
    pub index: usize,
    /// Ruta relativa dentro del torrent.
    pub name: String,
    pub size: u64,
    /// Desplazamiento del archivo dentro del torrent (para mapear bytes → piezas).
    pub offset: u64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Metadata {
    pub info_hash: InfoHash,
    pub name: String,
    pub files: Vec<FileInfo>,
    pub piece_length: u64,
    pub piece_count: u32,
    /// Bytes del `.torrent` para la caché (FR-13).
    #[serde(skip)]
    pub torrent_bytes: Option<Vec<u8>>,
}

/// Qué archivo de un torrent se quiere (catálogo, FR-48/49): el índice del addon si lo trae; si
/// no, el que coincide con el episodio (`SxxExx` / `TxEE`); si no, el video más grande.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct FilePick {
    pub index: Option<usize>,
    pub episode: Option<(u32, u32)>,
}

impl Metadata {
    pub fn pick_file(&self, pick: FilePick) -> Result<FileInfo> {
        if pick.index.is_some() {
            return self.choose_file(pick.index);
        }
        if let Some((s, e)) = pick.episode {
            if let Some(f) = self
                .files
                .iter()
                .filter(|f| is_video(&f.name))
                .filter(|f| names_episode(&f.name, s, e))
                .max_by_key(|f| f.size)
            {
                return Ok(f.clone());
            }
            tracing::warn!(
                season = s,
                episode = e,
                "ningún archivo coincide con el episodio: uso el más grande"
            );
        }
        self.choose_file(None)
    }
}

/// ¿El nombre trae este episodio? `S01E03`, `s1e03`, `1x03` (sin confundir `S01E030` ni `11x03`).
/// La regla de "qué episodio es" vive en [`crate::release::season_episodes`].
pub fn names_episode(name: &str, season: u32, episode: u32) -> bool {
    crate::release::season_episodes(name)
        .any(|(s, e)| u32::from(s) == season && e.map(u32::from) == Some(episode))
}

/// Extensiones que se consideran video al elegir qué archivo reproducir/medir.
pub const VIDEO_EXTENSIONS: &[&str] = &[
    "mkv", "mp4", "m4v", "mov", "avi", "webm", "ts", "m2ts", "wmv",
];

/// ¿La extensión del nombre es de video ([`VIDEO_EXTENSIONS`])?
pub fn is_video(name: &str) -> bool {
    std::path::Path::new(name)
        .extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| VIDEO_EXTENSIONS.contains(&e.to_ascii_lowercase().as_str()))
}

impl Metadata {
    /// El archivo pedido, o el video más grande, o el archivo más grande.
    /// (Agregado en F2: lo comparten `playback` y `analyzer`.)
    pub fn choose_file(&self, requested: Option<usize>) -> Result<FileInfo> {
        if let Some(i) = requested {
            return self
                .files
                .get(i)
                .cloned()
                .ok_or_else(|| crate::CoreError::NotFound(format!("archivo {i} del torrent")));
        }
        self.files
            .iter()
            .filter(|f| is_video(&f.name))
            .max_by_key(|f| f.size)
            .or_else(|| self.files.iter().max_by_key(|f| f.size))
            .cloned()
            .ok_or_else(|| crate::CoreError::NotFound("archivos en el torrent".into()))
    }

    /// Guarda el `.torrent` para no volver a pedir metadatos (FR-13). Best effort.
    pub fn save_torrent_cache(&self, path: &std::path::Path) {
        let Some(bytes) = &self.torrent_bytes else {
            return;
        };
        if let Some(parent) = path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        // Atómico (temporal + rename): un `.torrent` a medio escribir rompería el próximo `add`.
        static SEQ: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
        let mut tmp = path.as_os_str().to_owned();
        tmp.push(format!(
            ".{}-{}.tmp",
            std::process::id(),
            SEQ.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
        ));
        let tmp = PathBuf::from(tmp);
        if let Err(e) = std::fs::write(&tmp, bytes).and_then(|()| std::fs::rename(&tmp, path)) {
            let _ = std::fs::remove_file(&tmp);
            tracing::warn!("no se pudo guardar el .torrent en caché: {e}");
        }
    }
}

/// Rango de bytes DENTRO de un archivo, `[start, end)`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct ByteRange {
    pub start: u64,
    pub end: u64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct RangeProgress {
    pub range: ByteRange,
    pub pieces_done: u32,
    pub pieces_total: u32,
    /// Para el log de diagnóstico: peers que tienen las piezas faltantes (lección 9).
    pub peers_with_missing: u32,
}

#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
pub struct Stats {
    /// Bytes de piezas completas y verificadas (del archivo seleccionado o del torrent).
    pub downloaded_bytes: u64,
    /// Bytes RECIBIDOS de la red, verificados o no. Para medir velocidad: no depende del tamaño
    /// de pieza (en torrents grandes una pieza de 16 MB tarda en completarse y `downloaded_bytes`
    /// avanza a saltos o queda en 0 durante la medición). Agregado al calibrar el análisis.
    #[serde(default)]
    pub received_bytes: u64,
    pub download_speed_bps: f64,
    pub upload_speed_bps: f64,
    pub peers: u32,
    /// Peers conectados que tienen el archivo completo (seeders reales, no los que dice el tracker).
    #[serde(default)]
    pub seeds: u32,
    /// 0.0–1.0 del archivo seleccionado.
    pub progress: f32,
    pub paused: bool,
    pub ranges: Vec<RangeProgress>,
}

#[derive(Debug, Clone, Copy, Default)]
pub struct RemoveOptions {
    pub delete_data: bool,
}

#[derive(Debug, Clone)]
pub enum EngineEvent {
    RangeReady {
        handle: TorrentHandle,
        file_index: usize,
        range: ByteRange,
    },
    /// Línea para el log en vivo ("Ver detalle") y diagnóstico.
    Log {
        handle: Option<TorrentHandle>,
        line: String,
    },
    Error {
        handle: Option<TorrentHandle>,
        message: String,
    },
    /// El proceso del motor terminó (esperado o no).
    Exited { code: Option<i32> },
}

#[async_trait]
pub trait TorrentEngine: Send + Sync {
    /// PID del proceso del motor si corre aparte (registro de dueño de `cleanup`, T-05).
    /// `None` para motores embebidos.
    fn pid(&self) -> Option<u32> {
        None
    }

    /// Agrega el torrent sin nada seleccionado: nada se baja hasta `prioritize_ranges` o
    /// `select_file` (lección 3). No espera metadatos.
    async fn add(&self, source: TorrentSource, opts: AddOptions) -> Result<TorrentHandle>;

    /// Espera los metadatos (el llamador pone el timeout, NFR-08). Mejor `wait_metadata`.
    async fn metadata(&self, handle: TorrentHandle) -> Result<Arc<Metadata>>;

    /// Qué falta mientras `metadata` no vuelve (para el mensaje de timeout).
    async fn waiting_on(&self, _handle: TorrentHandle) -> Option<Waiting> {
        None
    }

    /// Reemplaza la lista de rangos prioritarios del archivo. Exclusivos: ninguna otra pieza se
    /// pide hasta que estén (lección 3).
    async fn prioritize_ranges(
        &self,
        handle: TorrentHandle,
        file_index: usize,
        ranges: &[ByteRange],
    ) -> Result<()>;

    /// Conteo del enjambre: sin nada pedido, rqbit da el torrent por terminado y corta a cada
    /// seeder apenas manda su bitfield. Esto lo mantiene "pendiente" (a lo sumo baja la última
    /// pieza del archivo) para que los seeders sigan conectados. Hasta `remove`.
    async fn hold_peers(&self, _handle: TorrentHandle, _file_index: usize) -> Result<()> {
        Ok(())
    }

    /// Selecciona el archivo completo (después de la precarga) y deselecciona el resto.
    async fn select_file(&self, handle: TorrentHandle, file_index: usize) -> Result<()>;

    /// `http://127.0.0.1:<puerto>/…` con soporte de Range (NFR-16).
    async fn stream_url(&self, handle: TorrentHandle, file_index: usize) -> Result<String>;

    async fn stats(&self, handle: TorrentHandle) -> Result<Stats>;

    async fn pause(&self, handle: TorrentHandle) -> Result<()>;
    async fn resume(&self, handle: TorrentHandle) -> Result<()>;
    async fn remove(&self, handle: TorrentHandle, opts: RemoveOptions) -> Result<()>;

    /// Eventos de todos los torrents de este motor.
    fn subscribe(&self) -> broadcast::Receiver<EngineEvent>;

    /// Detiene el motor (y su proceso) — al cerrar la app.
    async fn shutdown(&self) -> Result<()>;
}

/// En qué está un torrent cuyos metadatos todavía no llegaron.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Waiting {
    /// Magnet sin metadatos; `peers` = encontrados por DHT durante la espera (si se cuentan).
    Metadata { peers: Option<usize> },
    /// Metadatos ya conocidos: verificando lo que hay en disco (`done` de `total` bytes).
    Checking { done: u64, total: u64 },
}

/// `metadata` con timeout (NFR-08). Si vence, el log dice qué faltaba: sin peers, peers que no
/// dan metadatos, o metadatos conocidos pero todavía verificando datos en disco.
pub async fn wait_metadata(
    engine: &dyn TorrentEngine,
    handle: TorrentHandle,
    secs: u64,
) -> Result<Arc<Metadata>> {
    if let Ok(r) = tokio::time::timeout(Duration::from_secs(secs), engine.metadata(handle)).await {
        return r;
    }
    let waiting = engine.waiting_on(handle).await;
    let what = match waiting {
        Some(Waiting::Checking { done, total }) => {
            tracing::warn!(
                "tiempo agotado verificando datos en disco: {:.1} de {:.1} GB (los metadatos ya estaban)",
                done as f64 / 1e9,
                total as f64 / 1e9
            );
            "verificación de datos en disco"
        }
        Some(Waiting::Metadata { peers: Some(0) }) => {
            tracing::warn!("tiempo agotado esperando metadatos: 0 peers encontrados por DHT");
            "metadatos"
        }
        Some(Waiting::Metadata { peers: Some(n) }) => {
            tracing::warn!(
                "tiempo agotado esperando metadatos: {n} peers encontrados por DHT, ninguno los dio"
            );
            "metadatos"
        }
        _ => "metadatos",
    };
    Err(CoreError::Timeout { what, secs })
}

/// Agrega desde el `.torrent` en caché si existe (sin esperar metadatos, FR-13); si no, con el
/// magnet (`magnet` ya con los trackers, FR-10). Si el motor rechaza el `.torrent` (archivo
/// roto), se borra de la caché y se reintenta UNA vez con el magnet: si no, fallaría siempre.
pub async fn add_cached_or_magnet(
    engine: &dyn TorrentEngine,
    cached: &std::path::Path,
    magnet: Magnet,
    opts: AddOptions,
) -> Result<TorrentHandle> {
    if !cached.is_file() {
        return engine.add(TorrentSource::Magnet(magnet), opts).await;
    }
    match engine
        .add(TorrentSource::TorrentFile(cached.to_path_buf()), opts.clone())
        .await
    {
        Err(e) if !matches!(e, CoreError::Cancelled) => {
            tracing::warn!(
                ?cached,
                "`.torrent` en caché rechazado ({e}): lo borro y uso el magnet"
            );
            let _ = std::fs::remove_file(cached);
            engine.add(TorrentSource::Magnet(magnet), opts).await
        }
        r => r,
    }
}

/// Fábrica: la ÚNICA función que conoce las implementaciones concretas.
/// Cada llamada crea un motor independiente (proceso sidecar propio).
/// Sin conexiones entrantes ni DHT persistente: para el analizador y herramientas (ADR-30).
pub async fn create(config: &EngineConfig, paths: &AppPaths) -> Result<Arc<dyn TorrentEngine>> {
    create_with(config, paths, None).await
}

/// Motor de una reproducción: además escucha conexiones entrantes (si `incoming`) y guarda la
/// tabla del DHT en [`AppPaths::dht_file`] (ADR-30). webtorrent lo ignora.
pub async fn create_for_playback(
    config: &EngineConfig,
    paths: &AppPaths,
) -> Result<Arc<dyn TorrentEngine>> {
    create_with(config, paths, Some(paths.dht_file())).await
}

#[cfg_attr(not(feature = "rqbit"), allow(unused_variables))]
async fn create_with(
    config: &EngineConfig,
    paths: &AppPaths,
    dht_file: Option<PathBuf>,
) -> Result<Arc<dyn TorrentEngine>> {
    match config.kind {
        EngineKind::Webtorrent => Ok(Arc::new(
            webtorrent::WebtorrentSidecar::spawn(config).await?,
        )),
        #[cfg(feature = "rqbit")]
        EngineKind::Rqbit => Ok(Arc::new(
            rqbit::RqbitEmbedded::spawn(config, paths.rqbit_temp_dir(), dht_file).await?,
        )),
        #[cfg(not(feature = "rqbit"))]
        EngineKind::Rqbit => Err(crate::CoreError::Unsupported(
            "motor rqbit (compilar con la feature `rqbit`)",
        )),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn meta(names: &[&str]) -> Metadata {
        Metadata {
            files: names
                .iter()
                .enumerate()
                .map(|(i, n)| FileInfo {
                    index: i,
                    name: (*n).into(),
                    size: 100 + i as u64,
                    offset: 0,
                })
                .collect(),
            info_hash: InfoHash::from_bytes([0; 20]),
            name: String::new(),
            piece_length: 0,
            piece_count: 0,
            torrent_bytes: None,
        }
    }

    /// FR-49: pack sin `fileIdx` → el archivo del episodio pedido; con `fileIdx` → ese.
    #[test]
    fn elige_el_archivo_del_episodio() {
        let m = meta(&[
            "Serie/Serie.S01E01.mkv",
            "Serie/Serie.S01E03.mkv",
            "Serie/Serie.S01E13.mkv",
            "Serie/extras.txt",
        ]);
        let pick = |index, episode| m.pick_file(FilePick { index, episode }).unwrap().index;
        assert_eq!(pick(None, Some((1, 3))), 1);
        assert_eq!(pick(Some(0), Some((1, 3))), 0);
        assert_eq!(pick(None, Some((2, 1))), 2); // sin coincidencia: el más grande
        assert!(names_episode("Breaking_Bad_1x01_Pilot.mkv", 1, 1));
        assert!(!names_episode("Show.S01E010.mkv", 1, 1));
        assert!(!names_episode("Show.11x01.mkv", 1, 1));
    }
}
