//! `app` — [`AppCore`]: cablea los módulos y es la ÚNICA superficie que ve la UI (NFR-01).
//! Cada método corresponde 1:1 a un comando Tauri (`src-tauri/src/commands.rs`) y a una
//! función de `ui/src/api.js`. Ningún método bloquea: lo largo corre en tareas y avisa por eventos (NFR-10).
//! Ningún comando hace `panic`: los errores vuelven como [`CoreError`] con mensaje para el usuario.

use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use std::time::Duration;

use serde::{Deserialize, Serialize};

/// Tests de conexión guardados en los datos guardados (2026-11-17): valen una hora.
const TESTS_KEY: &str = "tests-conexion.json";
const TEST_TTL_SECS: i64 = 3600;

/// Resultado de un test de conexión (conteo del enjambre) y cuándo se hizo.
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct SavedTest {
    pub count: crate::analyzer::swarm::SwarmCount,
    pub at: chrono::DateTime<chrono::Utc>,
}
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
use crate::library::{Group, Library, LibraryRowView, LiveMeasurement};
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

/// Un subtítulo del dropdown del catálogo (2026-11-18): bajado ("Encontrados para vos") o
/// resultado de Premium sin bajar (`path` vacío).
#[derive(Debug, Clone, Serialize)]
pub struct SubtitleFound {
    /// `proveedor:id`: para elegirlo ([`AppCore::catalog_subtitle_use`]).
    pub key: String,
    /// Nombre en pantalla del proveedor.
    pub provider: String,
    pub language: crate::config::SubtitleLanguage,
    pub release_name: String,
    /// Para distinguir dos del mismo release (p. ej. uno para sordos).
    pub downloads: u32,
    /// Archivo ya bajado (en la caché de la app): para "Descargar" desde el panel.
    pub path: String,
    /// Cuánto calza con el video: `exact` / `release` / `fps` / `none`.
    pub level: crate::subtitles::MatchKind,
    pub latino: bool,
    /// Grupo del release (o el proveedor si no se sabe) y "fuente resolución" (o "sin release").
    pub head: String,
    pub spec: String,
}

impl SubtitleFound {
    fn new(cand: &crate::subtitles::SubtitleCandidate, path: Option<&std::path::Path>) -> Self {
        let release = crate::release::parse_release_name(&cand.release_name);
        let tags = crate::catalog::normalize::release_tags(&cand.release_name, &release);
        let provider = crate::subtitles::providers::display_name(cand.provider).to_string();
        let spec: Vec<String> = [tags.source, tags.resolution]
            .into_iter()
            .flatten()
            .collect();
        SubtitleFound {
            key: cand.key(),
            language: cand.language,
            release_name: cand.release_name.clone(),
            downloads: cand.downloads,
            path: path.map(|p| p.display().to_string()).unwrap_or_default(),
            level: cand.match_kind,
            latino: cand.variant == crate::subtitles::SpanishVariant::Latino,
            head: release.release_group.unwrap_or_else(|| provider.clone()),
            spec: if spec.is_empty() {
                "sin release".into()
            } else {
                spec.join(" ")
            },
            provider,
        }
    }
}

/// Subtítulos de una opción para el dropdown: lo encontrado y lo elegido / probado en ella.
#[derive(Debug, Clone, Serialize)]
pub struct CatalogSubtitles {
    pub found: Vec<SubtitleFound>,
    pub picks: SubtitlePicks,
    /// Se saben los fps y la duración de la opción (se leyeron sus pistas): sin eso ninguno puede
    /// calzar por "mismos fps y duración", y la UI lo dice.
    pub timing_known: bool,
}

/// Lo elegido para la opción (clave) y los que eligió antes y cambió (no sincronizaron).
#[derive(Debug, Clone, Default, Serialize)]
pub struct SubtitlePicks {
    pub chosen: Option<String>,
    pub tried: Vec<String>,
}

/// Cuota de OpenSubtitles.com (Premium). `remaining`/`per_day` = `None`: todavía no se sabe
/// (se conoce con la primera descarga desde que abrió la app).
#[derive(Debug, Clone, Serialize)]
pub struct PremiumQuota {
    pub has_key: bool,
    /// Hay usuario y contraseña de OpenSubtitles.com: la cuota se sabe desde el arranque.
    pub has_login: bool,
    /// El login falló (mensaje para el usuario); no se reintenta hasta cambiar los datos.
    pub login_error: Option<String>,
    pub remaining: Option<u32>,
    pub per_day: Option<u32>,
    /// Hora local en que vuelve ("21:00"), si el servidor la dijo.
    pub resets_at: Option<String>,
}

/// El Premium elegido para bajar: lo que la UI ya mostró del resultado de la búsqueda.
#[derive(Debug, Clone, serde::Deserialize)]
pub struct PremiumPick {
    /// `file_id` de OpenSubtitles.com.
    pub id: u64,
    pub release_name: String,
    pub latino: bool,
    pub level: crate::subtitles::MatchKind,
}

/// Un subtítulo para copiar a Descargas: el archivo de la caché y con qué nombre (sin extensión).
#[derive(Debug, Clone, serde::Deserialize)]
pub struct SubtitleSave {
    pub path: String,
    pub name: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct TempUsage {
    pub bytes: u64,
    pub folder: String,
}

/// ¿Hay API key guardada para este proveedor de subtítulos? (Ajustes, F4).
#[derive(Debug, Clone, Serialize)]
pub struct ApiKeyStatus {
    pub service: String,
    pub configured: bool,
}

/// Opciones de arranque (agregado en F2). `AppCore::start` usa las de la app real.
#[derive(Debug, Clone)]
pub struct StartOptions {
    /// Escuchar el portapapeles mientras la app está abierta (FR-01) y leer el historial
    /// al abrir si la config lo pide (FR-02). Las herramientas de línea de comandos lo apagan.
    pub capture_clipboard: bool,
    /// Carpetas de la app. `None` → las del SO; las pruebas usan `AppPaths::under`.
    pub paths: Option<AppPaths>,
}

impl Default for StartOptions {
    fn default() -> Self {
        Self {
            capture_clipboard: true,
            paths: None,
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
        {
            let catalog = catalog.clone();
            tokio::spawn(async move { catalog.warm_imdb().await });
        }
        // Lista compartida de trackers, de fondo: la primera reproducción no la espera.
        {
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

    // ----- Biblioteca (FR-01–04) -----

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
            let _ = self.analyzer.cancel_one(key.info_hash).await;
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
            let _ = self.analyzer.cancel_one(*hash).await;
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
        let _ = self.analyzer.cancel().await;
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
        let _ = self.analyzer.cancel().await;
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

    // ----- Limpieza (FR-18–20) -----
    /// Cuánto liberaría "Limpiar temporales" (para la confirmación, FR-19).
    pub fn temp_usage(&self) -> Result<TempUsage> {
        Ok(TempUsage {
            bytes: self.cleanup.temp_size(&self.playback.active_dirs())?,
            folder: self.paths.downloads_dir().display().to_string(),
        })
    }
    /// "Limpiar temporales" (FR-19): nunca toca reproducciones activas ni el historial. Lo
    /// analizado de los magnets de la lista SÍ se borra (decidido), salvo lo que se esté midiendo.
    pub fn clean_temp(&self) -> Result<CleanupReport> {
        self.cleanup.clean(&self.playback.active_dirs())
    }
    /// Velocidad de internet de la red actual: la guardada (salvo `force`) o la mide, con progreso
    /// en `CoreEvent::SpeedTest`.
    pub async fn speed_test(&self, force: bool) -> Result<crate::speedtest::SpeedResult> {
        self.speed_test.run(force, self.events.as_ref()).await
    }
    /// Lo que ocupa la caché de datos (fichas, puntajes, datasets de IMDb).
    pub fn data_cache_size(&self) -> u64 {
        self.data_cache.size()
    }
    /// "Borrar datos guardados": todo lo de la caché de datos. Devuelve los bytes liberados.
    /// Lo ya cargado en esta sesión sigue en memoria hasta cerrar la app.
    pub fn clear_data_cache(&self) -> Result<u64> {
        self.data_cache.clear()
    }
    pub fn open_downloads_folder(&self) -> Result<()> {
        crate::cleanup::open_in_file_manager(&self.paths.downloads_dir())
    }

    // ----- Logs (panel de actividad, 2026-11-15) -----
    /// Últimas `max` líneas del log general (el detallado, con niveles), del archivo más nuevo.
    pub fn logs_tail(&self, max: usize) -> Result<Vec<String>> {
        let Some(file) = newest_log(&self.paths.log_dir) else {
            return Ok(Vec::new());
        };
        let text = std::fs::read_to_string(&file).map_err(|source| CoreError::Io {
            path: file.clone(),
            source,
        })?;
        let lines: Vec<&str> = text.lines().collect();
        Ok(lines[lines.len().saturating_sub(max)..]
            .iter()
            .map(|l| l.to_string())
            .collect())
    }

    /// "Descargar logs": copia los logs (y lo que vio el usuario en el panel, `friendly`) a una
    /// carpeta nueva en Descargas y la muestra en el Finder / Explorador. Devuelve la carpeta.
    pub fn export_logs(&self, friendly: &str) -> Result<std::path::PathBuf> {
        let base = directories::UserDirs::new()
            .and_then(|u| u.download_dir().map(|d| d.to_path_buf()))
            .ok_or(CoreError::Unsupported("carpeta de Descargas"))?;
        let dest = base.join(format!(
            "streamonte-logs-{}",
            chrono::Local::now().format("%Y%m%d-%H%M%S")
        ));
        let io = |path: &std::path::Path| {
            let path = path.to_path_buf();
            move |source| CoreError::Io { path, source }
        };
        std::fs::create_dir_all(&dest).map_err(io(&dest))?;
        let entries = std::fs::read_dir(&self.paths.log_dir).map_err(io(&self.paths.log_dir))?;
        for entry in entries.flatten() {
            let from = entry.path();
            // Los de diagnóstico vacíos no aportan nada.
            if from.is_file() && entry.metadata().is_ok_and(|m| m.len() > 0) {
                let to = dest.join(entry.file_name());
                std::fs::copy(&from, &to).map_err(io(&to))?;
            }
        }
        let activity = dest.join("actividad.txt");
        std::fs::write(&activity, friendly).map_err(io(&activity))?;
        crate::cleanup::open_in_file_manager(&dest)?;
        Ok(dest)
    }

    /// "Descargar" subtítulos del panel (2026-11-17): copia los elegidos a
    /// `Descargas/<título> (subtítulos)` y abre la carpeta. Las rutas vienen de la UI: solo se
    /// copian archivos de la caché de la app.
    pub fn save_subtitles(
        &self,
        title: &str,
        files: &[SubtitleSave],
    ) -> Result<std::path::PathBuf> {
        let base = directories::UserDirs::new()
            .and_then(|u| u.download_dir().map(|d| d.to_path_buf()))
            .ok_or(CoreError::Unsupported("carpeta de Descargas"))?;
        let safe = |s: &str| -> String {
            s.chars()
                .map(|c| {
                    if "/\\:*?\"<>|".contains(c) || c.is_control() {
                        '-'
                    } else {
                        c
                    }
                })
                .collect::<String>()
                .trim()
                .to_string()
        };
        let io = |path: &std::path::Path| {
            let path = path.to_path_buf();
            move |source| CoreError::Io { path, source }
        };
        let dest = base.join(format!("{} (subtítulos)", safe(title)));
        std::fs::create_dir_all(&dest).map_err(io(&dest))?;
        for f in files {
            let from = self.cached_file(&f.path)?;
            let ext = from.extension().and_then(|e| e.to_str()).unwrap_or("srt");
            let to = dest.join(format!("{}.{ext}", safe(&f.name)));
            std::fs::copy(&from, &to).map_err(io(&to))?;
        }
        crate::cleanup::open_in_file_manager(&dest)?;
        Ok(dest)
    }

    // ----- Configuración (NFR-04, Q-06) -----
    pub async fn config(&self) -> Config {
        self.config.read().await.clone()
    }
    /// ÚNICA escritura de la config: con el lock de escritura tomado aplica `change` a una copia,
    /// la guarda (atómico) y recién entonces la publica y la propaga (logger, semáforo). Dos
    /// cambios a la vez se ponen en fila y ninguno pisa al otro; si `change` falla o no se puede
    /// guardar, no cambia nada. Nada lento adentro: lo que va a la red se hace antes.
    pub async fn update_config<T>(
        &self,
        change: impl FnOnce(&mut Config) -> Result<T>,
    ) -> Result<T> {
        let mut current = self.config.write().await;
        let mut next = current.clone();
        let out = change(&mut next)?;
        self.config_store.save(&next)?;
        *current = next;
        crate::logger::apply(&current.logging)?;
        self.library
            .lock()
            .await
            .set_ranking(current.ranking.clone());
        Ok(out)
    }

    /// Ajustes → Red (ADR-30): entrantes / UPnP. Aplica desde la próxima reproducción.
    /// "Verificar" en Ajustes › Red: ¿el puerto de las reproducciones llega desde internet?
    pub async fn check_incoming(&self) -> crate::incoming::IncomingCheck {
        let engine = self.config.read().await.engine.clone();
        crate::incoming::check(&engine, &self.paths).await
    }

    /// Ecualizador del reproductor (Ajustes, 2026-11-17): rige desde la próxima reproducción.
    pub async fn set_equalizer(&self, equalizer: crate::config::Equalizer) -> Result<()> {
        self.update_config(|c| {
            c.player.equalizer = equalizer;
            Ok(())
        })
        .await
    }

    /// Idiomas de la app y de los títulos (Ajustes y bienvenida, 2026-11-20): lo de TMDB se pide en ellos.
    pub async fn set_language(&self, language: crate::config::LanguageConfig) -> Result<()> {
        self.update_config(|c| {
            c.language = language;
            Ok(())
        })
        .await
    }

    pub async fn set_network(
        &self,
        incoming: bool,
        upnp: bool,
        announce_early: bool,
    ) -> Result<()> {
        self.update_config(|c| {
            c.engine.incoming = incoming;
            c.engine.upnp = upnp;
            c.engine.announce_early = announce_early;
            Ok(())
        })
        .await
    }

    // ----- Subtítulos (FR-24, Q-01, Q-04, NFR-16) -----
    /// Guarda la API key de un proveedor ("opensubtitles" o "wyzie") en el almacén seguro del
    /// sistema; vacía = borrarla. Nunca va a `config.json` ni a los logs.
    /// API keys de servicios (Ajustes): subtítulos (Wyzie, OpenSubtitles) y pósters (TMDB).
    /// Se guardan en el almacén seguro; nunca se devuelven ni se loguean.
    pub fn set_api_key(&self, service: &str, key: &str) -> Result<()> {
        match service {
            crate::catalog::tmdb::TMDB => crate::catalog::tmdb::set_key(key),
            crate::catalog::torbox::TORBOX => crate::catalog::torbox::set_key(key),
            crate::catalog::latteam::LATTEAM => crate::catalog::latteam::set_key(key),
            provider => crate::subtitles::secrets::set_api_key(provider, key),
        }
    }
    /// Qué servicios tienen key (Ajustes), sin devolver nunca la key.
    pub fn api_keys(&self) -> Vec<ApiKeyStatus> {
        let subtitles = crate::subtitles::secrets::KEY_PROVIDERS
            .iter()
            .map(|p| ApiKeyStatus {
                service: (*p).to_string(),
                configured: crate::subtitles::secrets::has_api_key(p),
            });
        subtitles
            .chain([
                ApiKeyStatus {
                    service: crate::catalog::tmdb::TMDB.to_string(),
                    configured: crate::catalog::tmdb::has_key(),
                },
                ApiKeyStatus {
                    service: crate::catalog::torbox::TORBOX.to_string(),
                    configured: crate::catalog::torbox::has_key(),
                },
                ApiKeyStatus {
                    service: crate::catalog::latteam::LATTEAM.to_string(),
                    configured: crate::catalog::latteam::has_key(),
                },
            ])
            .collect()
    }
    /// Abre en el navegador la página para pedir la key de un servicio (solo URLs fijas, NFR-16).
    pub fn open_key_page(&self, service: &str) -> Result<()> {
        let url = match service {
            crate::catalog::tmdb::TMDB => Some(crate::catalog::tmdb::KEY_PAGE),
            crate::catalog::torbox::TORBOX => Some(crate::catalog::torbox::KEY_PAGE),
            crate::catalog::latteam::LATTEAM => Some(crate::catalog::latteam::KEY_PAGE),
            provider => crate::subtitles::secrets::key_page(provider),
        }
        .ok_or_else(|| CoreError::NotFound(format!("servicio {service}")))?;
        crate::external::open_external(url)
            .map_err(|_| CoreError::Unsupported("abrir el navegador"))
    }

    /// Abre la ficha de IMDb del título en el navegador (solo ids `tt…` válidos).
    pub fn open_imdb(&self, imdb_id: &str) -> Result<()> {
        if !crate::catalog::is_imdb_id(imdb_id) {
            return Err(CoreError::NotFound(format!("ficha {imdb_id}")));
        }
        crate::external::open_external(format!("https://www.imdb.com/title/{imdb_id}/"))
            .map_err(|_| CoreError::Unsupported("abrir el navegador"))
    }

    /// Cuáles de esas opciones (de la lista vigente) ya están en la caché de TorBox (2026-11-17).
    /// `None` = sin key de TorBox o no respondió.
    pub async fn catalog_torbox(
        &self,
        video_id: &str,
        hashes: &[InfoHash],
    ) -> Option<crate::catalog::torbox::Cached> {
        let timeout = self.catalog_timeout().await;
        self.catalog.torbox_cached(video_id, hashes, timeout).await
    }

    /// ▶ desde TorBox (2026-11-17): abre el reproductor con el link directo de TorBox (sin P2P ni
    /// motor). No queda en "Descargas": es un video en línea.
    pub async fn play_torbox(
        &self,
        video_id: &str,
        hash: InfoHash,
        player: Option<crate::config::PlayerKind>,
        audio: Option<crate::audio::AudioPick>,
    ) -> Result<crate::playback::PlaybackId> {
        use crate::config::PlayerKind;
        let timeout = self
            .catalog_timeout()
            .await
            .max(std::time::Duration::from_secs(20));
        let (url, title) = self.catalog.torbox_stream(hash, timeout).await?;
        let cfg = self.config.read().await.clone();
        let kind = crate::player::resolve_player(player, &cfg.player);
        // Lo elegido en el paso de subtítulos de Reproducir (por opción, como la reproducción
        // por torrent): una pista del video se elige con `--sid`; un archivo va solo (mpv muestra
        // el único `--sub-file`). Sin elegir: los ya bajados, mejor primero.
        let (_, _, key) = self.subtitle_identity(video_id, &hash).await?;
        let chosen = crate::subtitles::SubtitleMemory::new(self.paths.subtitles_memory_file())
            .get(&key)
            .ok()
            .flatten()
            .map(|c| c.subtitle)
            .filter(|s| !s.is_empty() && s != crate::subtitles::CHOICE_ALL);
        let mut extra_args = Vec::new();
        let embedded = chosen.as_deref().and_then(|c| {
            c.strip_prefix(crate::subtitles::EMBEDDED)?
                .strip_prefix(':')
        });
        let subtitle_files = if let Some(sid) = embedded {
            extra_args.push(format!("--sid={sid}"));
            Vec::new()
        } else {
            let log: crate::subtitles::session::LogFn =
                Arc::new(|line| tracing::info!(target: "streamonte_core::subtitles", "{line}"));
            let got = self
                .subtitle_files(video_id, &hash, cfg.subtitles.language, log)
                .await
                .unwrap_or_default();
            match got.iter().find(|(c, _)| Some(c.key()) == chosen) {
                Some((_, path)) => vec![path.clone()],
                None => got.into_iter().map(|(_, path)| path).collect(),
            }
        };
        // Audio elegido (como en la reproducción por torrent: solo mpv entiende estos argumentos).
        if let Some(a) = audio.filter(|_| kind == PlayerKind::Mpv) {
            extra_args.extend(a.mpv_args());
        }
        // La misma "reproducción en curso" que la del motor: fila, Detener y cambiar subtítulo.
        self.playback
            .start_stream(crate::playback::StreamRequest {
                key,
                name: title,
                url,
                player: kind,
                subtitle_files,
                extra_args,
            })
            .await
    }

    /// Usuario y contraseña de OpenSubtitles.com (Ajustes; vacíos = borrar). Al almacén seguro.
    pub fn set_opensubtitles_login(&self, username: &str, password: &str) -> Result<()> {
        crate::subtitles::secrets::set_opensubtitles_login(username, password)
    }

    /// Cambiar el subtítulo mientras se ve (2026-11-18): lo carga en el mpv abierto sin reiniciar
    /// y queda elegido para esa opción. `key`: `embedded:<sid>` o `proveedor:id`; `path`: el
    /// archivo ya bajado (solo de la caché de la app).
    pub async fn playback_subtitle(
        &self,
        id: crate::playback::PlaybackId,
        key: &str,
        path: Option<&str>,
    ) -> Result<()> {
        use crate::playback::LiveSubtitle;
        let sid = key
            .strip_prefix(crate::subtitles::EMBEDDED)
            .and_then(|k| k.strip_prefix(':'))
            .and_then(|n| n.parse::<i64>().ok());
        let sub = match (sid, path) {
            (Some(sid), _) => LiveSubtitle::Track(sid),
            (None, Some(path)) => LiveSubtitle::File(self.cached_file(path)?),
            (None, None) => return Err(CoreError::NotFound(format!("subtítulo {key}"))),
        };
        let video = self.playback.load_subtitle(id, sub).await?;
        crate::subtitles::SubtitleMemory::new(self.paths.subtitles_memory_file()).choose(
            &video,
            key,
            crate::config::SubtitleLanguage::Es,
        )?;
        Ok(())
    }

    /// Un archivo que viene de la UI, solo si está en la caché de la app (subtítulos bajados).
    fn cached_file(&self, path: &str) -> Result<std::path::PathBuf> {
        let io = |path: &std::path::Path| {
            let path = path.to_path_buf();
            move |source| CoreError::Io { path, source }
        };
        let root = self
            .paths
            .cache_dir
            .canonicalize()
            .map_err(io(&self.paths.cache_dir))?;
        let from = std::path::Path::new(path);
        let from = from.canonicalize().map_err(io(from))?;
        if !from.starts_with(&root) || !from.is_file() {
            return Err(CoreError::NotFound(format!("subtítulo {path}")));
        }
        Ok(from)
    }

    /// Pistas de una opción que se va a ver por TorBox (2026-11-18): mpv sin ventana lee audio,
    /// subtítulos, fps y duración del mismo link https que va a abrir (el video ya está en sus
    /// servidores; contar el enjambre no hace falta). Quedan en la fila como las del análisis, así
    /// el paso de audio y el de subtítulos de Reproducir las usan; los `sid` son los mismos que
    /// verá mpv al reproducir ese link. Como "Verificar salud", la opción pasa a la biblioteca si no
    /// estaba: lo leído es del torrent y se guarda en su fila (sin fila se perdía, 2026-11-18).
    pub async fn catalog_torbox_tracks(
        &self,
        kind: MediaKind,
        video_id: &str,
        hash: InfoHash,
    ) -> Result<()> {
        // Un REMUX de 50+ GB tarda en dar el primer byte desde TorBox: 30 s cortaba lecturas que iban a andar.
        const PROBE_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(60);
        let timeout = self
            .catalog_timeout()
            .await
            .max(std::time::Duration::from_secs(20));
        let (url, title) = self.catalog.torbox_stream(hash, timeout).await?;
        let mpv_path = self.config.read().await.player.mpv_path.clone();
        let mpv = crate::paths::find_executable(crate::paths::Executable::Mpv, mpv_path.as_deref())
            .ok_or_else(|| CoreError::Player("no hay mpv para leer las pistas".into()))?;
        let probe = crate::player::probe_media(&mpv, &url, PROBE_TIMEOUT)
            .await
            .inspect_err(|e| tracing::warn!("leer pistas por TorBox ({hash}): {e}"))?;
        if !self.library.lock().await.has_torrent(&hash) {
            self.catalog_add(kind, video_id, &[hash]).await?;
        }
        let video = VideoId::parse(video_id)?;
        let c = self.catalog.candidate(&video, &hash);
        let mut library = self.library.lock().await;
        let keys = library.update_torrent(&hash, |e| {
            let live = e.live.get_or_insert_with(|| LiveMeasurement {
                measured_at: chrono::Utc::now(),
                torrent_name: Some(title.clone()),
                file_index: c.as_ref().and_then(|c| c.file_idx).unwrap_or(0),
                file_name: c
                    .as_ref()
                    .and_then(|c| c.file_name.clone())
                    .unwrap_or_else(|| title.clone()),
                file_size: c.as_ref().and_then(|c| c.size_bytes).unwrap_or(0),
                peers: 0,
                seeds: 0,
                partial: false,
                measured_secs: 0.0,
                avg_speed_bps: 0.0, // sin velocidad: no se midió el enjambre
                max_speed_bps: 0.0,
                duration_secs: None,
                audio: None,
                subs: None,
                fps: None,
            });
            live.duration_secs = Some(probe.duration_secs);
            live.audio = Some(probe.audio.clone());
            live.subs = Some(probe.subs.clone());
            live.fps = probe.fps;
        });
        library.emit_rows(&keys, self.events.as_ref());
        Ok(())
    }

    /// Link de una opción para copiar: magnet o, por TorBox, el de castear (HLS con el audio original o latino).
    pub async fn catalog_link(
        &self,
        hash: InfoHash,
        torbox: bool,
        orig: Option<String>,
        latino: bool,
    ) -> Result<String> {
        if torbox {
            let timeout = self
                .catalog_timeout()
                .await
                .max(std::time::Duration::from_secs(20));
            return self
                .catalog
                .torbox_cast(hash, orig.as_deref(), latino, timeout)
                .await;
        }
        self.catalog
            .magnets_of(&[hash])
            .into_iter()
            .next()
            .map(|m| m.to_uri())
            .ok_or_else(|| CoreError::NotFound("esa opción ya no está en la lista".into()))
    }

    /// Reproductores de este equipo (Ajustes → Reproductor, 2026-11-17).
    pub async fn players_status(&self) -> crate::player::PlayersStatus {
        crate::player::players_status(&self.config.read().await.player)
    }

    /// Abre el tráiler en YouTube (solo ids de video válidos).
    pub fn open_trailer(&self, youtube_id: &str) -> Result<()> {
        if !crate::catalog::cinemeta::is_youtube_id(youtube_id) {
            return Err(CoreError::NotFound(format!("tráiler {youtube_id}")));
        }
        crate::external::open_external(format!("https://www.youtube.com/watch?v={youtube_id}"))
            .map_err(|_| CoreError::Unsupported("abrir el navegador"))
    }

    /// Póster de TMDB para un título cuyo póster de Cinemeta no existe (2026-11-15).
    pub async fn catalog_poster(&self, imdb_id: &str) -> Option<String> {
        let timeout = self.catalog_timeout().await;
        self.catalog.poster(imdb_id, timeout).await
    }

    /// "Contar seeders reales" de opciones del catálogo (2026-11-15): se conecta al enjambre de
    /// cada una y cuenta los que ve, sin bajar el video ni sumarlo a Mis magnets. `Quick` (≤ 30 s,
    /// todas) descarta; `Deep` (~2 min, las mejores) decide la salud. Varios conteos conviven;
    /// cerrar o cambiar de video los corta todos.
    pub async fn catalog_swarm(
        &self,
        hashes: &[InfoHash],
        depth: crate::analyzer::swarm::Depth,
    ) -> std::collections::HashMap<InfoHash, crate::analyzer::swarm::SwarmCount> {
        let deep = depth == crate::analyzer::swarm::Depth::Deep;
        let cancel = self.swarm_cancel.lock().expect("swarm").clone();
        let magnets = self.catalog.magnets_of(hashes);
        let cfg = self.config.read().await.clone();
        let found =
            crate::analyzer::swarm::count(&self.paths, &cfg, magnets, depth, cancel.clone(), {
                let events = self.events.clone();
                move |hash, count, done| {
                    events.emit(if done {
                        CoreEvent::CatalogSwarmCounted { hash, count, deep }
                    } else {
                        CoreEvent::CatalogSwarmProgress { hash, count, deep }
                    })
                }
            })
            .await;
        // Cortado por el usuario: lo que no llegó no es "nadie respondió" y no se guarda. La prueba
        // rápida no se guarda: es barata y se repite al volver a abrir.
        if deep && !cancel.is_cancelled() {
            self.save_tests(hashes, &found);
        }
        found
    }

    /// Tests de conexión guardados (2026-11-17) de esos torrents, de la última hora.
    pub fn catalog_swarm_saved(&self, hashes: &[InfoHash]) -> HashMap<InfoHash, SavedTest> {
        let saved = self.saved_tests();
        hashes
            .iter()
            .filter_map(|h| saved.get(&h.to_hex()).map(|t| (*h, *t)))
            .collect()
    }

    fn saved_tests(&self) -> HashMap<String, SavedTest> {
        let now = chrono::Utc::now();
        let mut map: HashMap<String, SavedTest> = self
            .data_cache
            .get(TESTS_KEY)
            .map(|(m, _)| m)
            .unwrap_or_default();
        map.retain(|_, t| (now - t.at).num_seconds() < TEST_TTL_SECS);
        map
    }

    /// Guarda el resultado de cada torrent pedido; sin resultado = nadie respondió.
    fn save_tests(
        &self,
        hashes: &[InfoHash],
        found: &HashMap<InfoHash, crate::analyzer::swarm::SwarmCount>,
    ) {
        let at = chrono::Utc::now();
        let mut map = self.saved_tests();
        for h in hashes {
            let count = found
                .get(h)
                .copied()
                .unwrap_or(crate::analyzer::swarm::SwarmCount {
                    seeds: 0,
                    peers: 0,
                    reached: false,
                    known: 0,
                    incoming: 0,
                });
            map.insert(h.to_hex(), SavedTest { count, at });
        }
        self.data_cache.put(TESTS_KEY, &map);
    }

    /// Espacio libre (bytes) del disco donde se guardan las descargas; `None` si no se pudo leer.
    pub fn downloads_free_bytes(&self) -> Option<u64> {
        let dir = self.paths.downloads_dir();
        let dir = dir.canonicalize().unwrap_or(dir);
        let disks = sysinfo::Disks::new_with_refreshed_list().ok()?;
        disks
            .iter()
            .filter(|d| dir.starts_with(d.mount_point()))
            .max_by_key(|d| d.mount_point().as_os_str().len())
            .map(|d| d.available_space())
    }

    /// Censo DHT de opciones del catálogo (2026-11-16): direcciones únicas por hash, sin conectarse
    /// (~12 s). Comparte el corte con `catalog_swarm`.
    pub async fn catalog_census(
        &self,
        hashes: &[InfoHash],
    ) -> std::collections::HashMap<InfoHash, u32> {
        let cancel = self.swarm_cancel.lock().expect("swarm").clone();
        let cfg = self.config.read().await.clone();
        crate::analyzer::swarm::census(&self.paths, &cfg, hashes.to_vec(), cancel).await
    }

    /// Subtítulos del video abierto en el catálogo (2026-11-15; dropdown 2026-11-18): busca y baja
    /// hasta 5 de las fuentes gratis en `language` (el otro idioma completa) sin necesitar el
    /// video, por IMDb + episodio y el release de la opción `hash`. Quedan en la caché de ESE
    /// video: al analizar o reproducir se reusan. OpenSubtitles.com no entra: es Premium.
    pub async fn catalog_subtitles(
        &self,
        video_id: &str,
        hash: &InfoHash,
        language: crate::config::SubtitleLanguage,
    ) -> Result<CatalogSubtitles> {
        // El log de la búsqueda también es el progreso que ve la UI ("bajando N", "bajado …").
        let progress = Arc::new(std::sync::Mutex::new((false, 0usize, 0usize)));
        let (events, vid) = (self.events.clone(), video_id.to_string());
        let emit = {
            let progress = progress.clone();
            move || {
                let (downloading, done, total) = *progress.lock().expect("progreso");
                events.emit(CoreEvent::CatalogSubtitlesProgress {
                    video_id: vid.clone(),
                    downloading,
                    done,
                    total,
                });
            }
        };
        emit();
        let log: crate::subtitles::session::LogFn = Arc::new(move |line| {
            tracing::info!(target: "streamonte_core::subtitles", "{line}");
            let mut changed = false;
            if let Some(n) = line
                .strip_prefix("subtítulos: bajando ")
                .and_then(|n| n.trim().parse::<usize>().ok())
            {
                let mut p = progress.lock().expect("progreso");
                p.0 = true;
                p.2 += n;
                changed = true;
            } else if line.starts_with("subtítulos: bajado ") {
                progress.lock().expect("progreso").1 += 1;
                changed = true;
            }
            if changed {
                emit();
            }
        });
        let (identity, _, key) = self.subtitle_identity(video_id, hash).await?;
        let got = self.subtitle_files(video_id, hash, language, log).await?;
        Ok(CatalogSubtitles {
            found: got
                .iter()
                .map(|(cand, path)| SubtitleFound::new(cand, Some(path)))
                .collect(),
            picks: self.subtitle_picks(&key),
            timing_known: identity.fps.is_some(),
        })
    }

    /// "Usar" un subtítulo del dropdown (encontrado, Premium ya bajado o uno que trae el video):
    /// queda elegido para esa opción y el reproductor lo pone al abrirla. El anterior cuenta como
    /// probado.
    pub async fn catalog_subtitle_use(
        &self,
        video_id: &str,
        hash: &InfoHash,
        key: &str,
    ) -> Result<SubtitlePicks> {
        let (_, _, video) = self.subtitle_identity(video_id, hash).await?;
        let memory = crate::subtitles::SubtitleMemory::new(self.paths.subtitles_memory_file());
        let c = memory.choose(&video, key, crate::config::SubtitleLanguage::Es)?;
        Ok(SubtitlePicks {
            chosen: Some(c.subtitle),
            tried: c.tried,
        })
    }

    /// Cuota de Premium, sin pedir nada (buscar no la gasta y no la informa).
    pub async fn premium_quota(&self) -> PremiumQuota {
        use crate::subtitles::providers::{OpenSubtitlesProvider, SubtitleProvider};
        let os = OpenSubtitlesProvider::from_store();
        // Con login, la cuenta la dice siempre; sin login, se sabe recién con una descarga.
        let has_login = crate::subtitles::secrets::opensubtitles_login().is_some();
        let login_error = match os.has_key() && has_login {
            true => os.account_quota().await.err().map(|e| e.user_message()),
            false => None,
        };
        let q = os.quota().await.ok().flatten();
        PremiumQuota {
            has_key: os.has_key(),
            has_login,
            login_error,
            remaining: q.map(|q| q.remaining),
            per_day: q.map(|q| q.per_day),
            resets_at: q
                .and_then(|q| q.resets_at)
                .map(|t| t.with_timezone(&chrono::Local).format("%H:%M").to_string()),
        }
    }

    /// Busca en Premium (OpenSubtitles.com), solo en español. No gasta cuota: no baja nada.
    pub async fn catalog_premium_search(
        &self,
        video_id: &str,
        hash: &InfoHash,
    ) -> Result<Vec<SubtitleFound>> {
        use crate::subtitles::providers::{OpenSubtitlesProvider, SubtitleProvider};
        let (identity, _, _) = self.subtitle_identity(video_id, hash).await?;
        let mut found = OpenSubtitlesProvider::from_store()
            .search(&identity, crate::config::SubtitleLanguage::Es)
            .await?;
        crate::subtitles::fit_by_timing(&identity, &mut found);
        Ok(crate::subtitles::top_candidates(found, usize::MAX)
            .iter()
            .map(|c| SubtitleFound::new(c, None))
            .collect())
    }

    /// "Usar · 1" de Premium: baja ESE subtítulo (gasta 1 de la cuota), lo suma a lo guardado
    /// con el video (el reproductor lo carga) y queda elegido. Nada más se baja.
    pub async fn catalog_premium_use(
        &self,
        video_id: &str,
        hash: &InfoHash,
        pick: PremiumPick,
    ) -> Result<CatalogSubtitles> {
        use crate::subtitles::providers::{OpenSubtitlesProvider, SubtitleProvider, OPENSUBTITLES};
        let es = crate::config::SubtitleLanguage::Es;
        let (identity, cache_dir, video) = self.subtitle_identity(video_id, hash).await?;
        let cand = crate::subtitles::SubtitleCandidate {
            provider: OPENSUBTITLES,
            provider_id: pick.id.to_string(),
            release_name: pick.release_name,
            language: es,
            match_kind: pick.level,
            downloads: 0,
            variant: if pick.latino {
                crate::subtitles::SpanishVariant::Latino
            } else {
                crate::subtitles::SpanishVariant::Unknown
            },
            url: String::new(),
            fps: None,
            last_secs: None,
        };
        std::fs::create_dir_all(&cache_dir).map_err(|source| CoreError::Io {
            path: cache_dir.clone(),
            source,
        })?;
        let path = OpenSubtitlesProvider::from_store()
            .download(&cand, &cache_dir)
            .await?;
        crate::subtitles::session::add_saved(&cache_dir, es, cand.clone(), path);
        let memory = crate::subtitles::SubtitleMemory::new(self.paths.subtitles_memory_file());
        memory.choose(&video, &cand.key(), es)?;
        // Lo guardado ya lo incluye: se relee sin buscar.
        let log: crate::subtitles::session::LogFn =
            Arc::new(|line| tracing::info!(target: "streamonte_core::subtitles", "{line}"));
        let got = self.subtitle_files(video_id, hash, es, log).await?;
        Ok(CatalogSubtitles {
            found: got
                .iter()
                .map(|(c, path)| SubtitleFound::new(c, Some(path)))
                .collect(),
            picks: self.subtitle_picks(&video),
            timing_known: identity.fps.is_some(),
        })
    }

    fn subtitle_picks(&self, video: &crate::video_key::VideoKey) -> SubtitlePicks {
        crate::subtitles::SubtitleMemory::new(self.paths.subtitles_memory_file())
            .get(video)
            .ok()
            .flatten()
            .map(|c| SubtitlePicks {
                chosen: Some(c.subtitle).filter(|s| !s.is_empty()),
                tried: c.tried,
            })
            .unwrap_or_default()
    }

    /// Qué video es para los subtítulos (IMDb + episodio, el release de la opción `hash` y, si
    /// esa opción ya se analizó, su duración y fps reales), la carpeta donde se guardan los del
    /// catálogo y la clave con que se recuerda lo elegido (la misma que usa la reproducción).
    async fn subtitle_identity(
        &self,
        video_id: &str,
        hash: &InfoHash,
    ) -> Result<(
        crate::subtitles::VideoIdentity,
        std::path::PathBuf,
        crate::video_key::VideoKey,
    )> {
        let video = VideoId::parse(video_id)?;
        let c = self
            .catalog
            .candidate(&video, hash)
            .ok_or_else(|| CoreError::Catalog {
                user: "Esa opción ya no está en la lista: actualizá las opciones.".into(),
                detail: format!("candidato {hash} no encontrado"),
            })?;
        let file = c
            .file_name
            .clone()
            .unwrap_or_else(|| c.release_name.clone());
        let mut identity = crate::subtitles::VideoIdentity::for_file(
            &file,
            &c.release_name,
            *hash,
            c.size_bytes.unwrap_or(0),
        );
        identity.imdb_id = Some(video.imdb_id().to_string());
        if let Some((s, e)) = video.episode() {
            identity.season = u16::try_from(s).ok();
            identity.episode = u16::try_from(e).ok();
        }
        let live = self
            .library
            .lock()
            .await
            .of_torrent(*hash)
            .find_map(|e| e.live.clone());
        identity.duration_secs = live.as_ref().and_then(|l| l.duration_secs);
        identity.fps = live.as_ref().and_then(|l| l.fps);
        let dir = self.paths.pending_subtitles_dir(&identity.video_id(), hash);
        // La misma clave que la fila que crea Reproducir (`library::entry_key`).
        let key = crate::video_key::VideoKey::new(*hash, video.episode(), c.file_idx);
        Ok((identity, dir, key))
    }

    /// Subtítulos de esa opción de la lista (2026-11-17, compartido por el dropdown y el ▶ de
    /// TorBox): los busca y baja de las fuentes gratis (lo ya bajado sale de la caché), mejor
    /// primero.
    async fn subtitle_files(
        &self,
        video_id: &str,
        hash: &InfoHash,
        language: crate::config::SubtitleLanguage,
        log: crate::subtitles::session::LogFn,
    ) -> Result<Vec<(crate::subtitles::SubtitleCandidate, std::path::PathBuf)>> {
        let (identity, cache_dir, _) = self.subtitle_identity(video_id, hash).await?;
        Ok(
            crate::subtitles::session::fetch(crate::subtitles::session::Fetch {
                video: identity,
                video_url: None,
                torrent_files: Vec::new(),
                language,
                cache_dir,
                remembered: None,
                log,
            })
            .await,
        )
    }

    // ----- Catálogo y addons (F4b, spec 09) -----

    /// FR-36: búsqueda en Cinemeta (películas y series a la vez). Una búsqueda nueva cancela la
    /// anterior (`Cancelled`, la UI la ignora). FR-40: en segundo plano se piden las fichas para
    /// avisar con `CatalogExcluded` cuáles son anime / japonés.
    pub async fn catalog_search(&self, query: &str) -> Result<Vec<MetaPreview>> {
        let timeout = self.catalog_timeout().await;
        let events = self.events.clone();
        self.catalog
            .search_flagging_excluded(query, timeout, move |id| {
                events.emit(CoreEvent::CatalogExcluded { id });
            })
            .await
    }

    /// Puntaje promedio por temporada de una serie (IMDb) y su estado.
    pub async fn catalog_season_ratings(
        &self,
        imdb_id: &str,
        quick: bool,
    ) -> Result<crate::catalog::seasons::SeasonRatings> {
        let timeout = self.catalog_timeout().await;
        self.catalog.season_ratings(imdb_id, quick, timeout).await
    }

    /// Explorar sin key de TMDB: en tendencia ahora.
    pub async fn catalog_trending(&self, kind: MediaKind, skip: u32) -> Result<BrowsePage> {
        let timeout = self.catalog_timeout().await;
        self.catalog.trending(kind, skip, timeout).await
    }

    /// Explorar con los filtros de IMDb (votos, idiomas); necesita la key de TMDB.
    #[allow(clippy::too_many_arguments)]
    pub async fn catalog_browse_top(
        &self,
        kind: MediaKind,
        sort: BrowseSort,
        from: &str,
        to: Option<&str>,
        min_votes: u32,
        languages: Vec<String>,
        genres: Vec<u32>,
    ) -> Result<BrowsePage> {
        let timeout = self.catalog_timeout().await;
        let titles = self.languages().await.titles;
        self.catalog
            .browse_top(
                kind, sort, from, to, min_votes, languages, genres, titles, timeout,
            )
            .await
    }

    /// Géneros de TMDB del tipo, en el idioma de la app (filtro de Explorar).
    pub async fn catalog_genres(
        &self,
        kind: MediaKind,
    ) -> Result<Vec<crate::catalog::top::GenreName>> {
        let timeout = self.catalog_timeout().await;
        let app = self.languages().await.app;
        self.catalog.genres(kind, app, timeout).await
    }

    /// Títulos y sinopsis de los episodios de una temporada en los idiomas elegidos (vacío sin key de TMDB).
    pub async fn catalog_episodes(
        &self,
        imdb_id: &str,
        season: u32,
    ) -> Vec<crate::catalog::tmdb::EpisodeText> {
        let timeout = self.catalog_timeout().await;
        let langs = self.languages().await;
        self.catalog.episodes(imdb_id, season, langs, timeout).await
    }

    /// "Pegar magnet" con TorBox (2026-11-20): si lo tiene en caché, se baja o ya está en la cuenta, con
    /// sus videos; `who` también reconoce la película o serie por el nombre (`dn`) en TMDB.
    pub async fn torbox_magnet(
        &self,
        hash: InfoHash,
        name: &str,
        who: bool,
    ) -> Result<(
        crate::catalog::torbox::MagnetStatus,
        Option<crate::catalog::tmdb::Identified>,
    )> {
        let timeout = self.catalog_timeout().await;
        let status =
            crate::catalog::torbox::magnet_status(&self.catalog.http, hash, timeout).await?;
        let titles = self.languages().await.titles;
        let named = status
            .name
            .as_deref()
            .filter(|n| !n.is_empty())
            .unwrap_or(name);
        let ident = if who {
            self.catalog.identify(named, titles, timeout).await
        } else {
            None
        };
        Ok((status, ident))
    }

    /// "Bajarlo en TorBox": lo agrega a la cuenta aunque no esté en caché; devuelve el estado nuevo.
    pub async fn torbox_magnet_download(
        &self,
        hash: InfoHash,
        name: &str,
    ) -> Result<crate::catalog::torbox::MagnetStatus> {
        let timeout = self.catalog_timeout().await;
        let mut magnet = format!("magnet:?xt=urn:btih:{}", hash.to_hex());
        if !name.is_empty() {
            magnet.push_str(&format!(
                "&dn={}",
                crate::catalog::protocol::encode_extra(name)
            ));
        }
        crate::catalog::torbox::magnet_download(&self.catalog.http, &magnet, timeout).await?;
        crate::catalog::torbox::magnet_status(&self.catalog.http, hash, timeout).await
    }

    /// Datos de TMDB para el panel (2026-11-17); sin key, `has_key = false`.
    pub async fn catalog_details(
        &self,
        kind: MediaKind,
        imdb_id: &str,
    ) -> crate::catalog::tmdb::DetailsView {
        let timeout = self.catalog_timeout().await;
        let langs = self.languages().await;
        self.catalog.details(kind, imdb_id, langs, timeout).await
    }

    /// Similares de TMDB del título, al abrir "Similares" en el panel (2026-11-17).
    pub async fn catalog_similar(
        &self,
        kind: MediaKind,
        imdb_id: &str,
    ) -> Vec<crate::catalog::tmdb::Similar> {
        let timeout = self.catalog_timeout().await;
        let titles = self.languages().await.titles;
        self.catalog.similar(kind, imdb_id, titles, timeout).await
    }

    /// FR-38/39: ficha de película o serie (con episodios).
    pub async fn catalog_meta(&self, kind: MediaKind, id: &str) -> Result<Meta> {
        let timeout = self.catalog_timeout().await;
        self.catalog.meta(kind, id, timeout).await
    }

    /// FR-42: pide streams a todos los addons habilitados; llegan por `CatalogStreams`.
    /// Cambiar de video cancela la consulta anterior. Los seeders reales llegan solos (scrape).
    /// Las pruebas de conexión del video anterior siguen (2026-11-17): la UI pregunta si cortarlas
    /// ([`Self::catalog_stop_swarm`]).
    pub async fn catalog_streams(&self, kind: MediaKind, video_id: &str) -> Result<()> {
        let cfg = self.config.read().await.clone();
        let events = self.events.clone();
        self.catalog.streams(&cfg, kind, video_id, move |update| {
            events.emit(CoreEvent::CatalogStreams { update });
        })
    }

    /// "Detener" el análisis profundo (2026-11-16): corta los conteos de enjambre en curso; la
    /// consulta de fuentes sigue.
    pub fn catalog_stop_swarm(&self) {
        std::mem::take(&mut *self.swarm_cancel.lock().expect("swarm")).cancel();
    }

    /// Cerrar la ficha / volver a buscar: corta la consulta en curso. Las pruebas de conexión no
    /// (2026-11-17): la UI pregunta si seguir de fondo.
    pub fn catalog_stop_streams(&self) {
        self.catalog.stop_streams();
    }

    /// Candidatos → filas de la biblioteca con `origin` (spec 09 §8.1), sin analizar ("Reproducir"
    /// desde el catálogo las agrega así y las reproduce con [`Self::play`]). No pasa por el
    /// análisis automático "al pegar": desde el catálogo solo se mide lo que el usuario elige.
    pub async fn catalog_add(
        &self,
        kind: MediaKind,
        video_id: &str,
        hashes: &[InfoHash],
    ) -> Result<Vec<LibraryRowView>> {
        let video = VideoId::parse(video_id)?;
        let timeout = self.catalog_timeout().await;
        let meta = self.catalog.meta(kind, video.imdb_id(), timeout).await.ok();
        let trackers = self.config.read().await.all_trackers();
        let mut library = self.library.lock().await;
        let mut added = Vec::new();
        for hash in hashes {
            let pick = self.catalog.pick(&video, hash, meta.as_ref(), &trackers)?;
            // Una fila por episodio: agregar S3E2 no pisa la fila de S3E1 del mismo pack.
            let key = library.add_from_catalog(
                &pick.magnet,
                &pick.magnet.to_uri(),
                pick.origin,
                pick.size_bytes,
            );
            library.emit_rows(&[key], self.events.as_ref());
            if let Some(entry) = library.get(&key) {
                added.push(library.view(entry));
            }
        }
        Ok(added)
    }

    /// Ajustes → Fuentes (FR-41).
    pub async fn catalog_addons(&self) -> Vec<AddonView> {
        self.config
            .read()
            .await
            .catalog
            .addons
            .iter()
            .map(AddonView::from)
            .collect()
    }

    /// "Agregar addon": valida el manifest; URL con configuración → almacén seguro (NFR-22).
    /// El manifest se pide (hasta 10 s) SIN el lock de la config: mientras tanto otros ajustes
    /// se guardan normalmente y el alta solo agrega su fila a la config de ese momento.
    pub async fn catalog_add_addon(&self, url: &str) -> Result<AddonView> {
        let _one_at_a_time = self.adding_addon.lock().await;
        let existing = self.config.read().await.catalog.addons.clone();
        let entry = self.catalog.new_addon(url, &existing).await?;
        let view = AddonView::from(&entry);
        self.update_config(|c| {
            c.catalog.addons.push(entry);
            Ok(())
        })
        .await?;
        Ok(view)
    }

    pub async fn catalog_remove_addon(&self, id: &str) -> Result<()> {
        let own = self
            .config
            .read()
            .await
            .catalog
            .addons
            .iter()
            .any(|a| a.id == id && a.kind != crate::config::SourceKind::Stremio);
        if own {
            return Err(CoreError::Catalog {
                user: "Esta fuente viene con la app: no se quita, apagala.".into(),
                detail: format!("fuente propia {id}"),
            });
        }
        let entry = self
            .update_config(|c| {
                let pos = c.catalog.addons.iter().position(|a| a.id == id);
                let pos = pos.ok_or_else(|| CoreError::NotFound(format!("addon {id}")))?;
                Ok(c.catalog.addons.remove(pos))
            })
            .await?;
        // Después de guardar: si no se pudo, la URL secreta sigue en el almacén.
        self.catalog.forget_addon(&entry);
        Ok(())
    }

    pub async fn catalog_set_addon_enabled(&self, id: &str, enabled: bool) -> Result<()> {
        self.update_config(|c| {
            let entry = c.catalog.addons.iter_mut().find(|a| a.id == id);
            entry
                .ok_or_else(|| CoreError::NotFound(format!("addon {id}")))?
                .enabled = enabled;
            Ok(())
        })
        .await
    }

    /// "Restaurar lista por defecto" (spec 09 §9).
    pub async fn catalog_reset_addons(&self) -> Result<Vec<AddonView>> {
        let old = self
            .update_config(|c| {
                Ok(std::mem::replace(
                    &mut c.catalog.addons,
                    crate::config::default_addons(),
                ))
            })
            .await?;
        for entry in &old {
            self.catalog.forget_addon(entry);
        }
        Ok(self.catalog_addons().await)
    }

    /// Filtro "Sin anime" de Buscar (FR-40).
    pub async fn catalog_set_exclude_japanese(&self, exclude: bool) -> Result<()> {
        self.update_config(|c| {
            c.catalog.exclude_japanese = exclude;
            Ok(())
        })
        .await
    }

    async fn catalog_timeout(&self) -> Duration {
        Duration::from_millis(self.config.read().await.catalog.timeout_ms)
    }

    async fn languages(&self) -> crate::config::LanguageConfig {
        self.config.read().await.language
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
