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
//!
//! Submódulos:
//! - [`net`]: escucha, UPnP, DHT persistente, opciones de la sesión y log de red/peers (ADR-30).
//! - [`fastresume`]: el bitfield de piezas verificadas, guardado junto a los datos.
//! - [`http`]: el servidor del stream.

mod fastresume;
mod http;
mod net;

use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};
use std::sync::Mutex;
use std::time::Duration;

use async_trait::async_trait;
use librqbit::dht::Id20;
use librqbit::{AddTorrent, AddTorrentOptions, ManagedTorrent, Session};
use tokio::io::{AsyncReadExt, AsyncSeekExt};
use tokio::net::TcpListener;
use tokio::sync::{broadcast, watch};
use tokio::task::JoinHandle;

use super::*;
use crate::config::EngineConfig;
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
    /// Solo reproducción: log periódico de red y peers (ADR-30).
    peer_watch: Option<JoinHandle<()>>,
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
    /// Vive con la sesión (aunque el motor se suelte sin `shutdown`): mientras exista, ninguna
    /// otra sesión guarda `dht.json` (ADR-30).
    dht_lease: Mutex<Option<net::DhtLease>>,
}

pub struct RqbitEmbedded {
    inner: Arc<Inner>,
    next_handle: AtomicU64,
    http_port: u16,
    http_task: JoinHandle<()>,
}

/// Sin `shutdown()`: las tareas guardan `Arc<Inner>` y la sesión seguiría viva para siempre.
impl Drop for RqbitEmbedded {
    fn drop(&mut self) {
        self.http_task.abort();
        if let Ok(entries) = self.inner.entries.lock() {
            for e in entries.values() {
                e.resolver.abort();
                e.range_tasks.iter().for_each(JoinHandle::abort);
                if let Some(t) = &e.dht_task {
                    t.abort();
                }
                if let Some(t) = &e.peer_watch {
                    t.abort();
                }
            }
        }
        self.inner.session.cancellation_token().cancel();
    }
}

/// "Verificar puerto" (2026-11-16): una sesión sin torrents que escucha en `port` y pide el
/// reenvío por UPnP igual que el motor de una reproducción. Cancelar el token la cierra.
pub(super) async fn hold_port(
    config: &EngineConfig,
    default_dir: PathBuf,
    port: u16,
) -> Result<Arc<Session>> {
    let state_dir = default_dir
        .with_file_name("rqbit-state")
        .join(format!("{}-puerto", std::process::id()));
    let _ = std::fs::remove_dir_all(&state_dir);
    Session::new_with_opts(
        default_dir,
        net::session_opts(config, Some(port), None, &state_dir),
    )
    .await
    .map_err(|e| CoreError::Engine(format!("no se pudo escuchar en el puerto {port}: {e:#}")))
}

impl RqbitEmbedded {
    /// `default_dir` = carpeta efímera de la sesión ([`AppPaths::rqbit_temp_dir`]); su estado va
    /// al lado, en `rqbit-state`. `dht_file` = motor de una reproducción: escucha entrantes (si
    /// `incoming`) y guarda el DHT ahí (también el conteo profundo con `announce_early`).
    /// `None` = análisis rápido/herramientas: ni escucha ni persistencia (ADR-30).
    pub async fn spawn(
        config: &EngineConfig,
        default_dir: PathBuf,
        dht_file: Option<PathBuf>,
    ) -> Result<Self> {
        let playback = dht_file.is_some();
        let lease = dht_file.as_ref().and_then(|_| net::DhtLease::take());
        let persist = dht_file.as_deref().filter(|_| lease.is_some());
        let listen_port =
            (playback && config.incoming).then(|| net::free_port(config.listen_ports));
        static INSTANCE: AtomicU64 = AtomicU64::new(0);
        // shortcut: si la app muere, esta carpeta (pocos KB) queda en %TEMP%; limpiarla al arrancar si molesta.
        let state_dir = default_dir.with_file_name("rqbit-state").join(format!(
            "{}-{}",
            std::process::id(),
            INSTANCE.fetch_add(1, Ordering::Relaxed)
        ));
        let _ = std::fs::remove_dir_all(&state_dir);
        let mut fallback = None;
        let mut opts = net::session_opts(config, listen_port, persist, &state_dir);
        // Cada stream de librqbit retiene uno de estos permisos de E/S (8 por defecto) y
        // `hold_peers` deja uno abierto por torrent mientras cuenta (también escuchando): con 8
        // la tanda se traba. En la reproducción solo sube un tope que no se alcanza.
        // shortcut: alcanza para tandas de hasta ~30 torrents (la UI manda 20); más, subirlo.
        opts.runtime_worker_threads = Some(40);
        let session = match Session::new_with_opts(default_dir.clone(), opts).await {
            Ok(s) => s,
            // Puerto tomado entre la prueba y el bind, IPv6 apagado, puerto del DHT ocupado…:
            // se sigue como antes (sin entrantes ni persistencia) en vez de no reproducir.
            Err(e) if listen_port.is_some() || persist.is_some() => {
                tracing::warn!("rqbit: {e:#}; se reintenta sin escucha ni DHT persistente");
                fallback = Some(format!("{e:#}"));
                Session::new_with_opts(
                    default_dir,
                    net::session_opts(config, None, None, &state_dir),
                )
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
            net::net_line(
                config,
                session.announce_port(),
                listen_port,
                fallback.as_deref(),
                lease.is_some(),
            )
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
            dht_lease: Mutex::new(lease),
        });

        let listener = TcpListener::bind(("127.0.0.1", 0))
            .await
            .map_err(|e| CoreError::Engine(format!("servidor HTTP local: {e}")))?;
        let http_port = listener.local_addr().map(|a| a.port()).unwrap_or_default();
        let http_task = tokio::spawn(http::serve_http(listener, inner.clone()));
        tracing::info!(http_port, "rqbit embebido listo");

        Ok(Self {
            inner,
            next_handle: AtomicU64::new(1),
            http_port,
            http_task,
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

    /// Sin esperar: pause/resume/stats no deben colgarse en un magnet sin peers.
    fn resolved(&self, handle: TorrentHandle) -> Result<Arc<ManagedTorrent>> {
        match self.torrent_rx(handle)?.borrow().clone() {
            Some(r) => r.map_err(CoreError::Engine),
            None => Err(CoreError::Engine("todavía sin metadatos".into())),
        }
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
        let bitfield =
            fastresume::Bitfield::restore(&self.inner.state_dir, &id, &opts.download_dir);
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
            only_files: Some(Vec::new()),
            overwrite: true,
            output_folder: Some(opts.download_dir.to_string_lossy().into_owned()),
            trackers: Some(opts.trackers.clone()),
            initial_peers: (!opts.initial_peers.is_empty()).then(|| opts.initial_peers.clone()),
            ratelimits: librqbit::limits::LimitsConfig {
                download_bps: opts.download_bps.and_then(std::num::NonZeroU32::new),
                upload_bps: None,
            },
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
                bitfield.save();
                Ok::<_, String>(torrent)
            }
            .await;
            match &result {
                Ok(_) => {
                    let _ = inner.events.send(EngineEvent::Log {
                        handle: Some(handle),
                        line: format!(
                            "metadatos en {:.1} s (rqbit)",
                            started.elapsed().as_secs_f32()
                        ),
                    });
                }
                Err(e) => {
                    let _ = inner.events.send(EngineEvent::Error {
                        handle: Some(handle),
                        message: e.clone(),
                    });
                }
            }
            let _ = tx.send(Some(result));
            if let Some(t) = dht_abort {
                t.abort();
            }
        });
        // Reproducción: arranca con el torrent resuelto; termina cuando `remove` la aborta.
        let peer_watch = self.inner.net_line.clone().map(|net_line| {
            let inner = self.inner.clone();
            let mut rx = rx.clone();
            tokio::spawn(async move {
                let resolved = rx.wait_for(Option::is_some).await.map(|r| r.clone());
                let Ok(Some(Ok(torrent))) = resolved else {
                    return;
                };
                let listening = inner.session.announce_port().is_some();
                net::log_peers(torrent, handle, net_line, listening, inner.events.clone()).await;
            })
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
                peer_watch,
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
    ) -> Result<()> {
        let torrent = self.inner.torrent(handle).await?;
        let progress: Arc<Vec<(ByteRange, AtomicU64)>> =
            Arc::new(ranges.iter().map(|r| (*r, AtomicU64::new(0))).collect());
        // Bajo el lock: si `remove` ganó, no quedan tareas sin abortar.
        let mut entries = self.inner.entries.lock().expect("entries");
        let entry = entries
            .get_mut(&handle.0)
            .ok_or_else(|| CoreError::Engine(format!("handle desconocido: {}", handle.0)))?;
        for t in entry.range_tasks.drain(..) {
            t.abort();
        }
        for (i, range) in ranges.iter().copied().enumerate() {
            let torrent = torrent.clone();
            let progress = progress.clone();
            let events = self.inner.events.clone();
            entry.range_tasks.push(tokio::spawn(async move {
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
        entry.range_progress = progress;
        entry.file_index = Some(file_index);
        Ok(())
    }

    async fn hold_peers(&self, handle: TorrentHandle, file_index: usize) -> Result<()> {
        let torrent = self.inner.torrent(handle).await?;
        // Seleccionado = los trackers lo ven con `left > 0` (como alguien que lo está bajando) y le
        // pasan seeders; sin nada seleccionado se anuncia completo y le dan casi solo leechers.
        // Lo que baje lo limita el `download_bps` con que se agregó (el conteo lo pone casi en 0).
        self.inner
            .session
            .update_only_files(&torrent, &HashSet::from([file_index]))
            .await
            .map_err(|e| CoreError::Engine(format!("{e:#}")))?;
        // Un stream abierto sobre un archivo incompleto = torrent no terminado (librqbit
        // `is_finished_and_no_active_streams`); al crearlo además reconecta a los ya cortados.
        // Parado al final del archivo, su ventana de lectura es solo la última pieza.
        let mut stream = torrent
            .stream(file_index)
            .await
            .map_err(|e| CoreError::Engine(format!("{e:#}")))?;
        stream
            .seek(std::io::SeekFrom::End(0))
            .await
            .map_err(|e| CoreError::Engine(format!("{e:#}")))?;
        let mut entries = self.inner.entries.lock().expect("entries");
        let entry = entries
            .get_mut(&handle.0)
            .ok_or_else(|| CoreError::Engine(format!("handle desconocido: {}", handle.0)))?;
        // `remove` aborta la tarea y el stream se suelta.
        entry.range_tasks.push(tokio::spawn(async move {
            let _stream = stream;
            std::future::pending::<()>().await;
        }));
        Ok(())
    }

    async fn dht_census(&self, hashes: &[InfoHash], secs: u64) -> Option<HashMap<InfoHash, u32>> {
        use futures_util::StreamExt;
        let dht = self.inner.session.get_dht()?.clone();
        let deadline = tokio::time::Instant::now() + Duration::from_secs(secs);
        let tasks = hashes.iter().map(|h| {
            let mut peers = dht.get_peers(Id20::new(*h.as_bytes()), None); // sin announce_peer
            let h = *h;
            async move {
                let mut seen = HashSet::new();
                while let Ok(Some(a)) = tokio::time::timeout_at(deadline, peers.next()).await {
                    seen.insert(a);
                }
                (h, seen.len() as u32) // al soltar `peers` se cancela la búsqueda
            }
        });
        let out = futures_util::future::join_all(tasks).await.into_iter().collect();
        let st = dht.stats();
        tracing::info!(n = hashes.len(), rt = st.routing_table_size, "censo DHT listo");
        Some(out)
    }

    async fn connected_peers(&self, handle: TorrentHandle) -> Vec<std::net::SocketAddr> {
        let Ok(torrent) = self.inner.torrent(handle).await else {
            return Vec::new();
        };
        let Some(live) = torrent.live() else {
            return Vec::new();
        };
        // Filtro por defecto: solo los conectados ahora.
        live.per_peer_stats_snapshot(Default::default())
            .peers
            .keys()
            .filter_map(|addr| addr.parse().ok())
            .collect()
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
        let torrent = self.inner.resolved(handle)?;
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
            known_peers: s.live.as_ref().map(|l| l.snapshot.peer_stats.seen),
            incoming_peers: torrent
                .live()
                .map(|l| {
                    l.per_peer_stats_snapshot(Default::default())
                        .peers
                        .values()
                        .filter(|p| p.counters.incoming_connections > 0)
                        .count() as u32
                })
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
        let t = self.inner.resolved(handle)?;
        self.inner
            .session
            .pause(&t)
            .await
            .map_err(|e| CoreError::Engine(format!("{e:#}")))
    }

    async fn resume(&self, handle: TorrentHandle) -> Result<()> {
        let t = self.inner.resolved(handle)?;
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
        if let Some(t) = &entry.peer_watch {
            t.abort();
        }
        // Mientras verifica el disco solo está en `checking`, pero ya está en la sesión.
        let resolved = match entry.torrent.borrow().clone() {
            Some(Ok(t)) => Some(t),
            _ => entry.checking.lock().expect("checking").clone(),
        };
        if let Some(t) = resolved {
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
        self.inner.dht_lease.lock().expect("dht_lease").take();
        let _ = self.inner.events.send(EngineEvent::Exited { code: None });
        Ok(())
    }
}
