//! `analyzer` — cola de medición en vivo con pausa/reanudar, reintentos y duración real (FR-05–08).
//!
//! Flujo (spec 04, flujo 2): scrape en lote → por cada candidato con seeders:
//! motor propio de medición (carpeta temporal) → metadatos → archivo de video más grande →
//! precarga inicio(+final) y velocidad real durante `measure_secs` → duración con
//! `player::probe_media` sobre la URL del motor → `library` guarda → se borra todo (FR-06).
//! Pausar no pierde lo medido: lo terminado ya está en `library` (FR-08). La medición en curso
//! se corta y vuelve al principio de la cola; al reanudar se mide de nuevo.
//!
//! La cola es una única tarea de fondo que recibe comandos por canal (NFR-10). Las mediciones
//! van de a una (`concurrency` = 1): medir en paralelo reparte el ancho de banda y los
//! resultados dejan de ser comparables entre sí.
//!
//! Submódulos: `queue` (la cola y su estado por hash) · `live` (medidor real, carpetas de
//! análisis) · `pipeline` (pasos de red de la fase rápida y de la medición) · `speed` (velocidad
//! sostenida, pura) · `subs` (subtítulos al analizar) · `names` (nombres al pegar).

mod live;
mod names;
mod pipeline;
mod queue;
mod speed;
mod subs;
pub mod swarm;

use std::collections::HashMap;
use std::sync::Arc;

use async_trait::async_trait;
use serde::Serialize;
use tokio::sync::mpsc;
use tokio_util::sync::CancellationToken;

use crate::config::Config;
use crate::engine::FilePick;
use crate::events::EventSink;
use crate::library::{Library, LiveMeasurement};
use crate::magnet::{InfoHash, Magnet};
use crate::paths::AppPaths;
use crate::trackers::ScrapeResult;
use crate::Result;

pub use live::LiveMeasurer;
pub use names::fetch_names;
use queue::{Command, Queue};

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
        /// Margen y semáforo provisorios de cada fila del torrent para `live.speed_bps` (misma
        /// regla que el puntaje final: calibración + umbrales). Vacío sin velocidad todavía.
        provisional: Vec<crate::library::ProvisionalScore>,
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
    /// `on_result` por cada torrent que resuelve.
    async fn quick(
        &self,
        magnets: Vec<(Magnet, FilePick)>,
        cfg: &Config,
        cancel: CancellationToken,
        on_result: QuickSink,
    );
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
    /// Olvidar un magnet (se quitó de la lista): sale de la cola y, si se está midiendo, se
    /// corta; los demás siguen. La carpeta de análisis se suelta al terminar de cortarse.
    pub async fn cancel_one(&self, hash: InfoHash) -> Result<()> {
        self.send(Command::CancelOne(hash)).await
    }

    async fn send(&self, cmd: Command) -> Result<()> {
        self.tx
            .send(cmd)
            .await
            .map_err(|_| crate::CoreError::Cancelled)
    }
}
