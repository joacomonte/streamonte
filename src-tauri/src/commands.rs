//! Comandos Tauri = traducción 1:1 a `AppCore`. Los errores llegan a la UI como
//! `{ message, detail }`: `message` en lenguaje claro (NFR-12), `detail` para el log.

use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tauri::State;
use tstream_core::analyzer::AnalyzeScope;
use tstream_core::app::{
    AppCore, ClipboardPreview, ClipboardReadReport, LibraryView, SubtitleKeyStatus, TempUsage,
};
use tstream_core::catalog::cinemeta::{BrowseCursor, BrowsePage, BrowseSort, Meta, SearchResults};
use tstream_core::catalog::{AddonView, MediaKind};
use tstream_core::cleanup::CleanupReport;
use tstream_core::config::{Config, PlayerKind};
use tstream_core::magnet::InfoHash;
use tstream_core::playback::{OnAppClose, PlaybackAction, PlaybackId, PlaybackRow, StartRequest};
use tstream_core::CoreError;

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
#[tauri::command]
pub async fn library_read_clipboard(core: Core<'_>) -> CmdResult<ClipboardReadReport> {
    Ok(core.read_clipboard().await?)
}
#[tauri::command]
pub async fn library_add_text(core: Core<'_>, text: String) -> CmdResult<usize> {
    Ok(core.add_from_text(&text).await?)
}
#[tauri::command]
pub async fn library_remove(core: Core<'_>, hash: InfoHash) -> CmdResult<()> {
    Ok(core.remove(hash).await?)
}
#[tauri::command]
pub async fn library_clear(core: Core<'_>) -> CmdResult<()> {
    Ok(core.clear_library().await?)
}
#[tauri::command]
pub async fn library_magnet(core: Core<'_>, hash: InfoHash) -> CmdResult<String> {
    Ok(core.magnet_of(hash).await?)
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
pub async fn analyzer_pause_one(core: Core<'_>, hash: InfoHash) -> CmdResult<()> {
    Ok(core.analyzer_pause_one(hash).await?)
}
#[tauri::command]
pub async fn analyzer_resume_one(core: Core<'_>, hash: InfoHash) -> CmdResult<()> {
    Ok(core.analyzer_resume_one(hash).await?)
}
#[tauri::command]
pub async fn analyzer_restart(core: Core<'_>, hash: InfoHash, quick: bool) -> CmdResult<()> {
    Ok(core.analyzer_restart(hash, quick).await?)
}
#[tauri::command]
pub async fn clipboard_preview(core: Core<'_>) -> CmdResult<ClipboardPreview> {
    Ok(core.clipboard_preview().await?)
}
#[tauri::command]
pub async fn library_add_selected(core: Core<'_>, raws: Vec<String>) -> CmdResult<usize> {
    Ok(core.add_selected_magnets(raws).await?)
}
#[tauri::command]
pub async fn analyzer_finish(core: Core<'_>) -> CmdResult<()> {
    Ok(core.analyzer_finish().await?)
}

// ----- Reproducción -----
#[tauri::command]
pub async fn play(
    core: Core<'_>,
    hash: InfoHash,
    player: Option<PlayerKind>,
    file_index: Option<usize>,
    audio: Option<tstream_core::audio::AudioPick>,
) -> CmdResult<PlaybackId> {
    Ok(core
        .play(StartRequest {
            info_hash: hash,
            magnet: None,
            player,
            file_index,
            audio,
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
pub fn active_playbacks(core: Core<'_>) -> usize {
    core.active_playbacks()
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
#[tauri::command]
pub fn temp_usage(core: Core<'_>) -> CmdResult<TempUsage> {
    Ok(core.temp_usage()?)
}
#[tauri::command]
pub fn clean_temp(core: Core<'_>) -> CmdResult<CleanupReport> {
    Ok(core.clean_temp()?)
}
#[tauri::command]
pub fn open_downloads_folder(core: Core<'_>) -> CmdResult<()> {
    Ok(core.open_downloads_folder()?)
}

// ----- Configuración -----
#[tauri::command]
pub async fn config_get(core: Core<'_>) -> CmdResult<Config> {
    Ok(core.config().await)
}
#[tauri::command]
pub async fn config_set(core: Core<'_>, config: Config) -> CmdResult<()> {
    Ok(core.set_config(config).await?)
}

// ----- Subtítulos -----
/// `provider`: "opensubtitles" | "wyzie". `key` vacía = borrarla. Va al almacén seguro (NFR-16).
#[tauri::command]
pub fn subtitles_set_api_key(core: Core<'_>, provider: String, key: String) -> CmdResult<()> {
    Ok(core.subtitles_set_api_key(&provider, &key)?)
}
#[tauri::command]
pub fn subtitles_api_keys(core: Core<'_>) -> Vec<SubtitleKeyStatus> {
    core.subtitles_api_keys()
}

/// Abre en el navegador del sistema la página para pedir la key de un proveedor.
/// Solo estas URLs fijas: la UI no puede abrir direcciones arbitrarias (NFR-16).
#[tauri::command]
pub fn open_key_page(provider: String) -> CmdResult<()> {
    let url = match provider.as_str() {
        "wyzie" => "https://sub.wyzie.io/redeem",
        "opensubtitles" => "https://www.opensubtitles.com/consumers",
        _ => return Err(CoreError::NotFound(format!("proveedor {provider}")).into()),
    };
    #[cfg(windows)]
    let program = "explorer";
    #[cfg(target_os = "macos")]
    let program = "open";
    #[cfg(all(not(windows), not(target_os = "macos")))]
    let program = "xdg-open";
    std::process::Command::new(program)
        .arg(url)
        .spawn()
        .map(drop)
        .map_err(|_| UiError::from(CoreError::Unsupported("abrir el navegador")))
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
pub async fn catalog_analyze(
    core: Core<'_>,
    kind: MediaKind,
    video_id: String,
    hashes: Vec<InfoHash>,
) -> CmdResult<usize> {
    Ok(core.catalog_analyze(kind, &video_id, hashes).await?)
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
pub async fn catalog_browse(
    core: Core<'_>,
    kind: MediaKind,
    sort: BrowseSort,
    year: Option<u16>,
    skip: u32,
) -> CmdResult<BrowsePage> {
    Ok(core.catalog_browse(kind, sort, year, skip).await?)
}
#[tauri::command]
pub async fn catalog_browse_released(
    core: Core<'_>,
    kind: MediaKind,
    from: String,
    to: Option<String>,
    cursor: Option<BrowseCursor>,
) -> CmdResult<BrowsePage> {
    Ok(core
        .catalog_browse_released(kind, &from, to.as_deref(), cursor)
        .await?)
}
