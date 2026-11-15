//! `playback` — orquesta motor + precarga + reproductor; panel de reproducciones y acciones (FR-09–17).
//!
//! Flujo (spec 04, flujo 1), por reproducción:
//! `start` → carpeta propia (o la de una pausada) + `cleanup.claim` → `engine.add` (trackers, deselect,
//! `.torrent` en caché si hay) → metadatos (timeout) → archivo de video → `preload::run`
//! → `player.launch(stream_url)` → stats cada 1 s al panel → al terminar: motor detenido.
//!
//! Ciclo de vida (FR-12 cambiado por el usuario, 2026-11-13): al cerrar mpv, al dar play a otro
//! video (FR-12b) o al cerrar la app, la descarga queda **pausada y guardada** (`.tstream-kept.json`
//! en su carpeta, con el minuto donde se dejó de ver). Se borra solo con "Borrar" o "Borrar todo".
//! Las pausadas sobreviven a cerrar la app (`load_kept`) y se retoman desde lo ya bajado.
//!
//!
//! Este archivo: tipos públicos, registro de reproducciones (activas en `slots`, pausadas en
//! `kept`) y su ciclo de vida (`start` / `act` / `stop_all` / `teardown`). El resto:
//! - [`flow`]: el flujo de una reproducción (metadatos → precarga → reproductor → al cerrar).
//! - [`kept`]: pausadas guardadas en disco, migración y reuso de lo bajado al analizar (FR-06d).
//! - [`calibration`]: velocidad real mientras se mira → factor del semáforo.
//!
//! Cada reproducción usa su propio motor (aislamiento: si uno cae, no tumba a los demás).

mod calibration;
pub use calibration::Calibration;
mod flow;
mod kept;

use std::collections::{BTreeMap, HashSet, VecDeque};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use tokio_util::sync::CancellationToken;

use crate::cleanup::Cleanup;
use crate::config::{Config, PlayerKind};
use crate::engine::{RemoveOptions, TorrentEngine, TorrentHandle};
use crate::events::{CoreEvent, EventSink, StatusLevel};
use crate::library::Library;
use crate::magnet::{InfoHash, Magnet};
use crate::paths::AppPaths;
use crate::video_key::VideoKey;
use crate::{CoreError, Result};
use kept::{kept_row, Kept};

const LOG_LINES: usize = 500;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
pub struct PlaybackId(pub u64);

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum PlaybackState {
    FetchingMetadata,
    /// Precarga (FR-11); `fraction` 0–1.
    Preparing {
        fraction: f32,
    },
    Playing,
    /// Descarga pausada; el reproductor sigue abierto.
    DownloadPaused,
    Stopping,
    /// Se cerró el reproductor sin terminar de bajar: la UI pregunta si seguir bajando de fondo o
    /// pausar (2026-11-14). Sin respuesta en [`flow::ASK_TIMEOUT`] se pausa, como antes.
    AskAfterClose,
    /// Bajando de fondo, sin reproductor (eligió "Seguir bajando"): hasta completar o "Detener".
    Background,
    /// Guardada y pausada (sin reproductor ni motor): se retoma con play (FR-12).
    Paused {
        position_secs: Option<f64>,
    },
    Failed {
        message: String,
    },
}

/// Una fila del panel (FR-14).
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct PlaybackRow {
    pub id: PlaybackId,
    /// Qué video es: la fila de *Mis magnets* con la misma clave muestra "Retomar" / "Volver a mpv".
    pub key: VideoKey,
    pub info_hash: InfoHash,
    pub name: String,
    pub state: PlaybackState,
    pub player: PlayerKind,
    /// 0–1 del archivo.
    pub progress: f32,
    pub speed_bps: f64,
    pub peers: u32,
    pub started_at: DateTime<Utc>,
    /// Segundos desde Reproducir hasta metadatos listos (NFR-08, 06-D).
    pub metadata_secs: Option<f32>,
    /// Segundos desde Reproducir hasta fin de precarga (o plan B) (FR-11, 06-D).
    pub preload_secs: Option<f32>,
    /// Segundos desde Reproducir hasta la primera imagen (Q-07, métrica de O1).
    pub time_to_first_frame_secs: Option<f32>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum PlaybackAction {
    PauseDownload,
    /// En una fila activa: reanudar la descarga. En una pausada: retomar la reproducción.
    ResumeDownload,
    /// Cierra reproductor y motor; lo bajado queda guardado y en pausa (FR-12).
    Stop,
    /// "Borrar": detiene si está activa y borra lo descargado.
    StopAndDelete,
    OpenFolder,
    /// Respuesta a [`PlaybackState::AskAfterClose`]: seguir bajando de fondo. (Pausar = `Stop`.)
    KeepDownloading,
}

/// Cuánto se espera a que una reproducción que se cierra quede guardada (`Shared::wait_gone`).
const CLOSE_WAIT: Duration = Duration::from_secs(20);

#[derive(Debug, Clone)]
pub struct StartRequest {
    /// Qué video: una pausada solo se retoma si es ESTE (no otro episodio del mismo pack).
    pub key: VideoKey,
    /// Magnet a usar. `None` → el de la pausada o el guardado en la biblioteca.
    pub magnet: Option<Magnet>,
    /// `None` → el de la config (FR-09).
    pub player: Option<PlayerKind>,
    /// `None` → el de la pausada o el video más grande.
    pub file_index: Option<usize>,
    /// Audio elegido (inglés / latino…). `None` → el de la pausada, o el que traiga por defecto.
    pub audio: Option<crate::audio::AudioPick>,
    /// "Cargar en background" desde el catálogo: precarga y baja de fondo sin abrir el reproductor
    /// ni pausar lo que se esté viendo. Reproducir después la retoma con lo ya bajado.
    pub background: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum OnAppClose {
    /// Cierra mpv; las descargas quedan pausadas y guardadas.
    StopAll,
    /// Q-10: mpv sigue con lo que tiene en caché; la descarga se pausa y queda guardada.
    LeaveRunning,
}

pub struct PlaybackDeps {
    pub paths: AppPaths,
    pub config: Arc<tokio::sync::RwLock<Config>>,
    pub library: Arc<tokio::sync::Mutex<Library>>,
    pub events: Arc<dyn EventSink>,
    /// Única dueña de `calibration.json` (el factor del semáforo).
    pub calibration: Arc<Calibration>,
}

/// Estado vivo de una reproducción.
struct Slot {
    row: Mutex<PlaybackRow>,
    dir: PathBuf,
    started: Instant,
    /// Detener pedido por el usuario o por la app.
    cancel: CancellationToken,
    /// Al detener: ¿borrar lo bajado? Por defecto NO (FR-12 cambiado): solo "Borrar".
    delete_on_stop: AtomicBool,
    /// Al detener: ¿dejar mpv abierto? (FR-17 "dejarla", Q-10: mpv sigue con su caché).
    keep_player: AtomicBool,
    /// Minuto donde retomar (pausada).
    resume_from: Option<f64>,
    engine: Mutex<Option<(Arc<dyn TorrentEngine>, TorrentHandle)>>,
    /// Último `time-pos` de mpv (para retomar).
    position: Mutex<Option<f64>>,
    /// Se conoce al llegar los metadatos; sin esto no hay nada que valga la pena guardar.
    file_index: Mutex<Option<usize>>,
    magnet_uri: Mutex<Option<String>>,
    log: Mutex<VecDeque<String>>,
    /// Audio elegido (se guarda con la pausada).
    audio: Option<crate::audio::AudioPick>,
    /// "Seguir bajando" al cerrar el reproductor (`PlaybackAction::KeepDownloading`).
    keep_downloading: tokio::sync::Notify,
    /// Arrancó con [`StartRequest::background`]: nunca abre reproductor.
    background: bool,
}

impl Slot {
    /// Baja sin reproductor: arrancó como carga en background o ya pasó a bajar de fondo.
    fn without_player(&self, state: &PlaybackState) -> bool {
        self.background || *state == PlaybackState::Background
    }
    /// Única puerta para cambiar `row.state`: pasa a `next` solo si `allowed(estado actual)`.
    /// Devuelve si cambió. No emite: quien llama decide cuándo avisar al panel.
    fn transition(
        &self,
        allowed: impl FnOnce(&PlaybackState) -> bool,
        next: PlaybackState,
    ) -> bool {
        let mut row = self.row.lock().expect("row");
        let ok = allowed(&row.state);
        if ok {
            row.state = next;
        }
        ok
    }

    /// [`Self::transition`] sin condición (el flujo avanza de paso).
    fn set_state(&self, next: PlaybackState) {
        self.transition(|_| true, next);
    }
}

struct Shared {
    deps: PlaybackDeps,
    cleanup: Cleanup,
    /// Un `start` a la vez (ver [`PlaybackManager::start`]).
    starting: tokio::sync::Mutex<()>,
    slots: Mutex<BTreeMap<PlaybackId, Arc<Slot>>>,
    kept: Mutex<BTreeMap<PlaybackId, Kept>>,
    next_id: AtomicU64,
}

pub struct PlaybackManager {
    shared: Arc<Shared>,
}

impl PlaybackManager {
    pub fn new(deps: PlaybackDeps) -> Self {
        let cleanup = Cleanup::new(deps.paths.clone());
        Self {
            shared: Arc::new(Shared {
                deps,
                cleanup,
                starting: tokio::sync::Mutex::new(()),
                slots: Mutex::default(),
                kept: Mutex::default(),
                next_id: AtomicU64::new(1),
            }),
        }
    }

    /// Al abrir la app: las descargas pausadas de sesiones anteriores vuelven al panel (FR-12).
    /// Las de antes de la clave por video se migran ([`migrated_key`]) y se reescriben.
    pub async fn load_kept(&self) {
        self.shared.load_kept().await
    }

    /// Empieza en segundo plano y devuelve enseguida (NFR-10). El progreso llega por eventos.
    /// FR-12b: si había otra reproducción activa (también otro episodio del mismo pack), se cierra
    /// su mpv y queda pausada y guardada. Si ESTE video estaba pausado, se retoma desde lo ya
    /// bajado y desde donde se dejó de ver.
    ///
    /// Todo pasa en un solo turno (`starting`): ¿ya está? → pausar la otra → esperar a que se
    /// guarde (~1 s: cambiar de video espera ese cierre) → retomar la pausada → fila nueva. Así
    /// dos ▶ seguidos no abren dos motores y una pausada recién cerrada se retoma en vez de
    /// bajarse de cero en otra carpeta.
    pub async fn start(&self, req: StartRequest) -> Result<PlaybackId> {
        let _turn = self.shared.starting.lock().await;
        // Ya se está reproduciendo ese mismo video: nada que hacer. Si solo baja de fondo (o
        // espera "¿seguir bajando?"), se corta y se retoma abajo con reproductor.
        if let Some(id) = self.shared.active_id_for(&req.key) {
            if req.background || !self.shared.stop_background(id).await {
                return Ok(id);
            }
        }
        if !req.background {
            let closing = self.shared.pause_active();
            self.shared.wait_gone(&closing, CLOSE_WAIT).await;
        }

        let kept = self.shared.take_kept(&req.key);
        let player = match (req.player, &kept) {
            (Some(p), _) => p,
            (None, Some((_, k))) => k.record.player,
            (None, None) => self.shared.deps.config.read().await.player.default_player,
        };
        let mut req = req;
        let adopted;
        let (id, dir, name, resume_from, file_index, magnet) = match kept {
            Some((id, k)) => {
                let magnet = match req.magnet.take() {
                    Some(m) => Some(m),
                    None => Magnet::parse(&k.record.magnet).ok(),
                };
                if req.audio.is_none() {
                    req.audio = k.record.audio.clone();
                }
                adopted = self.shared.merge_analysis(&req.key.info_hash, &k.dir);
                (
                    id,
                    k.dir,
                    k.record.name,
                    k.record.position_secs,
                    req.file_index.or(Some(k.record.file_index)),
                    magnet,
                )
            }
            None => {
                let id = self.shared.new_id();
                let dir = self.shared.deps.paths.downloads_dir().join(format!(
                    "{}-{}-{}",
                    req.key.info_hash.to_hex(),
                    std::process::id(),
                    id.0
                ));
                adopted = self.shared.adopt_analysis(&req.key.info_hash, &dir);
                let name = req
                    .magnet
                    .as_ref()
                    .and_then(|m| m.display_name.clone())
                    .unwrap_or_else(|| req.key.info_hash.to_hex());
                (id, dir, name, None, req.file_index, req.magnet.take())
            }
        };

        let slot = Arc::new(Slot {
            row: Mutex::new(PlaybackRow {
                id,
                key: req.key,
                info_hash: req.key.info_hash,
                name,
                state: PlaybackState::FetchingMetadata,
                player,
                progress: 0.0,
                speed_bps: 0.0,
                peers: 0,
                started_at: Utc::now(),
                metadata_secs: None,
                preload_secs: None,
                time_to_first_frame_secs: None,
            }),
            dir,
            started: Instant::now(),
            cancel: CancellationToken::new(),
            delete_on_stop: AtomicBool::new(false),
            keep_player: AtomicBool::new(false),
            keep_downloading: tokio::sync::Notify::new(),
            background: req.background,
            resume_from,
            engine: Mutex::new(None),
            position: Mutex::new(resume_from),
            file_index: Mutex::new(None),
            magnet_uri: Mutex::new(None),
            log: Mutex::default(),
            audio: req.audio.clone(),
        });
        self.shared
            .slots
            .lock()
            .expect("slots")
            .insert(id, slot.clone());
        self.shared.emit_row(&slot);
        if adopted {
            self.shared
                .log(&slot, "reuso lo bajado al analizar (FR-06d)".into());
        }
        if let Some(pos) = resume_from {
            self.shared
                .log(&slot, format!("retomando desde {}", clock(pos)));
        }

        let req = StartRequest {
            magnet,
            file_index,
            ..req
        };
        let shared = self.shared.clone();
        tokio::spawn(async move {
            let result = flow::run(&shared, &slot, req, player).await;
            if let Err(e) = &result {
                if !matches!(e, CoreError::Cancelled) {
                    shared.log(&slot, format!("error: {e}"));
                    shared.status(StatusLevel::Error, e.user_message());
                    slot.set_state(PlaybackState::Failed {
                        message: e.user_message(),
                    });
                    shared.emit_row(&slot);
                }
            }
            let kept = shared.teardown(&slot).await;
            if kept {
                shared.slot_to_kept(&slot);
            } else if result.is_ok()
                || matches!(result, Err(CoreError::Cancelled))
                || slot.cancel.is_cancelled()
            {
                // Una fila fallida sin nada guardado queda visible hasta que el usuario la quite.
                shared.forget(&slot);
            }
        });
        Ok(id)
    }

    pub async fn act(&self, id: PlaybackId, action: PlaybackAction) -> Result<()> {
        // Filas pausadas (sin motor ni reproductor).
        if let Some((key, dir)) = self.shared.kept_info(id) {
            return match action {
                PlaybackAction::ResumeDownload => self
                    .start(StartRequest {
                        key,
                        magnet: None,
                        player: None,
                        file_index: None,
                        audio: None, // el de la pausada
                        background: false,
                    })
                    .await
                    .map(drop),
                PlaybackAction::StopAndDelete => self.shared.delete_kept(id).await,
                PlaybackAction::OpenFolder => crate::cleanup::open_in_file_manager(&dir),
                PlaybackAction::Stop
                | PlaybackAction::PauseDownload
                | PlaybackAction::KeepDownloading => Ok(()),
            };
        }

        let slot = self.shared.slot(id)?;
        match action {
            PlaybackAction::Stop | PlaybackAction::StopAndDelete => {
                slot.delete_on_stop
                    .store(action == PlaybackAction::StopAndDelete, Ordering::Relaxed);
                if matches!(
                    slot.row.lock().expect("row").state,
                    PlaybackState::Failed { .. }
                ) {
                    if action == PlaybackAction::StopAndDelete {
                        let _ = self.shared.cleanup.remove_dir(&slot.dir).await;
                    }
                    self.shared.forget(&slot);
                }
                slot.cancel.cancel();
            }
            PlaybackAction::PauseDownload | PlaybackAction::ResumeDownload => {
                let state = slot.row.lock().expect("row").state.clone();
                let next = match (action, &state) {
                    (PlaybackAction::PauseDownload, PlaybackState::Playing) => {
                        PlaybackState::DownloadPaused
                    }
                    (PlaybackAction::ResumeDownload, PlaybackState::DownloadPaused) => {
                        PlaybackState::Playing
                    }
                    (PlaybackAction::ResumeDownload, PlaybackState::Background) => {
                        PlaybackState::Background
                    }
                    // Preparando, preguntando, deteniendo…: no aplica (no-op).
                    _ => return Ok(()),
                };
                let engine = slot.engine.lock().expect("engine").clone();
                let Some((engine, handle)) = engine else {
                    return Err(CoreError::NotFound("descarga todavía no iniciada".into()));
                };
                if action == PlaybackAction::PauseDownload {
                    engine.pause(handle).await?;
                } else {
                    engine.resume(handle).await?;
                }
                // Si cambió mientras tanto (p. ej. se cerró el reproductor), no pisarlo.
                slot.transition(|now| *now == state, next);
                self.shared.emit_row(&slot);
            }
            PlaybackAction::OpenFolder => crate::cleanup::open_in_file_manager(&slot.dir)?,
            // Solo con la pregunta abierta: `Notify` guarda el permiso y la próxima se saltearía.
            PlaybackAction::KeepDownloading => {
                if slot.row.lock().expect("row").state == PlaybackState::AskAfterClose {
                    slot.keep_downloading.notify_one();
                }
            }
        }
        Ok(())
    }

    /// Activas primero, después las pausadas.
    pub fn rows(&self) -> Vec<PlaybackRow> {
        let mut rows: Vec<PlaybackRow> = self
            .shared
            .slots
            .lock()
            .expect("slots")
            .values()
            .map(|s| s.row.lock().expect("row").clone())
            .collect();
        rows.extend(
            self.shared
                .kept
                .lock()
                .expect("kept")
                .iter()
                .map(|(id, k)| kept_row(*id, k)),
        );
        rows
    }

    /// Últimas líneas del log de una reproducción ("Ver detalle", FR-15).
    pub fn log_tail(&self, id: PlaybackId, max_lines: usize) -> Vec<String> {
        let Ok(slot) = self.shared.slot(id) else {
            return Vec::new();
        };
        let log = slot.log.lock().expect("log");
        log.iter()
            .skip(log.len().saturating_sub(max_lines))
            .cloned()
            .collect()
    }

    /// FR-16 "Borrar todo" (`delete_data`): detiene todo y borra también las pausadas.
    /// Sin `delete_data`: detiene todo y las deja pausadas y guardadas.
    pub async fn stop_all(&self, delete_data: bool) -> Result<()> {
        self.stop_all_inner(delete_data, false).await?;
        if delete_data {
            let ids: Vec<PlaybackId> = self
                .shared
                .kept
                .lock()
                .expect("kept")
                .keys()
                .copied()
                .collect();
            for id in ids {
                let _ = self.shared.delete_kept(id).await;
            }
        }
        Ok(())
    }

    async fn stop_all_inner(&self, delete_data: bool, keep_player: bool) -> Result<()> {
        let slots: Vec<Arc<Slot>> = self
            .shared
            .slots
            .lock()
            .expect("slots")
            .values()
            .cloned()
            .collect();
        for slot in &slots {
            slot.delete_on_stop.store(delete_data, Ordering::Relaxed);
            slot.keep_player.store(keep_player, Ordering::Relaxed);
            slot.cancel.cancel();
        }
        // Esperar a que todas terminen (máx. 15 s).
        let deadline = Instant::now() + Duration::from_secs(15);
        while self.active_count() > 0 && Instant::now() < deadline {
            tokio::time::sleep(Duration::from_millis(200)).await;
        }
        Ok(())
    }

    /// Reproducciones activas (no las pausadas): para preguntar al cerrar (FR-17).
    pub fn active_count(&self) -> usize {
        self.shared
            .slots
            .lock()
            .expect("slots")
            .values()
            .filter(|s| {
                !matches!(
                    s.row.lock().expect("row").state,
                    PlaybackState::Failed { .. }
                )
            })
            .count()
    }

    /// Carpetas que `cleanup` no debe tocar: activas y pausadas.
    pub fn active_dirs(&self) -> HashSet<PathBuf> {
        let mut dirs: HashSet<PathBuf> = self
            .shared
            .slots
            .lock()
            .expect("slots")
            .values()
            .map(|s| s.dir.clone())
            .collect();
        dirs.extend(
            self.shared
                .kept
                .lock()
                .expect("kept")
                .values()
                .map(|k| k.dir.clone()),
        );
        dirs
    }

    pub async fn on_app_close(&self, choice: OnAppClose) -> Result<()> {
        match choice {
            // FR-12 (cambiado): nada se borra al cerrar; todo queda pausado y guardado.
            OnAppClose::StopAll => self.stop_all_inner(false, false).await,
            OnAppClose::LeaveRunning => self.stop_all_inner(false, true).await,
        }
    }
}

impl Shared {
    fn new_id(&self) -> PlaybackId {
        PlaybackId(self.next_id.fetch_add(1, Ordering::Relaxed))
    }

    fn slot(&self, id: PlaybackId) -> Result<Arc<Slot>> {
        self.slots
            .lock()
            .expect("slots")
            .get(&id)
            .cloned()
            .ok_or_else(|| CoreError::NotFound(format!("reproducción {}", id.0)))
    }

    fn active_id_for(&self, key: &VideoKey) -> Option<PlaybackId> {
        self.slots
            .lock()
            .expect("slots")
            .values()
            .find(|s| {
                let row = s.row.lock().expect("row");
                row.key == *key
                    && !matches!(
                        row.state,
                        PlaybackState::Failed { .. } | PlaybackState::Stopping
                    )
                    && !s.cancel.is_cancelled()
            })
            .map(|s| s.row.lock().expect("row").id)
    }

    /// FR-12b: cierra el mpv de las reproducciones activas; quedan pausadas y guardadas. Las que
    /// bajan de fondo siguen. Devuelve las que se están cerrando (estas y las que ya se cerraban)
    /// para esperarlas con [`Self::wait_gone`]; las fallidas ya no hacen nada y quedan visibles.
    fn pause_active(&self) -> Vec<PlaybackId> {
        let mut closing = Vec::new();
        for (id, slot) in self.slots.lock().expect("slots").iter() {
            let state = slot.row.lock().expect("row").state.clone();
            if matches!(state, PlaybackState::Failed { .. }) {
                continue;
            }
            if !slot.cancel.is_cancelled() {
                if slot.without_player(&state) {
                    continue;
                }
                slot.delete_on_stop.store(false, Ordering::Relaxed);
                slot.keep_player.store(false, Ordering::Relaxed);
                slot.cancel.cancel();
            }
            closing.push(*id);
        }
        closing
    }

    /// Espera (hasta `max`) a que esas reproducciones terminen de cerrarse: ya guardadas como
    /// pausadas (`slot_to_kept`) o borradas.
    async fn wait_gone(&self, ids: &[PlaybackId], max: Duration) {
        let deadline = Instant::now() + max;
        while Instant::now() < deadline {
            {
                let slots = self.slots.lock().expect("slots");
                if !ids.iter().any(|id| slots.contains_key(id)) {
                    return;
                }
            }
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
        tracing::warn!(
            ?ids,
            "reproducciones que no terminaron de cerrarse a tiempo"
        );
    }

    fn emit_row(&self, slot: &Slot) {
        let row = slot.row.lock().expect("row").clone();
        self.deps.events.emit(CoreEvent::PlaybackUpdated { row });
    }

    fn status(&self, level: StatusLevel, message: String) {
        self.deps.events.emit(CoreEvent::Status { level, message });
    }

    fn log(&self, slot: &Slot, line: String) {
        let id = slot.row.lock().expect("row").id;
        tracing::info!(playback = id.0, "{line}");
        let stamped = format!("[{:>6.1} s] {line}", slot.started.elapsed().as_secs_f32());
        {
            let mut log = slot.log.lock().expect("log");
            if log.len() == LOG_LINES {
                log.pop_front();
            }
            log.push_back(stamped.clone());
        }
        self.deps
            .events
            .emit(CoreEvent::PlaybackLog { id, line: stamped });
    }

    /// Detiene el motor. Si el usuario no pidió borrar y ya había un video elegido, guarda el
    /// registro para retomar y devuelve `true` (queda pausada). Si no, borra la carpeta.
    async fn teardown(&self, slot: &Slot) -> bool {
        let t0 = Instant::now();
        slot.transition(
            |now| !matches!(now, PlaybackState::Failed { .. }),
            PlaybackState::Stopping,
        );
        self.emit_row(slot);
        let file_index = *slot.file_index.lock().expect("file_index");
        let magnet = slot.magnet_uri.lock().expect("magnet").clone();
        let keep = !slot.delete_on_stop.load(Ordering::Relaxed)
            && file_index.is_some()
            && magnet.is_some();
        let engine = slot.engine.lock().expect("engine").take();
        if let Some((engine, handle)) = engine {
            if let Err(e) = engine
                .remove(handle, RemoveOptions { delete_data: !keep })
                .await
            {
                tracing::warn!("remove del motor: {e}");
            }
            let _ = engine.shutdown().await;
        }
        if keep {
            self.save_kept(
                slot,
                file_index.unwrap_or_default(),
                magnet.unwrap_or_default(),
            );
            self.cleanup.release(&slot.dir);
        } else {
            match self.cleanup.remove_dir(&slot.dir).await {
                Ok(freed) => tracing::debug!(freed, "carpeta borrada"),
                Err(e) => tracing::warn!(
                    "no se pudo borrar {:?}: {e} (se reintenta al abrir la app)",
                    slot.dir
                ),
            }
        }
        let secs = t0.elapsed().as_secs_f32();
        self.log(
            slot,
            if keep {
                format!("motor detenido en {secs:.1} s · descarga pausada y guardada")
            } else {
                format!("motor detenido y carpeta borrada en {secs:.1} s")
            },
        );
        keep
    }

    /// Si `id` solo baja de fondo (o espera la respuesta al cerrar), lo corta y espera a que quede
    /// pausada y guardada. `false` si es una reproducción con reproductor (no se toca).
    async fn stop_background(&self, id: PlaybackId) -> bool {
        let Ok(slot) = self.slot(id) else {
            return false;
        };
        let state = slot.row.lock().expect("row").state.clone();
        if !slot.without_player(&state) && state != PlaybackState::AskAfterClose {
            return false;
        }
        slot.cancel.cancel();
        self.wait_gone(&[id], CLOSE_WAIT).await;
        true
    }

    fn forget(&self, slot: &Slot) {
        let id = slot.row.lock().expect("row").id;
        self.slots.lock().expect("slots").remove(&id);
        self.deps.events.emit(CoreEvent::PlaybackRemoved { id });
    }
}

fn clock(secs: f64) -> String {
    let s = secs.max(0.0) as u64;
    format!("{}:{:02}:{:02}", s / 3600, (s % 3600) / 60, s % 60)
}
