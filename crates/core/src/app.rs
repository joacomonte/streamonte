//! `app` — [`AppCore`]: cablea los módulos y es la ÚNICA superficie que ve la UI (NFR-01).
//! Cada método corresponde 1:1 a un comando Tauri (`src-tauri/src/commands.rs`) y a una
//! función de `ui/src/api.js`. Ningún método bloquea: lo largo corre en tareas y avisa por eventos (NFR-10).
//! Ningún comando hace `panic`: los errores vuelven como [`CoreError`] con mensaje para el usuario.

use std::collections::HashSet;
use std::sync::Arc;
use std::time::Duration;

use serde::Serialize;
use tokio::sync::Mutex;
use tokio_util::sync::CancellationToken;

use crate::analyzer::{AnalyzeScope, AnalyzerHandle};
use crate::catalog::cinemeta::{BrowseCursor, BrowsePage, BrowseSort, Meta, SearchResults};
use crate::catalog::{AddonView, MediaKind, VideoId};
use crate::cleanup::{Cleanup, CleanupReport};
use crate::clipboard::WatchGuard;
use crate::config::{Config, ConfigStore};
use crate::events::{CoreEvent, EventSink, StatusLevel};
use crate::intake::Intake;
pub use crate::intake::{ClipboardPreview, ClipboardPreviewItem, ClipboardReadReport};
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

/// Un subtítulo bajado desde el catálogo (para mostrar en la fila).
#[derive(Debug, Clone, Serialize)]
pub struct SubtitleFound {
    pub provider: String,
    pub language: crate::config::SubtitleLanguage,
    pub release_name: String,
    /// Para distinguir dos del mismo release (p. ej. uno para sordos).
    pub downloads: u32,
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

        let catalog = Arc::new(crate::catalog::Catalog::new(&config.read().await.catalog));
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
    pub async fn clipboard_preview(&self) -> Result<ClipboardPreview> {
        Ok(self.intake.clipboard_preview().await)
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
        let port = self.config.read().await.engine.listen_ports[0];
        crate::incoming::check(port).await
    }

    pub async fn set_network(&self, incoming: bool, upnp: bool) -> Result<()> {
        self.update_config(|c| {
            c.engine.incoming = incoming;
            c.engine.upnp = upnp;
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
            .chain(std::iter::once(ApiKeyStatus {
                service: crate::catalog::tmdb::TMDB.to_string(),
                configured: crate::catalog::tmdb::has_key(),
            }))
            .collect()
    }
    /// Abre en el navegador la página para pedir la key de un servicio (solo URLs fijas, NFR-16).
    pub fn open_key_page(&self, service: &str) -> Result<()> {
        let url = match service {
            crate::catalog::tmdb::TMDB => Some(crate::catalog::tmdb::KEY_PAGE),
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

    /// Póster de TMDB para un título cuyo póster de Cinemeta no existe (2026-11-15).
    pub async fn catalog_poster(&self, imdb_id: &str) -> Option<String> {
        let timeout = self.catalog_timeout().await;
        self.catalog.poster(imdb_id, timeout).await
    }

    /// "Contar seeders reales" de opciones del catálogo (2026-11-15): se conecta al enjambre de
    /// cada una y cuenta los que ve (~50 s por tanda), sin bajar el video ni sumarlo a Mis
    /// magnets. Varios conteos conviven; cerrar o cambiar de video los corta todos.
    pub async fn catalog_swarm(
        &self,
        hashes: &[InfoHash],
        deep: bool,
    ) -> std::collections::HashMap<InfoHash, crate::analyzer::swarm::SwarmCount> {
        let cancel = self.swarm_cancel.lock().expect("swarm").clone();
        let magnets = self.catalog.magnets_of(hashes);
        let cfg = self.config.read().await.clone();
        crate::analyzer::swarm::count(&self.paths, &cfg, magnets, deep, cancel, {
            let events = self.events.clone();
            move |hash, count, done| {
                events.emit(if done {
                    CoreEvent::CatalogSwarmCounted { hash, count }
                } else {
                    CoreEvent::CatalogSwarmProgress { hash, count }
                })
            }
        })
        .await
    }

    /// "Bajar subtítulos" de una opción del catálogo (2026-11-15): busca y baja hasta 5 en
    /// `language` (el otro idioma completa) sin necesitar el video, por IMDb + episodio y nombre
    /// del release. Quedan en la caché de ESE video: al analizar o reproducir se reusan y se
    /// copian junto al archivo con nombres que mpv carga solo.
    pub async fn catalog_subtitles(
        &self,
        video_id: &str,
        hash: &InfoHash,
        language: crate::config::SubtitleLanguage,
    ) -> Result<Vec<SubtitleFound>> {
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
        let id = identity.video_id();
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
        let got = crate::subtitles::session::fetch(crate::subtitles::session::Fetch {
            video: identity,
            video_url: None,
            torrent_files: Vec::new(),
            language,
            cache_dir: self.paths.pending_subtitles_dir(&id),
            remembered: None,
            // Lo pidió el usuario: OpenSubtitles completa si hace falta (respeta su cuota diaria).
            opensubtitles: true,
            log,
        })
        .await;
        Ok(got
            .into_iter()
            .map(|(cand, _)| SubtitleFound {
                provider: crate::subtitles::providers::display_name(cand.provider).to_string(),
                language: cand.language,
                release_name: cand.release_name,
                downloads: cand.downloads,
            })
            .collect())
    }

    // ----- Catálogo y addons (F4b, spec 09) -----

    /// FR-36: búsqueda en Cinemeta (películas y series a la vez). Una búsqueda nueva cancela la
    /// anterior (`Cancelled`, la UI la ignora). FR-40: en segundo plano se piden las fichas para
    /// avisar con `CatalogExcluded` cuáles son anime / japonés.
    pub async fn catalog_search(&self, query: &str) -> Result<SearchResults> {
        let timeout = self.catalog_timeout().await;
        let events = self.events.clone();
        self.catalog
            .search_flagging_excluded(query, timeout, move |id| {
                events.emit(CoreEvent::CatalogExcluded { id });
            })
            .await
    }

    /// Explorar (FR-37 simple, 2026-11-14): una página de 50 de Cinemeta.
    pub async fn catalog_browse(
        &self,
        kind: MediaKind,
        sort: BrowseSort,
        year: Option<u16>,
        genre: Option<&str>,
        skip: u32,
    ) -> Result<BrowsePage> {
        let timeout = self.catalog_timeout().await;
        self.catalog
            .browse(kind, sort, year, genre, skip, timeout)
            .await
    }

    /// Explorar por fecha de estreno (`AAAA-MM-DD`, bordes incluidos; sin `to` = hasta hoy).
    /// `cursor` es el `next` de la página anterior (None = primera).
    pub async fn catalog_browse_released(
        &self,
        kind: MediaKind,
        from: &str,
        to: Option<&str>,
        genre: Option<&str>,
        cursor: Option<BrowseCursor>,
    ) -> Result<BrowsePage> {
        let timeout = self.catalog_timeout().await;
        self.catalog
            .browse_released(kind, from, to, genre, cursor, timeout)
            .await
    }

    /// Mejor puntuadas con los filtros de IMDb (votos, idiomas); solo películas.
    pub async fn catalog_browse_top(
        &self,
        from: &str,
        to: Option<&str>,
        min_votes: u32,
        languages: Vec<String>,
        genre: Option<&str>,
    ) -> Result<BrowsePage> {
        let timeout = self.catalog_timeout().await;
        self.catalog
            .browse_top(from, to, min_votes, languages, genre, timeout)
            .await
    }

    /// FR-38/39: ficha de película o serie (con episodios).
    pub async fn catalog_meta(&self, kind: MediaKind, id: &str) -> Result<Meta> {
        let timeout = self.catalog_timeout().await;
        self.catalog.meta(kind, id, timeout).await
    }

    /// FR-42: pide streams a todos los addons habilitados; llegan por `CatalogStreams`.
    /// Cambiar de video cancela la consulta anterior. Los seeders reales llegan solos (scrape).
    pub async fn catalog_streams(&self, kind: MediaKind, video_id: &str) -> Result<()> {
        // Otro video: los conteos de enjambre del anterior ya no sirven.
        std::mem::take(&mut *self.swarm_cancel.lock().expect("swarm")).cancel();
        let cfg = self.config.read().await.clone();
        let events = self.events.clone();
        self.catalog.streams(&cfg, kind, video_id, move |update| {
            events.emit(CoreEvent::CatalogStreams { update });
        })
    }

    /// Cerrar la ficha / volver a buscar: corta la consulta en curso.
    pub fn catalog_stop_streams(&self) {
        self.catalog.stop_streams();
        // Corta los conteos de enjambre de ese video; los próximos usan un token nuevo.
        std::mem::take(&mut *self.swarm_cancel.lock().expect("swarm")).cancel();
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
