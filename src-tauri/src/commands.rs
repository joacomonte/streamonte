//! Comandos Tauri = traducción 1:1 a `AppCore`. Los errores llegan a la UI como
//! `{ message, detail }`: `message` en lenguaje claro (NFR-12), `detail` para el log.

use std::sync::Arc;

use serde::{Deserialize, Serialize};
use streamonte_core::analyzer::swarm::SwarmCount;
use streamonte_core::analyzer::AnalyzeScope;
use streamonte_core::app::{
    ApiKeyStatus, AppCore, CatalogSubtitles, CopiedMagnet, LibraryView, PremiumPick, PremiumQuota,
    SubtitleFound, SubtitlePicks, TempUsage,
};
use streamonte_core::catalog::cinemeta::{BrowsePage, BrowseSort, Meta, MetaPreview};
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
        // Todo comando que falla queda en el log (antes solo lo veía la UI y el log no tenía rastro).
        tracing::warn!("comando falló: {} · {e}", e.user_message());
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
pub async fn analyzer_cancel(core: Core<'_>, hashes: Vec<InfoHash>) -> CmdResult<()> {
    core.analyzer_cancel(&hashes).await;
    Ok(())
}
#[tauri::command]
pub async fn analyzer_resume(core: Core<'_>) -> CmdResult<()> {
    Ok(core.analyzer_resume().await?)
}
#[tauri::command]
pub async fn copied_magnet(core: Core<'_>) -> CmdResult<Option<CopiedMagnet>> {
    Ok(core.copied_magnet().await)
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
/// Ventana aparte con solo la Actividad (`index.html?logs`); si ya está abierta, la trae al frente. Async: crear
/// una ventana desde un comando síncrono traba el hilo principal en Windows.
#[tauri::command]
pub async fn open_logs_window(app: tauri::AppHandle) -> CmdResult<()> {
    use tauri::Manager;
    if let Some(w) = app.get_webview_window("logs") {
        let _ = w.unminimize();
        let _ = w.set_focus();
        return Ok(());
    }
    tauri::WebviewWindowBuilder::new(
        &app,
        "logs",
        tauri::WebviewUrl::App("index.html?logs".into()),
    )
    .title("Streamonte · Actividad")
    .inner_size(1000.0, 640.0)
    .min_inner_size(520.0, 320.0)
    .build()
    .map(|_| ())
    .map_err(|e| UiError {
        message: "No se pudo abrir la ventana de actividad.".into(),
        detail: e.to_string(),
    })
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
pub async fn players_status(core: Core<'_>) -> CmdResult<streamonte_core::player::PlayersStatus> {
    Ok(core.players_status().await)
}
/// "Instalar mpv" (Ajustes): con Homebrew lo instala; si no, abre la guía. `true` = instalado.
#[tauri::command]
pub async fn install_mpv() -> CmdResult<bool> {
    Ok(streamonte_core::player::install_mpv().await?)
}
#[tauri::command]
pub async fn config_set_language(
    core: Core<'_>,
    language: streamonte_core::config::LanguageConfig,
) -> CmdResult<()> {
    Ok(core.set_language(language).await?)
}
#[tauri::command]
pub async fn config_set_equalizer(
    core: Core<'_>,
    equalizer: streamonte_core::config::Equalizer,
) -> CmdResult<()> {
    Ok(core.set_equalizer(equalizer).await?)
}
#[tauri::command]
pub async fn config_set_network(
    core: Core<'_>,
    incoming: bool,
    upnp: bool,
    announce_early: bool,
) -> CmdResult<()> {
    Ok(core.set_network(incoming, upnp, announce_early).await?)
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
/// Tráiler en YouTube, en el navegador.
#[tauri::command]
pub async fn catalog_open_trailer(core: Core<'_>, youtube_id: String) -> CmdResult<()> {
    let core = core.inner().clone();
    blocking(move || Ok(core.open_trailer(&youtube_id)?)).await
}
/// Ficha de IMDb del título en el navegador.
#[tauri::command]
pub async fn catalog_open_imdb(core: Core<'_>, imdb_id: String) -> CmdResult<()> {
    let core = core.inner().clone();
    blocking(move || Ok(core.open_imdb(&imdb_id)?)).await
}
/// "Contar seeders reales" de opciones del catálogo (se conecta al enjambre): `quick` ≤ 30 s,
/// `deep` ~2 min.
#[tauri::command]
pub async fn catalog_swarm(
    core: Core<'_>,
    hashes: Vec<InfoHash>,
    depth: streamonte_core::analyzer::swarm::Depth,
) -> CmdResult<std::collections::HashMap<InfoHash, SwarmCount>> {
    Ok(core.catalog_swarm(&hashes, depth).await)
}
/// Cuáles de esas opciones están en la caché de TorBox; null = sin key o no respondió.
#[tauri::command]
pub async fn catalog_torbox(
    core: Core<'_>,
    video_id: String,
    hashes: Vec<InfoHash>,
) -> CmdResult<Option<streamonte_core::catalog::torbox::Cached>> {
    Ok(core.catalog_torbox(&video_id, &hashes).await?)
}
/// ▶ desde TorBox: abre el reproductor con su link directo, con el audio y el subtítulo elegidos.
#[tauri::command]
pub async fn play_torbox(
    core: Core<'_>,
    video_id: String,
    hash: InfoHash,
    player: Option<PlayerKind>,
    audio: Option<streamonte_core::audio::AudioPick>,
) -> CmdResult<PlaybackId> {
    Ok(core.play_torbox(&video_id, hash, player, audio).await?)
}
/// Usuario y contraseña de OpenSubtitles.com (vacíos = borrar). Nunca vuelven a la UI.
#[tauri::command]
pub fn opensubtitles_login_set(
    core: Core<'_>,
    username: String,
    password: String,
) -> CmdResult<()> {
    Ok(core.set_opensubtitles_login(&username, &password)?)
}
/// Cambiar el subtítulo de lo que se está viendo (mpv), sin reiniciar.
#[tauri::command]
pub async fn playback_subtitle(
    core: Core<'_>,
    id: PlaybackId,
    key: String,
    path: Option<String>,
) -> CmdResult<()> {
    Ok(core.playback_subtitle(id, &key, path.as_deref()).await?)
}
/// Lee audio y subtítulos de una opción por su link de TorBox (paso previo de Reproducir).
#[tauri::command]
pub async fn catalog_torbox_tracks(
    core: Core<'_>,
    kind: MediaKind,
    video_id: String,
    hash: InfoHash,
) -> CmdResult<()> {
    Ok(core.catalog_torbox_tracks(kind, &video_id, hash).await?)
}
/// Copia subtítulos ya bajados a Descargas y abre la carpeta.
#[tauri::command]
pub fn save_subtitles(
    core: Core<'_>,
    title: String,
    files: Vec<streamonte_core::app::SubtitleSave>,
) -> CmdResult<String> {
    Ok(core.save_subtitles(&title, &files)?.display().to_string())
}
/// Magnet o link https de TorBox de una opción, para copiar (clic derecho).
#[tauri::command]
pub async fn catalog_link(
    core: Core<'_>,
    hash: InfoHash,
    torbox: bool,
    orig: Option<String>,
    latino: bool,
) -> CmdResult<String> {
    Ok(core.catalog_link(hash, torbox, orig, latino).await?)
}
/// Tests de conexión de la última hora (datos guardados).
#[tauri::command]
pub fn catalog_swarm_saved(
    core: Core<'_>,
    hashes: Vec<InfoHash>,
) -> CmdResult<std::collections::HashMap<InfoHash, streamonte_core::app::SavedTest>> {
    Ok(core.catalog_swarm_saved(&hashes))
}
/// Espacio libre del disco de descargas, en bytes (null si no se pudo leer).
#[tauri::command]
pub fn downloads_free_bytes(core: Core<'_>) -> CmdResult<Option<u64>> {
    Ok(core.downloads_free_bytes())
}
/// Censo DHT sin conectarse (~12 s): direcciones únicas por hash; falta = 0.
#[tauri::command]
pub async fn catalog_census(
    core: Core<'_>,
    hashes: Vec<InfoHash>,
) -> CmdResult<std::collections::HashMap<InfoHash, u32>> {
    Ok(core.catalog_census(&hashes).await)
}
/// Subtítulos del video del catálogo (hasta 5 de las fuentes gratis; el idioma elegido primero)
/// con lo elegido y lo probado para ese video.
#[tauri::command]
pub async fn catalog_subtitles(
    core: Core<'_>,
    video_id: String,
    hash: InfoHash,
    language: SubtitleLanguage,
) -> CmdResult<CatalogSubtitles> {
    Ok(core.catalog_subtitles(&video_id, &hash, language).await?)
}
/// "Usar" un subtítulo del dropdown: queda elegido para ese video.
#[tauri::command]
pub async fn catalog_subtitle_use(
    core: Core<'_>,
    video_id: String,
    hash: InfoHash,
    key: String,
) -> CmdResult<SubtitlePicks> {
    Ok(core.catalog_subtitle_use(&video_id, &hash, &key).await?)
}
/// Cuota de Premium (OpenSubtitles.com) sin pedir nada.
#[tauri::command]
pub async fn premium_quota(core: Core<'_>) -> CmdResult<PremiumQuota> {
    Ok(core.premium_quota().await)
}
/// Busca en Premium (no gasta cuota).
#[tauri::command]
pub async fn catalog_premium_search(
    core: Core<'_>,
    video_id: String,
    hash: InfoHash,
) -> CmdResult<Vec<SubtitleFound>> {
    Ok(core.catalog_premium_search(&video_id, &hash).await?)
}
/// Baja UN Premium elegido (gasta 1) y lo deja elegido para el reproductor.
#[tauri::command]
pub async fn catalog_premium_use(
    core: Core<'_>,
    video_id: String,
    hash: InfoHash,
    pick: PremiumPick,
) -> CmdResult<CatalogSubtitles> {
    Ok(core.catalog_premium_use(&video_id, &hash, pick).await?)
}
/// Póster de TMDB para un título sin imagen en Cinemeta (`null` sin key o si no lo tiene).
#[tauri::command]
pub async fn catalog_poster(core: Core<'_>, imdb_id: String) -> CmdResult<Option<String>> {
    Ok(core.catalog_poster(&imdb_id).await)
}

// ----- Catálogo y addons (F4b, spec 09) -----
#[tauri::command]
pub async fn catalog_search(core: Core<'_>, query: String) -> CmdResult<Vec<MetaPreview>> {
    Ok(core.catalog_search(&query).await?)
}
/// Actores y directores para las sugerencias del buscador.
#[tauri::command]
pub async fn catalog_people(
    core: Core<'_>,
    query: String,
) -> CmdResult<Vec<streamonte_core::catalog::people::Person>> {
    Ok(core.catalog_people(&query).await?)
}
/// Lo que actuó (`cast`) o dirigió (`director`) una persona.
#[tauri::command]
pub async fn catalog_person_titles(
    core: Core<'_>,
    id: u64,
    role: streamonte_core::catalog::people::Role,
) -> CmdResult<Vec<MetaPreview>> {
    Ok(core.catalog_person_titles(id, role).await?)
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
pub fn catalog_stop_swarm(core: Core<'_>) {
    core.catalog_stop_swarm();
}
#[tauri::command]
pub async fn speed_test(
    core: Core<'_>,
    force: bool,
) -> CmdResult<streamonte_core::speedtest::SpeedResult> {
    Ok(core.speed_test(force).await?)
}
#[tauri::command]
pub fn data_cache_size(core: Core<'_>) -> u64 {
    core.data_cache_size()
}
#[tauri::command]
pub fn clear_data_cache(core: Core<'_>) -> CmdResult<u64> {
    Ok(core.clear_data_cache()?)
}
#[tauri::command]
pub async fn catalog_details(
    core: Core<'_>,
    kind: MediaKind,
    imdb_id: String,
) -> CmdResult<streamonte_core::catalog::tmdb::DetailsView> {
    Ok(core.catalog_details(kind, &imdb_id).await)
}
#[tauri::command]
pub async fn catalog_similar(
    core: Core<'_>,
    kind: MediaKind,
    imdb_id: String,
) -> CmdResult<Vec<streamonte_core::catalog::tmdb::Similar>> {
    Ok(core.catalog_similar(kind, &imdb_id).await)
}
#[tauri::command]
pub async fn catalog_season_ratings(
    core: Core<'_>,
    imdb_id: String,
    quick: bool,
) -> CmdResult<streamonte_core::catalog::seasons::SeasonRatings> {
    Ok(core.catalog_season_ratings(&imdb_id, quick).await?)
}
#[tauri::command]
pub async fn catalog_trending(core: Core<'_>, kind: MediaKind, skip: u32) -> CmdResult<BrowsePage> {
    Ok(core.catalog_trending(kind, skip).await?)
}
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn catalog_browse_top(
    core: Core<'_>,
    kind: MediaKind,
    sort: BrowseSort,
    from: String,
    to: Option<String>,
    min_votes: u32,
    languages: Vec<String>,
) -> CmdResult<BrowsePage> {
    Ok(core
        .catalog_browse_top(kind, sort, &from, to.as_deref(), min_votes, languages)
        .await?)
}
/// Explorar con un género elegido: búsqueda por subgéneros de IMDb.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn catalog_browse_interests(
    core: Core<'_>,
    kind: MediaKind,
    sort: BrowseSort,
    from: String,
    to: Option<String>,
    min_votes: u32,
    languages: Vec<String>,
    interests: Vec<String>,
) -> CmdResult<BrowsePage> {
    Ok(core
        .catalog_browse_interests(
            kind,
            sort,
            &from,
            to.as_deref(),
            min_votes,
            languages,
            interests,
        )
        .await?)
}
/// Ejemplos populares de cada subgénero de IMDb (tarjetas del filtro de géneros).
#[tauri::command]
pub async fn catalog_interest_examples(
    core: Core<'_>,
    kind: MediaKind,
    ids: Vec<String>,
) -> CmdResult<std::collections::HashMap<String, Vec<streamonte_core::catalog::interests::Example>>>
{
    Ok(core.catalog_interest_examples(kind, ids).await?)
}
/// Títulos y sinopsis de los episodios de una temporada en los idiomas elegidos.
#[tauri::command]
pub async fn catalog_episodes(
    core: Core<'_>,
    imdb_id: String,
    season: u32,
) -> CmdResult<Vec<streamonte_core::catalog::tmdb::EpisodeText>> {
    Ok(core.catalog_episodes(&imdb_id, season).await)
}
/// "Pegar magnet" con TorBox: estado en TorBox, sus videos y (con `who`) qué película o serie es.
#[derive(Serialize)]
pub struct TorboxMagnetView {
    status: streamonte_core::catalog::torbox::MagnetStatus,
    ident: Option<streamonte_core::catalog::tmdb::Identified>,
}
#[tauri::command]
pub async fn torbox_magnet(
    core: Core<'_>,
    hash: InfoHash,
    name: String,
    who: bool,
) -> CmdResult<TorboxMagnetView> {
    let (status, ident) = core.torbox_magnet(hash, &name, who).await?;
    Ok(TorboxMagnetView { status, ident })
}
/// "Bajarlo en TorBox": lo agrega aunque no esté en caché; devuelve el estado nuevo.
#[tauri::command]
pub async fn torbox_magnet_download(
    core: Core<'_>,
    hash: InfoHash,
    name: String,
) -> CmdResult<streamonte_core::catalog::torbox::MagnetStatus> {
    Ok(core.torbox_magnet_download(hash, &name).await?)
}
