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
//! Calibración automática: mientras se mira (minutos 1–5) se mide la velocidad real sostenida y se
//! compara con la que predijo el análisis; la mediana de esas razones ajusta el semáforo.
//! Cada reproducción usa su propio motor (aislamiento: si uno cae, no tumba a los demás).

use std::collections::{BTreeMap, HashSet, VecDeque};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use tokio_util::sync::CancellationToken;

use crate::cleanup::{Cleanup, OwnerRecord, KEPT_FILE};
use crate::config::{Config, ConfigStore, PlayerKind, SubtitleLanguage};
use crate::engine::{
    AddOptions, EngineEvent, FileInfo, Metadata, RemoveOptions, TorrentEngine, TorrentHandle,
    TorrentSource,
};
use crate::events::{CoreEvent, EventSink, StatusLevel};
use crate::library::Library;
use crate::magnet::{InfoHash, Magnet};
use crate::paths::AppPaths;
use crate::player::{LaunchRequest, MpvEvent, PlayerLauncher};
use crate::preload::{self, PreloadOutcome};
use crate::subtitles;
use crate::{CoreError, Result};

const LOG_LINES: usize = 500;
/// Retomar un poco antes de donde se dejó (para no perder la frase).
const RESUME_REWIND_SECS: f64 = 3.0;
/// Ventana de calibración: desde el minuto 1 (peers ya conectados) hasta el 5.
const CALIBRATION_FROM: Duration = Duration::from_secs(60);
const CALIBRATION_TO: Duration = Duration::from_secs(300);
/// Mínimo de segundos válidos para que una reproducción cuente para la calibración.
const CALIBRATION_MIN_SAMPLES: usize = 20;
/// Cuántas reproducciones recientes se usan para el factor.
const CALIBRATION_KEEP: usize = 30;

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
    /// pausar (2026-11-14). Sin respuesta en [`ASK_TIMEOUT`] se pausa, como antes.
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

/// Cuánto se espera la respuesta a "¿seguir bajando?" antes de pausar.
const ASK_TIMEOUT: Duration = Duration::from_secs(120);

/// `true` si el usuario eligió seguir bajando; `false` si pausó (o se detuvo / no respondió).
async fn wait_answer(
    answer: &tokio::sync::Notify,
    cancel: &CancellationToken,
    timeout: Duration,
) -> bool {
    tokio::select! {
        _ = answer.notified() => true,
        _ = cancel.cancelled() => false,
        _ = tokio::time::sleep(timeout) => false,
    }
}

#[derive(Debug, Clone)]
pub struct StartRequest {
    pub info_hash: InfoHash,
    /// Magnet a usar. `None` → el de la pausada o el guardado en la biblioteca.
    pub magnet: Option<Magnet>,
    /// `None` → el de la config (FR-09).
    pub player: Option<PlayerKind>,
    /// `None` → el de la pausada o el video más grande.
    pub file_index: Option<usize>,
    /// Audio elegido (inglés / latino…). `None` → el de la pausada, o el que traiga por defecto.
    pub audio: Option<crate::audio::AudioPick>,
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
}

/// Lo que se guarda en `<carpeta>/.tstream-kept.json` para retomar (también tras reabrir la app).
#[derive(Debug, Clone, Serialize, Deserialize)]
struct KeptRecord {
    info_hash: InfoHash,
    /// Magnet completo (con trackers) para volver a agregar el torrent.
    magnet: String,
    name: String,
    file_index: usize,
    position_secs: Option<f64>,
    progress: f32,
    player: PlayerKind,
    saved_at: DateTime<Utc>,
    /// Audio elegido: al retomar se usa el mismo sin volver a preguntar.
    #[serde(default)]
    audio: Option<crate::audio::AudioPick>,
}

struct Kept {
    record: KeptRecord,
    dir: PathBuf,
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
}

struct Shared {
    deps: PlaybackDeps,
    cleanup: Cleanup,
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
                slots: Mutex::default(),
                kept: Mutex::default(),
                next_id: AtomicU64::new(1),
            }),
        }
    }

    /// Al abrir la app: las descargas pausadas de sesiones anteriores vuelven al panel (FR-12).
    pub fn load_kept(&self) {
        let Ok(entries) = std::fs::read_dir(self.shared.deps.paths.downloads_dir()) else {
            return;
        };
        for dir in entries.filter_map(|e| e.ok()).map(|e| e.path()) {
            let Ok(Some(record)) = crate::fsutil::read_json::<KeptRecord>(&dir.join(KEPT_FILE))
            else {
                continue;
            };
            let id = self.shared.new_id();
            tracing::info!(?dir, name = record.name, "descarga pausada recuperada");
            self.shared.insert_kept(id, Kept { record, dir });
        }
    }

    /// Empieza en segundo plano y devuelve enseguida (NFR-10). El progreso llega por eventos.
    /// FR-12b: si había otra reproducción activa, se cierra su mpv y queda pausada y guardada.
    /// Si el video estaba pausado, se retoma desde lo ya bajado y desde donde se dejó de ver.
    pub async fn start(&self, req: StartRequest) -> Result<PlaybackId> {
        // Ya se está reproduciendo ese mismo video: nada que hacer. Si solo baja de fondo (o
        // espera "¿seguir bajando?"), se corta y se retoma abajo con reproductor.
        if let Some(id) = self.shared.active_id_for(&req.info_hash) {
            if !self.shared.stop_background(id).await {
                return Ok(id);
            }
        }
        self.shared.pause_active();

        let kept = self.shared.take_kept(&req.info_hash);
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
                adopted = self.shared.merge_analysis(&req.info_hash, &k.dir);
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
                    req.info_hash.to_hex(),
                    std::process::id(),
                    id.0
                ));
                adopted = self.shared.adopt_analysis(&req.info_hash, &dir);
                let name = req
                    .magnet
                    .as_ref()
                    .and_then(|m| m.display_name.clone())
                    .unwrap_or_else(|| req.info_hash.to_hex());
                (id, dir, name, None, req.file_index, req.magnet.take())
            }
        };

        let slot = Arc::new(Slot {
            row: Mutex::new(PlaybackRow {
                id,
                info_hash: req.info_hash,
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
            let result = run(&shared, &slot, req, player).await;
            if let Err(e) = &result {
                if !matches!(e, CoreError::Cancelled) {
                    shared.log(&slot, format!("error: {e}"));
                    shared.status(StatusLevel::Error, e.user_message());
                    slot.row.lock().expect("row").state = PlaybackState::Failed {
                        message: e.user_message(),
                    };
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
        if let Some((info_hash, dir)) = self.shared.kept_info(id) {
            return match action {
                PlaybackAction::ResumeDownload => self
                    .start(StartRequest {
                        info_hash,
                        magnet: None,
                        player: None,
                        file_index: None,
                        audio: None, // el de la pausada
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
                let engine = slot.engine.lock().expect("engine").clone();
                let Some((engine, handle)) = engine else {
                    return Err(CoreError::NotFound("descarga todavía no iniciada".into()));
                };
                if action == PlaybackAction::PauseDownload {
                    engine.pause(handle).await?;
                    slot.row.lock().expect("row").state = PlaybackState::DownloadPaused;
                } else {
                    engine.resume(handle).await?;
                    slot.row.lock().expect("row").state = PlaybackState::Playing;
                }
                self.shared.emit_row(&slot);
            }
            PlaybackAction::OpenFolder => crate::cleanup::open_in_file_manager(&slot.dir)?,
            PlaybackAction::KeepDownloading => slot.keep_downloading.notify_one(),
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
                .map(|(id, k)| kept_row(*id, &k.record)),
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

// ---------- flujo de una reproducción ----------

async fn run(
    shared: &Arc<Shared>,
    slot: &Arc<Slot>,
    req: StartRequest,
    player_kind: PlayerKind,
) -> Result<()> {
    let deps = &shared.deps;
    let cfg = deps.config.read().await.clone();

    // 1. Origen: `.torrent` en caché (sin esperar metadatos, FR-13) o magnet + trackers (FR-10).
    let magnet = match req.magnet {
        Some(m) => m,
        None => {
            let library = deps.library.lock().await;
            let entry = library
                .get(&req.info_hash)
                .ok_or_else(|| CoreError::NotFound(format!("magnet {}", req.info_hash)))?;
            Magnet::parse(&entry.magnet)?
        }
    };
    let full_magnet = magnet.with_trackers(&cfg.trackers);
    *slot.magnet_uri.lock().expect("magnet") = Some(full_magnet.to_uri());
    let cached = deps
        .paths
        .torrent_cache_dir()
        .join(format!("{}.torrent", req.info_hash.to_hex()));
    let source = if cached.is_file() {
        shared.log(slot, "usando metadatos guardados (FR-13)".into());
        TorrentSource::TorrentFile(cached.clone())
    } else {
        TorrentSource::Magnet(full_magnet)
    };

    // 2. Motor propio + registro de dueño de la carpeta (T-05).
    let engine = crate::engine::create_for_playback(&cfg.engine, deps.paths.dht_file()).await?;
    shared
        .cleanup
        .claim(&slot.dir, &owner(engine.pid(), None))?;
    let handle = engine
        .add(
            source,
            AddOptions {
                trackers: cfg.trackers.clone(),
                download_dir: slot.dir.clone(),
                only_file: req.file_index,
                start_deselected: true, // lección 3
            },
        )
        .await?;
    *slot.engine.lock().expect("engine") = Some((engine.clone(), handle));
    spawn_engine_log_forwarder(shared.clone(), slot.clone(), engine.as_ref(), handle);

    // 3. Metadatos con timeout (NFR-08).
    // FR-06d: carpeta adoptada del análisis → su bitfield evita re-verificar el archivo entero.
    let metadata = cancellable(
        slot,
        crate::engine::wait_metadata(engine.as_ref(), handle, cfg.engine.metadata_timeout_secs),
    )
    .await?;
    let metadata_secs = slot.started.elapsed().as_secs_f32();
    if !cached.is_file() {
        metadata.save_torrent_cache(&cached);
    }
    // FR-49: sin índice pedido, el archivo del episodio si la entrada vino del catálogo.
    let pick = match req.file_index {
        Some(i) => crate::engine::FilePick {
            index: Some(i),
            episode: None,
        },
        None => deps
            .library
            .lock()
            .await
            .get(&req.info_hash)
            .map(|e| e.file_pick())
            .unwrap_or_default(),
    };
    let file = metadata.pick_file(pick)?;
    *slot.file_index.lock().expect("file_index") = Some(file.index);
    shared.log(
        slot,
        format!(
            "metadatos en {metadata_secs:.1} s · archivo {} ({} MB)",
            file.name,
            file.size / 1_048_576
        ),
    );
    {
        let mut row = slot.row.lock().expect("row");
        row.metadata_secs = Some(metadata_secs);
        row.name = file_display_name(&file.name);
        row.state = PlaybackState::Preparing { fraction: 0.0 };
    }
    shared.emit_row(slot);

    // 4. Precarga exclusiva inicio (+ final en MP4) (FR-11). Al retomar, lo ya bajado se reusa.
    let plan = preload::plan(&file, &cfg.preload);
    shared.log(
        slot,
        format!(
            "precarga {:?}: {} rango(s)",
            plan.container,
            plan.ranges.len()
        ),
    );
    let progress_slot = slot.clone();
    let progress_shared = shared.clone();
    let on_progress = move |p: preload::PreloadProgress| {
        progress_slot.row.lock().expect("row").state = PlaybackState::Preparing {
            fraction: p.fraction,
        };
        progress_shared.emit_row(&progress_slot);
    };
    let outcome = preload::run(
        engine.as_ref(),
        handle,
        &plan,
        &cfg.preload,
        slot.cancel.clone(),
        &on_progress,
    )
    .await?;
    let preload_secs = slot.started.elapsed().as_secs_f32();
    match outcome {
        PreloadOutcome::Ready { elapsed } => shared.log(
            slot,
            format!("precarga lista en {:.1} s", elapsed.as_secs_f32()),
        ),
        PreloadOutcome::TimedOut { fraction, .. } => shared.log(
            slot,
            format!(
                "precarga incompleta ({:.0} %): abro el reproductor igual (plan B)",
                fraction * 100.0
            ),
        ),
    }
    slot.row.lock().expect("row").preload_secs = Some(preload_secs);

    // 5. Reproductor (FR-09). Al retomar, mpv arranca unos segundos antes de donde se dejó.
    let url = engine.stream_url(handle, file.index).await?;
    let mut extra_args = Vec::new();
    if let Some(pos) = slot.resume_from.filter(|p| *p > RESUME_REWIND_SECS * 2.0) {
        extra_args.push(format!("--start={:.1}", pos - RESUME_REWIND_SECS));
    }
    // Subtítulos que vienen DENTRO del video (MKV "MULTi"): que mpv elija solo la pista del
    // idioma pedido, latino primero (Q-03). Si después llegan los de la app, los reemplazan.
    match cfg.subtitles.language {
        SubtitleLanguage::Es => extra_args.push("--slang=es-419,es-MX,es-AR,lat,spa,es".into()),
        SubtitleLanguage::En => extra_args.push("--slang=en,eng".into()),
        SubtitleLanguage::None => {}
    }
    // Audio elegido al reproducir (inglés / latino…). Con audio en español los subtítulos en
    // español arrancan ocultos: no hacen falta, y S los muestra.
    let audio = slot
        .audio
        .clone()
        .filter(|_| player_kind == PlayerKind::Mpv);
    let hide_subs = audio.as_ref().is_some_and(|a| a.is_spanish())
        && cfg.subtitles.language == SubtitleLanguage::Es;
    if let Some(a) = &audio {
        extra_args.extend(a.mpv_args());
        shared.log(
            slot,
            format!("audio elegido: {} ({})", a.code, a.mpv_args().join(" ")),
        );
    }
    if hide_subs {
        extra_args.push("--sub-visibility=no".into());
    }
    let launcher = PlayerLauncher::new(deps.paths.clone(), cfg.player.clone());
    let mut player = launcher
        .launch(LaunchRequest {
            kind: player_kind,
            url: url.clone(),
            title: file_display_name(&file.name),
            subtitle_files: Vec::new(),
            log_file: None,
            extra_args,
        })
        .await?;
    shared
        .cleanup
        .claim(&slot.dir, &owner(engine.pid(), Some(player.pid)))?;
    shared.log(slot, format!("reproductor abierto (pid {})", player.pid));
    slot.row.lock().expect("row").state = PlaybackState::Playing;
    shared.emit_row(slot);
    if let Some(mpv) = &player.mpv {
        spawn_first_frame_watcher(shared.clone(), slot.clone(), mpv.events());
    }
    // 5b. Subtítulos (FR-22–28): en segundo plano, la película ya arrancó (NFR-10).
    let subtitles = match &player.mpv {
        Some(mpv) if cfg.subtitles.language != SubtitleLanguage::None => Some(
            spawn_subtitles(
                shared,
                slot,
                mpv.clone(),
                engine.as_ref(),
                handle,
                &metadata,
                &file,
                url,
                cfg.subtitles.language,
                hide_subs,
            )
            .await,
        ),
        _ => None,
    };

    // 6. Mientras se ve: stats al panel cada 1 s, posición para retomar y muestras de calibración.
    //    Termina cuando se cierra el reproductor o se detiene.
    let playing_since = Instant::now();
    let mut calibration = CalibrationSampler::default();
    let mut tick = tokio::time::interval(Duration::from_secs(1));
    let closed_by_user = loop {
        tokio::select! {
            _ = player.wait_exit() => break true,
            _ = slot.cancel.cancelled() => break false,
            _ = tick.tick() => {
                if let Ok(stats) = engine.stats(handle).await {
                    let download_paused = {
                        let mut row = slot.row.lock().expect("row");
                        row.progress = stats.progress;
                        row.speed_bps = stats.download_speed_bps;
                        row.peers = stats.peers;
                        row.state == PlaybackState::DownloadPaused
                    };
                    calibration.push(playing_since.elapsed(), &stats, download_paused);
                    shared.emit_row(slot);
                }
                if let Some(mpv) = &player.mpv {
                    if let Ok(Ok(v)) = tokio::time::timeout(Duration::from_millis(500), mpv.get_property("time-pos")).await {
                        if let Some(pos) = v.as_f64() {
                            *slot.position.lock().expect("position") = Some(pos);
                        }
                    }
                }
            }
        }
    };
    if let Some(task) = subtitles {
        task.abort();
    }
    if closed_by_user {
        shared.log(slot, "reproductor cerrado".into());
    } else if slot.keep_player.load(Ordering::Relaxed) {
        shared.log(
            slot,
            "app cerrada: el reproductor sigue con lo que tiene en caché (Q-10)".into(),
        );
    } else {
        shared.log(slot, "detenido desde la app".into());
        let _ = player.kill().await;
    }
    if let Some(actual_bps) = calibration.sustained() {
        shared
            .record_calibration(slot, req.info_hash, actual_bps)
            .await;
    }
    // 7. Reproductor cerrado sin terminar de bajar: ¿seguir bajando de fondo o pausar? (2026-11-14)
    if closed_by_user && slot.row.lock().expect("row").progress < 0.999 {
        slot.row.lock().expect("row").state = PlaybackState::AskAfterClose;
        shared.emit_row(slot);
        if wait_answer(&slot.keep_downloading, &slot.cancel, ASK_TIMEOUT).await {
            background_download(shared, slot, engine.as_ref(), handle).await;
        } else {
            shared.log(slot, "la descarga queda pausada y guardada".into());
        }
    }
    Ok(())
}

/// Sigue bajando sin reproductor hasta completar el video o hasta "Detener" (queda pausada).
async fn background_download(
    shared: &Arc<Shared>,
    slot: &Arc<Slot>,
    engine: &dyn TorrentEngine,
    handle: TorrentHandle,
) {
    shared.log(slot, "sigue bajando de fondo, sin reproductor".into());
    slot.row.lock().expect("row").state = PlaybackState::Background;
    shared.emit_row(slot);
    let mut tick = tokio::time::interval(Duration::from_secs(1));
    loop {
        tokio::select! {
            _ = slot.cancel.cancelled() => {
                shared.log(slot, "descarga de fondo detenida: queda pausada y guardada".into());
                return;
            }
            _ = tick.tick() => {
                let Ok(stats) = engine.stats(handle).await else { continue };
                {
                    let mut row = slot.row.lock().expect("row");
                    row.progress = stats.progress;
                    row.speed_bps = stats.download_speed_bps;
                    row.peers = stats.peers;
                }
                shared.emit_row(slot);
                if stats.progress >= 0.999 {
                    shared.log(slot, "descarga completa: queda guardada para verla sin esperar".into());
                    shared.status(StatusLevel::Info, format!("Terminó de bajar {}", slot.row.lock().expect("row").name));
                    return;
                }
            }
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

    fn active_id_for(&self, hash: &InfoHash) -> Option<PlaybackId> {
        self.slots
            .lock()
            .expect("slots")
            .values()
            .find(|s| {
                let row = s.row.lock().expect("row");
                row.info_hash == *hash
                    && !matches!(
                        row.state,
                        PlaybackState::Failed { .. } | PlaybackState::Stopping
                    )
                    && !s.cancel.is_cancelled()
            })
            .map(|s| s.row.lock().expect("row").id)
    }

    /// FR-12b: cierra el mpv de las reproducciones activas; quedan pausadas y guardadas.
    fn pause_active(&self) {
        for slot in self.slots.lock().expect("slots").values() {
            if slot.cancel.is_cancelled()
                || slot.row.lock().expect("row").state == PlaybackState::Background
            {
                continue;
            }
            slot.delete_on_stop.store(false, Ordering::Relaxed);
            slot.keep_player.store(false, Ordering::Relaxed);
            slot.cancel.cancel();
        }
    }

    /// FR-06d: si el análisis dejó datos de este hash, pasan a ser la carpeta de la reproducción
    /// (renombrar: sin copiar). No mientras se esté midiendo (la reserva falla).
    fn adopt_analysis(&self, hash: &InfoHash, dir: &std::path::Path) -> bool {
        let analysis = self.deps.paths.analysis_dir(hash);
        if !analysis.is_dir() || !self.cleanup.try_reserve(&analysis) {
            return false;
        }
        let result = std::fs::rename(&analysis, dir);
        self.cleanup.release(&analysis);
        if let Err(e) = &result {
            tracing::warn!("no se pudo adoptar {analysis:?}: {e}");
        }
        result.is_ok()
    }

    /// FR-06d al RETOMAR una pausada: si después de pausar se midió la velocidad, lo bajado quedó
    /// en la carpeta del análisis. Si tiene más bytes del video que la pausada, su archivo
    /// reemplaza al de la pausada (son pedazos distintos del mismo archivo: no se pueden juntar).
    fn merge_analysis(&self, hash: &InfoHash, kept_dir: &std::path::Path) -> bool {
        let analysis = self.deps.paths.analysis_dir(hash);
        if !analysis.is_dir() || !self.cleanup.try_reserve(&analysis) {
            return false;
        }
        let result = (|| -> std::io::Result<bool> {
            let Some((from, got)) = crate::fsutil::biggest_file(&analysis) else {
                return Ok(false);
            };
            let have = crate::fsutil::biggest_file(kept_dir).map_or(0, |(_, n)| n);
            if got <= have {
                return Ok(false);
            }
            let to = kept_dir.join(from.strip_prefix(&analysis).unwrap_or(&from));
            if let Some(parent) = to.parent() {
                std::fs::create_dir_all(parent)?;
            }
            let _ = std::fs::remove_file(&to);
            std::fs::rename(&from, &to)?;
            tracing::info!(got, have, "retomo con lo bajado al analizar (FR-06d)");
            Ok(true)
        })();
        let merged = match result {
            Ok(m) => m,
            Err(e) => {
                tracing::warn!("no se pudo reusar {analysis:?}: {e}");
                false
            }
        };
        if merged {
            let _ = std::fs::remove_dir_all(&analysis);
        }
        self.cleanup.release(&analysis);
        merged
    }

    fn take_kept(&self, hash: &InfoHash) -> Option<(PlaybackId, Kept)> {
        let mut kept = self.kept.lock().expect("kept");
        let id = kept
            .iter()
            .find(|(_, k)| k.record.info_hash == *hash)
            .map(|(id, _)| *id)?;
        kept.remove(&id).map(|k| (id, k))
    }

    fn kept_info(&self, id: PlaybackId) -> Option<(InfoHash, PathBuf)> {
        self.kept
            .lock()
            .expect("kept")
            .get(&id)
            .map(|k| (k.record.info_hash, k.dir.clone()))
    }

    fn insert_kept(&self, id: PlaybackId, kept: Kept) {
        let row = kept_row(id, &kept.record);
        self.kept.lock().expect("kept").insert(id, kept);
        self.deps.events.emit(CoreEvent::PlaybackUpdated { row });
    }

    /// "Borrar" una pausada: borra su carpeta y la saca del panel.
    async fn delete_kept(&self, id: PlaybackId) -> Result<()> {
        let Some(kept) = self.kept.lock().expect("kept").remove(&id) else {
            return Ok(());
        };
        let freed = self.cleanup.remove_dir(&kept.dir).await?;
        tracing::info!(freed, name = kept.record.name, "descarga pausada borrada");
        self.deps.events.emit(CoreEvent::PlaybackRemoved { id });
        Ok(())
    }

    /// La reproducción terminó y quedó guardada: pasa de "activa" a "pausada" con el mismo id.
    fn slot_to_kept(&self, slot: &Arc<Slot>) {
        let id = slot.row.lock().expect("row").id;
        self.slots.lock().expect("slots").remove(&id);
        if let Ok(Some(record)) = crate::fsutil::read_json::<KeptRecord>(&slot.dir.join(KEPT_FILE))
        {
            self.insert_kept(
                id,
                Kept {
                    record,
                    dir: slot.dir.clone(),
                },
            );
        } else {
            self.deps.events.emit(CoreEvent::PlaybackRemoved { id });
        }
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
        {
            let mut row = slot.row.lock().expect("row");
            if !matches!(row.state, PlaybackState::Failed { .. }) {
                row.state = PlaybackState::Stopping;
            }
        }
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
            let row = slot.row.lock().expect("row").clone();
            let record = KeptRecord {
                info_hash: row.info_hash,
                magnet: magnet.unwrap_or_default(),
                name: row.name.clone(),
                file_index: file_index.unwrap_or_default(),
                position_secs: *slot.position.lock().expect("position"),
                progress: row.progress,
                player: row.player,
                saved_at: Utc::now(),
                audio: slot.audio.clone(),
            };
            if let Err(e) = crate::fsutil::write_json_atomic(&slot.dir.join(KEPT_FILE), &record) {
                tracing::warn!("no se pudo guardar la descarga pausada: {e}");
            }
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
        if !matches!(
            state,
            PlaybackState::Background | PlaybackState::AskAfterClose
        ) {
            return false;
        }
        slot.cancel.cancel();
        let deadline = Instant::now() + Duration::from_secs(20);
        while self.slots.lock().expect("slots").contains_key(&id) && Instant::now() < deadline {
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
        true
    }

    fn forget(&self, slot: &Slot) {
        let id = slot.row.lock().expect("row").id;
        self.slots.lock().expect("slots").remove(&id);
        self.deps.events.emit(CoreEvent::PlaybackRemoved { id });
    }

    /// Calibración automática: guarda (predicción del análisis, velocidad real) y actualiza el
    /// factor del semáforo con la mediana de las últimas reproducciones.
    async fn record_calibration(&self, slot: &Slot, hash: InfoHash, actual_bps: f64) {
        let predicted = self
            .deps
            .library
            .lock()
            .await
            .get(&hash)
            .and_then(|e| e.live.as_ref().map(|l| l.avg_speed_bps))
            .filter(|p| *p > 0.0);
        let Some(predicted) = predicted else {
            return; // sin análisis previo no hay contra qué comparar
        };
        let file = self.deps.paths.data_dir.join("calibration.json");
        let mut samples: Vec<CalibrationSample> = crate::fsutil::read_json(&file)
            .ok()
            .flatten()
            .unwrap_or_default();
        samples.push(CalibrationSample {
            info_hash: hash,
            predicted_bps: predicted,
            actual_bps,
            at: Utc::now(),
        });
        if samples.len() > CALIBRATION_KEEP {
            samples.drain(..samples.len() - CALIBRATION_KEEP);
        }
        if let Err(e) = crate::fsutil::write_json_atomic(&file, &samples) {
            tracing::warn!("calibración: {e}");
            return;
        }
        let (factor, n) = calibration_factor(&samples);
        let mut cfg = self.deps.config.write().await;
        cfg.ranking.speed_factor = factor;
        cfg.ranking.speed_factor_samples = n;
        if let Err(e) = ConfigStore::new(&self.deps.paths).save(&cfg) {
            tracing::warn!("calibración: no se pudo guardar la config: {e}");
        }
        self.deps
            .library
            .lock()
            .await
            .set_ranking(cfg.ranking.clone());
        self.log(
            slot,
            format!(
                "calibración: análisis {:.1} Mbps · real {:.1} Mbps → factor {factor:.2} ({n} reproducciones)",
                predicted * 8.0 / 1e6,
                actual_bps * 8.0 / 1e6
            ),
        );
    }
}

fn kept_row(id: PlaybackId, r: &KeptRecord) -> PlaybackRow {
    PlaybackRow {
        id,
        info_hash: r.info_hash,
        name: r.name.clone(),
        state: PlaybackState::Paused {
            position_secs: r.position_secs,
        },
        player: r.player,
        progress: r.progress,
        speed_bps: 0.0,
        peers: 0,
        started_at: r.saved_at,
        metadata_secs: None,
        preload_secs: None,
        time_to_first_frame_secs: None,
    }
}

fn clock(secs: f64) -> String {
    let s = secs.max(0.0) as u64;
    format!("{}:{:02}:{:02}", s / 3600, (s % 3600) / 60, s % 60)
}

// ---------- calibración automática ----------

#[derive(Debug, Clone, Serialize, Deserialize)]
struct CalibrationSample {
    info_hash: InfoHash,
    predicted_bps: f64,
    actual_bps: f64,
    at: DateTime<Utc>,
}

/// Mediana de real ÷ predicción, acotada a [0,5; 4] para que un caso raro no rompa todo.
fn calibration_factor(samples: &[CalibrationSample]) -> (f64, u32) {
    let mut ratios: Vec<f64> = samples
        .iter()
        .filter(|s| s.predicted_bps > 0.0 && s.actual_bps > 0.0)
        .map(|s| s.actual_bps / s.predicted_bps)
        .collect();
    if ratios.is_empty() {
        return (1.0, 0);
    }
    ratios.sort_by(|a, b| a.total_cmp(b));
    let n = ratios.len();
    let median = if n % 2 == 0 {
        (ratios[n / 2 - 1] + ratios[n / 2]) / 2.0
    } else {
        ratios[n / 2]
    };
    (median.clamp(0.5, 4.0), n as u32)
}

/// Velocidad real sostenida mientras se reproduce: bytes recibidos por segundo entre el minuto 1
/// y el 5, solo mientras quedaba algo por bajar y la descarga no estaba pausada.
#[derive(Default)]
struct CalibrationSampler {
    prev: Option<(Instant, u64)>,
    rates: Vec<f64>,
}

impl CalibrationSampler {
    fn push(&mut self, playing_for: Duration, stats: &crate::engine::Stats, download_paused: bool) {
        let now = Instant::now();
        let bytes = stats.received_bytes;
        if let Some((t, b)) = self.prev {
            let in_window = playing_for >= CALIBRATION_FROM && playing_for <= CALIBRATION_TO;
            if in_window && !download_paused && stats.progress < 0.98 && bytes > 0 {
                let dt = now.duration_since(t).as_secs_f64().max(0.001);
                self.rates.push(bytes.saturating_sub(b) as f64 / dt);
            }
        }
        self.prev = Some((now, bytes));
    }

    fn sustained(&self) -> Option<f64> {
        if self.rates.len() < CALIBRATION_MIN_SAMPLES {
            return None;
        }
        let mut v = self.rates.clone();
        v.sort_by(|a, b| a.total_cmp(b));
        Some(v[v.len() / 2]).filter(|x| *x > 0.0)
    }
}

/// Corre `fut` salvo que el usuario detenga antes.
async fn cancellable<T>(
    slot: &Slot,
    fut: impl std::future::Future<Output = Result<T>>,
) -> Result<T> {
    tokio::select! {
        r = fut => r,
        _ = slot.cancel.cancelled() => Err(CoreError::Cancelled),
    }
}

fn owner(engine_pid: Option<u32>, player_pid: Option<u32>) -> OwnerRecord {
    OwnerRecord {
        app_pid: std::process::id(),
        engine_pid,
        player_pid,
        started_at: Utc::now(),
    }
}

fn file_display_name(path: &str) -> String {
    path.rsplit(['/', '\\']).next().unwrap_or(path).to_string()
}

fn spawn_engine_log_forwarder(
    shared: Arc<Shared>,
    slot: Arc<Slot>,
    engine: &dyn TorrentEngine,
    handle: TorrentHandle,
) {
    let mut events = engine.subscribe();
    tokio::spawn(async move {
        loop {
            match events.recv().await {
                Ok(EngineEvent::Log {
                    handle: Some(h),
                    line,
                }) if h == handle => shared.log(&slot, line),
                Ok(EngineEvent::Error {
                    handle: Some(h),
                    message,
                }) if h == handle => shared.log(&slot, format!("motor: {message}")),
                Ok(EngineEvent::Exited { .. })
                | Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
                _ => {}
            }
        }
    });
}

/// Arma lo que la sesión de subtítulos necesita (archivos del torrent por el stream del motor,
/// identidad del video) y la lanza. Termina sola cuando mpv se cierra.
#[allow(clippy::too_many_arguments)]
async fn spawn_subtitles(
    shared: &Arc<Shared>,
    slot: &Arc<Slot>,
    mpv: Arc<dyn crate::player::MpvControl>,
    engine: &dyn TorrentEngine,
    handle: TorrentHandle,
    metadata: &Metadata,
    file: &FileInfo,
    video_url: String,
    language: SubtitleLanguage,
    start_hidden: bool,
) -> tokio::task::JoinHandle<()> {
    // Los .srt/.ass del torrent se leen por el stream del motor: el stream pide solo esas
    // piezas (con rqbit y webtorrent), sin cambiar la selección del video.
    let mut torrent_files = Vec::new();
    for f in subtitles::subtitle_files_for(metadata, file) {
        if let Ok(url) = engine.stream_url(handle, f.index).await {
            torrent_files.push(subtitles::providers::TorrentSubtitleFile { name: f.name, url });
        }
    }
    let mut video = subtitles::parse_release_name(&file.name);
    // Archivos con nombre pobre ("video.mkv"): el nombre del torrent suele traer título y año.
    let from_torrent = subtitles::parse_release_name(&metadata.name);
    if video.year.is_none() && from_torrent.year.is_some() {
        video.title = from_torrent.title;
        video.year = from_torrent.year;
    }
    video.info_hash = Some(metadata.info_hash);
    video.file_size = file.size;
    let paths = &shared.deps.paths;
    let (log_shared, log_slot) = (shared.clone(), slot.clone());
    let request = subtitles::session::SessionRequest {
        mpv,
        info_hash: metadata.info_hash,
        video,
        video_url,
        torrent_files,
        language,
        start_hidden,
        cache_dir: paths.subtitle_cache_dir().join(metadata.info_hash.to_hex()),
        memory_file: paths.subtitles_memory_file(),
        log: Arc::new(move |line| log_shared.log(&log_slot, line)),
    };
    tokio::spawn(subtitles::session::run(request))
}

fn spawn_first_frame_watcher(
    shared: Arc<Shared>,
    slot: Arc<Slot>,
    mut events: tokio::sync::broadcast::Receiver<MpvEvent>,
) {
    tokio::spawn(async move {
        loop {
            match events.recv().await {
                Ok(MpvEvent::FirstFrame) => {
                    let secs = slot.started.elapsed().as_secs_f32();
                    slot.row.lock().expect("row").time_to_first_frame_secs = Some(secs);
                    shared.log(&slot, format!("primera imagen a los {secs:.1} s"));
                    shared.emit_row(&slot);
                    break;
                }
                Ok(MpvEvent::Shutdown) | Err(tokio::sync::broadcast::error::RecvError::Closed) => {
                    break
                }
                _ => {}
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample(predicted_mbps: f64, actual_mbps: f64) -> CalibrationSample {
        CalibrationSample {
            info_hash: InfoHash::from_bytes([1; 20]),
            predicted_bps: predicted_mbps * 1e6 / 8.0,
            actual_bps: actual_mbps * 1e6 / 8.0,
            at: Utc::now(),
        }
    }

    #[tokio::test]
    async fn al_cerrar_el_reproductor_sigue_bajando_solo_si_se_eligio() {
        let answer = tokio::sync::Notify::new();
        let cancel = CancellationToken::new();
        // "Seguir bajando" (aunque llegue antes de empezar a esperar: el permiso queda guardado).
        answer.notify_one();
        assert!(wait_answer(&answer, &cancel, Duration::from_secs(5)).await);
        // Sin respuesta: se pausa como antes.
        assert!(!wait_answer(&answer, &cancel, Duration::from_millis(30)).await);
        // "Pausar" (= Detener) o cerrar la app: se pausa.
        cancel.cancel();
        assert!(!wait_answer(&answer, &cancel, Duration::from_secs(5)).await);
    }

    #[test]
    fn factor_es_la_mediana_acotada() {
        assert_eq!(calibration_factor(&[]), (1.0, 0));
        let (f, n) =
            calibration_factor(&[sample(20.0, 60.0), sample(10.0, 25.0), sample(30.0, 33.0)]);
        assert_eq!(n, 3);
        assert!(
            (f - 2.5).abs() < 1e-9,
            "mediana de 3,0 · 2,5 · 1,1 = 2,5 (fue {f})"
        );
        let (f, _) = calibration_factor(&[sample(1.0, 100.0)]);
        assert_eq!(f, 4.0, "acotado arriba");
    }

    #[test]
    fn muestreador_ignora_el_primer_minuto_y_archivo_completo() {
        let mut s = CalibrationSampler::default();
        let stats = |bytes: u64, progress: f32| crate::engine::Stats {
            received_bytes: bytes,
            progress,
            ..Default::default()
        };
        s.push(Duration::from_secs(10), &stats(0, 0.1), false);
        s.push(Duration::from_secs(11), &stats(1_000_000, 0.1), false);
        assert!(s.rates.is_empty(), "antes del minuto 1 no cuenta");
        s.push(Duration::from_secs(70), &stats(2_000_000, 0.99), false);
        assert!(
            s.rates.is_empty(),
            "archivo casi completo: la velocidad cae y no sirve"
        );
        s.push(Duration::from_secs(71), &stats(3_000_000, 0.5), true);
        assert!(s.rates.is_empty(), "descarga pausada no cuenta");
        s.push(Duration::from_secs(72), &stats(4_000_000, 0.5), false);
        assert_eq!(s.rates.len(), 1);
        assert!(s.sustained().is_none(), "pocas muestras");
    }

    #[test]
    fn registro_de_pausada_ida_y_vuelta() {
        let r = KeptRecord {
            info_hash: InfoHash::from_bytes([7; 20]),
            magnet: "magnet:?xt=urn:btih:0707070707070707070707070707070707070707".into(),
            name: "Pelicula.mkv".into(),
            file_index: 3,
            position_secs: Some(1234.5),
            progress: 0.4,
            player: PlayerKind::Mpv,
            saved_at: Utc::now(),
            audio: None,
        };
        let json = serde_json::to_string(&r).unwrap();
        let back: KeptRecord = serde_json::from_str(&json).unwrap();
        assert_eq!(back.file_index, 3);
        assert_eq!(back.position_secs, Some(1234.5));
        assert_eq!(
            kept_row(PlaybackId(9), &back).state,
            PlaybackState::Paused {
                position_secs: Some(1234.5)
            }
        );
        assert_eq!(clock(3725.0), "1:02:05");
    }

    /// FR-06d: dar play adopta lo bajado al analizar (sin copiar), pero no mientras se mide.
    #[test]
    fn play_adopta_la_carpeta_del_analisis() {
        let root = std::env::temp_dir().join(format!("tstream-test-adopt-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let paths = AppPaths::under(&root);
        paths.ensure_dirs().unwrap();
        let manager = PlaybackManager::new(PlaybackDeps {
            paths: paths.clone(),
            config: Arc::default(),
            library: Arc::new(tokio::sync::Mutex::new(
                Library::load(paths.library_file()).unwrap(),
            )),
            events: Arc::new(crate::events::NullSink),
        });
        let shared = &manager.shared;
        let hash = InfoHash::from_bytes([7; 20]);
        let analysis = paths.analysis_dir(&hash);
        let play_dir = paths.downloads_dir().join("play-1");

        // Sin análisis previo: nada que adoptar.
        assert!(!shared.adopt_analysis(&hash, &play_dir));

        std::fs::create_dir_all(analysis.join("Sintel")).unwrap();
        std::fs::write(analysis.join("Sintel").join("sintel.mp4"), b"cabecera").unwrap();
        // Midiendo (carpeta reservada): no se toca.
        assert!(shared.cleanup.try_reserve(&analysis));
        assert!(!shared.adopt_analysis(&hash, &play_dir));
        shared.cleanup.release(&analysis);

        assert!(shared.adopt_analysis(&hash, &play_dir));
        assert!(!analysis.exists());
        assert_eq!(
            std::fs::read(play_dir.join("Sintel").join("sintel.mp4")).unwrap(),
            b"cabecera"
        );

        // Retomar una pausada: el análisis posterior con MÁS bytes reemplaza su video.
        let kept = paths.downloads_dir().join("play-2");
        std::fs::create_dir_all(kept.join("Sintel")).unwrap();
        std::fs::write(kept.join("Sintel").join("sintel.mp4"), vec![1u8; 10_000]).unwrap();
        std::fs::write(kept.join(".tstream-kept.json"), b"{}").unwrap();
        std::fs::create_dir_all(analysis.join("Sintel")).unwrap();
        std::fs::write(
            analysis.join("Sintel").join("sintel.mp4"),
            vec![2u8; 50_000],
        )
        .unwrap();
        assert!(shared.merge_analysis(&hash, &kept));
        assert!(!analysis.exists());
        assert_eq!(
            std::fs::read(kept.join("Sintel").join("sintel.mp4")).unwrap()[0],
            2
        );
        assert!(
            kept.join(".tstream-kept.json").exists(),
            "el registro de la pausada queda"
        );
        // Con MENOS bytes que la pausada, no se toca nada.
        std::fs::create_dir_all(analysis.join("Sintel")).unwrap();
        std::fs::write(analysis.join("Sintel").join("sintel.mp4"), vec![3u8; 9_000]).unwrap();
        assert!(!shared.merge_analysis(&hash, &kept));
        assert_eq!(
            std::fs::read(kept.join("Sintel").join("sintel.mp4")).unwrap()[0],
            2
        );
        std::fs::remove_dir_all(root).unwrap();
    }
}
