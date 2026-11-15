//! Motor rqbit EMBEBIDO: `librqbit` corre dentro del núcleo, sin proceso aparte (ADR-15, Q-08).
//!
//! Cómo cumple el contrato de `TorrentEngine`:
//! - Lección 1 / NFR-09: librqbit marca los archivos como sparse en Windows (FSCTL_SET_SPARSE)
//!   antes de escribir, así que escribir el final no rellena con ceros. Se verifica en T-01.
//! - Lección 3 / exclusividad: el torrent se agrega con `only_files = []` (nada seleccionado). Las
//!   únicas piezas que se piden son las de los streams abiertos: librqbit prioriza los ~32 MB
//!   siguientes a la posición de cada stream. La precarga abre un stream por rango y lo lee
//!   hasta el final ⇒ `RangeReady`. Recién `select_file` selecciona el archivo entero.
//! - Servidor HTTP propio, mínimo, solo en 127.0.0.1 con soporte de Range (NFR-16).
//! - `add` de librqbit espera los metadatos del magnet; por eso se resuelve en segundo plano
//!   y `add` devuelve enseguida (como el sidecar).

use std::collections::{HashMap, HashSet};
use std::net::Ipv6Addr;
use std::path::Path;
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering};
use std::sync::Mutex;
use std::time::Duration;

use async_trait::async_trait;
use librqbit::dht::{DhtPersistenceConfig, Id20};
use librqbit::{
    AddTorrent, AddTorrentOptions, DhtSessionConfig, ListenerMode, ListenerOptions, ManagedTorrent,
    Session, SessionOptions, SessionPersistenceConfig,
};
use tokio::io::{AsyncReadExt, AsyncSeekExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::{broadcast, watch};
use tokio::task::JoinHandle;

use super::*;
use crate::config::{EngineConfig, EngineKind};
use crate::logger::DIAG_ENGINE;
use crate::CoreError;

type Resolved = Option<std::result::Result<Arc<ManagedTorrent>, String>>;

struct Entry {
    torrent: watch::Receiver<Resolved>,
    resolver: JoinHandle<()>,
    dir: PathBuf,
    /// Tareas que leen los rangos de precarga (se abortan al cambiar de rangos o al quitar).
    range_tasks: Vec<JoinHandle<()>>,
    /// Bytes leídos por rango (progreso de la precarga).
    range_progress: Arc<Vec<(ByteRange, AtomicU64)>>,
    file_index: Option<usize>,
    /// El torrent ya agregado mientras verifica lo que hay en disco (antes de `torrent`).
    checking: Arc<Mutex<Option<Arc<ManagedTorrent>>>>,
    dht_peers: Arc<AtomicUsize>,
    dht_task: Option<JoinHandle<()>>,
}

struct Inner {
    session: Arc<Session>,
    entries: Mutex<HashMap<u64, Entry>>,
    events: broadcast::Sender<EngineEvent>,
    /// Solo el motor de una reproducción: estado de red para el log de Detalle; además activa
    /// el conteo periódico de peers (ADR-30).
    net_line: Option<String>,
    /// Persistencia de librqbit de ESTA instancia (solo para fastresume; se borra al apagar).
    state_dir: PathBuf,
}

pub struct RqbitEmbedded {
    inner: Arc<Inner>,
    next_handle: AtomicU64,
    http_port: u16,
    http_task: JoinHandle<()>,
    dht_lease: Mutex<Option<DhtLease>>,
}

/// Un solo motor por proceso guarda la tabla del DHT: librqbit escribe a `dht.json.tmp.<pid>`,
/// así que dos motores del mismo proceso se pisarían el temporal (ADR-30).
static DHT_OWNER: AtomicBool = AtomicBool::new(false);

struct DhtLease;

impl DhtLease {
    fn take() -> Option<Self> {
        (!DHT_OWNER.swap(true, Ordering::AcqRel)).then_some(Self)
    }
}

impl Drop for DhtLease {
    fn drop(&mut self) {
        DHT_OWNER.store(false, Ordering::Release);
    }
}

/// Primer puerto libre de `[a, b]`; 0 = que elija el SO. Se prueba en IPv4 e IPv6 porque
/// librqbit escucha en `[::]` doble pila.
fn free_port([a, b]: [u16; 2]) -> u16 {
    (a.min(b)..=a.max(b))
        .find(|&p| {
            std::net::TcpListener::bind(("0.0.0.0", p)).is_ok()
                && std::net::TcpListener::bind((Ipv6Addr::UNSPECIFIED, p)).is_ok()
        })
        .unwrap_or(0)
}

/// Bitfield de piezas verificadas, junto a los datos: viaja con la carpeta (FR-06d).
const BITV_FILE: &str = ".tstream-piezas.bitv";

/// Enlace duro (mismo archivo: lo que librqbit escriba después también queda); si no se puede
/// (otro volumen), copia: queda una foto vieja pero segura (librqbit verifica una muestra).
fn link_or_copy(from: &Path, to: &Path) {
    if let Some(parent) = to.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let _ = std::fs::remove_file(to);
    if std::fs::hard_link(from, to).is_err() {
        if let Err(e) = std::fs::copy(from, to) {
            tracing::debug!(target: DIAG_ENGINE, "fastresume {from:?} → {to:?}: {e}");
        }
    }
}

fn session_opts(
    config: &EngineConfig,
    listen_port: Option<u16>,
    dht_file: Option<&Path>,
    state_dir: &Path,
) -> SessionOptions {
    SessionOptions {
        dht: Some(DhtSessionConfig {
            // Solo en nuestra carpeta de caché; nunca en la ruta por defecto de librqbit.
            persistence: dht_file.map(|f| DhtPersistenceConfig {
                config_filename: Some(f.to_path_buf()),
                ..Default::default()
            }),
            ..Default::default()
        }),
        // Sin escucha, librqbit anuncia a los trackers un puerto falso (4240).
        listen: listen_port.map(|port| ListenerOptions {
            mode: if config.utp {
                ListenerMode::TcpAndUtp
            } else {
                ListenerMode::TcpOnly
            },
            listen_addr: (Ipv6Addr::UNSPECIFIED, port).into(),
            enable_upnp_port_forwarding: config.upnp,
            ..Default::default()
        }),
        // Persistencia solo para fastresume, en una carpeta propia de la instancia (vacía al
        // arrancar: no restaura torrents de otras). El bitfield real vive en la carpeta de datos.
        persistence: Some(SessionPersistenceConfig::Json {
            folder: Some(state_dir.to_path_buf()),
        }),
        fastresume: true,
        peer_limit: Some(config.max_connections as usize),
        ..Default::default()
    }
}

/// Para comparar antes/después (ADR-30). Un peer cuenta como entrante si alguna vez se conectó
/// él: librqbit no expone el sentido de la conexión actual.
fn peer_line(t: &ManagedTorrent) -> Option<(String, usize)> {
    let peers = t.live()?.per_peer_stats_snapshot(Default::default()).peers;
    let incoming = peers
        .values()
        .filter(|p| p.counters.incoming_connections > 0)
        .count();
    let mib_s = t
        .stats()
        .live
        .map(|l| l.download_speed.as_bytes() as f64 / 1_048_576.0)
        .unwrap_or_default();
    let line = format!(
        "peers: {} conectados ({incoming} entrantes, {} salientes) · {mib_s:.1} MiB/s",
        peers.len(),
        peers.len() - incoming
    );
    Some((line, incoming))
}

impl RqbitEmbedded {
    /// `dht_file` = motor de una reproducción: escucha entrantes (si `incoming`) y guarda el DHT
    /// ahí. `None` = analizador/herramientas: ni escucha ni persistencia (ADR-30).
    pub async fn spawn(config: &EngineConfig, dht_file: Option<PathBuf>) -> Result<Self> {
        let default_dir = std::env::temp_dir().join("tstream-v2").join("rqbit");
        let playback = dht_file.is_some();
        let lease = dht_file.as_ref().and_then(|_| DhtLease::take());
        let persist = dht_file.as_deref().filter(|_| lease.is_some());
        let listen_port = (playback && config.incoming).then(|| free_port(config.listen_ports));
        static INSTANCE: AtomicU64 = AtomicU64::new(0);
        // shortcut: si la app muere, esta carpeta (pocos KB) queda en %TEMP%; limpiarla al arrancar si molesta.
        let state_dir = default_dir.with_file_name("rqbit-state").join(format!(
            "{}-{}",
            std::process::id(),
            INSTANCE.fetch_add(1, Ordering::Relaxed)
        ));
        let _ = std::fs::remove_dir_all(&state_dir);
        let mut fallback = None;
        let session = match Session::new_with_opts(
            default_dir.clone(),
            session_opts(config, listen_port, persist, &state_dir),
        )
        .await
        {
            Ok(s) => s,
            // Puerto tomado entre la prueba y el bind, IPv6 apagado, puerto del DHT ocupado…:
            // se sigue como antes (sin entrantes ni persistencia) en vez de no reproducir.
            Err(e) if listen_port.is_some() || persist.is_some() => {
                tracing::warn!("rqbit: {e:#}; se reintenta sin escucha ni DHT persistente");
                fallback = Some(format!("{e:#}"));
                Session::new_with_opts(default_dir, session_opts(config, None, None, &state_dir))
                    .await
                    .map_err(|e| CoreError::Engine(format!("no se pudo iniciar rqbit: {e:#}")))?
            }
            Err(e) => {
                return Err(CoreError::Engine(format!(
                    "no se pudo iniciar rqbit: {e:#}"
                )))
            }
        };
        let lease = lease.filter(|_| fallback.is_none());
        let net_line = playback.then(|| {
            let incoming = match session.announce_port() {
                Some(port) => format!(
                    "entrantes: escucha TCP{} en el puerto {port}{} · {}",
                    if config.utp { "+uTP" } else { "" },
                    if listen_port == Some(0) {
                        format!(
                            " (los puertos {}–{} estaban ocupados: uno al azar)",
                            config.listen_ports[0], config.listen_ports[1]
                        )
                    } else {
                        String::new()
                    },
                    if config.upnp {
                        "UPnP pedido (resultado en el log general: \"successfully port forwarded\" o \"failed to forward port\")"
                    } else {
                        "UPnP apagado"
                    }
                ),
                None if !config.incoming => {
                    "entrantes: apagadas (engine.incoming = false); solo salientes".into()
                }
                None => format!(
                    "entrantes: no se pudo escuchar, solo salientes ({})",
                    fallback.as_deref().unwrap_or("sin detalle")
                ),
            };
            let dht = if lease.is_some() {
                "DHT persistente"
            } else {
                "DHT sin guardar (ya lo guarda otra reproducción o falló)"
            };
            format!("{incoming} · {dht}")
        });
        if let Some(line) = &net_line {
            tracing::info!("rqbit red: {line}");
        }
        let (events, _) = broadcast::channel(256);
        let inner = Arc::new(Inner {
            session,
            entries: Mutex::default(),
            events,
            net_line,
            state_dir,
        });

        let listener = TcpListener::bind(("127.0.0.1", 0))
            .await
            .map_err(|e| CoreError::Engine(format!("servidor HTTP local: {e}")))?;
        let http_port = listener.local_addr().map(|a| a.port()).unwrap_or_default();
        let http_task = tokio::spawn(serve_http(listener, inner.clone()));
        tracing::info!(http_port, "rqbit embebido listo");

        Ok(Self {
            inner,
            next_handle: AtomicU64::new(1),
            http_port,
            http_task,
            dht_lease: Mutex::new(lease),
        })
    }
}

impl Inner {
    fn torrent_rx(&self, handle: TorrentHandle) -> Result<watch::Receiver<Resolved>> {
        self.entries
            .lock()
            .expect("entries")
            .get(&handle.0)
            .map(|e| e.torrent.clone())
            .ok_or_else(|| CoreError::Engine(format!("handle desconocido: {}", handle.0)))
    }

    /// Espera a que el torrent tenga metadatos y esté inicializado.
    async fn torrent(&self, handle: TorrentHandle) -> Result<Arc<ManagedTorrent>> {
        let mut rx = self.torrent_rx(handle)?;
        let resolved = rx
            .wait_for(Option::is_some)
            .await
            .map_err(|_| CoreError::Engine("el torrent fue quitado".into()))?
            .clone()
            .expect("is_some");
        resolved.map_err(CoreError::Engine)
    }
}

fn to_metadata(t: &ManagedTorrent) -> Result<Metadata> {
    t.with_metadata(|m| {
        let files: Vec<FileInfo> = m
            .file_infos
            .iter()
            .enumerate()
            .map(|(index, f)| FileInfo {
                index,
                name: f.relative_filename.to_string_lossy().into_owned(),
                size: f.len,
                offset: f.offset_in_torrent,
            })
            .collect();
        let piece_length = u64::from(m.lengths().default_piece_length());
        let total: u64 = files.iter().map(|f| f.size).sum();
        Metadata {
            info_hash: InfoHash::from_bytes(t.info_hash().0),
            name: t.name().unwrap_or_default(),
            files,
            piece_length,
            piece_count: total.div_ceil(piece_length.max(1)) as u32,
            torrent_bytes: Some(m.torrent_bytes.to_vec()),
        }
    })
    .map_err(|e| CoreError::Engine(format!("{e:#}")))
}

#[async_trait]
impl TorrentEngine for RqbitEmbedded {
    fn kind(&self) -> EngineKind {
        EngineKind::Rqbit
    }

    async fn add(&self, source: TorrentSource, opts: AddOptions) -> Result<TorrentHandle> {
        let handle = TorrentHandle(self.next_handle.fetch_add(1, Ordering::Relaxed));
        tokio::fs::create_dir_all(&opts.download_dir)
            .await
            .map_err(|source| CoreError::Io {
                path: opts.download_dir.clone(),
                source,
            })?;
        let (add, id, magnet) = match source {
            TorrentSource::Magnet(m) => (
                AddTorrent::from_url(m.to_uri()),
                Id20::new(*m.info_hash.as_bytes()),
                true,
            ),
            TorrentSource::TorrentFile(path) => {
                let bytes = tokio::fs::read(&path)
                    .await
                    .map_err(|source| CoreError::Io {
                        path: path.clone(),
                        source,
                    })?;
                let id = librqbit::torrent_from_bytes(&bytes)
                    .map(|t| t.info_hash)
                    .map_err(|e| CoreError::Engine(format!(".torrent inválido: {e:#}")))?;
                (AddTorrent::from_bytes(bytes), id, false)
            }
        };
        // Fastresume: lo ya verificado en esta carpeta no se vuelve a hashear entero (un
        // archivo de 60 GB tardaba más que el timeout de metadatos). Mismo nombre que usa librqbit.
        let state_bitv = self.inner.state_dir.join(format!("{id:?}.bitv"));
        let dir_bitv = opts.download_dir.join(BITV_FILE);
        if dir_bitv.is_file() {
            link_or_copy(&dir_bitv, &state_bitv);
        }
        let checking: Arc<Mutex<Option<Arc<ManagedTorrent>>>> = Arc::default();
        // Magnet sin metadatos: cuántos peers aparecen por DHT mientras se espera, para
        // distinguir "sin peers" de "peers pero no dan metadatos".
        let dht_peers = Arc::new(AtomicUsize::new(0));
        let dht = magnet
            .then(|| self.inner.session.get_dht().cloned())
            .flatten();
        let dht_task = dht.map(|dht| {
            let found = dht_peers.clone();
            tokio::spawn(async move {
                use futures_util::StreamExt;
                let mut seen = HashSet::new();
                let mut peers = dht.get_peers(id, None);
                while let Some(addr) = peers.next().await {
                    if seen.insert(addr) {
                        found.store(seen.len(), Ordering::Relaxed);
                    }
                }
            })
        });
        let add_opts = AddTorrentOptions {
            // Lección 3: nada seleccionado; solo los streams piden piezas.
            only_files: if opts.start_deselected {
                Some(Vec::new())
            } else {
                None
            },
            overwrite: true,
            output_folder: Some(opts.download_dir.to_string_lossy().into_owned()),
            trackers: Some(opts.trackers.clone()),
            ..Default::default()
        };

        let (tx, rx) = watch::channel::<Resolved>(None);
        let inner = self.inner.clone();
        let started = std::time::Instant::now();
        let pending = checking.clone();
        let dht_abort = dht_task.as_ref().map(|t| t.abort_handle());
        let resolver = tokio::spawn(async move {
            let result = async {
                let response = inner
                    .session
                    .add_torrent(add, Some(add_opts))
                    .await
                    .map_err(|e| format!("{e:#}"))?;
                let torrent = response
                    .into_handle()
                    .ok_or("rqbit no devolvió el torrent")?;
                *pending.lock().expect("checking") = Some(torrent.clone());
                torrent
                    .wait_until_initialized()
                    .await
                    .map_err(|e| format!("{e:#}"))?;
                // librqbit reescribe su bitfield tras un chequeo completo y lo borra al quitar el
                // torrent: un enlace duro en la carpeta lo conserva (y sigue al día) para la próxima.
                let _ = std::fs::remove_file(&dir_bitv);
                link_or_copy(&state_bitv, &dir_bitv);
                Ok::<_, String>(torrent)
            }
            .await;
            match &result {
                Ok(t) => {
                    let _ = inner.events.send(EngineEvent::Log {
                        handle: Some(handle),
                        line: format!(
                            "metadatos en {:.1} s (rqbit)",
                            started.elapsed().as_secs_f32()
                        ),
                    });
                    if let Ok(meta) = to_metadata(t) {
                        let _ = inner.events.send(EngineEvent::Metadata {
                            handle,
                            metadata: Arc::new(meta),
                        });
                    }
                }
                Err(e) => {
                    let _ = inner.events.send(EngineEvent::Error {
                        handle: Some(handle),
                        message: e.clone(),
                    });
                }
            }
            let watch_peers = inner.net_line.clone().zip(result.as_ref().ok().cloned());
            let _ = tx.send(Some(result));
            if let Some(t) = dht_abort {
                t.abort();
            }
            // Reproducción: estado de red y peers cada 10 s al log de Detalle (ADR-30). Termina
            // cuando `remove` aborta esta tarea.
            if let Some((net_line, torrent)) = watch_peers {
                let log = |line| {
                    let _ = inner.events.send(EngineEvent::Log {
                        handle: Some(handle),
                        line,
                    });
                };
                log(net_line);
                let listening = inner.session.announce_port().is_some();
                let mut tick = 0u32;
                loop {
                    tick = tick.saturating_add(1);
                    tokio::time::sleep(Duration::from_secs(10)).await;
                    let Some((line, incoming)) = peer_line(&torrent) else {
                        continue;
                    };
                    log(line);
                    // Desde adentro no se distingue firewall, UPnP ausente o doble NAT: se avisa una vez.
                    if listening && tick == 12 && incoming == 0 {
                        log("entrantes: 0 en 2 min — firewall que bloquea, router sin UPnP o doble NAT; sigue solo con salientes".into());
                    }
                }
            }
        });

        self.inner.entries.lock().expect("entries").insert(
            handle.0,
            Entry {
                torrent: rx,
                resolver,
                dir: opts.download_dir,
                range_tasks: Vec::new(),
                range_progress: Arc::new(Vec::new()),
                file_index: None,
                checking,
                dht_peers,
                dht_task,
            },
        );
        Ok(handle)
    }

    async fn metadata(&self, handle: TorrentHandle) -> Result<Arc<Metadata>> {
        let t = self.inner.torrent(handle).await?;
        Ok(Arc::new(to_metadata(&t)?))
    }

    async fn waiting_on(&self, handle: TorrentHandle) -> Option<Waiting> {
        let entries = self.inner.entries.lock().expect("entries");
        let e = entries.get(&handle.0)?;
        let checking = e.checking.lock().expect("checking").clone();
        Some(match checking {
            Some(t) => {
                let s = t.stats();
                Waiting::Checking {
                    done: s.progress_bytes,
                    total: s.total_bytes,
                }
            }
            None => Waiting::Metadata {
                peers: e
                    .dht_task
                    .as_ref()
                    .map(|_| e.dht_peers.load(Ordering::Relaxed)),
            },
        })
    }

    async fn prioritize_ranges(
        &self,
        handle: TorrentHandle,
        file_index: usize,
        ranges: &[ByteRange],
        _mode: PriorityMode,
    ) -> Result<()> {
        let torrent = self.inner.torrent(handle).await?;
        let progress: Arc<Vec<(ByteRange, AtomicU64)>> =
            Arc::new(ranges.iter().map(|r| (*r, AtomicU64::new(0))).collect());
        let mut tasks = Vec::new();
        for (i, range) in ranges.iter().copied().enumerate() {
            let torrent = torrent.clone();
            let progress = progress.clone();
            let events = self.inner.events.clone();
            tasks.push(tokio::spawn(async move {
                let result = async {
                    let mut stream = torrent.stream(file_index).await?;
                    stream.seek(std::io::SeekFrom::Start(range.start)).await?;
                    let mut remaining = range.end - range.start;
                    let mut buf = vec![0u8; 256 * 1024];
                    while remaining > 0 {
                        let want = remaining.min(buf.len() as u64) as usize;
                        let n = stream.read(&mut buf[..want]).await?;
                        if n == 0 {
                            break;
                        }
                        remaining -= n as u64;
                        progress[i].1.fetch_add(n as u64, Ordering::Relaxed);
                    }
                    Ok::<_, anyhow::Error>(())
                }
                .await;
                match result {
                    Ok(()) => {
                        let _ = events.send(EngineEvent::RangeReady {
                            handle,
                            file_index,
                            range,
                        });
                    }
                    Err(e) => {
                        let _ = events.send(EngineEvent::Log {
                            handle: Some(handle),
                            line: format!("rango {}-{}: {e:#}", range.start, range.end),
                        });
                    }
                }
            }));
        }
        let mut entries = self.inner.entries.lock().expect("entries");
        if let Some(entry) = entries.get_mut(&handle.0) {
            for t in entry.range_tasks.drain(..) {
                t.abort();
            }
            entry.range_tasks = tasks;
            entry.range_progress = progress;
            entry.file_index = Some(file_index);
        }
        Ok(())
    }

    async fn select_file(&self, handle: TorrentHandle, file_index: usize) -> Result<()> {
        let torrent = self.inner.torrent(handle).await?;
        self.inner
            .session
            .update_only_files(&torrent, &HashSet::from([file_index]))
            .await
            .map_err(|e| CoreError::Engine(format!("{e:#}")))?;
        if let Some(entry) = self
            .inner
            .entries
            .lock()
            .expect("entries")
            .get_mut(&handle.0)
        {
            entry.file_index = Some(file_index);
        }
        Ok(())
    }

    async fn stream_url(&self, handle: TorrentHandle, file_index: usize) -> Result<String> {
        self.inner.torrent(handle).await?;
        Ok(format!(
            "http://127.0.0.1:{}/{}/{}",
            self.http_port, handle.0, file_index
        ))
    }

    async fn stats(&self, handle: TorrentHandle) -> Result<Stats> {
        let torrent = self.inner.torrent(handle).await?;
        let (file_index, range_progress) = {
            let entries = self.inner.entries.lock().expect("entries");
            let e = entries
                .get(&handle.0)
                .ok_or_else(|| CoreError::Engine("handle desconocido".into()))?;
            (e.file_index, e.range_progress.clone())
        };
        let s = torrent.stats();
        let piece_length = torrent
            .with_metadata(|m| u64::from(m.lengths().default_piece_length()))
            .unwrap_or(1)
            .max(1);
        let (speed, peers) = s
            .live
            .as_ref()
            .map(|l| {
                (
                    l.download_speed.as_bytes() as f64,
                    l.snapshot.peer_stats.live,
                )
            })
            .unwrap_or_default();
        let file_len = file_index.and_then(|i| {
            torrent
                .with_metadata(|m| m.file_infos.get(i).map(|f| f.len))
                .ok()
                .flatten()
        });
        let file_done = file_index.and_then(|i| s.file_progress.get(i).copied());
        Ok(Stats {
            downloaded_bytes: file_done.unwrap_or(s.progress_bytes),
            // Bytes recibidos de peers (antes de verificar la pieza).
            received_bytes: s
                .live
                .as_ref()
                .map(|l| l.snapshot.fetched_bytes)
                .unwrap_or(s.progress_bytes),
            download_speed_bps: speed,
            upload_speed_bps: s
                .live
                .as_ref()
                .map(|l| l.upload_speed.as_bytes() as f64)
                .unwrap_or_default(),
            peers,
            seeds: s
                .live
                .as_ref()
                .map(|l| l.snapshot.peer_stats.live_seeders)
                .unwrap_or_default(),
            progress: match (file_done, file_len) {
                (Some(d), Some(l)) if l > 0 => d as f32 / l as f32,
                _ if s.total_bytes > 0 => s.progress_bytes as f32 / s.total_bytes as f32,
                _ => 0.0,
            },
            paused: torrent.is_paused(),
            ranges: range_progress
                .iter()
                .map(|(range, read)| {
                    let total = (range.end - range.start).div_ceil(piece_length) as u32;
                    let done = (read.load(Ordering::Relaxed) / piece_length) as u32;
                    RangeProgress {
                        range: *range,
                        pieces_done: done.min(total),
                        pieces_total: total,
                        peers_with_missing: 0, // librqbit no lo expone
                    }
                })
                .collect(),
        })
    }

    async fn pause(&self, handle: TorrentHandle) -> Result<()> {
        let t = self.inner.torrent(handle).await?;
        self.inner
            .session
            .pause(&t)
            .await
            .map_err(|e| CoreError::Engine(format!("{e:#}")))
    }

    async fn resume(&self, handle: TorrentHandle) -> Result<()> {
        let t = self.inner.torrent(handle).await?;
        self.inner
            .session
            .unpause(&t)
            .await
            .map_err(|e| CoreError::Engine(format!("{e:#}")))
    }

    async fn remove(&self, handle: TorrentHandle, opts: RemoveOptions) -> Result<()> {
        let Some(entry) = self
            .inner
            .entries
            .lock()
            .expect("entries")
            .remove(&handle.0)
        else {
            return Ok(());
        };
        for t in &entry.range_tasks {
            t.abort();
        }
        entry.resolver.abort();
        if let Some(t) = &entry.dht_task {
            t.abort();
        }
        let resolved = entry.torrent.borrow().clone();
        if let Some(Ok(t)) = resolved {
            if let Err(e) = self
                .inner
                .session
                .delete(t.id().into(), opts.delete_data)
                .await
            {
                tracing::warn!(target: DIAG_ENGINE, "rqbit delete: {e:#}");
            }
        }
        if opts.delete_data {
            let _ = tokio::fs::remove_dir_all(&entry.dir).await;
        }
        Ok(())
    }

    fn subscribe(&self) -> broadcast::Receiver<EngineEvent> {
        self.inner.events.subscribe()
    }

    async fn shutdown(&self) -> Result<()> {
        let handles: Vec<u64> = self
            .inner
            .entries
            .lock()
            .expect("entries")
            .keys()
            .copied()
            .collect();
        // Como el sidecar: apagar no borra datos (FR-06d conserva lo del análisis aunque se
        // cancele). Quien quiere borrar llama `remove(delete_data)` o `cleanup.remove_dir`.
        for h in handles {
            let _ = self
                .remove(TorrentHandle(h), RemoveOptions { delete_data: false })
                .await;
        }
        self.http_task.abort();
        let _ = tokio::time::timeout(Duration::from_secs(5), self.inner.session.stop()).await;
        let _ = tokio::fs::remove_dir_all(&self.inner.state_dir).await;
        // Recién con la sesión parada otra reproducción puede tomar el DHT persistente.
        self.dht_lease.lock().expect("dht_lease").take();
        let _ = self.inner.events.send(EngineEvent::Exited { code: None });
        Ok(())
    }
}

// ---------- servidor HTTP mínimo (solo 127.0.0.1, con Range) ----------

async fn serve_http(listener: TcpListener, inner: Arc<Inner>) {
    loop {
        let Ok((socket, _)) = listener.accept().await else {
            continue;
        };
        let inner = inner.clone();
        tokio::spawn(async move {
            if let Err(e) = handle_http(socket, &inner).await {
                tracing::debug!(target: DIAG_ENGINE, "http: {e:#}");
            }
        });
    }
}

async fn handle_http(mut socket: TcpStream, inner: &Inner) -> anyhow::Result<()> {
    // Leer cabeceras (máx. 16 KiB).
    let mut head = Vec::with_capacity(1024);
    let mut byte = [0u8; 1];
    while !head.ends_with(b"\r\n\r\n") {
        if socket.read(&mut byte).await? == 0 || head.len() > 16 * 1024 {
            return Ok(());
        }
        head.push(byte[0]);
    }
    let head = String::from_utf8_lossy(&head);
    let mut lines = head.split("\r\n");
    let mut parts = lines.next().unwrap_or_default().split_whitespace();
    let method = parts.next().unwrap_or_default().to_string();
    let path = parts.next().unwrap_or_default().to_string();
    let range_header = lines
        .filter_map(|l| l.split_once(':'))
        .find(|(k, _)| k.trim().eq_ignore_ascii_case("range"))
        .map(|(_, v)| v.trim().to_string());

    let mut segs = path.trim_start_matches('/').split('/');
    let (Some(Ok(h)), Some(Ok(file_index))) = (
        segs.next().map(str::parse::<u64>),
        segs.next().map(str::parse::<usize>),
    ) else {
        socket
            .write_all(b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")
            .await?;
        return Ok(());
    };
    let Ok(torrent) = inner.torrent(TorrentHandle(h)).await else {
        socket
            .write_all(b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")
            .await?;
        return Ok(());
    };
    let (file_len, name) = torrent
        .with_metadata(|m| {
            m.file_infos
                .get(file_index)
                .map(|f| (f.len, f.relative_filename.to_string_lossy().into_owned()))
        })?
        .ok_or_else(|| anyhow::anyhow!("archivo inexistente"))?;

    let (start, end) = parse_range(range_header.as_deref(), file_len);
    if start >= file_len && file_len > 0 {
        let msg = format!("HTTP/1.1 416 Range Not Satisfiable\r\nContent-Range: bytes */{file_len}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
        socket.write_all(msg.as_bytes()).await?;
        return Ok(());
    }
    let len = end - start + 1;
    let status = if range_header.is_some() {
        "206 Partial Content"
    } else {
        "200 OK"
    };
    let mut resp = format!(
        "HTTP/1.1 {status}\r\nContent-Type: {}\r\nAccept-Ranges: bytes\r\nContent-Length: {len}\r\nConnection: close\r\n",
        mime_of(&name)
    );
    if range_header.is_some() {
        resp.push_str(&format!(
            "Content-Range: bytes {start}-{end}/{file_len}\r\n"
        ));
    }
    resp.push_str("\r\n");
    socket.write_all(resp.as_bytes()).await?;
    if method.eq_ignore_ascii_case("HEAD") {
        return Ok(());
    }
    let mut stream = torrent.stream(file_index).await?;
    stream.seek(std::io::SeekFrom::Start(start)).await?;
    tokio::io::copy(&mut stream.take(len), &mut socket).await?;
    Ok(())
}

/// `bytes=a-b`, `bytes=a-`, `bytes=-n` → (inicio, fin inclusive).
fn parse_range(header: Option<&str>, len: u64) -> (u64, u64) {
    let last = len.saturating_sub(1);
    let Some(spec) = header.and_then(|h| h.trim().strip_prefix("bytes=")) else {
        return (0, last);
    };
    let spec = spec.split(',').next().unwrap_or_default().trim();
    match spec.split_once('-') {
        Some(("", n)) => {
            let n: u64 = n.parse().unwrap_or(0);
            (len.saturating_sub(n), last)
        }
        Some((a, "")) => (a.parse().unwrap_or(0), last),
        Some((a, b)) => (
            a.parse().unwrap_or(0),
            b.parse::<u64>().unwrap_or(last).min(last),
        ),
        None => (0, last),
    }
}

fn mime_of(name: &str) -> &'static str {
    match name
        .rsplit('.')
        .next()
        .map(str::to_ascii_lowercase)
        .as_deref()
    {
        Some("mp4" | "m4v") => "video/mp4",
        Some("mkv") => "video/x-matroska",
        Some("webm") => "video/webm",
        Some("mov") => "video/quicktime",
        _ => "application/octet-stream",
    }
}

#[cfg(test)]
mod tests {
    use super::{free_port, parse_range, DhtLease};

    #[test]
    fn puerto_ocupado_salta_al_siguiente_o_al_azar() {
        let busy = std::net::TcpListener::bind(("0.0.0.0", 0)).unwrap();
        let p = busy.local_addr().unwrap().port();
        assert_eq!(free_port([p, p]), 0);
        assert_ne!(free_port([p, p.saturating_add(20)]), p);
    }

    #[test]
    fn un_solo_dueno_del_dht() {
        let first = DhtLease::take().expect("libre");
        assert!(DhtLease::take().is_none());
        drop(first);
        assert!(DhtLease::take().is_some());
    }

    /// El bug de los 60 s: con el `.torrent` en caché y datos ya en la carpeta, librqbit
    /// re-hasheaba el archivo entero antes de dar "metadatos". Con el bitfield guardado no.
    #[tokio::test(flavor = "multi_thread")]
    async fn bitfield_guardado_evita_reverificar_lo_bajado() {
        use super::super::{
            wait_metadata, AddOptions, RemoveOptions, TorrentEngine, TorrentSource,
        };
        use super::{RqbitEmbedded, BITV_FILE};

        let root =
            std::env::temp_dir().join(format!("tstream-test-fastresume-{}", std::process::id()));
        let dir = root.join("datos");
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&dir).unwrap();
        let data: Vec<u8> = (0..4 * 16384u32).map(|i| (i * 7 % 251) as u8).collect();
        std::fs::write(dir.join("video.bin"), &data).unwrap();
        let t = librqbit::create_torrent(
            &dir.join("video.bin"),
            librqbit::CreateTorrentOptions {
                name: None,
                trackers: vec![],
                piece_length: Some(16384),
            },
            &librqbit::spawn_utils::BlockingSpawner::new(1),
        )
        .await
        .unwrap();
        let torrent_file = root.join("cache.torrent");
        std::fs::write(&torrent_file, t.as_bytes().unwrap()).unwrap();
        let cfg = crate::config::EngineConfig::default();
        let opts = || AddOptions {
            trackers: vec![],
            download_dir: dir.clone(),
            only_file: None,
            start_deselected: true,
        };
        let bitv = dir.join(BITV_FILE);

        // 1ª vez (sin bitfield): chequeo completo; el bitfield queda junto a los datos aunque
        // librqbit borre el suyo al quitar el torrent. 4 piezas → 1111_0000.
        let e = RqbitEmbedded::spawn(&cfg, None).await.unwrap();
        let h = e
            .add(TorrentSource::TorrentFile(torrent_file.clone()), opts())
            .await
            .unwrap();
        wait_metadata(&e, h, 30).await.unwrap();
        e.remove(h, RemoveOptions { delete_data: false })
            .await
            .unwrap();
        e.shutdown().await.unwrap();
        assert_eq!(std::fs::read(&bitv).unwrap(), [0b1111_0000]);

        // 2ª vez con un bitfield que dice "nada": si librqbit re-verificara el disco volvería a
        // 1111_0000; con fastresume lo usa tal cual y no hashea el archivo.
        std::fs::write(&bitv, [0u8]).unwrap();
        let e = RqbitEmbedded::spawn(&cfg, None).await.unwrap();
        let h = e
            .add(TorrentSource::TorrentFile(torrent_file), opts())
            .await
            .unwrap();
        wait_metadata(&e, h, 30).await.unwrap();
        assert_eq!(std::fs::read(&bitv).unwrap(), [0u8]);
        e.shutdown().await.unwrap();
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn rangos_http() {
        assert_eq!(parse_range(None, 100), (0, 99));
        assert_eq!(parse_range(Some("bytes=10-19"), 100), (10, 19));
        assert_eq!(parse_range(Some("bytes=90-"), 100), (90, 99));
        assert_eq!(parse_range(Some("bytes=-5"), 100), (95, 99));
        assert_eq!(parse_range(Some("bytes=50-500"), 100), (50, 99));
    }
}
