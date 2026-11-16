//! `subtitles` — proveedores, detección del video, ranking, fusión ASS, sincronización, memoria
//! (FR-21–28, ADR-10/11/12). Interfaces definidas en F0; implementadas en F5/F6 (pedido del
//! usuario 2026-11-13: subtítulos antes que el resto de la UI).
//!
//! Submódulos:
//! - [`merge`]: lectura de SRT/ASS y fusión de hasta 5 en un único ASS (modo comparación, FR-25).
//! - [`providers`]: del torrent, Wyzie Subs, Subdivx (experimental), Gestdown, Subtitulamos y
//!   OpenSubtitles (FR-22, FR-24).
//! - [`secrets`]: API keys en el almacén seguro del sistema (NFR-16), nunca en `config.json`.
//! - [`session`]: lo que pasa mientras mpv está abierto: buscar, bajar, cargar, teclas, memoria.

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use async_trait::async_trait;
use serde::{Deserialize, Serialize};

use crate::config::SubtitleLanguage;
use crate::engine::{FileInfo, Metadata};
use crate::magnet::InfoHash;
use crate::video_key::VideoKey;
use crate::Result;

mod fetch;
mod merge;
pub mod providers;
pub mod secrets;
pub mod session;

pub use merge::merge_ass;

/// Cuántos subtítulos se cargan a la vez (FR-24/25: "al menos 5, o los que encuentre hasta 5").
pub const MAX_SUBTITLES: usize = 5;

/// Extensiones de subtítulo de texto que sabemos leer y fusionar.
pub const SUBTITLE_EXTENSIONS: &[&str] = &["srt", "ass", "ssa", "vtt"];

// ---------- Detección del video (FR-23) ----------

/// Lo que sabemos del video para buscar subtítulos.
#[derive(Debug, Clone, Default, Serialize)]
pub struct VideoIdentity {
    pub info_hash: Option<InfoHash>,
    pub file_name: String,
    pub file_size: u64,
    /// Hash OpenSubtitles (tamaño + primeros/últimos 64 KiB, YA precargados por `preload`).
    pub movie_hash: Option<u64>,
    pub title: Option<String>,
    pub year: Option<u16>,
    pub season: Option<u16>,
    pub episode: Option<u16>,
    pub source: Option<String>,
    pub release_group: Option<String>,
    pub duration_secs: Option<f64>,
    /// IMDb id (`tt…`) si se pudo resolver (Wyzie lo exige). Agregado en F6 (aditivo).
    pub imdb_id: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum Confidence {
    High,
    Medium,
    /// La UI pregunta "¿Es X?" con corrección (FR-23).
    Low,
}

impl VideoIdentity {
    /// Confianza de la identificación (FR-23): hash o título+año = alta; solo título = media.
    pub fn confidence(&self) -> Confidence {
        match (&self.title, self.year, self.movie_hash) {
            (_, _, Some(_)) | (Some(_), Some(_), _) => Confidence::High,
            (Some(_), None, _) if self.season.is_some() => Confidence::High,
            (Some(_), None, _) => Confidence::Medium,
            _ => Confidence::Low,
        }
    }
}

impl From<crate::release::ReleaseName> for VideoIdentity {
    fn from(r: crate::release::ReleaseName) -> Self {
        VideoIdentity {
            file_name: r.file_name,
            title: r.title,
            year: r.year,
            season: r.season,
            episode: r.episode,
            source: r.source,
            release_group: r.release_group,
            ..Default::default()
        }
    }
}

impl VideoIdentity {
    /// Identidad del video que se reproduce o mide: título/año del nombre del archivo y, si el
    /// archivo tiene nombre pobre ("video.mkv"), del nombre del torrent.
    pub fn for_file(file_name: &str, torrent_name: &str, info_hash: InfoHash, size: u64) -> Self {
        let mut video = Self::from(crate::release::parse_release_name(file_name));
        let from_torrent = crate::release::parse_release_name(torrent_name);
        if video.year.is_none() && from_torrent.year.is_some() {
            video.title = from_torrent.title;
            video.year = from_torrent.year;
        }
        video.info_hash = Some(info_hash);
        video.file_size = size;
        video
    }

    /// Toma el IMDb id del catálogo (FR-49) de la fila que es ESTE archivo (`file_index` dentro
    /// del torrent): mismo episodio, o película con el mismo archivo. Otra fila del mismo pack
    /// (otro episodio) no aplica.
    pub fn apply_catalog<'a>(
        &mut self,
        origins: impl IntoIterator<Item = &'a crate::library::CatalogOrigin>,
        file_index: usize,
    ) {
        let parsed = self
            .season
            .zip(self.episode)
            .map(|(s, e)| (u32::from(s), u32::from(e)));
        let found = origins.into_iter().find(|o| match o.season.zip(o.episode) {
            Some(ep) => Some(ep) == parsed,
            None => parsed.is_none() && o.file_idx.map_or(true, |i| i == file_index),
        });
        if let Some(o) = found {
            self.imdb_id = Some(o.imdb_id.clone());
        }
    }

    /// Qué película o episodio es, sin importar el torrent: dos torrents del mismo video
    /// comparten la carpeta de caché de subtítulos y se bajan una sola vez (2026-11-15).
    /// IMDb id (del catálogo) + SxxEyy; si no, título + año (película) o título + SxxEyy
    /// (episodio). Una película sin año es ambigua (remakes): por info hash, como antes.
    /// Va como nombre de carpeta.
    pub fn video_id(&self) -> String {
        let episode = self
            .season
            .zip(self.episode)
            .map(|(s, e)| format!("s{s:02}e{e:02}"));
        let title = self.title.as_deref().map(providers::normalized_title);
        let parts: Vec<String> = match (&self.imdb_id, title, self.year, episode) {
            (Some(imdb), _, _, ep) => [Some(imdb.to_lowercase()), ep]
                .into_iter()
                .flatten()
                .collect(),
            (None, Some(t), year, Some(ep)) if !t.is_empty() => {
                [Some(t), year.map(|y| y.to_string()), Some(ep)]
                    .into_iter()
                    .flatten()
                    .collect()
            }
            (None, Some(t), Some(y), None) if !t.is_empty() => vec![t, y.to_string()],
            _ => vec![self.info_hash.map_or_else(String::new, |h| h.to_hex())],
        };
        // Solo letras y números: el IMDb id viene del addon del catálogo y va a una ruta.
        let id: String = parts
            .join("-")
            .chars()
            .map(|c| if c.is_alphanumeric() { c } else { '-' })
            .take(100)
            .collect();
        if id.is_empty() {
            "desconocido".into()
        } else {
            id
        }
    }
}

/// Hash de OpenSubtitles: `size + Σ u64 LE de los primeros 64 KiB + Σ de los últimos 64 KiB`
/// (sumas con desborde, como el algoritmo de referencia). Si un trozo no es múltiplo de 8 bytes,
/// el resto se ignora (igual que la referencia, que lee de a 8).
pub fn movie_hash(size: u64, head_64k: &[u8], tail_64k: &[u8]) -> u64 {
    let sum = |bytes: &[u8]| {
        bytes.chunks_exact(8).fold(0u64, |acc, c| {
            acc.wrapping_add(u64::from_le_bytes(c.try_into().expect("8 bytes")))
        })
    };
    size.wrapping_add(sum(head_64k)).wrapping_add(sum(tail_64k))
}

/// Archivos de subtítulo del torrent que acompañan al video elegido (FR-22).
/// Con varios videos (pack de serie) solo los que llevan el nombre del video.
pub fn subtitle_files_for(metadata: &Metadata, video: &FileInfo) -> Vec<FileInfo> {
    let is_sub = |f: &&FileInfo| {
        Path::new(&f.name)
            .extension()
            .and_then(|e| e.to_str())
            .is_some_and(|e| SUBTITLE_EXTENSIONS.contains(&e.to_ascii_lowercase().as_str()))
            // Más de 2 MB no es un subtítulo de texto.
            && f.size < 2 * 1024 * 1024
    };
    let videos = metadata
        .files
        .iter()
        .filter(|f| crate::engine::is_video(&f.name))
        .count();
    let video_stem = Path::new(&video.name)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or_default()
        .to_lowercase();
    metadata
        .files
        .iter()
        .filter(is_sub)
        .filter(|f| videos <= 1 || f.name.to_lowercase().contains(&video_stem))
        .cloned()
        .collect()
}

// ---------- Proveedores (FR-24, R-02) ----------

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum MatchKind {
    // Orden de mejor a peor (FR-24): hash > release > duración > nada.
    Hash,
    Release,
    Duration,
    None,
}

pub use crate::audio::SpanishVariant;

#[derive(Debug, Clone, Serialize)]
pub struct SubtitleCandidate {
    pub provider: &'static str,
    pub provider_id: String,
    pub release_name: String,
    pub language: SubtitleLanguage,
    pub match_kind: MatchKind,
    pub downloads: u32,
    /// Agregado en F6 (aditivo): variante del español (ranking Q-03).
    pub variant: SpanishVariant,
    /// Agregado en F6 (aditivo): de dónde se baja (URL del proveedor o del motor, 127.0.0.1).
    #[serde(skip)]
    pub url: String,
}

impl SubtitleCandidate {
    /// Clave estable para la memoria por película (FR-28) y el nombre en caché.
    pub fn key(&self) -> String {
        format!("{}:{}", self.provider, self.provider_id)
    }
}

#[derive(Debug, Clone, Copy, Serialize)]
pub struct Quota {
    pub remaining: u32,
    pub per_day: u32,
}

/// Ordena y deja los mejores `n` (5 por FR-24). Orden (F6, anotado en spec 04):
/// 1. los del torrent primero (FR-22, ADR-12: son del mismo archivo),
/// 2. variante: latino > España > sin variante (Q-03),
/// 3. coincidencia: hash > release > duración > nada (FR-24),
/// 4. popularidad (descargas).
pub fn top_candidates(mut all: Vec<SubtitleCandidate>, n: usize) -> Vec<SubtitleCandidate> {
    all.sort_by(|a, b| {
        (a.provider != providers::TORRENT_PROVIDER)
            .cmp(&(b.provider != providers::TORRENT_PROVIDER))
            .then(a.variant.cmp(&b.variant))
            .then(a.match_kind.cmp(&b.match_kind))
            .then(b.downloads.cmp(&a.downloads))
    });
    all.truncate(n);
    all
}

// ---------- Comparación (FR-25, ADR-11) ----------

pub struct LabeledSubtitle {
    pub path: PathBuf,
    /// Lo que se muestra en pantalla delante de cada línea, p. ej. "1 · torrent/Sintel.es".
    pub label: String,
}

// ---------- Sincronización (FR-26, FR-27) ----------

/// Teclas de sync manual: Z −0,1 s · X +0,1 s · Shift ×10 · R reset (FR-26).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SyncKey {
    VoiceEarlier { big: bool },
    VoiceLater { big: bool },
    Reset,
}

/// Aplica una tecla al desfase actual (segundos, mismo signo que `sub-delay` de mpv).
/// "La voz llega antes" = el subtítulo viene tarde → hay que adelantarlo (desfase más negativo).
/// Se redondea a décimas para que 30 toques no acumulen error de punto flotante.
pub fn apply_sync_key(current_delay: f64, key: SyncKey) -> f64 {
    let step = |big: bool| if big { 1.0 } else { 0.1 };
    let next = match key {
        SyncKey::VoiceEarlier { big } => current_delay - step(big),
        SyncKey::VoiceLater { big } => current_delay + step(big),
        SyncKey::Reset => 0.0,
    };
    let rounded = (next * 10.0).round() / 10.0;
    // Evitar "-0,0".
    if rounded == 0.0 {
        0.0
    } else {
        rounded
    }
}

/// Mensaje en lenguaje claro para la pantalla, p. ej. "Subtítulos 0,3 s más tarde" (FR-26).
pub fn sync_message(delay: f64) -> String {
    let secs = (delay.abs() * 10.0).round() / 10.0;
    if secs == 0.0 {
        return "Subtítulos sin desfase (sincronización original)".into();
    }
    let amount = format!("{secs:.1}").replace('.', ",");
    if delay > 0.0 {
        format!("Subtítulos {amount} s más tarde")
    } else {
        format!("Subtítulos {amount} s antes")
    }
}

/// Sincronización automática contra el audio o un subtítulo de referencia (FR-27, F7).
#[async_trait]
pub trait AutoSync: Send + Sync {
    /// Devuelve el desfase a aplicar (segundos).
    async fn compute_offset(&self, subtitle: &Path, reference: SyncReference) -> Result<f64>;
}

pub enum SyncReference {
    /// URL del motor (audio del video).
    Audio(String),
    Subtitle(PathBuf),
}

// ---------- Memoria por película (FR-28) ----------

/// Valor especial de [`SubtitleChoice::subtitle`]: modo comparación (todos a la vez).
pub const CHOICE_ALL: &str = "all";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct SubtitleChoice {
    /// Clave del candidato (`proveedor:id`, ver [`SubtitleCandidate::key`]) o [`CHOICE_ALL`].
    pub subtitle: String,
    pub delay_secs: f64,
    /// Agregado en F6 (aditivo): etiqueta para volver a cargarlo desde la caché aunque el
    /// proveedor ya no lo devuelva entre los 5 mejores.
    #[serde(default)]
    pub label: Option<String>,
    /// Idioma de la sesión en que se eligió: una elección en español no aplica a una sesión en
    /// inglés. Los datos viejos no lo traen → español (el default, el único que había).
    #[serde(default)]
    pub language: SubtitleLanguage,
}

/// `subtitles-memory.json`: por video ([`VideoKey`] como texto: cada episodio de un pack tiene
/// la suya), el subtítulo elegido y el desfase (FR-28). Los datos viejos están por info hash,
/// que es la misma clave que un magnet pegado (el torrent entero).
pub struct SubtitleMemory {
    path: PathBuf,
}

impl SubtitleMemory {
    pub fn new(path: PathBuf) -> Self {
        Self { path }
    }

    fn load(&self) -> HashMap<String, SubtitleChoice> {
        match crate::fsutil::read_json(&self.path) {
            Ok(Some(map)) => map,
            Ok(None) => HashMap::new(),
            Err(e) => {
                // Corrupto: se aparta y se empieza de cero; nunca rompe la reproducción (NFR-12).
                tracing::warn!("subtitles-memory.json inválido: {e}");
                let _ = crate::fsutil::quarantine(&self.path);
                HashMap::new()
            }
        }
    }

    pub fn get(&self, key: &VideoKey) -> Result<Option<SubtitleChoice>> {
        Ok(self.load().remove(&key.to_string()))
    }

    pub fn set(&self, key: &VideoKey, choice: SubtitleChoice) -> Result<()> {
        let mut map = self.load();
        map.insert(key.to_string(), choice);
        crate::fsutil::write_json_atomic(&self.path, &map)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cand(
        provider: &'static str,
        variant: SpanishVariant,
        m: MatchKind,
        dl: u32,
    ) -> SubtitleCandidate {
        SubtitleCandidate {
            provider,
            provider_id: format!("{provider}-{variant:?}-{m:?}-{dl}"),
            release_name: String::new(),
            language: SubtitleLanguage::Es,
            match_kind: m,
            downloads: dl,
            variant,
            url: String::new(),
        }
    }

    #[test]
    fn ranking_latino_espana_sin_variante() {
        use SpanishVariant::*;
        let all = vec![
            cand("wyzie", Unknown, MatchKind::Hash, 900),
            cand("wyzie", Spain, MatchKind::Hash, 900),
            cand("subdivx", Latino, MatchKind::None, 1),
        ];
        let top = top_candidates(all, 5);
        let order: Vec<_> = top.iter().map(|c| c.variant).collect();
        assert_eq!(order, vec![Latino, Spain, Unknown]);
    }

    #[test]
    fn ranking_hash_release_duracion_popularidad() {
        use SpanishVariant::Latino;
        let all = vec![
            cand("wyzie", Latino, MatchKind::None, 10_000),
            cand("wyzie", Latino, MatchKind::Duration, 5),
            cand("wyzie", Latino, MatchKind::Release, 1),
            cand("wyzie", Latino, MatchKind::Hash, 0),
            cand("wyzie", Latino, MatchKind::Release, 50),
        ];
        let top = top_candidates(all, 5);
        let order: Vec<_> = top.iter().map(|c| (c.match_kind, c.downloads)).collect();
        assert_eq!(
            order,
            vec![
                (MatchKind::Hash, 0),
                (MatchKind::Release, 50),
                (MatchKind::Release, 1),
                (MatchKind::Duration, 5),
                (MatchKind::None, 10_000),
            ]
        );
    }

    #[test]
    fn ranking_torrent_primero_y_corta_en_n() {
        let mut all: Vec<_> = (0..8)
            .map(|i| cand("wyzie", SpanishVariant::Latino, MatchKind::Hash, i))
            .collect();
        all.push(cand(
            providers::TORRENT_PROVIDER,
            SpanishVariant::Unknown,
            MatchKind::Hash,
            0,
        ));
        let top = top_candidates(all, MAX_SUBTITLES);
        assert_eq!(top.len(), 5);
        assert_eq!(top[0].provider, providers::TORRENT_PROVIDER);
    }

    #[test]
    fn sync_teclas() {
        let d = apply_sync_key(0.0, SyncKey::VoiceEarlier { big: false });
        assert_eq!(d, -0.1);
        let d = apply_sync_key(d, SyncKey::VoiceEarlier { big: true });
        assert_eq!(d, -1.1);
        let d = apply_sync_key(d, SyncKey::VoiceLater { big: true });
        assert_eq!(d, -0.1);
        let d = apply_sync_key(d, SyncKey::VoiceLater { big: false });
        assert_eq!(d, 0.0);
        assert!(d.is_sign_positive(), "sin -0,0");
        assert_eq!(apply_sync_key(3.7, SyncKey::Reset), 0.0);
        // 30 toques de 0,1 s = 3,0 s exactos (sin error acumulado).
        let mut d = 0.0;
        for _ in 0..30 {
            d = apply_sync_key(d, SyncKey::VoiceLater { big: false });
        }
        assert_eq!(d, 3.0);
    }

    #[test]
    fn sync_mensajes_claros() {
        assert_eq!(sync_message(0.3), "Subtítulos 0,3 s más tarde");
        assert_eq!(sync_message(-1.5), "Subtítulos 1,5 s antes");
        assert_eq!(
            sync_message(0.0),
            "Subtítulos sin desfase (sincronización original)"
        );
        assert_eq!(
            sync_message(0.30000000000000004),
            "Subtítulos 0,3 s más tarde"
        );
    }

    /// Vector calculado con el algoritmo de referencia de OpenSubtitles (Python, struct.unpack
    /// "<q" de a 8 bytes con máscara de 64 bits) sobre datos sintéticos.
    #[test]
    fn movie_hash_vector_conocido() {
        let size: u64 = 1_000_000;
        let head: Vec<u8> = (0..65_536u32).map(|i| (i % 251) as u8).collect();
        let tail: Vec<u8> = (0..65_536u32).map(|i| (i * 7 % 256) as u8).collect();
        assert_eq!(
            format!("{:016x}", movie_hash(size, &head, &tail)),
            MOVIE_HASH_EXPECTED
        );
        // Desborde: no hace panic y envuelve.
        let ff = vec![0xFFu8; 65_536];
        let _ = movie_hash(u64::MAX, &ff, &ff);
    }
    const MOVIE_HASH_EXPECTED: &str = include_str!("../tests/fixtures/subtitles/movie-hash.txt");

    #[test]
    fn confianza_por_el_nombre() {
        let id = |name| VideoIdentity::from(crate::release::parse_release_name(name));
        let v = id("The.Martian.2015.1080p.WEB-DL.x264-NTb.mkv");
        assert_eq!(v.confidence(), Confidence::High);
        assert_eq!(id("Sintel/Sintel.mp4").confidence(), Confidence::Medium);
        let v = id("Show.Name.S01E02.720p.HDTV.x264-GRP.mkv");
        assert_eq!(v.confidence(), Confidence::High);
        // Archivo con nombre pobre: título y año salen del nombre del torrent.
        let h = InfoHash::from_bytes([1; 20]);
        let v = VideoIdentity::for_file("video.mkv", "The.Martian.2015.1080p", h, 9);
        assert_eq!((v.year, v.file_size, v.info_hash), (Some(2015), 9, Some(h)));
    }

    #[test]
    fn mismo_video_en_distintos_torrents_misma_identidad() {
        let (a, b) = (InfoHash::from_bytes([1; 20]), InfoHash::from_bytes([2; 20]));
        let ep = |name: &str, h| VideoIdentity::for_file(name, name, h, 1);
        // Sin catálogo: título + SxxEyy (o + año en películas), sin importar release ni torrent.
        let x = ep("Game.of.Thrones.S03E02.720p.HDTV.x264-IMMERSE.mkv", a);
        let y = ep("Game Of Thrones S03E02 1080p BluRay-DEMAND.mkv", b);
        assert_eq!(x.video_id(), "game-of-thrones-s03e02");
        assert_eq!(x.video_id(), y.video_id());
        assert_eq!(
            ep("Dune.Part.Two.2024.2160p.WEB-DL.mkv", a).video_id(),
            ep("Dune Part Two (2024) 1080p.mkv", b).video_id()
        );
        // Película sin año: ambigua (remakes) → por torrent, como antes.
        assert_eq!(ep("Dune.1080p.mkv", a).video_id(), a.to_hex());
        // Con catálogo: IMDb id + episodio, solo si la fila es este archivo.
        let origin = |s: Option<u32>, e: Option<u32>, file_idx| crate::library::CatalogOrigin {
            video_id: String::new(),
            imdb_id: "tt0944947".into(),
            title: "Game of Thrones".into(),
            year: None,
            season: s,
            episode: e,
            file_idx,
            addons: Vec::new(),
        };
        let mut x = x;
        x.apply_catalog(&[origin(Some(3), Some(1), None)], 0);
        assert_eq!(x.imdb_id, None, "otro episodio del pack: no aplica");
        x.apply_catalog(
            &[
                origin(Some(3), Some(1), None),
                origin(Some(3), Some(2), None),
            ],
            0,
        );
        assert_eq!(x.video_id(), "tt0944947-s03e02");
        let mut movie = ep("Dune.Part.Two.2024.mkv", a);
        movie.apply_catalog(&[origin(None, None, Some(4))], 3);
        assert_eq!(movie.imdb_id, None, "otro archivo del torrent");
        movie.apply_catalog(&[origin(None, None, Some(4))], 4);
        assert_eq!(movie.video_id(), "tt0944947");
    }

    #[test]
    fn archivos_de_subtitulo_del_torrent() {
        let f = |index, name: &str, size| FileInfo {
            index,
            name: name.into(),
            size,
            offset: 0,
        };
        let meta = Metadata {
            info_hash: InfoHash::from_bytes([0; 20]),
            name: "Sintel".into(),
            files: vec![
                f(0, "Sintel/Sintel.de.srt", 1000),
                f(1, "Sintel/Sintel.es.srt", 1000),
                f(2, "Sintel/Sintel.mp4", 129_000_000),
                f(3, "Sintel/poster.jpg", 1000),
            ],
            piece_length: 1,
            piece_count: 1,
            torrent_bytes: None,
        };
        let subs = subtitle_files_for(&meta, &meta.files[2]);
        assert_eq!(subs.len(), 2);
    }

    #[test]
    fn memoria_por_pelicula_ida_y_vuelta() {
        let dir =
            std::env::temp_dir().join(format!("streamonte-test-submem-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let mem = SubtitleMemory::new(dir.join("subtitles-memory.json"));
        let h = VideoKey::whole(InfoHash::from_bytes([7; 20]));
        assert_eq!(mem.get(&h).unwrap(), None);
        let choice = SubtitleChoice {
            subtitle: "wyzie:123".into(),
            delay_secs: -0.3,
            label: Some("2 · Wyzie/rel".into()),
            language: SubtitleLanguage::En,
        };
        mem.set(&h, choice.clone()).unwrap();
        mem.set(
            &VideoKey::whole(InfoHash::from_bytes([8; 20])),
            choice.clone(),
        )
        .unwrap();
        assert_eq!(mem.get(&h).unwrap(), Some(choice.clone()));
        // Otro episodio del mismo pack no hereda la elección.
        let e2 = VideoKey::new(InfoHash::from_bytes([7; 20]), Some((3, 2)), None);
        assert_eq!(mem.get(&e2).unwrap(), None);
        // Dato viejo (por info hash): es la clave del torrent entero.
        std::fs::write(
            dir.join("subtitles-memory.json"),
            format!(
                r#"{{"{}":{{"subtitle":"wyzie:9","delay_secs":1.0}}}}"#,
                "09".repeat(20)
            ),
        )
        .unwrap();
        let old = VideoKey::whole(InfoHash::from_bytes([9; 20]));
        assert_eq!(mem.get(&old).unwrap().unwrap().subtitle, "wyzie:9");
        // Datos de antes del campo `language`: se leen como español.
        let old: SubtitleChoice =
            serde_json::from_str(r#"{"subtitle":"wyzie:1","delay_secs":0.0}"#).unwrap();
        assert_eq!(old.language, SubtitleLanguage::Es);
        std::fs::remove_dir_all(dir).unwrap();
    }
}
