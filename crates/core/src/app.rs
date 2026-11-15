//! `app` — [`AppCore`]: cablea los módulos y es la ÚNICA superficie que ve la UI (NFR-01).
//! Cada método corresponde 1:1 a un comando Tauri (`src-tauri/src/commands.rs`) y a una
//! función de `ui/src/api.js`. Ningún método bloquea: lo largo corre en tareas y avisa por eventos (NFR-10).
//! Ningún comando hace `panic`: lo que todavía no existe devuelve [`CoreError::NotImplemented`].

use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use serde::Serialize;
use tokio::sync::Mutex;

use crate::analyzer::{AnalyzeScope, AnalyzerHandle};
use crate::catalog::cinemeta::{BrowseCursor, BrowsePage, BrowseSort, Meta, SearchResults};
use crate::catalog::{AddonView, MediaKind, VideoId};
use crate::cleanup::{Cleanup, CleanupReport};
use crate::clipboard::{ClipboardSource, WatchGuard};
use crate::config::{Config, ConfigStore};
use crate::events::{CoreEvent, EventSink, StatusLevel};
use crate::library::CatalogOrigin;
use crate::library::{AddOutcome, Group, Library, LibraryEntry};
use crate::logger::LoggerGuard;
use crate::magnet::{InfoHash, Magnet};
use crate::paths::AppPaths;
use crate::playback::{
    OnAppClose, PlaybackAction, PlaybackId, PlaybackManager, PlaybackRow, StartRequest,
};
use crate::{CoreError, Result};

/// Cada cuánto se mira si la biblioteca cambió para guardarla (debounce de `library.json`).
const LIBRARY_SAVE_DEBOUNCE: Duration = Duration::from_millis(500);

/// Lista agrupada para la vista principal (FR-03, FR-29).
#[derive(Debug, Clone, Serialize)]
pub struct LibraryView {
    pub pasted_now: Vec<LibraryEntry>,
    pub previous: Vec<LibraryEntry>,
}

/// Diálogo "Leer portapapeles": magnets encontrados para elegir (2026-11-14).
#[derive(Debug, Clone, Serialize)]
pub struct ClipboardPreview {
    pub items: Vec<ClipboardPreviewItem>,
    /// `false` → solo se vio el último copiado (Win+V apagado o macOS).
    pub history_available: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct ClipboardPreviewItem {
    #[serde(flatten)]
    pub magnet: crate::clipboard::ClipboardMagnet,
    /// Ya está en la lista.
    pub in_list: bool,
    /// Nombre real si ya lo conocemos (metadatos de una vez anterior).
    pub known_name: Option<String>,
}

/// Resultado de "Leer portapapeles" sin diálogo (FR-02, lectura al abrir la app).
#[derive(Debug, Clone, Serialize)]
pub struct ClipboardReadReport {
    pub added: usize,
    /// `false` → la UI avisa que Win+V está apagado o no existe en el SO.
    pub history_available: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct TempUsage {
    pub bytes: u64,
    pub folder: String,
}

/// ¿Hay API key guardada para este proveedor de subtítulos? (Ajustes, F4).
#[derive(Debug, Clone, Serialize)]
pub struct SubtitleKeyStatus {
    pub provider: String,
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
    /// Magnets recién pegados → nombre real + análisis automático.
    intake: Intake,
    /// Catálogo y addons (F4b, spec 09).
    catalog: Arc<crate::catalog::Catalog>,
    clipboard: Arc<dyn ClipboardSource>,
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
        let mut library = Library::load(paths.library_file())?;
        // FR-20 / T-05: restos de una ejecución anterior (app cerrada a la fuerza, corte de luz).
        // FR-06d: lo analizado de los magnets que siguen en la lista NO es resto; el de los que
        // ya no están, sí. En segundo plano: borrar varios GB no debe demorar la ventana (NFR-10).
        {
            let cleanup = Cleanup::new(paths.clone());
            let events = events.clone();
            let keep = analysis_dirs(&paths, &library.hashes());
            tokio::task::spawn_blocking(move || match cleanup.clean_orphans(&keep) {
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
            });
        }

        library.set_ranking(config.ranking.clone());
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
        });
        // FR-12: las descargas pausadas de sesiones anteriores vuelven al panel.
        playback.load_kept();

        let intake = spawn_intake(
            paths.clone(),
            config.clone(),
            library.clone(),
            events.clone(),
            analyzer.clone(),
        );

        let clipboard: Arc<dyn ClipboardSource> = Arc::from(crate::clipboard::platform_source());
        let clipboard_watch = if opts.capture_clipboard {
            start_clipboard_watch(clipboard.as_ref(), &library, &events, &intake)
        } else {
            None
        };

        let catalog = Arc::new(crate::catalog::Catalog::new(&config.read().await.catalog));
        tracing::info!("núcleo iniciado");
        let core = Arc::new(Self {
            catalog,
            cleanup: Cleanup::new(paths.clone()),
            paths,
            config,
            config_store,
            library,
            analyzer,
            playback,
            events,
            intake,
            clipboard,
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
        let downloads = self.paths.downloads_dir();
        let group = |g| {
            library
                .list(g)
                .into_iter()
                .map(|e| {
                    let mut e = e.clone();
                    if let Some(live) = &e.live {
                        let prefix = format!("{}-", e.info_hash.to_hex());
                        e.downloaded_bytes = Some(crate::fsutil::downloaded_in_dirs(
                            &downloads,
                            &prefix,
                            &live.file_name,
                        ));
                    }
                    e
                })
                .collect()
        };
        LibraryView {
            pasted_now: group(Group::PastedNow),
            previous: group(Group::Previous),
        }
    }

    /// "Leer portapapeles" (FR-02): historial Win+V del más nuevo al más viejo hasta el primer
    /// no-magnet. Sin historial (apagado o macOS): solo el último copiado + aviso.
    /// Diálogo "Leer portapapeles" (2026-11-14): TODOS los magnets del historial Win+V con la
    /// hora en que se copiaron, para que el usuario elija cuáles agregar. Marca los que ya están.
    pub async fn clipboard_preview(&self) -> Result<ClipboardPreview> {
        let (items, unavailable) = crate::clipboard::scan_all(self.clipboard.as_ref()).await;
        let library = self.library.lock().await;
        let items = items
            .into_iter()
            .map(|m| {
                let entry = library.get(&m.info_hash);
                ClipboardPreviewItem {
                    in_list: entry.is_some(),
                    known_name: entry.and_then(|e| e.torrent_name.clone()),
                    magnet: m,
                }
            })
            .collect();
        Ok(ClipboardPreview {
            items,
            history_available: unavailable.is_none(),
        })
    }

    /// Agrega solo los magnets elegidos en el diálogo (texto original de cada uno).
    pub async fn add_selected_magnets(&self, raws: Vec<String>) -> Result<usize> {
        self.add_from_text(&raws.join("\n")).await
    }

    pub async fn read_clipboard(&self) -> Result<ClipboardReadReport> {
        let crate::clipboard::ClipboardImport {
            magnets,
            unavailable,
        } = crate::clipboard::import(self.clipboard.as_ref()).await;
        if let Some(reason) = unavailable {
            self.events
                .emit(CoreEvent::ClipboardHistoryUnavailable { reason });
        }
        let added = add_magnets(&self.library, self.events.as_ref(), &self.intake, &magnets).await;
        Ok(ClipboardReadReport {
            added,
            history_available: unavailable.is_none(),
        })
    }

    /// Agrega todos los magnets de un texto (pegar, arrastrar, captura en vivo; FR-01).
    /// Devuelve cuántos quedaron en "Pegados ahora" por este texto (nuevos o traídos de "Anteriores").
    pub async fn add_from_text(&self, text: &str) -> Result<usize> {
        let magnets = crate::magnet::extract_all_with_raw(text);
        Ok(add_magnets(&self.library, self.events.as_ref(), &self.intake, &magnets).await)
    }

    /// Quitar uno (FR-04).
    /// FR-06d: con el magnet se va lo bajado al analizarlo.
    pub async fn remove(&self, hash: InfoHash) -> Result<()> {
        if !self.library.lock().await.remove(&hash) {
            return Err(CoreError::NotFound(format!("magnet {hash}")));
        }
        self.events
            .emit(CoreEvent::LibraryEntryRemoved { info_hash: hash });
        self.delete_analysis(&[hash]).await;
        Ok(())
    }

    /// Limpiar lista (FR-04). Corta el análisis en curso: no tiene sentido medir lo que se borró.
    /// FR-06d: borra también lo bajado al analizar.
    pub async fn clear_library(&self) -> Result<()> {
        let _ = self.analyzer.cancel().await;
        let hashes = {
            let mut library = self.library.lock().await;
            let hashes = library.hashes();
            library.clear();
            hashes
        };
        self.events.emit(CoreEvent::LibraryCleared);
        self.delete_analysis(&hashes).await;
        Ok(())
    }

    /// Borra los datos de análisis (FR-06d). Si una medición todavía la usa (archivos abiertos),
    /// queda para la limpieza del próximo inicio: su hash ya no está en la lista.
    async fn delete_analysis(&self, hashes: &[InfoHash]) {
        for hash in hashes {
            let dir = self.paths.analysis_dir(hash);
            if let Err(e) = self.cleanup.remove_dir(&dir).await {
                tracing::warn!("no se pudo borrar {dir:?}: {e} (se reintenta al abrir la app)");
            }
        }
    }

    /// Lo que la limpieza automática no toca: reproducciones (activas y pausadas) y el análisis
    /// de los magnets de la lista (FR-06d).
    async fn kept_dirs(&self) -> HashSet<PathBuf> {
        let mut dirs = self.playback.active_dirs();
        dirs.extend(analysis_dirs(
            &self.paths,
            &self.library.lock().await.hashes(),
        ));
        dirs
    }

    /// Magnet para "Copiar magnet" (FR-04): tal cual se copió.
    pub async fn magnet_of(&self, hash: InfoHash) -> Result<String> {
        self.library
            .lock()
            .await
            .get(&hash)
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
        self.playback.stop_all(true).await?;
        let hashes = self.library.lock().await.hashes();
        self.delete_analysis(&hashes).await;
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
        if let Err(e) = self.library.lock().await.save_if_dirty() {
            tracing::warn!("guardar library.json al cerrar: {e}");
        }
        self.playback.on_app_close(choice).await?;
        // FR-20 al cerrar: restos sin dueño vivo (lo propio ya se borró al detener).
        if let Err(e) = self.cleanup.clean_orphans(&self.kept_dirs().await) {
            tracing::warn!("limpieza al cerrar: {e}");
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
    /// "Limpiar temporales" (FR-19): nunca toca reproducciones activas ni el historial.
    pub fn clean_temp(&self) -> Result<CleanupReport> {
        self.cleanup.clean(&self.playback.active_dirs())
    }
    pub fn open_downloads_folder(&self) -> Result<()> {
        crate::cleanup::open_in_file_manager(&self.paths.downloads_dir())
    }

    // ----- Configuración (NFR-04, Q-06) -----
    pub async fn config(&self) -> Config {
        self.config.read().await.clone()
    }
    pub async fn set_config(&self, new: Config) -> Result<()> {
        self.config_store.save(&new)?;
        crate::logger::apply(&new.logging)?;
        self.library.lock().await.set_ranking(new.ranking.clone());
        *self.config.write().await = new;
        Ok(())
    }

    // ----- Subtítulos (FR-24, Q-01, Q-04, NFR-16) -----
    /// Guarda la API key de un proveedor ("opensubtitles" o "wyzie") en el almacén seguro del
    /// sistema; vacía = borrarla. Nunca va a `config.json` ni a los logs.
    pub fn subtitles_set_api_key(&self, provider: &str, key: &str) -> Result<()> {
        crate::subtitles::secrets::set_api_key(provider, key)
    }
    /// Qué proveedores tienen key (para Ajustes, F4), sin devolver nunca la key.
    pub fn subtitles_api_keys(&self) -> Vec<SubtitleKeyStatus> {
        crate::subtitles::secrets::KEY_PROVIDERS
            .iter()
            .map(|p| SubtitleKeyStatus {
                provider: (*p).to_string(),
                configured: crate::subtitles::secrets::has_api_key(p),
            })
            .collect()
    }

    // ----- Catálogo y addons (F4b, spec 09) -----

    /// FR-36: búsqueda en Cinemeta (películas y series a la vez). Una búsqueda nueva cancela la
    /// anterior (`Cancelled`, la UI la ignora). FR-40: en segundo plano se piden las fichas para
    /// avisar con `CatalogExcluded` cuáles son anime / japonés.
    pub async fn catalog_search(&self, query: &str) -> Result<SearchResults> {
        let query = query.trim();
        if query.chars().count() < 2 {
            return Ok(SearchResults {
                movies: Vec::new(),
                series: Vec::new(),
            });
        }
        let timeout = self.catalog_timeout().await;
        let results = self.catalog.search(query, timeout).await?;
        let previews = results
            .movies
            .iter()
            .chain(&results.series)
            .cloned()
            .collect();
        let (catalog, events) = (self.catalog.clone(), self.events.clone());
        tokio::spawn(async move {
            catalog
                .find_excluded(previews, timeout, move |id| {
                    events.emit(CoreEvent::CatalogExcluded { id });
                })
                .await;
        });
        Ok(results)
    }

    /// Explorar (FR-37 simple, 2026-11-14): una página de 50 de Cinemeta.
    pub async fn catalog_browse(
        &self,
        kind: MediaKind,
        sort: BrowseSort,
        year: Option<u16>,
        skip: u32,
    ) -> Result<BrowsePage> {
        let timeout = self.catalog_timeout().await;
        crate::catalog::cinemeta::browse(&self.catalog.http, kind, sort, year, skip, timeout)
            .await
            .map_err(|e| crate::catalog::fetch_error("cargar la lista", &e))
    }

    /// Explorar por fecha de estreno (`AAAA-MM-DD`, bordes incluidos; sin `to` = hasta hoy).
    /// `cursor` es el `next` de la página anterior (None = primera).
    pub async fn catalog_browse_released(
        &self,
        kind: MediaKind,
        from: &str,
        to: Option<&str>,
        cursor: Option<BrowseCursor>,
    ) -> Result<BrowsePage> {
        let date = |s: &str| {
            chrono::NaiveDate::parse_from_str(s.trim(), "%Y-%m-%d").map_err(|_| {
                CoreError::Catalog {
                    user: format!("Fecha inválida: {s}."),
                    detail: format!("fecha inválida: {s:?}"),
                }
            })
        };
        let from = date(from)?;
        let to = match to.filter(|t| !t.trim().is_empty()) {
            Some(t) => date(t)?,
            None => chrono::Local::now().date_naive(),
        };
        if from > to {
            return Err(CoreError::Catalog {
                user: "La fecha «desde» es posterior a «hasta».".into(),
                detail: format!("rango invertido: {from} > {to}"),
            });
        }
        let timeout = self.catalog_timeout().await;
        crate::catalog::cinemeta::browse_released(
            &self.catalog.http,
            kind,
            from,
            to,
            cursor,
            timeout,
        )
        .await
        .map_err(|e| crate::catalog::fetch_error("cargar la lista", &e))
    }

    /// FR-38/39: ficha de película o serie (con episodios).
    pub async fn catalog_meta(&self, kind: MediaKind, id: &str) -> Result<Meta> {
        let timeout = self.catalog_timeout().await;
        self.catalog.meta(kind, id, timeout).await
    }

    /// FR-42: pide streams a todos los addons habilitados; llegan por `CatalogStreams`.
    /// Cambiar de video cancela la consulta anterior. Los seeders reales llegan solos (scrape).
    pub async fn catalog_streams(&self, kind: MediaKind, video_id: &str) -> Result<()> {
        let video = VideoId::parse(video_id)?;
        let cfg = self.config.read().await.clone();
        let addons = self.catalog.enabled_addons(&cfg.catalog);
        if addons.is_empty() {
            return Err(CoreError::Catalog {
                user: "No hay fuentes habilitadas: activá alguna en Fuentes.".into(),
                detail: "sin addons habilitados".into(),
            });
        }
        let ctx = crate::catalog::aggregate::RunCtx {
            http: self.catalog.http.clone(),
            addons,
            video,
            kind,
            audio_order: cfg.catalog.audio_order.clone(),
            exclude_cam: cfg.catalog.exclude_cam,
            default_timeout: Duration::from_millis(cfg.catalog.timeout_ms),
            trackers: cfg.trackers.clone(),
            scrape_timeout: Duration::from_secs(cfg.analyzer.scrape_timeout_secs),
            latest: self.catalog.latest.clone(),
        };
        let events = self.events.clone();
        self.catalog.start_streams(ctx, move |update| {
            events.emit(CoreEvent::CatalogStreams { update });
        });
        Ok(())
    }

    /// Cerrar la ficha / volver a buscar: corta la consulta en curso.
    pub fn catalog_stop_streams(&self) {
        self.catalog.stop_streams();
    }

    /// "Analizar seleccionados" (Q-14, 2026-11-14: el usuario elige qué medir). Los agrega a
    /// *Mis magnets* con su origen y los mide con el archivo correcto (FR-48, FR-50).
    pub async fn catalog_analyze(
        &self,
        kind: MediaKind,
        video_id: &str,
        hashes: Vec<InfoHash>,
    ) -> Result<usize> {
        let added = self.catalog_add(kind, video_id, &hashes).await?;
        self.analyzer
            .enqueue(AnalyzeScope::Selected(added.clone()))
            .await?;
        Ok(added.len())
    }

    /// Candidatos → entradas de la biblioteca con `origin` (spec 09 §8.1). No pasa por el
    /// análisis automático "al pegar": desde el catálogo solo se mide lo que el usuario elige.
    async fn catalog_add(
        &self,
        kind: MediaKind,
        video_id: &str,
        hashes: &[InfoHash],
    ) -> Result<Vec<InfoHash>> {
        let video = VideoId::parse(video_id)?;
        let timeout = self.catalog_timeout().await;
        let meta = self.catalog.meta(kind, video.imdb_id(), timeout).await.ok();
        let trackers = self.config.read().await.trackers.clone();
        let mut library = self.library.lock().await;
        let mut added = Vec::new();
        for hash in hashes {
            let c = self
                .catalog
                .candidate(hash)
                .ok_or_else(|| CoreError::Catalog {
                    user: "Ese torrent ya no está en la lista: actualizá los streams.".into(),
                    detail: format!("candidato {hash} no encontrado"),
                })?;
            let magnet = Magnet {
                info_hash: c.info_hash,
                display_name: Some(c.release_name.clone()),
                trackers: c.trackers.clone(),
            }
            .with_trackers(&trackers);
            library.add_or_touch(&magnet, &magnet.to_uri());
            let origin = CatalogOrigin {
                video_id: video.to_string(),
                imdb_id: video.imdb_id().to_string(),
                title: meta
                    .as_ref()
                    .map_or_else(|| video.imdb_id().to_string(), |m| m.name.clone()),
                year: meta.as_ref().and_then(|m| m.year.clone()),
                season: video.episode().map(|e| e.0),
                episode: video.episode().map(|e| e.1),
                file_idx: c.file_idx,
                addons: c.addons.clone(),
            };
            if let Some(entry) = library.update(hash, |e| {
                e.origin = Some(origin);
                e.video_size = e.video_size.or(c.size_bytes);
            }) {
                self.events.emit(CoreEvent::LibraryEntryUpdated {
                    entry: Box::new(entry.clone()),
                });
            }
            added.push(*hash);
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
    pub async fn catalog_add_addon(&self, url: &str) -> Result<AddonView> {
        let mut cfg = self.config().await;
        let entry = self.catalog.new_addon(url, &cfg.catalog.addons).await?;
        let view = AddonView::from(&entry);
        cfg.catalog.addons.push(entry);
        self.set_config(cfg).await?;
        Ok(view)
    }

    pub async fn catalog_remove_addon(&self, id: &str) -> Result<()> {
        let mut cfg = self.config().await;
        let Some(pos) = cfg.catalog.addons.iter().position(|a| a.id == id) else {
            return Err(CoreError::NotFound(format!("addon {id}")));
        };
        let entry = cfg.catalog.addons.remove(pos);
        self.catalog.forget_addon(&entry);
        self.set_config(cfg).await
    }

    pub async fn catalog_set_addon_enabled(&self, id: &str, enabled: bool) -> Result<()> {
        let mut cfg = self.config().await;
        let entry = cfg
            .catalog
            .addons
            .iter_mut()
            .find(|a| a.id == id)
            .ok_or_else(|| CoreError::NotFound(format!("addon {id}")))?;
        entry.enabled = enabled;
        self.set_config(cfg).await
    }

    /// "Restaurar lista por defecto" (spec 09 §9).
    pub async fn catalog_reset_addons(&self) -> Result<Vec<AddonView>> {
        let mut cfg = self.config().await;
        for entry in &cfg.catalog.addons {
            self.catalog.forget_addon(entry);
        }
        cfg.catalog.addons = crate::config::default_addons();
        self.set_config(cfg).await?;
        Ok(self.catalog_addons().await)
    }

    async fn catalog_timeout(&self) -> Duration {
        Duration::from_millis(self.config.read().await.catalog.timeout_ms)
    }

    // ----- Utilidades (no son comandos de la UI) -----

    /// Guarda la biblioteca ya, sin esperar el debounce (herramientas de línea de comandos).
    pub async fn flush_library(&self) -> Result<()> {
        self.library.lock().await.save_if_dirty().map(drop)
    }
}

/// Agrega magnets a la biblioteca y avisa a la UI. Devuelve cuántos quedaron en "Pegados ahora"
/// por esta operación (nuevos o movidos desde "Anteriores").
async fn add_magnets(
    library: &Mutex<Library>,
    events: &dyn EventSink,
    intake: &Intake,
    magnets: &[(Magnet, String)],
) -> usize {
    let mut library = library.lock().await;
    let mut count = 0;
    let mut fresh = Vec::new();
    for (m, raw) in magnets {
        // `raw` = el magnet tal cual se copió ("Copiar magnet", FR-04).
        match library.add_or_touch(m, raw) {
            AddOutcome::AlreadyPresent => {}
            AddOutcome::Added | AddOutcome::MovedToPastedNow => {
                count += 1;
                if let Some(entry) = library.get(&m.info_hash) {
                    if entry.torrent_name.is_none() || entry.live.is_none() {
                        fresh.push(m.clone());
                    }
                    events.emit(CoreEvent::LibraryEntryUpdated {
                        entry: Box::new(entry.clone()),
                    });
                }
            }
        }
    }
    if !fresh.is_empty() {
        let _ = intake.send(fresh);
    }
    count
}

/// Magnets recién pegados → nombre real + análisis automático (ver [`spawn_intake`]).
type Intake = tokio::sync::mpsc::UnboundedSender<Vec<Magnet>>;

/// Al pegar: 1) metadatos de todos a la vez para mostrar el nombre real en segundos (el `dn` de
/// Torrentio es genérico) y 2) si `analyzer.auto_on_paste`, análisis completo de esos magnets.
/// Agrupa lo que llega en ~400 ms (pegar 5 magnets juntos = una sola tanda).
fn spawn_intake(
    paths: AppPaths,
    config: Arc<tokio::sync::RwLock<Config>>,
    library: Arc<Mutex<Library>>,
    events: Arc<dyn EventSink>,
    analyzer: AnalyzerHandle,
) -> Intake {
    let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<Vec<Magnet>>();
    tokio::spawn(async move {
        while let Some(mut batch) = rx.recv().await {
            tokio::time::sleep(std::time::Duration::from_millis(400)).await;
            while let Ok(more) = rx.try_recv() {
                batch.extend(more);
            }
            batch.dedup_by_key(|m| m.info_hash);
            let cfg = config.read().await.clone();
            let hashes: Vec<InfoHash> = batch.iter().map(|m| m.info_hash).collect();

            // 1. Nombres (en paralelo, sin bloquear la próxima tanda).
            let need_name: Vec<Magnet> = {
                let lib = library.lock().await;
                batch
                    .into_iter()
                    .filter(|m| {
                        lib.get(&m.info_hash)
                            .is_some_and(|e| e.torrent_name.is_none())
                    })
                    .collect()
            };
            if !need_name.is_empty() {
                events.emit(CoreEvent::Status {
                    level: StatusLevel::Info,
                    message: format!("Buscando el nombre de {} magnet(s)…", need_name.len()),
                });
                let (paths, cfg2, library, events) =
                    (paths.clone(), cfg.clone(), library.clone(), events.clone());
                let handle = tokio::runtime::Handle::current();
                tokio::spawn(async move {
                    crate::analyzer::fetch_names(
                        &paths,
                        &cfg2,
                        need_name,
                        move |hash, name, video_size| {
                            let (library, events) = (library.clone(), events.clone());
                            handle.spawn(async move {
                                let mut lib = library.lock().await;
                                if let Some(entry) = lib.update(&hash, |e| {
                                    e.torrent_name = Some(name.clone());
                                    e.video_size = e.video_size.or(video_size);
                                }) {
                                    events.emit(CoreEvent::LibraryEntryUpdated {
                                        entry: Box::new(entry.clone()),
                                    });
                                }
                            });
                        },
                    )
                    .await;
                });
            }

            // 2. Análisis automático (usa el `.torrent` en caché cuando ya llegó).
            if cfg.analyzer.auto_on_paste {
                if let Err(e) = analyzer.enqueue(AnalyzeScope::Pasted(hashes)).await {
                    tracing::warn!("análisis automático al pegar: {e}");
                }
            }
        }
    });
    tx
}

/// Captura en vivo (FR-01): de cada texto copiado se extraen todos los magnets. Si el SO no lo permite,
/// la app sigue (se puede pegar a mano) y queda anotado en el log (NFR-13).
/// "1,2 GB", "350 MB" — para mensajes de la barra de estado.
/// Carpetas de análisis (FR-06d) de estos magnets.
fn analysis_dirs(paths: &AppPaths, hashes: &[InfoHash]) -> HashSet<PathBuf> {
    hashes.iter().map(|h| paths.analysis_dir(h)).collect()
}

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

fn start_clipboard_watch(
    clipboard: &dyn ClipboardSource,
    library: &Arc<Mutex<Library>>,
    events: &Arc<dyn EventSink>,
    intake: &Intake,
) -> Option<WatchGuard> {
    let (tx, mut rx) = tokio::sync::mpsc::channel::<String>(64);
    let guard = match clipboard.watch(tx) {
        Ok(g) => g,
        Err(e) => {
            tracing::warn!("sin captura en vivo del portapapeles: {e}");
            return None;
        }
    };
    let library = library.clone();
    let events = events.clone();
    let intake = intake.clone();
    tokio::spawn(async move {
        while let Some(text) = rx.recv().await {
            let magnets = crate::magnet::extract_all_with_raw(&text);
            if !magnets.is_empty() {
                let n = add_magnets(&library, events.as_ref(), &intake, &magnets).await;
                tracing::debug!(magnets = magnets.len(), nuevos = n, "portapapeles");
            }
        }
    });
    Some(guard)
}

/// Guarda `library.json` como mucho una vez cada 500 ms y solo si cambió (spec 04).
fn spawn_library_saver(library: &Arc<Mutex<Library>>) {
    let library = Arc::downgrade(library);
    tokio::spawn(async move {
        let mut tick = tokio::time::interval(LIBRARY_SAVE_DEBOUNCE);
        loop {
            tick.tick().await;
            let Some(library) = library.upgrade() else {
                return; // la app terminó
            };
            let mut library = library.lock().await;
            if let Err(e) = library.save_if_dirty() {
                tracing::warn!("no se pudo guardar library.json: {e}");
            }
        }
    });
}
