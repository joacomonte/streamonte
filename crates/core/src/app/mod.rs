//! `app` — [`AppCore`]: cablea los módulos y es la ÚNICA superficie que ve la UI (NFR-01).
//! Cada método corresponde 1:1 a un comando Tauri (`src-tauri/src/commands.rs`) y a una
//! función de `ui/src/api.js`. Ningún método bloquea: lo largo corre en tareas y avisa por eventos (NFR-10).
//! Ningún comando hace `panic`: los errores vuelven como [`CoreError`] con mensaje para el usuario.

mod catalog;
mod settings;
mod subtitles;
mod torbox;

pub use catalog::SavedTest;
pub use settings::{ApiKeyStatus, TempUsage};
pub use subtitles::{
    CatalogSubtitles, PremiumPick, PremiumQuota, SubtitleFound, SubtitlePicks, SubtitleSave,
};

use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use std::time::Duration;

use serde::{Deserialize, Serialize};

use tokio::sync::Mutex;
use tokio_util::sync::CancellationToken;

use crate::analyzer::{AnalyzeScope, AnalyzerHandle};
use crate::catalog::cinemeta::{BrowsePage, BrowseSort, Meta, MetaPreview};
use crate::catalog::{AddonView, MediaKind, VideoId};
use crate::cleanup::{Cleanup, CleanupReport};
use crate::clipboard::WatchGuard;
use crate::config::{Config, ConfigStore};
use crate::events::{CoreEvent, EventSink, StatusLevel};
use crate::intake::Intake;
pub use crate::intake::{ClipboardReadReport, CopiedMagnet};
use crate::library::{Group, Library, LibraryRowView};
use crate::logger::LoggerGuard;
use crate::magnet::InfoHash;
use crate::paths::AppPaths;
use crate::playback::{
    OnAppClose, PlaybackAction, PlaybackId, PlaybackManager, PlaybackRow, StartRequest,
};
use crate::video_key::VideoKey;
use crate::{CoreError, Result};

/// Cada cuánto se mira si la biblioteca cambió para guardarla (debounce de `library.json`).
const LIBRARY_SAVE_DEBOUNCE: Duration = Duration::from_millis(500);
/// Cuánto esperar a que una medición recién cancelada suelte su carpeta de análisis.
const ANALYSIS_RELEASE_WAIT: Duration = Duration::from_secs(5);

/// Lista agrupada para la vista principal (FR-03, FR-29): cada fila con la misma forma que el
/// evento `LibraryEntryUpdated`.
#[derive(Debug, Clone, Serialize)]
pub struct LibraryView {
    pub pasted_now: Vec<LibraryRowView>,
    pub previous: Vec<LibraryRowView>,
}

/// Opciones de arranque (agregado en F2). `AppCore::start` usa las de la app real.
#[derive(Debug, Clone)]
pub struct StartOptions {
    /// Escuchar el portapapeles mientras la app está abierta (FR-01) y leer el historial
    /// al abrir si la config lo pide (FR-02). Las herramientas de línea de comandos lo apagan.
    pub capture_clipboard: bool,
    /// Carpetas de la app. `None` → las del SO; las pruebas usan `AppPaths::under`.
    pub paths: Option<AppPaths>,
    /// Descargas de fondo al abrir (puntajes de IMDb, lista compartida de trackers). Las pruebas
    /// de integración lo apagan para no tocar la red.
    pub background_fetch: bool,
}

impl Default for StartOptions {
    fn default() -> Self {
        Self {
            capture_clipboard: true,
            paths: None,
            background_fetch: true,
        }
    }
}

pub struct AppCore {
    pub paths: AppPaths,
    config: Arc<tokio::sync::RwLock<Config>>,
    config_store: ConfigStore,
    library: Arc<Mutex<Library>>,
    analyzer: AnalyzerHandle,
    playback: PlaybackManager,
    cleanup: Cleanup,
    events: Arc<dyn EventSink>,
    /// Entrada de magnets: pegar, portapapeles, nombre real + análisis automático.
    intake: Intake,
    /// Catálogo y addons (F4b, spec 09).
    catalog: Arc<crate::catalog::Catalog>,
    /// Caché de datos (fichas, puntajes, datasets de IMDb): aparte de la de videos.
    data_cache: Arc<crate::datacache::DataCache>,
    speed_test: crate::speedtest::SpeedTest,
    /// "Agregar addon" de a uno: dos altas a la vez podrían elegir el mismo id (y su secreto).
    adding_addon: Mutex<()>,
    /// Conteos de enjambre en curso (catálogo): cerrar o cambiar de video los corta.
    swarm_cancel: std::sync::Mutex<CancellationToken>,
    /// `tests-conexion.json`: leer-modificar-escribir sin que dos conteos a la vez se pisen.
    tests_file: Mutex<()>,
    _clipboard_watch: Option<WatchGuard>,
    _logger: LoggerGuard,
}

impl AppCore {
    /// Arranque de la app real (con captura del portapapeles).
    pub async fn start(events: Arc<dyn EventSink>) -> Result<Arc<Self>> {
        Self::start_with(events, StartOptions::default()).await
    }

    /// Arranque: paths → config → logger → limpieza automática de restos (FR-20)
    /// → library (start_session) → analyzer → escucha del portapapeles (FR-01) → lectura del historial si está activo (FR-02).
    pub async fn start_with(events: Arc<dyn EventSink>, opts: StartOptions) -> Result<Arc<Self>> {
        let paths = match opts.paths.clone() {
            Some(p) => {
                p.ensure_dirs()?;
                p
            }
            None => AppPaths::resolve()?,
        };
        let config_store = ConfigStore::new(&paths);
        let config = config_store.load()?;
        let logger = crate::logger::init(&paths, &config.logging)?;
        crate::activity::set_sink(events.clone());
        // Antes de limpiar y de recuperar las pausadas: que estén donde se las busca.
        // retirar después de v2.2.0
        paths.migrate_downloads_from_temp();
        let mut library = Library::load(paths.library_file())?;
        // FR-20 / T-05: restos de una ejecución anterior (app cerrada a la fuerza, corte de luz).
        // Lo analizado también es resto (2026-11-15: "no quiero que vaya dejando basura"): solo
        // quedan las descargas guardadas (`.streamonte-kept.json`). En segundo plano: borrar varios GB
        // no debe demorar la ventana (NFR-10).
        {
            let cleanup = Cleanup::new(paths.clone());
            let events = events.clone();
            // Todavía no hay reproducciones de esta sesión.
            let keep = HashSet::new();
            // Los subtítulos ahora van con cada video: la caché aparte de antes ya no se usa.
            // retirar después de v2.2.0
            let legacy_subs = paths.legacy_subtitle_cache_dir();
            tokio::task::spawn_blocking(move || {
                let _ = std::fs::remove_dir_all(&legacy_subs);
                match cleanup.clean_orphans(&keep) {
                    Ok(r) if !r.is_empty() => {
                        tracing::info!(?r, "restos de la sesión anterior limpiados");
                        events.emit(CoreEvent::Status {
                            level: StatusLevel::Info,
                            message: format!(
                                "Se limpiaron restos de la sesión anterior ({}).",
                                human_bytes(r.bytes_freed)
                            ),
                        });
                    }
                    Ok(_) => {}
                    Err(e) => tracing::warn!("limpieza al abrir: {e}"),
                }
            });
        }

        library.set_ranking(config.ranking.clone());
        library.set_downloads_dir(paths.downloads_dir());
        // Antes de cualquier escritura de `config.json`: siembra desde un factor viejo (migración).
        let calibration = Arc::new(crate::playback::Calibration::load(&paths));
        library.set_speed_factor(calibration.factor().0);
        let read_history_on_start = config.clipboard.read_history_on_start;
        let config = Arc::new(tokio::sync::RwLock::new(config));
        let library = Arc::new(Mutex::new(library));
        spawn_library_saver(&library);

        let analyzer = AnalyzerHandle::spawn(crate::analyzer::AnalyzerDeps {
            paths: paths.clone(),
            config: config.clone(),
            library: library.clone(),
            events: events.clone(),
        });
        let playback = PlaybackManager::new(crate::playback::PlaybackDeps {
            paths: paths.clone(),
            config: config.clone(),
            library: library.clone(),
            events: events.clone(),
            calibration,
        });
        // FR-12: las descargas pausadas de sesiones anteriores vuelven al panel.
        playback.load_kept().await;

        let intake = Intake::spawn(
            paths.clone(),
            config.clone(),
            library.clone(),
            events.clone(),
            analyzer.clone(),
            Arc::from(crate::clipboard::platform_source()),
        );
        let clipboard_watch = if opts.capture_clipboard {
            intake.watch_clipboard()
        } else {
            None
        };

        let data_cache = Arc::new(crate::datacache::DataCache::new(paths.data_cache_dir()));
        {
            let data = data_cache.clone();
            tokio::task::spawn_blocking(move || data.prune(crate::datacache::MAX_BYTES));
        }
        let catalog = Arc::new(crate::catalog::Catalog::new(
            &config.read().await.catalog,
            data_cache.clone(),
        ));
        // Puntajes de IMDb e índice por temporada, de fondo: la búsqueda y la primera serie no esperan.
        if opts.background_fetch {
            let catalog = catalog.clone();
            tokio::spawn(async move { catalog.warm_imdb().await });
        }
        // Lista compartida de trackers, de fondo: la primera reproducción no la espera.
        if opts.background_fetch {
            let (config, file) = (config.clone(), paths.shared_trackers_file());
            tokio::spawn(async move {
                let list = crate::trackers::shared_list(&file).await;
                tracing::info!(n = list.len(), "trackers de la lista compartida");
                config.write().await.shared_trackers = list;
            });
        }
        tracing::info!("núcleo iniciado");
        let core = Arc::new(Self {
            catalog,
            data_cache,
            speed_test: crate::speedtest::SpeedTest::new(paths.speed_file()),
            cleanup: Cleanup::new(paths.clone()),
            paths,
            config,
            config_store,
            adding_addon: Mutex::new(()),
            swarm_cancel: std::sync::Mutex::default(),
            tests_file: Mutex::new(()),
            library,
            analyzer,
            playback,
            events,
            intake,
            _clipboard_watch: clipboard_watch,
            _logger: logger,
        });
        if opts.capture_clipboard && read_history_on_start {
            // En segundo plano: el historial WinRT puede tardar y la ventana no debe esperar (NFR-10).
            let core2 = core.clone();
            tokio::spawn(async move {
                if let Err(e) = core2.read_clipboard().await {
                    tracing::warn!("leer el portapapeles al abrir: {e}");
                }
            });
        }
        Ok(core)
    }

    /// Las dos listas de la vista principal, cada una en el orden por defecto (FR-03, FR-07).
    pub async fn library(&self) -> LibraryView {
        let library = self.library.lock().await;
        LibraryView {
            pasted_now: library.list(Group::PastedNow),
            previous: library.list(Group::Previous),
        }
    }

    /// Diálogo "Leer portapapeles" (2026-11-14): todos los magnets del historial para elegir.
    /// Lo último copiado, si es un magnet (botón "Reproducir magnet copiado").
    pub async fn copied_magnet(&self) -> Option<CopiedMagnet> {
        self.intake.copied_magnet().await
    }

    /// Agrega solo los magnets elegidos en el diálogo (texto original de cada uno).
    pub async fn add_selected_magnets(&self, raws: Vec<String>) -> Result<usize> {
        self.add_from_text(&raws.join("\n")).await
    }

    /// "Leer portapapeles" (FR-02) sin diálogo: hasta el primer no-magnet del historial.
    pub async fn read_clipboard(&self) -> Result<ClipboardReadReport> {
        Ok(self.intake.read_clipboard().await)
    }

    /// Agrega todos los magnets de un texto (pegar, arrastrar, captura en vivo; FR-01).
    /// Devuelve cuántos quedaron en "Pegados ahora" por este texto (nuevos o traídos de "Anteriores").
    pub async fn add_from_text(&self, text: &str) -> Result<usize> {
        Ok(self.intake.add_from_text(text).await)
    }

    /// Quitar una fila (FR-04).
    /// FR-06d: con el último video de un torrent se corta su análisis (solo el de ese magnet) y
    /// se va lo bajado al analizarlo. Si quedan otros episodios del mismo torrent, el análisis
    /// se conserva.
    pub async fn remove(&self, key: VideoKey) -> Result<()> {
        let last_of_torrent = {
            let mut library = self.library.lock().await;
            if !library.remove(&key) {
                return Err(CoreError::NotFound(format!("magnet {key}")));
            }
            !library.has_torrent(&key.info_hash)
        };
        self.events.emit(CoreEvent::LibraryEntryRemoved { key });
        if last_of_torrent {
            if let Err(e) = self.analyzer.cancel_one(key.info_hash).await {
                tracing::warn!("cancelar análisis al quitar: {e}");
            }
            self.delete_analysis(&[key.info_hash], ANALYSIS_RELEASE_WAIT)
                .await;
        }
        Ok(())
    }

    /// Borra los datos de análisis (FR-06d). Nunca una carpeta que una medición todavía usa:
    /// espera hasta `wait` a que la suelte (tras cancelar el analizador) y si no, la deja para
    /// la limpieza del próximo inicio.
    async fn delete_analysis(&self, hashes: &[InfoHash], wait: Duration) {
        for hash in hashes {
            let dir = self.paths.analysis_dir(hash);
            match self.cleanup.remove_dir_when_free(&dir, wait).await {
                Ok(Some(_)) => {}
                Ok(None) => tracing::info!(?dir, "análisis en uso: no se borra ahora"),
                Err(e) => {
                    tracing::warn!("no se pudo borrar {dir:?}: {e} (se reintenta al abrir la app)")
                }
            }
        }
    }

    /// Magnet para "Copiar magnet" (FR-04): tal cual se copió.
    pub async fn magnet_of(&self, hash: InfoHash) -> Result<String> {
        self.library
            .lock()
            .await
            .any_of(&hash)
            .map(|e| e.magnet.clone())
            .ok_or_else(|| CoreError::NotFound(format!("magnet {hash}")))
    }

    // ----- Análisis (FR-05–08) -----
    pub async fn analyze(&self, scope: AnalyzeScope) -> Result<()> {
        self.analyzer.enqueue(scope).await
    }

    pub async fn analyzer_pause(&self) -> Result<()> {
        self.analyzer.pause().await
    }

    pub async fn analyzer_resume(&self) -> Result<()> {
        self.analyzer.resume().await
    }

    /// "Listo": terminar la medición de velocidad en curso con lo medido (2026-11-13).
    pub async fn analyzer_finish(&self) -> Result<()> {
        self.analyzer.finish().await
    }

    /// Pausar / reanudar el análisis de un solo magnet (2026-11-14).
    pub async fn analyzer_pause_one(&self, hash: InfoHash) -> Result<()> {
        self.analyzer.pause_one(hash).await
    }

    pub async fn analyzer_resume_one(&self, hash: InfoHash) -> Result<()> {
        self.analyzer.resume_one(hash).await
    }

    /// Cancela el análisis de esos torrents (en cola o corriendo): el catálogo corta sus lecturas de
    /// pistas al volver atrás o cambiar de video (2026-11-18).
    pub async fn analyzer_cancel(&self, hashes: &[InfoHash]) {
        for hash in hashes {
            if let Err(e) = self.analyzer.cancel_one(*hash).await {
                tracing::warn!("cancelar análisis: {e}");
            }
        }
    }

    /// "Reiniciar análisis": desde cero aunque ya esté en cola, pausado o midiéndose.
    pub async fn analyzer_restart(&self, hash: InfoHash, quick: bool) -> Result<()> {
        self.analyzer.restart(hash, quick).await
    }

    // ----- Reproducción y panel (FR-09–17) -----
    pub async fn play(&self, req: StartRequest) -> Result<PlaybackId> {
        self.playback.start(req).await
    }

    pub async fn playback_action(&self, id: PlaybackId, action: PlaybackAction) -> Result<()> {
        self.playback.act(id, action).await
    }

    pub fn playbacks(&self) -> Vec<PlaybackRow> {
        self.playback.rows()
    }

    pub fn playback_log(&self, id: PlaybackId) -> Vec<String> {
        self.playback.log_tail(id, 500)
    }

    /// FR-16: detiene todas las reproducciones (borrando lo bajado, también lo pausado y lo
    /// bajado al analizar, FR-06d) y limpia restos huérfanos. La lista no se toca.
    pub async fn stop_all_and_clean(&self) -> Result<CleanupReport> {
        // Sin esto se borraría la carpeta de la medición en curso con el motor escribiendo.
        if let Err(e) = self.analyzer.cancel().await {
            tracing::warn!("cancelar análisis al limpiar: {e}");
        }
        self.playback.stop_all(true).await?;
        let hashes = self.library.lock().await.hashes();
        self.delete_analysis(&hashes, ANALYSIS_RELEASE_WAIT).await;
        let active = self.playback.active_dirs();
        let cleanup = Cleanup::new(self.paths.clone());
        tokio::task::spawn_blocking(move || cleanup.clean_orphans(&active))
            .await
            .map_err(|e| CoreError::Engine(format!("limpieza: {e}")))?
    }

    pub fn active_playbacks(&self) -> usize {
        self.playback.active_count()
    }

    /// Al cerrar la app: corta el análisis, guarda la biblioteca y aplica la elección (FR-17).
    pub async fn on_close(&self, choice: OnAppClose) -> Result<()> {
        if let Err(e) = self.analyzer.cancel().await {
            tracing::warn!("cancelar análisis al cerrar: {e}");
        }
        if let Err(e) = save_library(&self.library).await {
            tracing::warn!("guardar library.json al cerrar: {e}");
        }
        self.playback.on_app_close(choice).await?;
        // FR-20 al cerrar: restos sin dueño vivo (lo propio ya se borró al detener; lo analizado
        // en esta sesión se borra al abrir la próxima).
        let keep = self.playback.active_dirs();
        let cleanup = Cleanup::new(self.paths.clone());
        // Recorre procesos y borra carpetas: fuera de los hilos de tokio.
        match tokio::task::spawn_blocking(move || cleanup.clean_orphans(&keep)).await {
            Ok(Ok(_)) => {}
            Ok(Err(e)) => tracing::warn!("limpieza al cerrar: {e}"),
            Err(e) => tracing::warn!("limpieza al cerrar: {e}"),
        }
        Ok(())
    }
}

/// "1,2 GB", "350 MB" — para mensajes de la barra de estado.
pub fn human_bytes(bytes: u64) -> String {
    const GB: f64 = 1024.0 * 1024.0 * 1024.0;
    const MB: f64 = 1024.0 * 1024.0;
    let b = bytes as f64;
    if b >= GB {
        format!("{:.1} GB", b / GB).replace('.', ",")
    } else {
        format!("{:.0} MB", b / MB)
    }
}

/// Guarda `library.json` si cambió. El lock se toma solo para copiar: escribir a disco no frena
/// a la UI. `SAVING` pone en fila las escrituras: una copia vieja nunca pisa a una más nueva.
async fn save_library(library: &Mutex<Library>) -> Result<()> {
    static SAVING: Mutex<()> = Mutex::const_new(());
    let _turn = SAVING.lock().await;
    let Some(snapshot) = library.lock().await.take_dirty_snapshot() else {
        return Ok(());
    };
    let written = tokio::task::spawn_blocking(move || snapshot.write())
        .await
        .unwrap_or_else(|e| Err(CoreError::Engine(format!("guardar library.json: {e}"))));
    if written.is_err() {
        library.lock().await.mark_dirty();
    }
    written
}

/// Guarda `library.json` como mucho una vez cada 500 ms y solo si cambió (spec 04).
fn spawn_library_saver(library: &Arc<Mutex<Library>>) {
    let library = Arc::downgrade(library);
    tokio::spawn(async move {
        let mut tick = tokio::time::interval(LIBRARY_SAVE_DEBOUNCE);
        let mut failures = 0u32;
        loop {
            tick.tick().await;
            let Some(library) = library.upgrade() else {
                return; // la app terminó
            };
            match save_library(&library).await {
                Ok(()) if failures > 0 => {
                    tracing::info!(failures, "library.json se volvió a guardar");
                    failures = 0;
                }
                Ok(()) => {}
                Err(e) => {
                    failures += 1;
                    // Reintenta cada 500 ms, pero avisa la primera vez y después ~1 por minuto.
                    if failures % 120 == 1 {
                        tracing::warn!(failures, "no se pudo guardar library.json: {e}");
                    }
                }
            }
        }
    });
}

/// El log general más nuevo (`streamonte.<fecha>.log`, rota por día).
fn newest_log(dir: &std::path::Path) -> Option<std::path::PathBuf> {
    std::fs::read_dir(dir)
        .ok()?
        .flatten()
        .filter(|e| e.file_name().to_string_lossy().starts_with("streamonte."))
        .max_by_key(|e| e.metadata().and_then(|m| m.modified()).ok())
        .map(|e| e.path())
}
