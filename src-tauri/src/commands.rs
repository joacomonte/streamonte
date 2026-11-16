//! Comandos Tauri = traducción 1:1 a `AppCore`. Los errores llegan a la UI como
//! `{ message, detail }`: `message` en lenguaje claro (NFR-12), `detail` para el log.

use std::sync::Arc;

use serde::{Deserialize, Serialize};
use streamonte_core::analyzer::swarm::SwarmCount;
use streamonte_core::analyzer::AnalyzeScope;
use streamonte_core::app::{
    ApiKeyStatus, AppCore, ClipboardPreview, LibraryView, SubtitleFound, TempUsage,
};
use streamonte_core::catalog::cinemeta::{
    BrowseCursor, BrowsePage, BrowseSort, Meta, SearchResults,
};
use streamonte_core::catalog::{AddonView, MediaKind};
use streamonte_core::cleanup::CleanupReport;
use streamonte_core::config::{Config, PlayerKind, SubtitleLanguage};
use streamonte_core::library::LibraryRowView;
use streamonte_core::magnet::InfoHash;
use streamonte_core::playback::{
    OnAppClose, PlaybackAction, PlaybackId, PlaybackRow, StartRequest,
};
use streamonte_core::video_key::VideoKey;
use streamonte_core::CoreError;
use tauri::State;

type Core<'a> = State<'a, Arc<AppCore>>;
type CmdResult<T> = Result<T, UiError>;

#[derive(Debug, Serialize)]
pub struct UiError {
    message: String,
    detail: String,
}

impl From<CoreError> for UiError {
    fn from(e: CoreError) -> Self {
        Self {
            message: e.user_message(),
            detail: e.to_string(),
        }
    }
}

// ----- Biblioteca -----
#[tauri::command]
pub async fn library_get(core: Core<'_>) -> CmdResult<LibraryView> {
    Ok(core.library().await)
}
/// `key`: la fila (un video; ver `VideoKey`), no el torrent.
#[tauri::command]
pub async fn library_remove(core: Core<'_>, key: VideoKey) -> CmdResult<()> {
    Ok(core.remove(key).await?)
}

// ----- Análisis -----
#[derive(Debug, Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum ScopeArg {
    All,
    OnlyUnmeasured,
    One {
        hash: InfoHash,
    },
    /// Los marcados en la lista.
    Selected {
        hashes: Vec<InfoHash>,
    },
    /// "Análisis rápido" de una fila: sin medir velocidad.
    Quick {
        hash: InfoHash,
    },
}

#[tauri::command]
pub async fn analyze(core: Core<'_>, scope: ScopeArg) -> CmdResult<()> {
    let scope = match scope {
        ScopeArg::All => AnalyzeScope::All,
        ScopeArg::OnlyUnmeasured => AnalyzeScope::OnlyUnmeasured,
        ScopeArg::One { hash } => AnalyzeScope::One(hash),
        ScopeArg::Selected { hashes } => AnalyzeScope::Selected(hashes),
        ScopeArg::Quick { hash } => AnalyzeScope::QuickOnly(hash),
    };
    Ok(core.analyze(scope).await?)
}
#[tauri::command]
pub async fn analyzer_pause(core: Core<'_>) -> CmdResult<()> {
    Ok(core.analyzer_pause().await?)
}
#[tauri::command]
pub async fn analyzer_resume(core: Core<'_>) -> CmdResult<()> {
    Ok(core.analyzer_resume().await?)
}
#[tauri::command]
pub async fn clipboard_preview(core: Core<'_>) -> CmdResult<ClipboardPreview> {
    Ok(core.clipboard_preview().await?)
}
#[tauri::command]
pub async fn library_add_selected(core: Core<'_>, raws: Vec<String>) -> CmdResult<usize> {
    Ok(core.add_selected_magnets(raws).await?)
}

// ----- Reproducción -----
#[tauri::command]
pub async fn play(
    core: Core<'_>,
    key: VideoKey,
    player: Option<PlayerKind>,
    file_index: Option<usize>,
    audio: Option<streamonte_core::audio::AudioPick>,
    background: Option<bool>,
) -> CmdResult<PlaybackId> {
    Ok(core
        .play(StartRequest {
            key,
            magnet: None,
            player,
            file_index,
            audio,
            background: background.unwrap_or(false),
        })
        .await?)
}
#[tauri::command]
pub async fn playback_action(
    core: Core<'_>,
    id: PlaybackId,
    action: PlaybackAction,
) -> CmdResult<()> {
    Ok(core.playback_action(id, action).await?)
}
#[tauri::command]
pub fn playbacks_get(core: Core<'_>) -> Vec<PlaybackRow> {
    core.playbacks()
}
#[tauri::command]
pub fn playback_log(core: Core<'_>, id: PlaybackId) -> Vec<String> {
    core.playback_log(id)
}
#[tauri::command]
pub async fn stop_all_and_clean(core: Core<'_>) -> CmdResult<CleanupReport> {
    Ok(core.stop_all_and_clean().await?)
}
#[tauri::command]
/// Respuesta al diálogo de cierre (FR-17): aplica la elección, limpia y cierra la app.
pub async fn on_close(app: tauri::AppHandle, core: Core<'_>, choice: OnAppClose) -> CmdResult<()> {
    let result = core.on_close(choice).await;
    if let Err(e) = &result {
        tracing::warn!("al cerrar: {e}");
    }
    crate::CLOSING.store(true, std::sync::atomic::Ordering::SeqCst);
    app.exit(0);
    Ok(result?)
}

// ----- Limpieza -----
// Los comandos `fn` (sin async) corren en el hilo principal de Tauri y congelan la ventana:
// lo que toca disco, el almacén seguro o lanza procesos va a un hilo bloqueante.
async fn blocking<T: Send + 'static>(
    f: impl FnOnce() -> CmdResult<T> + Send + 'static,
) -> CmdResult<T> {
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|e| UiError {
            message: "Error interno.".into(),
            detail: e.to_string(),
        })?
}

#[tauri::command]
pub async fn temp_usage(core: Core<'_>) -> CmdResult<TempUsage> {
    let core = core.inner().clone();
    blocking(move || Ok(core.temp_usage()?)).await
}
#[tauri::command]
pub async fn clean_temp(core: Core<'_>) -> CmdResult<CleanupReport> {
    let core = core.inner().clone();
    blocking(move || Ok(core.clean_temp()?)).await
}
#[tauri::command]
pub async fn check_incoming(core: Core<'_>) -> CmdResult<streamonte_core::incoming::IncomingCheck> {
    Ok(core.check_incoming().await)
}
#[tauri::command]
pub async fn logs_tail(core: Core<'_>, max: usize) -> CmdResult<Vec<String>> {
    let core = core.inner().clone();
    blocking(move || Ok(core.logs_tail(max)?)).await
}
#[tauri::command]
pub async fn export_logs(core: Core<'_>, friendly: String) -> CmdResult<String> {
    let core = core.inner().clone();
    blocking(move || Ok(core.export_logs(&friendly)?.display().to_string())).await
}
#[tauri::command]
pub async fn open_downloads_folder(core: Core<'_>) -> CmdResult<()> {
    let core = core.inner().clone();
    blocking(move || Ok(core.open_downloads_folder()?)).await
}

// ----- Configuración -----
#[tauri::command]
pub async fn config_get(core: Core<'_>) -> CmdResult<Config> {
    Ok(core.config().await)
}
/// Ajustes → Red. Un comando por ajuste: la UI nunca reescribe la config entera (no pisa lo
/// que cambió otro mientras tanto).
#[tauri::command]
pub async fn config_set_network(core: Core<'_>, incoming: bool, upnp: bool) -> CmdResult<()> {
    Ok(core.set_network(incoming, upnp).await?)
}

// ----- Subtítulos -----
/// `provider`: "opensubtitles" | "wyzie". `key` vacía = borrarla. Va al almacén seguro (NFR-16).
/// API keys de servicios (subtítulos y pósters de TMDB): al almacén seguro, nunca de vuelta.
#[tauri::command]
pub async fn api_key_set(core: Core<'_>, service: String, key: String) -> CmdResult<()> {
    let core = core.inner().clone();
    blocking(move || Ok(core.set_api_key(&service, &key)?)).await
}
#[tauri::command]
pub async fn api_keys(core: Core<'_>) -> CmdResult<Vec<ApiKeyStatus>> {
    let core = core.inner().clone();
    blocking(move || Ok(core.api_keys())).await
}

/// Abre en el navegador del sistema la página para pedir la key de un proveedor.
#[tauri::command]
pub async fn open_key_page(core: Core<'_>, service: String) -> CmdResult<()> {
    let core = core.inner().clone();
    blocking(move || Ok(core.open_key_page(&service)?)).await
}
/// Ficha de IMDb del título en el navegador.
#[tauri::command]
pub async fn catalog_open_imdb(core: Core<'_>, imdb_id: String) -> CmdResult<()> {
    let core = core.inner().clone();
    blocking(move || Ok(core.open_imdb(&imdb_id)?)).await
}
/// "Contar seeders reales" de opciones del catálogo (se conecta al enjambre; ~50 s por tanda).
#[tauri::command]
pub async fn catalog_swarm(
    core: Core<'_>,
    hashes: Vec<InfoHash>,
    deep: bool,
) -> CmdResult<std::collections::HashMap<InfoHash, SwarmCount>> {
    Ok(core.catalog_swarm(&hashes, deep).await)
}
/// "Bajar subtítulos" de una opción del catálogo (hasta 5; el idioma elegido primero).
#[tauri::command]
pub async fn catalog_subtitles(
    core: Core<'_>,
    video_id: String,
    hash: InfoHash,
    language: SubtitleLanguage,
) -> CmdResult<Vec<SubtitleFound>> {
    Ok(core.catalog_subtitles(&video_id, &hash, language).await?)
}
/// Póster de TMDB para un título sin imagen en Cinemeta (`null` sin key o si no lo tiene).
#[tauri::command]
pub async fn catalog_poster(core: Core<'_>, imdb_id: String) -> CmdResult<Option<String>> {
    Ok(core.catalog_poster(&imdb_id).await)
}

// ----- Catálogo y addons (F4b, spec 09) -----
#[tauri::command]
pub async fn catalog_search(core: Core<'_>, query: String) -> CmdResult<SearchResults> {
    Ok(core.catalog_search(&query).await?)
}
#[tauri::command]
pub async fn catalog_meta(core: Core<'_>, kind: MediaKind, id: String) -> CmdResult<Meta> {
    Ok(core.catalog_meta(kind, &id).await?)
}
#[tauri::command]
pub async fn catalog_streams(core: Core<'_>, kind: MediaKind, video_id: String) -> CmdResult<()> {
    Ok(core.catalog_streams(kind, &video_id).await?)
}
#[tauri::command]
pub fn catalog_stop_streams(core: Core<'_>) {
    core.catalog_stop_streams();
}
#[tauri::command]
pub async fn catalog_add(
    core: Core<'_>,
    kind: MediaKind,
    video_id: String,
    hashes: Vec<InfoHash>,
) -> CmdResult<Vec<LibraryRowView>> {
    Ok(core.catalog_add(kind, &video_id, &hashes).await?)
}
#[tauri::command]
pub async fn catalog_addons(core: Core<'_>) -> CmdResult<Vec<AddonView>> {
    Ok(core.catalog_addons().await)
}
#[tauri::command]
pub async fn catalog_add_addon(core: Core<'_>, url: String) -> CmdResult<AddonView> {
    Ok(core.catalog_add_addon(&url).await?)
}
#[tauri::command]
pub async fn catalog_remove_addon(core: Core<'_>, id: String) -> CmdResult<()> {
    Ok(core.catalog_remove_addon(&id).await?)
}
#[tauri::command]
pub async fn catalog_set_addon_enabled(core: Core<'_>, id: String, enabled: bool) -> CmdResult<()> {
    Ok(core.catalog_set_addon_enabled(&id, enabled).await?)
}
#[tauri::command]
pub async fn catalog_reset_addons(core: Core<'_>) -> CmdResult<Vec<AddonView>> {
    Ok(core.catalog_reset_addons().await?)
}
#[tauri::command]
pub async fn catalog_set_exclude_japanese(core: Core<'_>, exclude: bool) -> CmdResult<()> {
    Ok(core.catalog_set_exclude_japanese(exclude).await?)
}
#[tauri::command]
pub async fn catalog_browse(
    core: Core<'_>,
    kind: MediaKind,
    sort: BrowseSort,
    year: Option<u16>,
    genre: Option<String>,
    skip: u32,
) -> CmdResult<BrowsePage> {
    Ok(core
        .catalog_browse(kind, sort, year, genre.as_deref(), skip)
        .await?)
}
#[tauri::command]
pub async fn catalog_browse_released(
    core: Core<'_>,
    kind: MediaKind,
    from: String,
    to: Option<String>,
    genre: Option<String>,
    cursor: Option<BrowseCursor>,
) -> CmdResult<BrowsePage> {
    Ok(core
        .catalog_browse_released(kind, &from, to.as_deref(), genre.as_deref(), cursor)
        .await?)
}
#[tauri::command]
pub async fn catalog_browse_top(
    core: Core<'_>,
    from: String,
    to: Option<String>,
    min_votes: u32,
    languages: Vec<String>,
    genre: Option<String>,
) -> CmdResult<BrowsePage> {
    Ok(core
        .catalog_browse_top(&from, to.as_deref(), min_votes, languages, genre.as_deref())
        .await?)
}
