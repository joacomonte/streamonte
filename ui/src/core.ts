// Única puerta de la UI al núcleo (NFR-01): una función por comando de `src-tauri/src/commands.rs` (`fooBar` ↔ `foo_bar`).
// La UI nunca sabe qué motor corre ni dónde están los archivos. `window.__TAURI__` se lee en cada llamada (no al cargar):
// el mock del navegador (`mock-tauri.ts`) y los tests lo instalan antes de la primera llamada, no antes del import.
import type {
  AddonView, AnalyzeScope, ApiKeyStatus, BrowsePage, CatalogItem, CatalogSubtitles, CleanupReport, Config, CopiedMagnet, CoreEvent,
  DetailsView, EpisodeText, Equalizer, IncomingCheck, InfoHash, InterestExample, LanguageConfig, LibraryRow, LibraryView, MagnetStatus,
  MediaKind, Meta, PlaybackAction, PlaybackId, PlaybackRow, PlayerKind, PlayersStatus, PremiumPick, PremiumQuota, SavedTest, SearchPerson,
  SeasonRatings, Similar, SpeedResult, SubtitleFound, SubtitleLanguage, SubtitlePicks, SwarmCount, TempUsage, TitleAwards, EpisodeScore, TorboxCached,
  TorboxMagnetView, VideoKey, NickAsk, NickEnter, NickStatus, VistosSeen, NewsListRaw,
} from './types.ts';

const invoke = <T>(cmd: string, args?: Record<string, unknown>): Promise<T> => window.__TAURI__.core.invoke<T>(cmd, args);

/** Ficha y detalles de un título: el panel (`catalog-side.js`) y la ficha compartida (`TitleView`, por `tauriApi.ts`) los piden
 *  a la vez al abrirlo; una sola invocación por título (la misma promesa hasta 10 s después de responder). */
const recent = new Map<string, { p: Promise<unknown>; at: number }>();
function once<T>(cmd: string, args: Record<string, unknown>): Promise<T> {
  const key = `${cmd}|${JSON.stringify(args)}`;
  const hit = recent.get(key);
  if (hit && Date.now() - hit.at < 10_000) return hit.p as Promise<T>;
  const p = invoke<T>(cmd, args);
  const entry = { p, at: Infinity };
  recent.set(key, entry);
  p.then(() => { entry.at = Date.now(); }, () => recent.delete(key));
  return p;
}
/** Key de TMDB nueva: la ficha cambia; lo llama `catalog.js` antes de volver a pedirla. */
export const forgetTitles = (): void => recent.clear();

// Biblioteca (FR-01–04)
export const library = () => invoke<LibraryView>('library_get');

// Análisis (FR-05–08)
export const analyze = (scope: AnalyzeScope) => invoke<void>('analyze', { scope });
export const analyzerPause = () => invoke<void>('analyzer_pause');
export const analyzerResume = () => invoke<void>('analyzer_resume');
export const analyzerCancel = (hashes: InfoHash[]) => invoke<void>('analyzer_cancel', { hashes });
/** Lo último copiado si es un magnet: {raw, info_hash, name} o null. */
export const copiedMagnet = () => invoke<CopiedMagnet|null>('copied_magnet');
export const remove = (key: VideoKey) => invoke<void>('library_remove', { key });
/** Agrega solo los magnets elegidos (texto original de cada uno). Devuelve cuántos. */
export const addSelected = (raws: string[]) => invoke<number>('library_add_selected', { raws });

// Reproducción (FR-09–17)
/** `audio`: audio elegido (inglés / latino…). */
export const play = (key: VideoKey, player: PlayerKind|null = null, fileIndex: number|null = null, audio: {code:string, aid:number|null}|null = null) => invoke<PlaybackId>('play', { key, player, fileIndex, audio });
/** "Cargar en background" (catálogo): baja de fondo sin reproductor; Reproducir después la retoma. */
export const playBackground = (key: VideoKey) => invoke<PlaybackId>('play', { key, background: true });
export const playbackAction = (id: PlaybackId, action: PlaybackAction) => invoke<void>('playback_action', { id, action });
export const playbacks = () => invoke<PlaybackRow[]>('playbacks_get');
export const playbackLog = (id: PlaybackId) => invoke<string[]>('playback_log', { id });
export const stopAllAndClean = () => invoke<CleanupReport>('stop_all_and_clean');
export const onClose = (choice: 'stop-all'|'leave-running') => invoke<void>('on_close', { choice });

// API keys de servicios en el almacén seguro del sistema (NFR-16). Nunca se leen de vuelta.
/** `service`: 'opensubtitles' | 'wyzie' | 'tmdb' | 'torbox' | 'latteam'. `key`: vacía = borrar. */
export const setApiKey = (service: string, key: string) => invoke<void>('api_key_set', { service, key });
/** Código de 3 dígitos de la web, al almacén seguro (vacío = borrar). */
export const webCodeSet = (code: string) => invoke<void>('web_code_set', { code });
/** Código cargado y apodo de la sesión (nunca el código ni la cookie). */
export const nickStatus = () => invoke<NickStatus>('nick_status');
export const nickAsk = (nick: string) => invoke<NickAsk>('nick_ask', { nick });
export const nickEnter = (nick: string, code: string[], mode: 'nuevo' | 'login') => invoke<NickEnter>('nick_enter', { nick, code, mode });
export const nickLogout = () => invoke<void>('nick_logout');
/** Los 2 animales (ids) de la sesión; null si todavía no se guardaron. */
export const nickAnimals = () => invoke<string[] | null>('nick_animals');
/** "Novedades" (vacía sin sesión de apodo). */
export const newsList = () => invoke<NewsListRaw>('news_list');
/** Recalcular Novedades en la web (tarda: no esperarlo). */
export const newsRefresh = () => invoke<void>('news_refresh');
/** Abrió el diálogo de Novedades. */
export const newsMarkSeen = () => invoke<void>('news_mark_seen');
/** "Vistos recientemente" del apodo (vacío sin sesión). */
export const vistosList = () => invoke<VistosSeen[]>('vistos_list');
/** Lo reprodujo ahora (sin sesión no hace nada). */
export const vistosMark = (item: VistosSeen) => invoke<void>('vistos_mark', { item });
export const vistosRestore = (item: VistosSeen) => invoke<void>('vistos_restore', { item });
export const vistosDismiss = (kind: VistosSeen['kind'], imdb: string, how: 'visto' | 'olvidar') => invoke<void>('vistos_dismiss', { kind, imdb, how });
export const apiKeys = () => invoke<ApiKeyStatus[]>('api_keys');
/** Abre en el navegador la página para pedir la key. */
export const openKeyPage = (service: string) => invoke<void>('open_key_page', { service });
/** Póster de TMDB para un título sin imagen en Cinemeta (null sin key o si no lo tiene). */
export const catalogPoster = (imdbId: string) => invoke<string|null>('catalog_poster', { imdbId });
/** Hashes que están en la caché de TorBox; null = sin key o no respondió. */
export const catalogTorbox = (videoId: string, hashes: InfoHash[]) => invoke<TorboxCached|null>('catalog_torbox', { videoId, hashes });
/** Ver por TorBox (link directo, sin P2P): una reproducción en curso más (fila, Detener, cambiar subtítulo). Devuelve su id. */
export const playTorbox = (videoId: string, hash: InfoHash, player: PlayerKind|null, audio: {code:string, aid:number|null}|null) => invoke<PlaybackId>('play_torbox', { videoId, hash, player, audio });
/** Lee audio y subtítulos de esa opción por su link de TorBox (quedan en su fila, como los del análisis). */
export const catalogTorboxTracks = (kind: MediaKind, videoId: string, hash: InfoHash) => invoke<void>('catalog_torbox_tracks', { kind, videoId, hash });
/** Cambia el subtítulo de lo que se está viendo (mpv) sin reiniciar: `key` de la fila; `path` si es un archivo. */
export const playbackSubtitle = (id: PlaybackId, key: string, path: string|null) => invoke<void>('playback_subtitle', { id, key, path });
/** Usuario y contraseña de OpenSubtitles.com (vacíos = borrar). Van al almacén seguro; nunca vuelven. */
export const setOpensubtitlesLogin = (username: string, password: string) => invoke<void>('opensubtitles_login_set', { username, password });
/** "Contar seeders reales": se conecta a cada enjambre (~50 s por tanda). {hash: {seeds, peers}}; falta = no se pudo. */
export const catalogSwarm = (hashes: InfoHash[], depth: 'quick'|'deep' = 'deep') => invoke<Record<InfoHash, SwarmCount>>('catalog_swarm', { hashes, depth });
/** Censo DHT sin conectarse (~12 s): {hash: direcciones}; falta = 0. */
export const catalogCensus = (hashes: InfoHash[]) => invoke<Record<InfoHash, number>>('catalog_census', { hashes });
/** Corta los conteos en curso ("Detener" el análisis); lo ya contado queda. */
export const catalogStopSwarm = () => invoke<void>('catalog_stop_swarm');
/** Subtítulos del video (fuentes gratis, hasta 5, `language` primero) con lo elegido y probado. `hash`: la opción que da el release. */
export const catalogSubtitles = (videoId: string, hash: InfoHash, language: SubtitleLanguage) => invoke<CatalogSubtitles>('catalog_subtitles', { videoId, hash, language });
/** "Usar" ese subtítulo para el video (encontrado, Premium o del video): devuelve {chosen, tried}. */
export const catalogSubtitleUse = (videoId: string, hash: InfoHash, key: string) => invoke<SubtitlePicks>('catalog_subtitle_use', { videoId, hash, key });
/** Cuota de Premium (OpenSubtitles.com). */
export const premiumQuota = () => invoke<PremiumQuota>('premium_quota');
/** Busca en Premium, solo español. No gasta cuota. */
export const catalogPremiumSearch = (videoId: string, hash: InfoHash) => invoke<SubtitleFound[]>('catalog_premium_search', { videoId, hash });
/** Baja UN Premium (gasta 1) y lo deja elegido. Devuelve como catalogSubtitles. */
export const catalogPremiumUse = (videoId: string, hash: InfoHash, pick: PremiumPick) => invoke<CatalogSubtitles>('catalog_premium_use', { videoId, hash, pick });

// Catálogo y addons (F4b, spec 09). kind: 'movie' | 'series'; videoId: 'tt…' o 'tt…:T:E'.
/** FR-36: películas y series juntas, lo más popular primero. Una búsqueda nueva cancela la anterior (error "Cancelado."). */
export const catalogSearch = (query: string) => invoke<CatalogItem[]>('catalog_search', { query });
/** Actores y directores para las sugerencias del buscador (hasta 6; vacío sin key de TMDB). */
export const catalogPeople = (query: string) => invoke<SearchPerson[]>('catalog_people', { query });
/** Lo que actuó o dirigió la persona (de más a menos popular). Necesita key de TMDB. */
export const catalogPersonTitles = (id: number, role: 'cast'|'director') => invoke<CatalogItem[]>('catalog_person_titles', { id, role });
/** En tendencia ahora (sin key de TMDB): {items, has_more}, 50 por página desde `skip`. */
export const catalogTrending = (kind: MediaKind, skip: number) => invoke<BrowsePage>('catalog_trending', { kind, skip });
/** Ejemplos populares de cada subgénero de IMDb (filtro de géneros). */
export const catalogInterestExamples = (kind: MediaKind, ids: string[]) => invoke<Record<string, InterestExample[]>>('catalog_interest_examples', { kind, ids });
/** Episodios de una temporada en los idiomas elegidos; vacío sin key de TMDB. */
export const catalogEpisodes = (imdbId: string, season: number) => invoke<EpisodeText[]>('catalog_episodes', { imdbId, season });
/** "Pegar magnet" con TorBox: estado, videos y (con `who`) qué película o serie es. */
export const torboxMagnet = (hash: InfoHash, name: string, who: boolean) => invoke<TorboxMagnetView>('torbox_magnet', { hash, name, who });
/** "Bajarlo en TorBox": lo agrega aunque no esté en caché; devuelve el estado nuevo. */
export const torboxMagnetDownload = (hash: InfoHash, name: string) => invoke<MagnetStatus>('torbox_magnet_download', { hash, name });
/** Ficha de TMDB (sinopsis, reparto, plataformas…). */
export const catalogDetails = (kind: MediaKind, imdbId: string) => once<DetailsView>('catalog_details', { kind, imdbId });
export const catalogSimilar = (kind: MediaKind, imdbId: string) => invoke<Similar[]>('catalog_similar', { kind, imdbId });
/** Puntaje promedio por temporada y estado de la serie. quick: no espera al índice de IMDb si se está armando (solo el estado). */
export const catalogSeasonRatings = (imdbId: string, quick = false) => invoke<SeasonRatings>('catalog_season_ratings', { imdbId, quick });
/** Bytes de un póster (ArrayBuffer): la UI lee su color. */
export const catalogImage = (url: string) => invoke<ArrayBuffer>('catalog_image', { url });
/** Puntaje de IMDb de cada capítulo de una temporada. */
export const catalogEpisodeRatings = (imdbId: string, season: number) => invoke<EpisodeScore[]>('catalog_episode_ratings', { imdbId, season });
/** Premios de IMDb: totales y el detalle de los grandes. */
export const catalogAwards = (imdbId: string) => invoke<TitleAwards>('catalog_awards', { imdbId });
/** Explorar con filtros de IMDb (necesita key de TMDB): {items, has_more:false}. sort: 'popular' | 'rating'. languages: ['en','es'] = idioma original inglés o español; [] = cualquiera. */
export const catalogBrowseTop = (kind: MediaKind, sort: 'popular'|'rating', from: string, to: string|null, minVotes: number, languages: string[]) => invoke<BrowsePage>('catalog_browse_top', { kind, sort, from, to, minVotes, languages });
/** Explorar con un género elegido: subgéneros de IMDb (`interests`, alcanza con uno), los mismos filtros, sin key de TMDB. */
export const catalogBrowseInterests = (kind: MediaKind, sort: 'rating'|'popular', from: string, to: string|null, minVotes: number, languages: string[], interests: string[]) => invoke<BrowsePage>('catalog_browse_interests', { kind, sort, from, to, minVotes, languages, interests });
/** Tests de conexión de la última hora (datos guardados). */
export const catalogSwarmSaved = (hashes: InfoHash[]) => invoke<Record<InfoHash, SavedTest>>('catalog_swarm_saved', { hashes });
/** Espacio libre del disco de descargas, en bytes (null si no se pudo leer). */
export const downloadsFreeBytes = () => invoke<number|null>('downloads_free_bytes');
/** Abre la ficha de IMDb del título en el navegador. */
export const catalogOpenImdb = (imdbId: string) => invoke<void>('catalog_open_imdb', { imdbId });
/** FR-38/39: ficha con episodios. */
export const catalogMeta = (kind: MediaKind, id: string) => once<Meta>('catalog_meta', { kind, id });
/** FR-42: los streams llegan por el evento catalog-streams. */
export const catalogStreams = (kind: MediaKind, videoId: string) => invoke<void>('catalog_streams', { kind, videoId });
export const catalogStopStreams = () => invoke<void>('catalog_stop_streams');
/** Copia subtítulos bajados a Descargas y abre la carpeta. Devuelve la ruta. */
export const saveSubtitles = (title: string, files: {path:string, name:string}[]) => invoke<string>('save_subtitles', { title, files });
/** Magnet de una opción o, con `torbox`, el link https para castear (HLS): `orig` = idioma original ISO 639-1, `latino` = poner ese audio. */
export const catalogLink = (hash: InfoHash, torbox: boolean, orig: string|null = null, latino = false) => invoke<string>('catalog_link', { hash, torbox, orig, latino });
/** Agrega a la biblioteca sin analizar ("Reproducir" desde el catálogo). Devuelve las filas. */
export const catalogAdd = (kind: MediaKind, videoId: string, hashes: InfoHash[]) => invoke<LibraryRow[]>('catalog_add', { kind, videoId, hashes });
/** Ajustes → Fuentes (FR-41). Las URLs secretas vuelven enmascaradas. */
export const catalogAddons = () => invoke<AddonView[]>('catalog_addons');
export const catalogAddAddon = (url: string) => invoke<AddonView>('catalog_add_addon', { url });
export const catalogRemoveAddon = (id: string) => invoke<void>('catalog_remove_addon', { id });
export const catalogSetAddonEnabled = (id: string, enabled: boolean) => invoke<void>('catalog_set_addon_enabled', { id, enabled });
export const catalogResetAddons = () => invoke<AddonView[]>('catalog_reset_addons');

// Limpieza (FR-18–20)
export const tempUsage = () => invoke<TempUsage>('temp_usage');
export const cleanTemp = () => invoke<CleanupReport>('clean_temp');
/** Velocidad de internet de esta red: la guardada o, con `force` (o sin medición), la mide (~10 s; el progreso llega como evento `speed-test`). */
export const speedTest = (force = false) => invoke<SpeedResult>('speed_test', { force });
/** Caché de datos (fichas, puntajes, datasets de IMDb): bytes que ocupa. */
export const dataCacheSize = () => invoke<number>('data_cache_size');
/** Borra la caché de datos (devuelve los bytes liberados). */
export const clearDataCache = () => invoke<number>('clear_data_cache');
/** ¿El puerto entrante llega desde internet? */
export const checkIncoming = () => invoke<IncomingCheck>('check_incoming');
/** Últimas líneas del log detallado del núcleo (con nivel: INFO/WARN/ERROR/DEBUG). */
export const logsTail = (max = 2000) => invoke<string[]>('logs_tail', { max });
/** Copia los logs (y la actividad visible) a Descargas y muestra la carpeta. Devuelve la ruta. */
export const exportLogs = (friendly: string) => invoke<string>('export_logs', { friendly });
export const openLogsWindow = () => invoke<void>('open_logs_window');
export const openDownloadsFolder = () => invoke<void>('open_downloads_folder');

// Configuración (NFR-04)
export const config = () => invoke<Config>('config_get');

// Un comando por ajuste: nunca se reescribe la config entera desde la UI.
/** Reproductores de este equipo. */
export const playersStatus = () => invoke<PlayersStatus>('players_status');
/** Con Homebrew instala mpv (minutos); si no, abre la guía. true = instalado. */
export const installMpv = () => invoke<boolean>('install_mpv');
/** 'cine' | 'voices' | 'flat' + intensidad en % 0–150 (Ajustes → Reproductor, 2026-11-17). */
export const setEqualizer = (equalizer: Equalizer, intensity: number) => invoke<void>('config_set_equalizer', { equalizer, intensity });
/** Idiomas de la app y de los títulos: {app: 'es'|'en', titles: 'es'|'en'}. */
export const setLanguage = (language: LanguageConfig) => invoke<void>('config_set_language', { language });
/** Ajustes → Red (ADR-30): entrantes / UPnP. */
export const setNetwork = (incoming: boolean, upnp: boolean, announceEarly: boolean) => invoke<void>('config_set_network', { incoming, upnp, announceEarly });

/**
 * Suscripción a eventos del núcleo (ver crates/core/src/events.rs). Único canal: `core://event`.
 * Tipos: library-entry-updated · library-entry-removed · clipboard-history-unavailable · analyzer-progress · analyzer-queue ·
 * playback-updated · playback-removed · playback-log · catalog-streams · activity · status
 */
export const onCoreEvent = (handler: (event: CoreEvent) => void): Promise<() => void> =>
  window.__TAURI__.event.listen<CoreEvent>('core://event', (e) => handler(e.payload));
