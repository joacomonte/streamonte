//! `analyzer` — cola de medición en vivo con pausa/reanudar, reintentos y duración real (FR-05–08).
//!
//! Flujo (spec 04, flujo 2): scrape en lote → por cada candidato con seeders:
//! motor propio de medición (carpeta temporal) → metadatos → archivo de video más grande →
//! precarga inicio(+final) y velocidad real durante `measure_secs` → duración con
//! `player::probe_duration` sobre la URL del motor → `library` guarda → se borra todo (FR-06).
//! Pausar no pierde lo medido: lo terminado ya está en `library` (FR-08). La medición en curso
//! se corta y vuelve al principio de la cola; al reanudar se mide de nuevo.
//!
//! La cola es una única tarea de fondo que recibe comandos por canal (NFR-10). Las mediciones
//! van de a una (`concurrency` = 1): medir en paralelo reparte el ancho de banda y los
//! resultados dejan de ser comparables entre sí.

use std::collections::{HashMap, HashSet, VecDeque};
use std::sync::Arc;
use std::time::{Duration, Instant};

use async_trait::async_trait;
use serde::Serialize;
use tokio::sync::mpsc;
use tokio_util::sync::CancellationToken;

use crate::cleanup::{Cleanup, OwnerRecord};
use crate::config::Config;
use crate::engine::{AddOptions, FilePick, RemoveOptions, TorrentSource};
use crate::events::{CoreEvent, EventSink, StatusLevel};
use crate::library::{settled_status, EntryStatus, Library, LiveMeasurement};
use crate::magnet::{InfoHash, Magnet};
use crate::paths::{find_executable, AppPaths, Executable};
use crate::trackers::ScrapeResult;
use crate::{CoreError, Result};

/// Plazo para leer la duración con mpv una vez precargado inicio y final.
const PROBE_TIMEOUT: Duration = Duration::from_secs(30);

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AnalyzeScope {
    All,
    /// "Analizar solo los no medidos" (FR-08).
    OnlyUnmeasured,
    /// "Re-analizar" uno (FR-08).
    One(InfoHash),
    /// Recién pegados: análisis automático al pegar (pedido del usuario, 2026-11-13).
    /// Como `All` pero solo estos (no forzados: sin seeders en el tracker no se miden).
    Pasted(Vec<InfoHash>),
    /// Los que el usuario marcó en la lista (2026-11-14). Forzados, como `One`.
    Selected(Vec<InfoHash>),
    /// "Análisis rápido" de una fila (2026-11-14): scrape + fase rápida, sin medir velocidad.
    QuickOnly(InfoHash),
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum AnalyzerState {
    Idle,
    Scraping {
        total: usize,
    },
    /// Fase rápida en paralelo: nombre, tamaño, duración, seeds y peers conectados (2026-11-13).
    QuickScan {
        total: usize,
    },
    Measuring {
        done: usize,
        total: usize,
        current: Option<InfoHash>,
        /// Velocidad en vivo mientras se mide (la UI la muestra con "≈" y el botón "Listo").
        live: Option<SpeedProgress>,
    },
    Paused {
        done: usize,
        total: usize,
    },
}

/// Avance de la medición de velocidad (cada ~2 s).
#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
pub struct SpeedProgress {
    /// Velocidad sostenida estimada hasta ahora (bytes/s).
    pub speed_bps: f64,
    /// Segundos de velocidad medidos (sin contar el arranque).
    pub secs: f64,
    pub peers: u32,
    pub seeds: u32,
    /// La velocidad dejó de cambiar: medir más casi no mejora la precisión.
    pub stable: bool,
    /// Bytes verificados del torrent hasta ahora (incluye lo que ya estaba en disco, FR-06d):
    /// la barra "% bajado" de la fila crece en vivo.
    pub downloaded_bytes: u64,
    /// En qué anda la medición: la fila muestra "preparando · conectando" etc. hasta que hay
    /// velocidad (2026-11-14: antes la fila parecía quieta mientras arrancaba el motor).
    pub phase: MeasurePhase,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum MeasurePhase {
    /// Arranca el motor y se suma el torrent.
    Connecting,
    /// Esperando los metadatos (nombre, archivos).
    Metadata,
    /// Precargando el principio (y final) del video; todavía sin muestras de velocidad.
    Preload,
    /// Midiendo la velocidad (`speed_bps` / `secs` valen).
    Measuring,
    /// Velocidad lista; mpv lee la duración y los audios.
    Probing,
}

impl SpeedProgress {
    /// Aviso de fase sin números todavía.
    fn phase(phase: MeasurePhase) -> Self {
        Self {
            speed_bps: 0.0,
            secs: 0.0,
            peers: 0,
            seeds: 0,
            stable: false,
            downloaded_bytes: 0,
            phase,
        }
    }
}

pub type ProgressSink = Arc<dyn Fn(SpeedProgress) + Send + Sync>;

/// Resultado de la fase rápida de un torrent.
#[derive(Debug, Clone)]
pub struct QuickInfo {
    pub torrent_name: Option<String>,
    pub file: crate::engine::FileInfo,
    pub peers: u32,
    pub seeds: u32,
    pub duration_secs: Option<f64>,
    pub audio: Option<Vec<crate::audio::AudioTrack>>,
}

pub type QuickSink = Arc<dyn Fn(InfoHash, QuickInfo) + Send + Sync>;

/// Control de una medición de velocidad.
pub struct MeasureCtl {
    /// Pausa/cancelación: lo medido se guarda como parcial.
    pub cancel: CancellationToken,
    /// "Listo" del usuario: termina YA con lo medido (medición válida, no parcial).
    pub finish: CancellationToken,
    pub progress: ProgressSink,
}

#[derive(Debug)]
enum Command {
    Enqueue(AnalyzeScope),
    Pause,
    Resume,
    Cancel,
    /// "Listo": terminar la medición de velocidad en curso con lo medido.
    Finish,
    /// Pausar solo este (2026-11-14): sale de la cola; si se estaba midiendo, guarda lo parcial.
    PauseOne(InfoHash),
    /// Reanudar solo este: vuelve a la cola.
    ResumeOne(InfoHash),
    /// "Reiniciar análisis" (2026-11-14, el usuario: "se bugeó y quería mandarlo de nuevo"):
    /// lo saca de la cola / pausa / medición en curso y lo vuelve a pedir desde cero.
    Restart {
        hash: InfoHash,
        quick: bool,
    },
}

/// Dependencias inyectadas (permite pruebas con motor falso).
pub struct AnalyzerDeps {
    pub paths: AppPaths,
    pub config: Arc<tokio::sync::RwLock<Config>>,
    pub library: Arc<tokio::sync::Mutex<Library>>,
    pub events: Arc<dyn EventSink>,
}

/// Lo que hace el trabajo de red. La implementación real ([`LiveMeasurer`]) usa trackers +
/// motor + mpv; las pruebas de la cola usan una falsa (sin red).
/// (Agregado en F2 para poder probar pausa/reintentos sin red, 06-C.)
#[async_trait]
pub trait Measurer: Send + Sync + 'static {
    /// Scrape en lote (FR-05).
    async fn scrape(&self, hashes: &[InfoHash], cfg: &Config) -> HashMap<InfoHash, ScrapeResult>;
    /// Medición de velocidad de un torrent (FR-06). Con `ctl.cancel` devuelve lo parcial (o
    /// `Err(Cancelled)` si no hay nada); con `ctl.finish` termina ya con lo medido. Deja todo
    /// borrado al volver, pase lo que pase.
    /// `pick`: qué archivo medir (catálogo: el del episodio, FR-48); default = el más grande.
    async fn measure(
        &self,
        magnet: &Magnet,
        pick: FilePick,
        cfg: &Config,
        ctl: MeasureCtl,
    ) -> Result<LiveMeasurement>;

    /// Fase rápida en paralelo (nombre, tamaño, duración, seeds/peers conectados). Llama a
    /// `on_result` por cada torrent que resuelve. Por defecto no hace nada (pruebas sin red).
    async fn quick(
        &self,
        magnets: Vec<(Magnet, FilePick)>,
        cfg: &Config,
        cancel: CancellationToken,
        on_result: QuickSink,
    ) {
        let _ = (magnets, cfg, cancel, on_result);
    }
}

/// Mango para controlar la tarea del analizador. Clonable.
#[derive(Clone)]
pub struct AnalyzerHandle {
    tx: mpsc::Sender<Command>,
}

impl AnalyzerHandle {
    /// Arranca la tarea de fondo (una sola por app) con el medidor real.
    pub fn spawn(deps: AnalyzerDeps) -> Self {
        let measurer = Arc::new(LiveMeasurer::new(deps.paths.clone()));
        Self::spawn_with(deps, measurer)
    }

    /// Igual que [`spawn`](Self::spawn) pero con otro medidor (pruebas).
    pub fn spawn_with(deps: AnalyzerDeps, measurer: Arc<dyn Measurer>) -> Self {
        let (tx, rx) = mpsc::channel::<Command>(64);
        tokio::spawn(Queue::new(deps, measurer).run(rx));
        Self { tx }
    }

    pub async fn enqueue(&self, scope: AnalyzeScope) -> Result<()> {
        self.send(Command::Enqueue(scope)).await
    }
    pub async fn pause(&self) -> Result<()> {
        self.send(Command::Pause).await
    }
    pub async fn resume(&self) -> Result<()> {
        self.send(Command::Resume).await
    }
    pub async fn cancel(&self) -> Result<()> {
        self.send(Command::Cancel).await
    }
    /// "Listo": terminar la medición de velocidad en curso con lo medido hasta ahora.
    pub async fn finish(&self) -> Result<()> {
        self.send(Command::Finish).await
    }
    /// Pausar el análisis de un solo magnet (los demás siguen).
    pub async fn pause_one(&self, hash: InfoHash) -> Result<()> {
        self.send(Command::PauseOne(hash)).await
    }
    /// Reanudar el análisis de un solo magnet.
    pub async fn resume_one(&self, hash: InfoHash) -> Result<()> {
        self.send(Command::ResumeOne(hash)).await
    }
    /// Volver a analizar uno desde cero aunque ya esté en cola, pausado o midiéndose.
    /// `quick`: solo la fase rápida; si no, también la velocidad.
    pub async fn restart(&self, hash: InfoHash, quick: bool) -> Result<()> {
        self.send(Command::Restart { hash, quick }).await
    }

    async fn send(&self, cmd: Command) -> Result<()> {
        self.tx
            .send(cmd)
            .await
            .map_err(|_| crate::CoreError::Cancelled)
    }
}

// ---------- cola ----------

/// Por qué se cortó la medición en curso.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum StopReason {
    Pause,
    Cancel,
    /// Pausa de este solo: queda retenido hasta que se reanude.
    Hold,
    /// "Reiniciar análisis": lo medido se descarta y se vuelve a pedir.
    Restart,
}

enum Wake {
    Command(Option<Command>),
    Finished(Result<LiveMeasurement>),
}

struct Current {
    hash: InfoHash,
    cancel: CancellationToken,
    finish: CancellationToken,
    stop: Option<StopReason>,
    task: tokio::task::JoinHandle<Result<LiveMeasurement>>,
}

struct Queue {
    deps: AnalyzerDeps,
    measurer: Arc<dyn Measurer>,
    /// Pedidos todavía sin scrape. `bool` = forzado ("Re-analizar uno": se mide aunque el tracker diga 0 seeders).
    to_scrape: Vec<(InfoHash, bool)>,
    /// Listos para medir, en orden.
    queue: VecDeque<InfoHash>,
    current: Option<Current>,
    paused: bool,
    /// Intentos fallidos por hash (reintento automático, FR-08 / NFR-12).
    failures: HashMap<InfoHash, u32>,
    done: usize,
    total: usize,
    last_state: Option<AnalyzerState>,
    /// Pausados uno por uno (2026-11-14): fuera de la cola hasta "Reanudar".
    held: Vec<InfoHash>,
    last_queue: Option<(Vec<InfoHash>, Vec<InfoHash>)>,
    /// Pedidos con [`AnalyzeScope::QuickOnly`]: tras la fase rápida no entran a la cola de medición.
    quick_only: HashSet<InfoHash>,
    /// "Reiniciar análisis" de lo que se estaba midiendo: se vuelve a pedir al cortar.
    restart_after: Vec<AnalyzeScope>,
    /// Subtítulos ya pedidos al analizar en esta sesión (uno por magnet).
    subs: Prefetched,
}

impl Queue {
    fn new(deps: AnalyzerDeps, measurer: Arc<dyn Measurer>) -> Self {
        Self {
            deps,
            measurer,
            to_scrape: Vec::new(),
            queue: VecDeque::new(),
            current: None,
            paused: false,
            failures: HashMap::new(),
            done: 0,
            total: 0,
            last_state: None,
            held: Vec::new(),
            last_queue: None,
            quick_only: HashSet::new(),
            restart_after: Vec::new(),
            subs: Prefetched::default(),
        }
    }

    async fn run(mut self, mut rx: mpsc::Receiver<Command>) {
        loop {
            if !self.paused && self.current.is_none() {
                if !self.to_scrape.is_empty() {
                    let batch = self.scrape_pending().await;
                    // Fase rápida en paralelo; los comandos que llegan mientras tanto se atienden después.
                    let buffered = self.quick_pending(batch, &mut rx).await;
                    for cmd in buffered {
                        self.handle(cmd).await;
                    }
                    while let Ok(cmd) = rx.try_recv() {
                        self.handle(cmd).await;
                    }
                    continue;
                }
                self.start_next().await;
            }
            self.report();

            let wake = {
                let finished = async {
                    match &mut self.current {
                        Some(c) => (&mut c.task).await,
                        None => std::future::pending().await,
                    }
                };
                tokio::select! {
                    cmd = rx.recv() => Wake::Command(cmd),
                    joined = finished => Wake::Finished(joined.unwrap_or_else(|e| {
                        Err(CoreError::Engine(format!("medición abortada: {e}")))
                    })),
                }
            };
            match wake {
                Wake::Command(Some(cmd)) => self.handle(cmd).await,
                Wake::Command(None) => break, // la app se cerró
                Wake::Finished(result) => self.finish_current(result).await,
            }
        }
        if let Some(c) = self.current.take() {
            c.cancel.cancel();
            let _ = c.task.await;
        }
    }

    async fn handle(&mut self, cmd: Command) {
        match cmd {
            Command::Enqueue(scope) => self.enqueue(scope).await,
            Command::Pause => {
                self.paused = true;
                if let Some(c) = &mut self.current {
                    c.stop = Some(StopReason::Pause);
                    c.cancel.cancel();
                }
            }
            Command::Resume => self.paused = false,
            Command::Finish => {
                if let Some(c) = &self.current {
                    c.finish.cancel();
                }
            }
            Command::PauseOne(hash) => {
                match &mut self.current {
                    Some(c) if c.hash == hash => {
                        c.stop = Some(StopReason::Hold);
                        c.cancel.cancel(); // guarda lo parcial; finish_current lo retiene
                    }
                    _ => {
                        let was_queued = self.queue.contains(&hash)
                            || self.to_scrape.iter().any(|(h, _)| *h == hash);
                        self.queue.retain(|h| *h != hash);
                        self.to_scrape.retain(|(h, _)| *h != hash);
                        if was_queued && !self.held.contains(&hash) {
                            self.held.push(hash);
                            self.settle(&[hash]).await;
                        }
                    }
                }
            }
            Command::ResumeOne(hash) => {
                if let Some(i) = self.held.iter().position(|h| *h == hash) {
                    self.held.remove(i);
                    let scraped = self
                        .deps
                        .library
                        .lock()
                        .await
                        .get(&hash)
                        .is_some_and(|e| e.scrape.is_some());
                    if scraped {
                        self.queue.push_back(hash);
                    } else {
                        self.to_scrape.push((hash, true));
                    }
                }
            }
            Command::Restart { hash, quick } => {
                let scope = if quick {
                    AnalyzeScope::QuickOnly(hash)
                } else {
                    AnalyzeScope::One(hash)
                };
                self.queue.retain(|h| *h != hash);
                self.to_scrape.retain(|(h, _)| *h != hash);
                self.held.retain(|h| *h != hash);
                self.quick_only.remove(&hash);
                self.failures.remove(&hash);
                match &mut self.current {
                    Some(c) if c.hash == hash => {
                        c.stop = Some(StopReason::Restart);
                        c.cancel.cancel();
                        self.restart_after.push(scope);
                    }
                    _ => {
                        self.settle(&[hash]).await;
                        self.enqueue(scope).await;
                    }
                }
            }
            Command::Cancel => {
                let pending: Vec<InfoHash> = self
                    .to_scrape
                    .drain(..)
                    .map(|(h, _)| h)
                    .chain(self.queue.drain(..))
                    .collect();
                self.settle(&pending).await;
                self.held.clear();
                if let Some(c) = &mut self.current {
                    c.stop = Some(StopReason::Cancel);
                    c.cancel.cancel();
                }
                self.paused = false;
                self.failures.clear();
            }
        }
    }

    async fn enqueue(&mut self, scope: AnalyzeScope) {
        let quick_only = matches!(scope, AnalyzeScope::QuickOnly(_));
        let (hashes, forced) = {
            let library = self.deps.library.lock().await;
            match scope {
                AnalyzeScope::All => (library.hashes(), false),
                AnalyzeScope::OnlyUnmeasured => (library.unmeasured(), false),
                AnalyzeScope::One(h) | AnalyzeScope::QuickOnly(h) => (
                    library
                        .get(&h)
                        .map(|e| vec![e.info_hash])
                        .unwrap_or_default(),
                    true,
                ),
                AnalyzeScope::Pasted(hs) => (
                    hs.into_iter()
                        .filter(|h| library.get(h).is_some_and(|e| !e.speed_measured()))
                        .collect(),
                    false,
                ),
                AnalyzeScope::Selected(hs) => (
                    hs.into_iter()
                        .filter(|h| library.get(h).is_some())
                        .collect(),
                    true,
                ),
            }
        };
        // Ya en cola, midiéndose o pausado uno por uno: pedirlo de nuevo no hace nada (2026-11-14,
        // contra el doble clic). Pausado se sigue con "Seguir analizando" (`ResumeOne`).
        let busy: HashSet<InfoHash> = self
            .to_scrape
            .iter()
            .map(|(h, _)| *h)
            .chain(self.queue.iter().copied())
            .chain(self.current.as_ref().map(|c| c.hash))
            .chain(self.held.iter().copied())
            .collect();
        for h in hashes {
            if !quick_only {
                // Un pedido completo después de uno rápido (aun pendiente) sí mide la velocidad.
                self.quick_only.remove(&h);
            }
            if busy.contains(&h) {
                continue;
            }
            if quick_only {
                self.quick_only.insert(h);
            }
            self.failures.remove(&h);
            self.to_scrape.push((h, forced));
        }
    }

    /// Scrape en lote de todo lo pendiente (FR-05) y pasa a la cola de medición, mejores primero.
    /// Devuelve lo que entró a la cola (para la fase rápida).
    async fn scrape_pending(&mut self) -> Vec<InfoHash> {
        let batch: Vec<(InfoHash, bool)> = std::mem::take(&mut self.to_scrape);
        let hashes: Vec<InfoHash> = batch.iter().map(|(h, _)| *h).collect();
        self.set_state(AnalyzerState::Scraping {
            total: hashes.len(),
        });
        self.update_entries(&hashes, |e| e.status = EntryStatus::Scraping)
            .await;

        let cfg = self.deps.config.read().await.clone();
        let results = self.measurer.scrape(&hashes, &cfg).await;

        let mut to_measure: Vec<(InfoHash, Option<u32>)> = Vec::new();
        let mut quick_only: Vec<InfoHash> = Vec::new();
        let mut library = self.deps.library.lock().await;
        for (hash, forced) in batch {
            let scrape = results.get(&hash).cloned();
            let seeders = scrape.as_ref().map(|s| s.seeders);
            let Some(entry) = library.update(&hash, |e| {
                if scrape.is_some() {
                    e.scrape = scrape.clone();
                }
                e.status = settled_status(e);
            }) else {
                continue; // la quitaron mientras tanto
            };
            self.deps.events.emit(CoreEvent::LibraryEntryUpdated {
                entry: Box::new(entry.clone()),
            });
            // FR-06: se miden los que tienen seeders. Sin respuesta de ningún tracker también se
            // mide (los trackers pueden no conocerlo; ADR-09: manda la medición en vivo).
            if self.quick_only.remove(&hash) {
                quick_only.push(hash);
            } else if forced || seeders != Some(0) {
                to_measure.push((hash, seeders));
            }
        }
        drop(library);
        // Más seeders primero: lo prometedor se mide antes (sin dato al final).
        to_measure.sort_by_key(|t| std::cmp::Reverse(t.1));
        self.total += to_measure.len();
        let hashes: Vec<InfoHash> = to_measure.into_iter().map(|(h, _)| h).collect();
        self.queue.extend(hashes.iter().copied());
        hashes.into_iter().chain(quick_only).collect()
    }

    /// Fase rápida (2026-11-13): en paralelo y casi sin ancho de banda, nombre real, tamaño,
    /// duración real y seeds/peers conectados. La velocidad se mide después, de a uno.
    /// Pausa/cancelación la cortan; los demás comandos se devuelven para atenderlos después.
    async fn quick_pending(
        &mut self,
        hashes: Vec<InfoHash>,
        rx: &mut mpsc::Receiver<Command>,
    ) -> Vec<Command> {
        let mut buffered = Vec::new();
        let magnets: Vec<(Magnet, FilePick)> = {
            let library = self.deps.library.lock().await;
            hashes
                .iter()
                .filter_map(|h| {
                    let e = library.get(h)?;
                    Some((Magnet::parse(&e.magnet).ok()?, e.file_pick()))
                })
                .collect()
        };
        if magnets.is_empty() {
            return buffered;
        }
        self.set_state(AnalyzerState::QuickScan {
            total: magnets.len(),
        });
        let cfg = self.deps.config.read().await.clone();
        let cancel = CancellationToken::new();
        let (library, events) = (self.deps.library.clone(), self.deps.events.clone());
        let handle = tokio::runtime::Handle::current();
        let subs = self.subs_ctx();
        let sink: QuickSink = Arc::new(move |hash, info: QuickInfo| {
            let (library, events, subs) = (library.clone(), events.clone(), subs.clone());
            handle.spawn(async move {
                let mut lib = library.lock().await;
                if let Some(entry) = lib.update(&hash, |e| apply_quick(e, &info)) {
                    events.emit(CoreEvent::LibraryEntryUpdated {
                        entry: Box::new(entry.clone()),
                    });
                }
                drop(lib);
                subs.prefetch(hash); // ya se sabe qué video es: a buscar subtítulos
            });
        });
        let quick = self.measurer.quick(magnets, &cfg, cancel.clone(), sink);
        tokio::pin!(quick);
        loop {
            tokio::select! {
                _ = &mut quick => break,
                cmd = rx.recv() => match cmd {
                    Some(c @ (Command::Pause | Command::Cancel)) => {
                        cancel.cancel();
                        buffered.push(c);
                    }
                    Some(c) => buffered.push(c),
                    None => {
                        cancel.cancel();
                        break;
                    }
                },
            }
        }
        buffered
    }

    async fn start_next(&mut self) {
        while let Some(hash) = self.queue.pop_front() {
            let (magnet, pick) = {
                let library = self.deps.library.lock().await;
                let e = library.get(&hash);
                (
                    e.map(|e| Magnet::parse(&e.magnet)),
                    e.map(|e| e.file_pick()).unwrap_or_default(),
                )
            };
            let magnet = match magnet {
                None => {
                    self.done += 1; // la quitaron de la lista
                    continue;
                }
                Some(Err(e)) => {
                    self.fail(hash, e.user_message()).await;
                    continue;
                }
                Some(Ok(m)) => m,
            };
            self.update_entries(&[hash], |e| e.status = EntryStatus::Measuring)
                .await;
            let cfg = self.deps.config.read().await.clone();
            let cancel = CancellationToken::new();
            let finish = CancellationToken::new();
            let measurer = self.measurer.clone();
            // Velocidad en vivo para la tarjeta (≈ X / Y Mbps · N s) y el botón "Listo".
            let (events, done, total) = (self.deps.events.clone(), self.done, self.total);
            let progress: ProgressSink = Arc::new(move |live: SpeedProgress| {
                events.emit(CoreEvent::AnalyzerProgress {
                    state: AnalyzerState::Measuring {
                        done,
                        total,
                        current: Some(hash),
                        live: Some(live),
                    },
                });
            });
            let ctl = MeasureCtl {
                cancel: cancel.clone(),
                finish: finish.clone(),
                progress,
            };
            let task =
                tokio::spawn(async move { measurer.measure(&magnet, pick, &cfg, ctl).await });
            self.current = Some(Current {
                hash,
                cancel,
                finish,
                stop: None,
                task,
            });
            return;
        }
    }

    async fn finish_current(&mut self, result: Result<LiveMeasurement>) {
        let Some(current) = self.current.take() else {
            return;
        };
        let hash = current.hash;
        match (result, current.stop) {
            (_, Some(StopReason::Restart)) => {
                // Se descarta y se pide de nuevo (abajo); no cuenta dos veces en "N de M".
                self.total = self.total.saturating_sub(1);
                self.settle(&[hash]).await;
            }
            (Ok(measurement), stop) => {
                self.failures.remove(&hash);
                let partial = measurement.partial;
                if partial && stop == Some(StopReason::Pause) {
                    // Pausa: se guarda lo parcial y al reanudar se completa la medición.
                    self.queue.push_front(hash);
                } else if partial && stop == Some(StopReason::Hold) {
                    // Pausa de este solo: queda retenido hasta "Reanudar".
                    self.held.push(hash);
                } else {
                    self.done += 1;
                }
                self.update_entries(&[hash], move |e| {
                    if e.torrent_name.is_none() {
                        e.torrent_name = measurement.torrent_name.clone();
                    }
                    e.video_size = Some(measurement.file_size);
                    // Una medición parcial nunca pisa una completa anterior.
                    let keep_old = partial
                        && e.live
                            .as_ref()
                            .is_some_and(|old| !old.partial && old.avg_speed_bps > 0.0);
                    if !keep_old {
                        let mut new = measurement.clone();
                        // La duración real puede venir de la fase rápida: no perderla.
                        if new.duration_secs.is_none() {
                            new.duration_secs = e.live.as_ref().and_then(|old| old.duration_secs);
                        }
                        if new.audio.is_none() {
                            new.audio = e.live.as_ref().and_then(|old| old.audio.clone());
                        }
                        e.live = Some(new);
                    }
                    e.status = EntryStatus::Measured;
                })
                .await;
                self.subs_ctx().prefetch(hash);
            }
            (Err(_), Some(StopReason::Pause)) => {
                // Vuelve al frente de la cola: al reanudar se mide de nuevo (FR-08).
                self.queue.push_front(hash);
                self.settle(&[hash]).await;
            }
            (Err(_), Some(StopReason::Cancel)) => self.settle(&[hash]).await,
            (Err(_), Some(StopReason::Hold)) => {
                self.held.push(hash);
                self.settle(&[hash]).await;
            }
            (Err(e), None) => {
                let retries = self.deps.config.read().await.analyzer.retries;
                let failures = self.failures.entry(hash).or_insert(0);
                *failures += 1;
                if *failures <= retries {
                    tracing::warn!(%hash, intento = *failures, "medición falló, reintento: {e}");
                    self.queue.push_front(hash);
                } else {
                    tracing::warn!(%hash, "medición falló definitivamente: {e}");
                    self.failures.remove(&hash);
                    self.fail(hash, e.user_message()).await;
                }
            }
        }
        for scope in std::mem::take(&mut self.restart_after) {
            self.enqueue(scope).await;
        }
        if self.queue.is_empty() && self.to_scrape.is_empty() && !self.paused {
            self.done = 0;
            self.total = 0;
        }
    }

    async fn fail(&mut self, hash: InfoHash, reason: String) {
        self.done += 1;
        self.deps.events.emit(CoreEvent::Status {
            level: StatusLevel::Warn,
            message: format!("No se pudo medir un torrent: {reason}"),
        });
        self.update_entries(&[hash], move |e| {
            e.status = EntryStatus::Failed {
                reason: reason.clone(),
            }
        })
        .await;
    }

    /// Vuelve las entradas a su estado "quieto" (lo medido no se pierde).
    async fn settle(&mut self, hashes: &[InfoHash]) {
        self.update_entries(hashes, |e| e.status = settled_status(e))
            .await;
    }

    async fn update_entries<F>(&self, hashes: &[InfoHash], f: F)
    where
        F: Fn(&mut crate::library::LibraryEntry) + Clone,
    {
        let mut library = self.deps.library.lock().await;
        for hash in hashes {
            if let Some(entry) = library.update(hash, f.clone()) {
                self.deps.events.emit(CoreEvent::LibraryEntryUpdated {
                    entry: Box::new(entry.clone()),
                });
            }
        }
    }

    fn report(&mut self) {
        // Qué está en cola y qué está pausado uno por uno, para la tarjeta de cada magnet.
        let queued: Vec<InfoHash> = self
            .to_scrape
            .iter()
            .map(|(h, _)| *h)
            .chain(self.queue.iter().copied())
            .collect();
        let snapshot = (queued, self.held.clone());
        if self.last_queue.as_ref() != Some(&snapshot) {
            self.deps.events.emit(CoreEvent::AnalyzerQueue {
                queued: snapshot.0.clone(),
                held: snapshot.1.clone(),
            });
            self.last_queue = Some(snapshot);
        }
        let state = if self.paused {
            AnalyzerState::Paused {
                done: self.done,
                total: self.total,
            }
        } else if let Some(c) = &self.current {
            AnalyzerState::Measuring {
                done: self.done,
                total: self.total,
                current: Some(c.hash),
                live: None,
            }
        } else {
            AnalyzerState::Idle
        };
        self.set_state(state);
    }

    fn set_state(&mut self, state: AnalyzerState) {
        if self.last_state.as_ref() != Some(&state) {
            self.last_state = Some(state.clone());
            self.deps.events.emit(CoreEvent::AnalyzerProgress { state });
        }
    }
}

impl Queue {
    fn subs_ctx(&self) -> SubsCtx {
        SubsCtx {
            paths: self.deps.paths.clone(),
            config: self.deps.config.clone(),
            library: self.deps.library.clone(),
            started: self.subs.clone(),
        }
    }
}

// ---------- subtítulos al analizar (2026-11-14) ----------
// "Buscar y descargar 5 subtítulos en español al analizar el magnet; ponelos en la misma carpeta
// con el mismo nombre así los carga mpv". Se reusa la búsqueda de la reproducción
// (`subtitles::session::fetch`) con su caché, así que al darle Ver ya están; además se copian
// junto al video como `<video>.es.srt`, `<video>.es-2.srt`… (mpv y VLC los cargan solos si se
// abre el archivo).

type Prefetched = Arc<std::sync::Mutex<HashSet<InfoHash>>>;

#[derive(Clone)]
struct SubsCtx {
    paths: AppPaths,
    config: Arc<tokio::sync::RwLock<Config>>,
    library: Arc<tokio::sync::Mutex<Library>>,
    started: Prefetched,
}

impl SubsCtx {
    /// De fondo y una sola vez por magnet en esta sesión.
    fn prefetch(&self, hash: InfoHash) {
        if !self.started.lock().expect("subs").insert(hash) {
            return;
        }
        let ctx = self.clone();
        tokio::spawn(async move { ctx.run(hash).await });
    }

    async fn run(&self, hash: InfoHash) {
        use crate::config::SubtitleLanguage;
        let lang = self.config.read().await.subtitles.language;
        if lang == SubtitleLanguage::None {
            return;
        }
        let Some((torrent_name, file_name, size)) =
            self.library.lock().await.get(&hash).and_then(|e| {
                let live = e.live.as_ref()?;
                Some((
                    e.torrent_name.clone().unwrap_or_else(|| e.name.clone()),
                    live.file_name.clone(),
                    live.file_size,
                ))
            })
        else {
            return;
        };
        let mut video = crate::subtitles::parse_release_name(&file_name);
        // Archivos con nombre pobre ("video.mkv"): el nombre del torrent suele traer título y año.
        let from_torrent = crate::subtitles::parse_release_name(&torrent_name);
        if video.year.is_none() && from_torrent.year.is_some() {
            video.title = from_torrent.title;
            video.year = from_torrent.year;
        }
        video.info_hash = Some(hash);
        video.file_size = size;
        let dir = self.paths.analysis_dir(&hash);
        video.movie_hash =
            crate::fsutil::biggest_file(&dir).and_then(|(p, _)| movie_hash_from_disk(&p, size));
        let log: crate::subtitles::session::LogFn =
            Arc::new(|line| tracing::info!(target: "tstream_core::subtitles", "{line}"));
        let got = crate::subtitles::session::fetch(crate::subtitles::session::Fetch {
            video,
            video_url: None,
            torrent_files: Vec::new(), // los de adentro del torrent se leen al reproducir
            language: lang,
            cache_dir: self.paths.subtitle_cache_dir().join(hash.to_hex()),
            remembered: None,
            opensubtitles: false, // su cuota diaria queda para cuando se reproduce
            log,
        })
        .await;
        // La carpeta pudo cambiar mientras tanto (la reproducción adopta la del análisis).
        let copied = crate::fsutil::biggest_file(&dir).map_or(0, |(video_path, _)| {
            copy_next_to_video(&video_path, &got, lang)
        });
        tracing::info!(
            target: "tstream_core::subtitles",
            "{} subtítulo(s) en {} listos para {torrent_name}{}",
            got.len(),
            if lang == SubtitleLanguage::Es { "español" } else { "inglés" },
            if copied > 0 { format!(", {copied} junto al video") } else { String::new() },
        );
    }
}

/// Hash OpenSubtitles desde el archivo en disco, solo si el principio y el final ya bajaron
/// (en un archivo disperso lo no bajado se lee como ceros).
fn movie_hash_from_disk(path: &std::path::Path, size: u64) -> Option<u64> {
    use std::io::{Read, Seek, SeekFrom};
    if size < 131_072 {
        return None;
    }
    let mut f = std::fs::File::open(path).ok()?;
    let mut head = vec![0u8; 65_536];
    let mut tail = vec![0u8; 65_536];
    f.read_exact(&mut head).ok()?;
    f.seek(SeekFrom::Start(size - 65_536)).ok()?;
    f.read_exact(&mut tail).ok()?;
    let downloaded = |b: &[u8]| b.iter().any(|x| *x != 0);
    (downloaded(&head) && downloaded(&tail))
        .then(|| crate::subtitles::movie_hash(size, &head, &tail))
}

/// Copia los subtítulos junto al video con su mismo nombre: `Peli.es.srt`, `Peli.es-2.srt`…
/// (mpv `sub-auto=exact` toma lo que sigue al nombre como idioma). No pisa lo que ya esté.
fn copy_next_to_video(
    video: &std::path::Path,
    subs: &[(crate::subtitles::SubtitleCandidate, std::path::PathBuf)],
    lang: crate::config::SubtitleLanguage,
) -> usize {
    let Some(stem) = video.file_stem().and_then(|s| s.to_str()) else {
        return 0;
    };
    let code = if lang == crate::config::SubtitleLanguage::En {
        "en"
    } else {
        "es"
    };
    let mut copied = 0;
    for (i, (_, path)) in subs.iter().enumerate() {
        let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("srt");
        let n = if i == 0 {
            String::new()
        } else {
            format!("-{}", i + 1)
        };
        let dest = video.with_file_name(format!("{stem}.{code}{n}.{ext}"));
        if !dest.exists() && std::fs::copy(path, &dest).is_ok() {
            copied += 1;
        }
    }
    copied
}

/// Aplica la fase rápida a una entrada sin pisar una velocidad ya medida.
fn apply_quick(e: &mut crate::library::LibraryEntry, info: &QuickInfo) {
    if e.torrent_name.is_none() {
        e.torrent_name = info.torrent_name.clone();
    }
    e.video_size = Some(info.file.size);
    match &mut e.live {
        Some(live) => {
            live.peers = info.peers;
            live.seeds = info.seeds;
            if info.duration_secs.is_some() {
                live.duration_secs = info.duration_secs;
            }
            if info.audio.is_some() {
                live.audio = info.audio.clone();
            }
        }
        None => {
            e.live = Some(LiveMeasurement {
                measured_at: chrono::Utc::now(),
                torrent_name: info.torrent_name.clone(),
                file_index: info.file.index,
                file_name: info.file.name.clone(),
                file_size: info.file.size,
                peers: info.peers,
                seeds: info.seeds,
                partial: false,
                measured_secs: 0.0,
                avg_speed_bps: 0.0, // todavía sin velocidad: la mide la fase 2
                max_speed_bps: 0.0,
                duration_secs: info.duration_secs,
                audio: info.audio.clone(),
            });
        }
    }
}

// ---------- medidor real ----------

/// Mide con un motor propio por torrent (aislado de las reproducciones) y mpv sin ventana.
pub struct LiveMeasurer {
    paths: AppPaths,
    cleanup: Cleanup,
    next_id: std::sync::atomic::AtomicU64,
}

impl LiveMeasurer {
    pub fn new(paths: AppPaths) -> Self {
        Self {
            cleanup: Cleanup::new(paths.clone()),
            paths,
            next_id: std::sync::atomic::AtomicU64::new(1),
        }
    }
}

#[async_trait]
impl Measurer for LiveMeasurer {
    async fn scrape(&self, hashes: &[InfoHash], cfg: &Config) -> HashMap<InfoHash, ScrapeResult> {
        let t0 = Instant::now();
        let r = crate::trackers::scrape_batch(
            hashes,
            &cfg.trackers,
            Duration::from_secs(cfg.analyzer.scrape_timeout_secs),
        )
        .await;
        tracing::info!(
            pedidos = hashes.len(),
            respondidos = r.len(),
            secs = format!("{:.1}", t0.elapsed().as_secs_f32()),
            "scrape en lote"
        );
        r
    }

    async fn measure(
        &self,
        magnet: &Magnet,
        pick: FilePick,
        cfg: &Config,
        ctl: MeasureCtl,
    ) -> Result<LiveMeasurement> {
        let cancel = ctl.cancel.clone();
        let id = self
            .next_id
            .fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        // FR-06d: se mide en la carpeta de análisis del hash (sigue lo de una medición anterior).
        let (dir, keep) = reserve_dir(
            &self.paths,
            &self.cleanup,
            &magnet.info_hash,
            format!("a{id}"),
        );
        (ctl.progress)(SpeedProgress::phase(MeasurePhase::Connecting));
        let engine = crate::engine::create(&cfg.engine).await?;
        let started = std::time::Instant::now();
        let partial: PartialRef = Arc::default();
        let result = tokio::select! {
            r = measure_with(&self.paths, &self.cleanup, engine.as_ref(), &dir, magnet, pick, cfg, &ctl, &partial) => r,
            _ = cancel.cancelled() => Err(CoreError::Cancelled),
        };
        // Pausa/cancelación a mitad de medición: lo medido no se tira (pedido del usuario,
        // 2026-11-13). Queda como medición parcial, menos precisa.
        let result = match result {
            Err(CoreError::Cancelled) => partial_measurement(&partial).ok_or(CoreError::Cancelled),
            r => r,
        };
        // FR-06d: el motor se apaga (nada sigue bajando ni compartiendo) y lo bajado queda
        // para la reproducción; solo se borra la carpeta descartable.
        let _ = engine.shutdown().await;
        release_dir(&self.cleanup, &dir, keep).await;
        tracing::info!(
            hash = %magnet.info_hash,
            ok = result.is_ok(),
            secs = format!("{:.1}", started.elapsed().as_secs_f32()),
            "medición terminada"
        );
        result
    }

    async fn quick(
        &self,
        magnets: Vec<(Magnet, FilePick)>,
        cfg: &Config,
        cancel: CancellationToken,
        on_result: QuickSink,
    ) {
        if magnets.is_empty() {
            return;
        }
        let engine = match crate::engine::create(&cfg.engine).await {
            Ok(e) => e,
            Err(e) => {
                tracing::warn!("fase rápida: no se pudo iniciar el motor: {e}");
                return;
            }
        };
        let started = Instant::now();
        let total = magnets.len();
        let sem = Arc::new(tokio::sync::Semaphore::new(
            cfg.analyzer.quick_concurrency.max(1),
        ));
        let mut tasks = tokio::task::JoinSet::new();
        let mut dirs = Vec::new();
        for (magnet, pick) in magnets {
            let id = self
                .next_id
                .fetch_add(1, std::sync::atomic::Ordering::Relaxed);
            let (dir, keep) = reserve_dir(
                &self.paths,
                &self.cleanup,
                &magnet.info_hash,
                format!("q{id}"),
            );
            dirs.push((dir.clone(), keep));
            let (engine, sem, cfg, paths, cancel, on_result) = (
                engine.clone(),
                sem.clone(),
                cfg.clone(),
                self.paths.clone(),
                cancel.clone(),
                on_result.clone(),
            );
            tasks.spawn(async move {
                let _permit = sem.acquire_owned().await.ok()?;
                if cancel.is_cancelled() {
                    return None;
                }
                let cleanup = Cleanup::new(paths.clone());
                tokio::select! {
                    r = quick_one(engine.as_ref(), &paths, &cleanup, &dir, &magnet, pick, &cfg) => match r {
                        Ok(info) => {
                            on_result(magnet.info_hash, info);
                            Some(())
                        }
                        Err(e) => {
                            tracing::warn!(hash = %magnet.info_hash, "fase rápida: {e}");
                            None
                        }
                    },
                    _ = cancel.cancelled() => None,
                }
            });
        }
        let mut ok = 0;
        while let Some(r) = tasks.join_next().await {
            if matches!(r, Ok(Some(()))) {
                ok += 1;
            }
        }
        let _ = engine.shutdown().await;
        for (dir, keep) in dirs {
            release_dir(&self.cleanup, &dir, keep).await;
        }
        tracing::info!(
            ok,
            total,
            secs = format!("{:.1}", started.elapsed().as_secs_f32()),
            "fase rápida"
        );
    }
}

/// Fase rápida de un torrent: metadatos → precarga inicio(+final MP4) mientras se cuentan
/// seeds/peers conectados (`quick_secs`) → duración real con mpv. Casi no usa ancho de banda.
async fn quick_one(
    engine: &dyn crate::engine::TorrentEngine,
    paths: &AppPaths,
    cleanup: &Cleanup,
    dir: &std::path::Path,
    magnet: &Magnet,
    pick: FilePick,
    cfg: &Config,
) -> Result<QuickInfo> {
    cleanup.claim(
        dir,
        &OwnerRecord {
            app_pid: std::process::id(),
            engine_pid: engine.pid(),
            player_pid: None,
            started_at: chrono::Utc::now(),
        },
    )?;
    let cached = paths
        .torrent_cache_dir()
        .join(format!("{}.torrent", magnet.info_hash.to_hex()));
    let source = if cached.is_file() {
        TorrentSource::TorrentFile(cached.clone())
    } else {
        TorrentSource::Magnet(magnet.with_trackers(&cfg.trackers))
    };
    let handle = engine
        .add(
            source,
            AddOptions {
                trackers: cfg.trackers.clone(),
                download_dir: dir.to_path_buf(),
                only_file: None,
                start_deselected: true,
            },
        )
        .await?;
    let result = async {
        let metadata = crate::engine::wait_metadata(engine, handle, 30).await?;
        if !cached.is_file() {
            metadata.save_torrent_cache(&cached);
        }
        let file = metadata.pick_file(pick)?;
        let plan = crate::preload::plan(&file, &cfg.preload);
        let mut preload_cfg = cfg.preload.clone();
        preload_cfg.fallback_open_secs = 20;
        let count = async {
            let (mut peers, mut seeds) = (0, 0);
            for _ in 0..cfg.analyzer.quick_secs.max(3) {
                tokio::time::sleep(Duration::from_secs(1)).await;
                if let Ok(Ok(s)) =
                    tokio::time::timeout(Duration::from_secs(2), engine.stats(handle)).await
                {
                    peers = peers.max(s.peers);
                    seeds = seeds.max(s.seeds);
                }
            }
            (peers, seeds)
        };
        let (preload, (peers, seeds)) = tokio::join!(
            crate::preload::run(
                engine,
                handle,
                &plan,
                &preload_cfg,
                CancellationToken::new(),
                &|_: crate::preload::PreloadProgress| {}
            ),
            count,
        );
        // Duración + pistas de audio (idiomas) en la misma lectura de cabecera.
        let probe = match (
            preload,
            find_executable(Executable::Mpv, cfg.player.mpv_path.as_deref()),
        ) {
            (Ok(_), Some(mpv)) => {
                let url = engine.stream_url(handle, file.index).await?;
                crate::player::probe_media(&mpv, &url, Duration::from_secs(20))
                    .await
                    .ok()
            }
            _ => None,
        };
        Ok(QuickInfo {
            torrent_name: Some(metadata.name.clone()).filter(|n| !n.is_empty()),
            file,
            peers,
            seeds,
            duration_secs: probe.as_ref().map(|p| p.duration_secs),
            audio: probe.map(|p| p.audio),
        })
    }
    .await;
    // Sin borrar: la carpeta la conserva o la borra `quick` (FR-06d).
    let _ = engine
        .remove(handle, RemoveOptions { delete_data: false })
        .await;
    result
}

#[allow(clippy::too_many_arguments)]
async fn measure_with(
    paths: &AppPaths,
    cleanup: &Cleanup,
    engine: &dyn crate::engine::TorrentEngine,
    dir: &std::path::Path,
    magnet: &Magnet,
    pick: FilePick,
    cfg: &Config,
    ctl: &MeasureCtl,
    partial: &PartialRef,
) -> Result<LiveMeasurement> {
    cleanup.claim(
        dir,
        &OwnerRecord {
            app_pid: std::process::id(),
            engine_pid: engine.pid(),
            player_pid: None,
            started_at: chrono::Utc::now(),
        },
    )?;

    // 1. `.torrent` en caché si ya lo vimos (FR-13), si no magnet + trackers (FR-10).
    let cached = paths
        .torrent_cache_dir()
        .join(format!("{}.torrent", magnet.info_hash.to_hex()));
    let source = if cached.is_file() {
        TorrentSource::TorrentFile(cached.clone())
    } else {
        TorrentSource::Magnet(magnet.with_trackers(&cfg.trackers))
    };
    let handle = engine
        .add(
            source,
            AddOptions {
                trackers: cfg.trackers.clone(),
                download_dir: dir.to_path_buf(),
                only_file: None,
                start_deselected: true, // lección 3
            },
        )
        .await?;

    // 2. Metadatos (también quedan guardados para reproducir sin esperarlos, FR-13).
    (ctl.progress)(SpeedProgress::phase(MeasurePhase::Metadata));
    let metadata =
        crate::engine::wait_metadata(engine, handle, cfg.engine.metadata_timeout_secs).await?;
    if !cached.is_file() {
        metadata.save_torrent_cache(&cached);
    }
    let file = metadata.pick_file(pick)?;
    {
        let mut p = partial.lock().expect("partial");
        p.torrent_name = Some(metadata.name.clone()).filter(|n| !n.is_empty());
        p.file = Some(file.clone());
    }

    // 3. Precarga inicio(+final MP4) y, a la vez, velocidad real durante `measure_secs`.
    //    La precarga deja listo lo que mpv necesita para leer la duración (lección 2).
    let plan = crate::preload::plan(&file, &cfg.preload);
    let mut preload_cfg = cfg.preload.clone();
    // Plan B más corto que al reproducir: el analizador no debe trabarse en un swarm lento.
    preload_cfg.fallback_open_secs = preload_cfg
        .fallback_open_secs
        .min(cfg.analyzer.measure_secs + 15);
    let window = Duration::from_secs(cfg.analyzer.measure_secs.max(1));
    (ctl.progress)(SpeedProgress::phase(MeasurePhase::Preload));
    let (preload, speed) = tokio::join!(
        crate::preload::run(
            engine,
            handle,
            &plan,
            &preload_cfg,
            ctl.cancel.clone(),
            &|_: crate::preload::PreloadProgress| {}
        ),
        sample_speed(
            engine,
            handle,
            SpeedWindow {
                min: window,
                max: Duration::from_secs(
                    cfg.analyzer.speed_max_secs.max(cfg.analyzer.measure_secs)
                )
            },
            partial,
            &ctl.finish,
            &ctl.progress,
        ),
    );
    preload?;
    let speed = speed?;
    (ctl.progress)(SpeedProgress {
        speed_bps: speed.avg_bps,
        secs: speed.secs,
        peers: speed.peers,
        seeds: speed.seeds,
        stable: true,
        downloaded_bytes: 0,
        phase: MeasurePhase::Probing,
    });

    // 4. Duración real con mpv sin ventana (FR-06, lección 9). Sin mpv → `None` (se estima con "~").
    let probe = match find_executable(Executable::Mpv, cfg.player.mpv_path.as_deref()) {
        Some(mpv) => {
            let url = engine.stream_url(handle, file.index).await?;
            match crate::player::probe_media(&mpv, &url, PROBE_TIMEOUT).await {
                Ok(p) => Some(p),
                Err(e) => {
                    tracing::warn!("no se pudo leer la duración: {e}");
                    None
                }
            }
        }
        None => {
            tracing::warn!("mpv no encontrado: la duración se estima");
            None
        }
    };
    let _ = engine
        .remove(handle, RemoveOptions { delete_data: false })
        .await;

    Ok(LiveMeasurement {
        measured_at: chrono::Utc::now(),
        torrent_name: Some(metadata.name.clone()).filter(|n| !n.is_empty()),
        file_index: file.index,
        file_name: file.name.clone(),
        file_size: file.size,
        peers: speed.peers,
        seeds: speed.seeds,
        partial: false,
        measured_secs: speed.secs,
        avg_speed_bps: speed.avg_bps,
        max_speed_bps: speed.max_bps,
        duration_secs: probe.as_ref().map(|p| p.duration_secs),
        audio: probe.map(|p| p.audio),
    })
}

/// FR-06d: carpeta donde analizar `hash` y si se conserva. La del análisis (la adopta la
/// reproducción) o, si otra fase del mismo hash ya la está usando, una descartable con `tag`.
fn reserve_dir(
    paths: &AppPaths,
    cleanup: &Cleanup,
    hash: &InfoHash,
    tag: String,
) -> (std::path::PathBuf, bool) {
    let dir = paths.analysis_dir(hash);
    if cleanup.try_reserve(&dir) {
        return (dir, true);
    }
    let scratch =
        paths
            .downloads_dir()
            .join(format!("{}-{}-{tag}", hash.to_hex(), std::process::id()));
    (scratch, false)
}

/// Fin de una fase: la carpeta de análisis queda libre (y en disco); la descartable se borra.
async fn release_dir(cleanup: &Cleanup, dir: &std::path::Path, keep: bool) {
    if keep {
        cleanup.release(dir);
    } else if let Err(e) = cleanup.remove_dir(dir).await {
        tracing::warn!("no se pudo borrar {dir:?}: {e} (se reintenta al abrir la app)");
    }
}

struct SpeedSample {
    avg_bps: f64,
    max_bps: f64,
    peers: u32,
    seeds: u32,
    /// Segundos de velocidad medidos (cantidad de muestras de 1 s).
    secs: f64,
}

/// Lo medido hasta ahora, para guardar una medición parcial si el usuario pausa (2026-11-13).
#[derive(Default)]
struct Partial {
    torrent_name: Option<String>,
    file: Option<crate::engine::FileInfo>,
    samples: Vec<f64>,
    peers: u32,
    seeds: u32,
}

type PartialRef = Arc<std::sync::Mutex<Partial>>;

/// Mínimo de segundos de velocidad para que una medición parcial valga la pena.
const PARTIAL_MIN_SAMPLES: usize = 3;

/// Medición parcial con lo que se llegó a medir (sin duración real: se estima con "~").
fn partial_measurement(partial: &PartialRef) -> Option<LiveMeasurement> {
    let p = partial.lock().expect("partial");
    let file = p.file.clone()?;
    if p.samples.len() < PARTIAL_MIN_SAMPLES {
        return None;
    }
    let speed = sustained_speed(&p.samples, p.peers, p.seeds);
    Some(LiveMeasurement {
        measured_at: chrono::Utc::now(),
        torrent_name: p.torrent_name.clone(),
        file_index: file.index,
        file_name: file.name,
        file_size: file.size,
        peers: speed.peers,
        seeds: speed.seeds,
        partial: true,
        measured_secs: speed.secs,
        avg_speed_bps: speed.avg_bps,
        max_speed_bps: speed.max_bps,
        duration_secs: None,
        audio: None,
    })
}

/// Ventana de medición de velocidad: como mínimo `min` (después del arranque) y como máximo `max`.
#[derive(Debug, Clone, Copy)]
struct SpeedWindow {
    min: Duration,
    max: Duration,
}

/// Velocidad real sostenida. Mide hasta que la velocidad se estabiliza (entre `min` y `max`),
/// o hasta que el usuario toca "Listo" (`finish`). Informa el avance cada 2 s (`progress`).
/// Cuanto más se mide, más real (hasta la meseta): por eso se puede estirar hasta `max`.
async fn sample_speed(
    engine: &dyn crate::engine::TorrentEngine,
    handle: crate::engine::TorrentHandle,
    window: SpeedWindow,
    partial: &PartialRef,
    finish: &CancellationToken,
    progress: &ProgressSink,
) -> Result<SpeedSample> {
    // Calibración (usuario, 2026-11-13: "dice que se va a cortar pero no se corta"):
    // 1. Bytes RECIBIDOS, no piezas verificadas: con piezas de 16 MB, en 15 s casi no se completan.
    // 2. Se descarta el arranque (WARMUP): los primeros segundos los peers recién se conectan (lección 5).
    // 3. Velocidad sostenida = MEDIANA de las muestras por segundo (no la suma total / tiempo).
    // 4. Si la velocidad sigue subiendo al final, se estira la ventana hasta EXTEND_MAX.
    let mut samples: Vec<f64> = Vec::new();
    let mut peers = 0;
    let mut seeds = 0;
    let mut prev: Option<(Instant, u64)> = None;
    let mut use_received = true;
    let mut base_downloaded: Option<u64> = None;
    let t0 = Instant::now();
    let min_until = WARMUP + window.min;
    let max_until = WARMUP + window.max;
    let mut tick = tokio::time::interval(Duration::from_secs(1));
    loop {
        tokio::select! {
            _ = tick.tick() => {}
            // "Listo": se cierra con lo medido (si ya hay algo).
            _ = finish.cancelled(), if !samples.is_empty() => break,
        }
        let Ok(Ok(s)) = tokio::time::timeout(Duration::from_secs(3), engine.stats(handle)).await
        else {
            continue;
        };
        peers = peers.max(s.peers);
        seeds = seeds.max(s.seeds);
        // Motores que no informan bytes recibidos: se cae a los verificados. Contra el arranque:
        // con lo de un análisis anterior en disco `downloaded` ya empieza > 0 (FR-06d).
        let base = *base_downloaded.get_or_insert(s.downloaded_bytes);
        if s.received_bytes == 0 && s.downloaded_bytes > base {
            use_received = false;
        }
        let bytes = if use_received {
            s.received_bytes
        } else {
            s.downloaded_bytes
        };
        let now = Instant::now();
        if let Some((t_prev, b_prev)) = prev {
            if now.duration_since(t0) > WARMUP {
                let dt = now.duration_since(t_prev).as_secs_f64().max(0.001);
                samples.push(bytes.saturating_sub(b_prev) as f64 / dt);
            }
        }
        prev = Some((now, bytes));
        {
            let mut p = partial.lock().expect("partial");
            p.samples.clone_from(&samples);
            p.peers = peers;
            p.seeds = seeds;
        }

        let stable = is_stable(&samples);
        if !samples.is_empty() && samples.len() % 2 == 0 {
            let downloaded_bytes = s.downloaded_bytes;
            let s = sustained_speed(&samples, peers, seeds);
            progress(SpeedProgress {
                speed_bps: s.avg_bps,
                secs: s.secs,
                peers,
                seeds,
                stable,
                downloaded_bytes,
                phase: MeasurePhase::Measuring,
            });
        }

        let elapsed = t0.elapsed();
        if elapsed >= max_until || (elapsed >= min_until && stable) {
            break;
        }
    }
    Ok(sustained_speed(&samples, peers, seeds))
}

/// Segundos iniciales que no cuentan (conexión de peers).
const WARMUP: Duration = Duration::from_secs(5);

/// ¿Los últimos 5 s van claramente más rápido que la mediana? (todavía no llegó a la meseta)
fn still_rising(samples: &[f64]) -> bool {
    if samples.len() < 8 {
        return true;
    }
    let tail = median(&samples[samples.len() - 5..]);
    tail > median(samples) * 1.2
}

/// Meseta alcanzada: ya no sube y los últimos 10 s están cerca (±15 %) de la velocidad
/// sostenida. A partir de acá medir más casi no cambia el resultado.
fn is_stable(samples: &[f64]) -> bool {
    if samples.len() < 15 || still_rising(samples) {
        return false;
    }
    let sustained = median(&samples[samples.len() / 2..]);
    if sustained <= 0.0 {
        return false;
    }
    let recent = median(&samples[samples.len() - 10..]);
    (recent / sustained - 1.0).abs() <= 0.15
}

fn median(values: &[f64]) -> f64 {
    if values.is_empty() {
        return 0.0;
    }
    let mut v = values.to_vec();
    v.sort_by(|a, b| a.total_cmp(b));
    let mid = v.len() / 2;
    if v.len() % 2 == 0 {
        (v[mid - 1] + v[mid]) / 2.0
    } else {
        v[mid]
    }
}

/// Velocidad sostenida (mediana de la meseta: la segunda mitad de las muestras, que ya pasó el
/// arranque) y máxima (mejor promedio móvil de 3 s, para no tomar un pico de 1 s).
fn sustained_speed(samples: &[f64], peers: u32, seeds: u32) -> SpeedSample {
    let plateau = &samples[samples.len() / 2..];
    let avg_bps = median(plateau);
    let max_bps = samples
        .windows(3)
        .map(|w| w.iter().sum::<f64>() / 3.0)
        .fold(avg_bps, f64::max);
    SpeedSample {
        avg_bps,
        max_bps,
        peers,
        seeds,
        secs: samples.len() as f64,
    }
}

// ---------- nombres al pegar ----------

/// Plazo para conseguir los metadatos de un magnet recién pegado.
const NAME_TIMEOUT: Duration = Duration::from_secs(45);

/// Busca SOLO los metadatos de varios magnets a la vez, con un único motor (pedido del usuario:
/// "al pegar, que al toque aparezca el nombre real"; el `dn` de Torrentio es genérico).
/// No baja contenido (todo deseleccionado). Guarda el `.torrent` en caché (FR-13), así el
/// análisis y Reproducir arrancan sin esperar metadatos. Llama a `on_found(hash, nombre, tamaño
/// del video)` por cada uno que
/// resuelve, apenas resuelve. Todo lo creado se borra al terminar.
pub async fn fetch_names(
    paths: &AppPaths,
    cfg: &Config,
    magnets: Vec<Magnet>,
    on_found: impl Fn(InfoHash, String, Option<u64>) + Send + Sync + 'static,
) {
    if magnets.is_empty() {
        return;
    }
    let engine = match crate::engine::create(&cfg.engine).await {
        Ok(e) => e,
        Err(e) => {
            tracing::warn!("nombres al pegar: no se pudo iniciar el motor: {e}");
            return;
        }
    };
    let cleanup = Cleanup::new(paths.clone());
    let on_found = Arc::new(on_found);
    let mut tasks = tokio::task::JoinSet::new();
    let mut dirs = Vec::new();
    for (n, magnet) in magnets.into_iter().enumerate() {
        let dir = paths.downloads_dir().join(format!(
            "{}-{}-n{n}",
            magnet.info_hash.to_hex(),
            std::process::id()
        ));
        let owner = OwnerRecord {
            app_pid: std::process::id(),
            engine_pid: engine.pid(),
            player_pid: None,
            started_at: chrono::Utc::now(),
        };
        if let Err(e) = std::fs::create_dir_all(&dir)
            .map_err(|e| e.to_string())
            .and_then(|_| cleanup.claim(&dir, &owner).map_err(|e| e.to_string()))
        {
            tracing::warn!("nombres al pegar: {e}");
            continue;
        }
        dirs.push(dir.clone());
        let engine = engine.clone();
        let on_found = on_found.clone();
        let cache = paths
            .torrent_cache_dir()
            .join(format!("{}.torrent", magnet.info_hash.to_hex()));
        let trackers = cfg.trackers.clone();
        tasks.spawn(async move {
            let hash = magnet.info_hash;
            let handle = engine
                .add(
                    TorrentSource::Magnet(magnet.with_trackers(&trackers)),
                    AddOptions {
                        trackers,
                        download_dir: dir,
                        only_file: None,
                        start_deselected: true,
                    },
                )
                .await
                .ok()?;
            let result = tokio::time::timeout(NAME_TIMEOUT, engine.metadata(handle)).await;
            let _ = engine
                .remove(handle, RemoveOptions { delete_data: true })
                .await;
            let metadata = result.ok()?.ok()?;
            if !cache.is_file() {
                metadata.save_torrent_cache(&cache);
            }
            if !metadata.name.is_empty() {
                let video_size = metadata.choose_file(None).ok().map(|f| f.size);
                on_found(hash, metadata.name.clone(), video_size);
            }
            Some(())
        });
    }
    let total = dirs.len();
    let mut found = 0;
    while let Some(r) = tasks.join_next().await {
        if matches!(r, Ok(Some(()))) {
            found += 1;
        }
    }
    let _ = engine.shutdown().await;
    for dir in dirs {
        let _ = cleanup.remove_dir(&dir).await;
    }
    tracing::info!(found, total, "nombres al pegar");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn velocidad_sostenida_ignora_el_arranque_lento() {
        // Caso real (Torrentio 27,6 GB): arranque lento y después ~60 Mbps sostenidos.
        let mbps = |x: f64| x * 1e6 / 8.0;
        let samples: Vec<f64> = [
            2.0, 5.0, 9.0, 20.0, 35.0, 55.0, 60.0, 62.0, 58.0, 61.0, 63.0, 59.0, 60.0, 64.0,
        ]
        .iter()
        .map(|&m| mbps(m))
        .collect();
        let s = sustained_speed(&samples, 10, 4);
        let got = s.avg_bps * 8.0 / 1e6;
        assert!((59.0..=62.0).contains(&got), "sostenida {got} Mbps");
        // El total/tiempo viejo daba mucho menos (lo que marcaba "se va a cortar").
        let old = samples.iter().sum::<f64>() / samples.len() as f64 * 8.0 / 1e6;
        assert!(old < 50.0);
        assert!(s.max_bps >= s.avg_bps);
    }

    #[test]
    fn sigue_subiendo_estira_la_ventana() {
        let rising: Vec<f64> = (1..=12).map(|i| f64::from(i) * 1e6).collect();
        assert!(still_rising(&rising));
        let flat = vec![5e6; 12];
        assert!(!still_rising(&flat));
        assert!(still_rising(&[1e6; 3]), "pocas muestras: seguir midiendo");
    }

    #[test]
    fn meseta_estable_corta_la_medicion() {
        assert!(!is_stable(&[5e6; 10]), "10 s: muy poco para saber");
        assert!(is_stable(&[5e6; 20]), "20 s planos: estable");
        let mut subiendo: Vec<f64> = vec![5e6; 10];
        subiendo.extend((1..=10).map(|i| 5e6 + f64::from(i) * 1e6));
        assert!(!is_stable(&subiendo), "todavía sube: seguir midiendo");
        let mut ruidosa = vec![5e6; 10];
        ruidosa.extend([1e6, 9e6, 1e6, 9e6, 1e6, 9e6, 1e6, 9e6, 1e6, 9e6]);
        let _ = is_stable(&ruidosa); // no debe entrar en pánico con ruido
    }

    #[test]
    fn pausa_a_mitad_guarda_medicion_parcial() {
        let p: PartialRef = Arc::default();
        assert!(
            partial_measurement(&p).is_none(),
            "sin metadatos no hay nada"
        );
        {
            let mut g = p.lock().unwrap();
            g.torrent_name = Some("Pelicula.2024.2160p".into());
            g.file = Some(crate::engine::FileInfo {
                index: 0,
                name: "p.mkv".into(),
                size: 20_000_000_000,
                offset: 0,
            });
            g.samples = vec![1e6, 2e6];
        }
        assert!(
            partial_measurement(&p).is_none(),
            "2 s de velocidad: muy poco"
        );
        p.lock().unwrap().samples = vec![1e6, 4e6, 5e6, 5e6, 6e6];
        p.lock().unwrap().seeds = 7;
        let m = partial_measurement(&p).expect("parcial");
        assert!(m.partial);
        assert_eq!(m.measured_secs, 5.0);
        assert_eq!(m.seeds, 7);
        assert!(m.duration_secs.is_none(), "sin duración real: se estima");
        assert!(m.avg_speed_bps >= 5e6);
    }

    #[test]
    fn sin_muestras_da_cero_sin_panic() {
        let s = sustained_speed(&[], 0, 0);
        assert_eq!(s.avg_bps, 0.0);
    }
    use crate::events::CoreEvent;

    use std::sync::Mutex;

    /// Medidor falso: scrape con seeders = 1er byte del hash; medición que tarda `delay`,
    /// falla las primeras `fail_first` veces y devuelve velocidad = 1er byte × 1 MB/s.
    struct Fake {
        delay: Duration,
        fail_first: Mutex<u32>,
        measured: Mutex<Vec<InfoHash>>,
        quicked: Mutex<Vec<InfoHash>>,
    }

    #[async_trait]
    impl Measurer for Fake {
        async fn scrape(&self, hashes: &[InfoHash], _: &Config) -> HashMap<InfoHash, ScrapeResult> {
            hashes
                .iter()
                .map(|h| {
                    (
                        *h,
                        ScrapeResult {
                            seeders: u32::from(h.as_bytes()[0]),
                            leechers: 1,
                            completed: 0,
                            trackers_ok: 1,
                            scraped_at: chrono::Utc::now(),
                        },
                    )
                })
                .collect()
        }
        async fn quick(
            &self,
            magnets: Vec<(Magnet, FilePick)>,
            _: &Config,
            _: CancellationToken,
            _: QuickSink,
        ) {
            let mut q = self.quicked.lock().unwrap();
            q.extend(magnets.iter().map(|(m, _)| m.info_hash));
        }
        async fn measure(
            &self,
            magnet: &Magnet,
            _: FilePick,
            _: &Config,
            ctl: MeasureCtl,
        ) -> Result<LiveMeasurement> {
            (ctl.progress)(SpeedProgress::phase(MeasurePhase::Connecting));
            tokio::select! {
                _ = tokio::time::sleep(self.delay) => {}
                _ = ctl.cancel.cancelled() => return Err(CoreError::Cancelled),
            }
            let should_fail = {
                let mut left = self.fail_first.lock().unwrap();
                let fail = *left > 0;
                *left = left.saturating_sub(1);
                fail
            };
            if should_fail {
                return Err(CoreError::Engine("falla simulada".into()));
            }
            self.measured.lock().unwrap().push(magnet.info_hash);
            Ok(LiveMeasurement {
                measured_at: chrono::Utc::now(),
                torrent_name: None,
                file_index: 0,
                file_name: "video.mkv".into(),
                file_size: 1_000_000_000,
                peers: 3,
                seeds: 1,
                partial: false,
                measured_secs: 15.0,
                avg_speed_bps: f64::from(magnet.info_hash.as_bytes()[0]) * 1e6,
                max_speed_bps: 0.0,
                duration_secs: Some(888.0),
                audio: None,
            })
        }
    }

    #[derive(Default)]
    struct Sink(Mutex<Vec<CoreEvent>>);
    impl EventSink for Sink {
        fn emit(&self, event: CoreEvent) {
            self.0.lock().unwrap().push(event);
        }
    }

    struct Setup {
        handle: AnalyzerHandle,
        library: Arc<tokio::sync::Mutex<Library>>,
        fake: Arc<Fake>,
        sink: Arc<Sink>,
        root: std::path::PathBuf,
    }

    fn hash(b: u8) -> InfoHash {
        InfoHash::from_bytes([b; 20])
    }

    async fn setup(
        name: &str,
        seeders: &[u8],
        delay_ms: u64,
        fail_first: u32,
        retries: u32,
    ) -> Setup {
        let root =
            std::env::temp_dir().join(format!("tstream-test-an-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let paths = AppPaths::under(&root);
        paths.ensure_dirs().unwrap();
        let mut library = Library::load(paths.library_file()).unwrap();
        for &s in seeders {
            let m = Magnet {
                info_hash: hash(s),
                display_name: Some(format!("t{s}")),
                trackers: vec![],
            };
            library.add_or_touch(&m, &m.to_uri());
        }
        let library = Arc::new(tokio::sync::Mutex::new(library));
        let mut cfg = Config::default();
        cfg.analyzer.retries = retries;
        // Sin búsquedas reales de subtítulos en las pruebas.
        cfg.subtitles.language = crate::config::SubtitleLanguage::None;
        let fake = Arc::new(Fake {
            delay: Duration::from_millis(delay_ms),
            fail_first: Mutex::new(fail_first),
            measured: Mutex::default(),
            quicked: Mutex::default(),
        });
        let sink = Arc::new(Sink::default());
        let handle = AnalyzerHandle::spawn_with(
            AnalyzerDeps {
                paths,
                config: Arc::new(tokio::sync::RwLock::new(cfg)),
                library: library.clone(),
                events: sink.clone(),
            },
            fake.clone(),
        );
        Setup {
            handle,
            library,
            fake,
            sink,
            root,
        }
    }

    impl Setup {
        async fn wait_idle(&self) {
            let deadline = Instant::now() + Duration::from_secs(10);
            loop {
                tokio::time::sleep(Duration::from_millis(20)).await;
                let idle = matches!(
                    self.sink
                        .0
                        .lock()
                        .unwrap()
                        .iter()
                        .rev()
                        .find_map(|e| match e {
                            CoreEvent::AnalyzerProgress { state } => Some(state.clone()),
                            _ => None,
                        }),
                    Some(AnalyzerState::Idle)
                );
                let lib = self.library.lock().await;
                let busy = lib.hashes().iter().any(|h| {
                    matches!(
                        lib.get(h).unwrap().status,
                        EntryStatus::Scraping | EntryStatus::Measuring
                    )
                });
                if idle && !busy {
                    return;
                }
                assert!(Instant::now() < deadline, "el analizador no terminó");
            }
        }
        fn cleanup(&self) {
            let _ = std::fs::remove_dir_all(&self.root);
        }
    }

    #[tokio::test]
    async fn mide_los_que_tienen_seeders_mejores_primero() {
        let s = setup("order", &[2, 0, 9], 10, 0, 0).await;
        s.handle.enqueue(AnalyzeScope::All).await.unwrap();
        s.wait_idle().await;
        assert_eq!(*s.fake.measured.lock().unwrap(), vec![hash(9), hash(2)]);
        let lib = s.library.lock().await;
        assert_eq!(lib.get(&hash(9)).unwrap().status, EntryStatus::Measured);
        let sin = lib.get(&hash(0)).unwrap();
        assert_eq!(sin.status, EntryStatus::Scraped, "0 seeders: no se mide");
        assert_eq!(sin.scrape.as_ref().unwrap().seeders, 0);
        drop(lib);
        // Re-analizar uno lo mide aunque el tracker diga 0 seeders (FR-08).
        s.handle.enqueue(AnalyzeScope::One(hash(0))).await.unwrap();
        s.wait_idle().await;
        assert_eq!(s.fake.measured.lock().unwrap().len(), 3);
        s.cleanup();
    }

    #[tokio::test]
    async fn pausa_no_pierde_lo_medido_y_reanuda() {
        let s = setup("pause", &[1, 2, 3], 300, 0, 0).await;
        s.handle.enqueue(AnalyzeScope::All).await.unwrap();
        // Esperar a que termine el primero (hash 3) y pausar durante el segundo.
        let deadline = Instant::now() + Duration::from_secs(5);
        while s.fake.measured.lock().unwrap().is_empty() {
            assert!(Instant::now() < deadline);
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
        s.handle.pause().await.unwrap();
        tokio::time::sleep(Duration::from_millis(600)).await;
        assert_eq!(s.fake.measured.lock().unwrap().len(), 1, "en pausa no mide");
        {
            let lib = s.library.lock().await;
            assert!(lib.get(&hash(3)).unwrap().live.is_some(), "lo medido queda");
            assert_eq!(lib.get(&hash(2)).unwrap().status, EntryStatus::Scraped);
        }
        assert!(s.sink.0.lock().unwrap().iter().any(|e| matches!(
            e,
            CoreEvent::AnalyzerProgress {
                state: AnalyzerState::Paused { .. }
            }
        )));
        s.handle.resume().await.unwrap();
        s.wait_idle().await;
        assert_eq!(
            *s.fake.measured.lock().unwrap(),
            vec![hash(3), hash(2), hash(1)]
        );
        // "Analizar solo los no medidos" no vuelve a medir nada.
        s.handle
            .enqueue(AnalyzeScope::OnlyUnmeasured)
            .await
            .unwrap();
        s.wait_idle().await;
        assert_eq!(s.fake.measured.lock().unwrap().len(), 3);
        s.cleanup();
    }

    #[tokio::test]
    async fn pausar_uno_no_frena_a_los_demas_y_se_reanuda_solo() {
        // Orden por seeders: 9, 5, 1. Se pausa el 5 (en cola) mientras se mide el 9.
        let s = setup("hold", &[1, 5, 9], 200, 0, 0).await;
        s.handle.enqueue(AnalyzeScope::All).await.unwrap();
        tokio::time::sleep(Duration::from_millis(50)).await;
        s.handle.pause_one(hash(5)).await.unwrap();
        s.wait_idle().await;
        assert_eq!(
            *s.fake.measured.lock().unwrap(),
            vec![hash(9), hash(1)],
            "el 5 quedó pausado"
        );
        let held = s.sink.0.lock().unwrap().iter().rev().find_map(|e| match e {
            CoreEvent::AnalyzerQueue { held, .. } => Some(held.clone()),
            _ => None,
        });
        assert_eq!(
            held,
            Some(vec![hash(5)]),
            "la UI sabe que el 5 está pausado"
        );
        s.handle.resume_one(hash(5)).await.unwrap();
        s.wait_idle().await;
        assert_eq!(
            *s.fake.measured.lock().unwrap(),
            vec![hash(9), hash(1), hash(5)]
        );
        s.cleanup();
    }

    #[tokio::test]
    async fn analizar_seleccionados_mide_solo_esos() {
        let s = setup("selected", &[1, 5, 9], 5, 0, 0).await;
        s.handle
            .enqueue(AnalyzeScope::Selected(vec![hash(1), hash(5)]))
            .await
            .unwrap();
        s.wait_idle().await;
        let mut got = s.fake.measured.lock().unwrap().clone();
        got.sort();
        assert_eq!(got, vec![hash(1), hash(5)]);
        s.cleanup();
    }

    #[tokio::test]
    async fn pedir_de_nuevo_lo_que_ya_se_analiza_no_hace_nada_y_la_fase_llega_a_la_ui() {
        let s = setup("twice", &[5, 9], 300, 0, 0).await;
        s.handle.enqueue(AnalyzeScope::One(hash(5))).await.unwrap();
        tokio::time::sleep(Duration::from_millis(50)).await;
        // Doble clic, "Analizar todo" y "Análisis rápido" mientras se mide: el 5 no se repite.
        s.handle.enqueue(AnalyzeScope::One(hash(5))).await.unwrap();
        s.handle
            .enqueue(AnalyzeScope::QuickOnly(hash(5)))
            .await
            .unwrap();
        s.handle.enqueue(AnalyzeScope::All).await.unwrap();
        s.wait_idle().await;
        let mut got = s.fake.measured.lock().unwrap().clone();
        got.sort();
        assert_eq!(got, vec![hash(5), hash(9)], "cada uno una sola vez");
        // La fase ("conectando") viaja en el progreso de la medición.
        assert!(s.sink.0.lock().unwrap().iter().any(|e| matches!(
            e,
            CoreEvent::AnalyzerProgress {
                state: AnalyzerState::Measuring {
                    live: Some(SpeedProgress {
                        phase: MeasurePhase::Connecting,
                        ..
                    }),
                    ..
                }
            }
        )));
        // Pausado uno por uno: pedirlo de nuevo no lo reactiva; "Seguir analizando" sí.
        s.handle.enqueue(AnalyzeScope::One(hash(9))).await.unwrap();
        tokio::time::sleep(Duration::from_millis(50)).await;
        s.handle.pause_one(hash(9)).await.unwrap();
        s.wait_idle().await;
        s.handle.enqueue(AnalyzeScope::One(hash(9))).await.unwrap();
        s.wait_idle().await;
        assert_eq!(
            s.fake.measured.lock().unwrap().len(),
            2,
            "pausado: no se mide"
        );
        s.handle.resume_one(hash(9)).await.unwrap();
        s.wait_idle().await;
        assert_eq!(s.fake.measured.lock().unwrap().len(), 3);
        s.cleanup();
    }

    #[tokio::test]
    async fn reiniciar_corta_lo_que_se_mide_y_lo_pide_de_nuevo() {
        let s = setup("restart", &[5, 9], 300, 0, 0).await;
        s.handle.enqueue(AnalyzeScope::One(hash(5))).await.unwrap();
        tokio::time::sleep(Duration::from_millis(80)).await;
        // Trabado a mitad de medición: reiniciar lo corta (sin guardar) y lo mide de nuevo.
        s.handle.restart(hash(5), false).await.unwrap();
        s.wait_idle().await;
        assert_eq!(
            *s.fake.measured.lock().unwrap(),
            vec![hash(5)],
            "una sola medición completa"
        );
        // Pausado uno por uno: reiniciar lo saca de la pausa y lo vuelve a pedir.
        s.handle.enqueue(AnalyzeScope::One(hash(9))).await.unwrap();
        tokio::time::sleep(Duration::from_millis(80)).await;
        s.handle.pause_one(hash(9)).await.unwrap();
        s.wait_idle().await;
        s.handle.restart(hash(9), false).await.unwrap();
        s.wait_idle().await;
        assert_eq!(s.fake.measured.lock().unwrap().len(), 2);
        // Reiniciar solo el rápido: no mide velocidad.
        s.handle.restart(hash(9), true).await.unwrap();
        s.wait_idle().await;
        assert_eq!(s.fake.measured.lock().unwrap().len(), 2);
        assert!(s.fake.quicked.lock().unwrap().contains(&hash(9)));
        s.cleanup();
    }

    #[test]
    fn subtitulos_junto_al_video_con_su_nombre() {
        let dir = std::env::temp_dir().join(format!("tstream-test-subs-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join("cache")).unwrap();
        let video = dir.join("Dune.Part.Two.2024.mkv");
        // Disperso a medias: principio bajado, final no → sin hash.
        let mut bytes = vec![0u8; 300_000];
        bytes[..1000].fill(7);
        std::fs::write(&video, &bytes).unwrap();
        assert_eq!(movie_hash_from_disk(&video, 300_000), None);
        bytes[299_000..].fill(9);
        std::fs::write(&video, &bytes).unwrap();
        assert!(movie_hash_from_disk(&video, 300_000).is_some());

        let cand = crate::subtitles::SubtitleCandidate {
            provider: crate::subtitles::TORRENT_PROVIDER,
            provider_id: "x".into(),
            release_name: "x".into(),
            language: crate::config::SubtitleLanguage::Es,
            match_kind: crate::subtitles::MatchKind::Hash,
            downloads: 0,
            variant: crate::subtitles::SpanishVariant::Unknown,
            url: String::new(),
        };
        let a = dir.join("cache").join("a.srt");
        let b = dir.join("cache").join("b.ass");
        std::fs::write(&a, "1").unwrap();
        std::fs::write(&b, "2").unwrap();
        let subs = vec![(cand.clone(), a), (cand, b)];
        let lang = crate::config::SubtitleLanguage::Es;
        assert_eq!(copy_next_to_video(&video, &subs, lang), 2);
        assert!(dir.join("Dune.Part.Two.2024.es.srt").is_file());
        assert!(dir.join("Dune.Part.Two.2024.es-2.ass").is_file());
        assert_eq!(
            copy_next_to_video(&video, &subs, lang),
            0,
            "no pisa ni duplica"
        );
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[tokio::test]
    async fn analisis_rapido_no_mide_velocidad() {
        let s = setup("quick-only", &[0, 5], 5, 0, 0).await;
        // Forzado como `One`: también con 0 seeders en el tracker.
        s.handle
            .enqueue(AnalyzeScope::QuickOnly(hash(0)))
            .await
            .unwrap();
        s.wait_idle().await;
        assert_eq!(*s.fake.quicked.lock().unwrap(), vec![hash(0)]);
        assert!(s.fake.measured.lock().unwrap().is_empty(), "no mide");
        let st = s.library.lock().await.get(&hash(0)).unwrap().status.clone();
        assert_eq!(st, EntryStatus::Scraped);
        // "Medir velocidad" después sí mide.
        s.handle.enqueue(AnalyzeScope::One(hash(0))).await.unwrap();
        s.wait_idle().await;
        assert_eq!(*s.fake.measured.lock().unwrap(), vec![hash(0)]);
        s.cleanup();
    }

    #[tokio::test]
    async fn reintenta_y_despues_marca_fallido() {
        let s = setup("retry", &[5], 5, 2, 2).await;
        s.handle.enqueue(AnalyzeScope::All).await.unwrap();
        s.wait_idle().await;
        assert_eq!(
            s.library.lock().await.get(&hash(5)).unwrap().status,
            EntryStatus::Measured,
            "2 fallas + 2 reintentos → mide"
        );
        s.cleanup();

        let s = setup("retry-fail", &[5], 5, 10, 1).await;
        s.handle.enqueue(AnalyzeScope::All).await.unwrap();
        s.wait_idle().await;
        let status = s.library.lock().await.get(&hash(5)).unwrap().status.clone();
        assert!(matches!(status, EntryStatus::Failed { .. }), "{status:?}");
        s.cleanup();
    }
}
