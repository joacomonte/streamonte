// @ts-check
// Única puerta de la UI al núcleo (NFR-01). Espejo 1:1 de src-tauri/src/commands.rs.
// La UI nunca sabe qué motor corre ni dónde están los archivos.

/**
 * @typedef {import('./types.ts').InfoHash} InfoHash
 * @typedef {import('./types.ts').VideoKey} VideoKey
 * @typedef {import('./types.ts').PlaybackId} PlaybackId
 * @typedef {import('./types.ts').PlayerKind} PlayerKind
 * @typedef {import('./types.ts').Light} Light
 * @typedef {import('./types.ts').AnalyzeScope} AnalyzeScope
 * @typedef {import('./types.ts').PlaybackAction} PlaybackAction
 * @typedef {import('./types.ts').UiError} UiError
 * @typedef {import('./types.ts').MediaKind} MediaKind
 * @typedef {import('./types.ts').CoreEvent} CoreEvent
 */

const tauri = window.__TAURI__;
/** @template T @param {string} cmd @param {Record<string, unknown>=} args @returns {Promise<T>} */
const invoke = (cmd, args) => tauri.core.invoke(cmd, args);

/** Ficha y detalles de un título: el panel (`catalog-side.js`) y la ficha compartida (`TitleView`, por `tauriApi.ts`) los piden
 *  a la vez al abrirlo; una sola invocación por título (la misma promesa hasta 10 s después de responder).
 *  @type {Map<string, {p: Promise<unknown>, at: number}>} */
const recent = new Map();
/** @template T @param {string} cmd @param {Record<string, unknown>} args @returns {Promise<T>} */
function once(cmd, args) {
  const key = `${cmd}|${JSON.stringify(args)}`;
  const hit = recent.get(key);
  if (hit && Date.now() - hit.at < 10_000) return /** @type {Promise<T>} */ (hit.p);
  /** @type {Promise<T>} */
  const p = invoke(cmd, args);
  const entry = { p, at: Infinity };
  recent.set(key, entry);
  p.then(() => { entry.at = Date.now(); }, () => recent.delete(key));
  return p;
}
/** Key de TMDB nueva: la ficha cambia; lo llama `catalog.js` antes de volver a pedirla. */
export const forgetTitles = () => recent.clear();

export const api = {
  // Biblioteca (FR-01–04)
  /** @returns {Promise<import('./types.ts').LibraryView>} */
  library: () => invoke('library_get'),

  // Análisis (FR-05–08)
  /** @param {AnalyzeScope} scope @returns {Promise<void>} */
  analyze: (scope) => invoke('analyze', { scope }),
  /** @returns {Promise<void>} */
  analyzerPause: () => invoke('analyzer_pause'),
  /** @returns {Promise<void>} */
  analyzerResume: () => invoke('analyzer_resume'),
  /** @param {InfoHash[]} hashes @returns {Promise<void>} */
  analyzerCancel: (hashes) => invoke('analyzer_cancel', { hashes }),
  /** Lo último copiado si es un magnet: {raw, info_hash, name} o null. @returns {Promise<import('./types.ts').CopiedMagnet|null>} */
  copiedMagnet: () => invoke('copied_magnet'),
  /** @param {VideoKey} key @returns {Promise<void>} */
  remove: (key) => invoke('library_remove', { key }),
  /** Agrega solo los magnets elegidos (texto original de cada uno). Devuelve cuántos. @param {string[]} raws @returns {Promise<number>} */
  addSelected: (raws) => invoke('library_add_selected', { raws }),

  // Reproducción (FR-09–17)
  /** @param {VideoKey} key @param {PlayerKind|null=} player @param {number|null=} fileIndex
   *  @param {{code:string, aid:number|null}|null=} audio  audio elegido (inglés / latino…)
   *  @returns {Promise<PlaybackId>} */
  play: (key, player = null, fileIndex = null, audio = null) => invoke('play', { key, player, fileIndex, audio }),
  /** "Cargar en background" (catálogo): baja de fondo sin reproductor; Reproducir después la retoma.
   *  @param {VideoKey} key @returns {Promise<PlaybackId>} */
  playBackground: (key) => invoke('play', { key, background: true }),
  /** @param {PlaybackId} id @param {PlaybackAction} action @returns {Promise<void>} */
  playbackAction: (id, action) => invoke('playback_action', { id, action }),
  /** @returns {Promise<import('./types.ts').PlaybackRow[]>} */
  playbacks: () => invoke('playbacks_get'),
  /** @param {PlaybackId} id @returns {Promise<string[]>} */
  playbackLog: (id) => invoke('playback_log', { id }),
  /** @returns {Promise<import('./types.ts').CleanupReport>} */
  stopAllAndClean: () => invoke('stop_all_and_clean'),
  /** @param {'stop-all'|'leave-running'} choice @returns {Promise<void>} */
  onClose: (choice) => invoke('on_close', { choice }),

  // API keys de servicios en el almacén seguro del sistema (NFR-16). Nunca se leen de vuelta.
  /** @param {string} service  'opensubtitles' | 'wyzie' | 'tmdb' | 'torbox' | 'latteam' @param {string} key  vacía = borrar @returns {Promise<void>} */
  setApiKey: (service, key) => invoke('api_key_set', { service, key }),
  /** @returns {Promise<import('./types.ts').ApiKeyStatus[]>} */
  apiKeys: () => invoke('api_keys'),
  /** Abre en el navegador la página para pedir la key. @param {string} service @returns {Promise<void>} */
  openKeyPage: (service) => invoke('open_key_page', { service }),
  /** Póster de TMDB para un título sin imagen en Cinemeta (null sin key o si no lo tiene). @param {string} imdbId @returns {Promise<string|null>} */
  catalogPoster: (imdbId) => invoke('catalog_poster', { imdbId }),
  /** Hashes que están en la caché de TorBox; null = sin key o no respondió.
   *  @param {string} videoId @param {InfoHash[]} hashes @returns {Promise<import('./types.ts').TorboxCached|null>} */
  catalogTorbox: (videoId, hashes) => invoke('catalog_torbox', { videoId, hashes }),
  /** Ver por TorBox (link directo, sin P2P): una reproducción en curso más (fila, Detener, cambiar subtítulo). Devuelve su id.
   *  @param {string} videoId @param {InfoHash} hash @param {PlayerKind|null} player @param {{code:string, aid:number|null}|null} audio @returns {Promise<PlaybackId>} */
  playTorbox: (videoId, hash, player, audio) => invoke('play_torbox', { videoId, hash, player, audio }),
  /** Lee audio y subtítulos de esa opción por su link de TorBox (quedan en su fila, como los del análisis).
   *  @param {MediaKind} kind @param {string} videoId @param {InfoHash} hash @returns {Promise<void>} */
  catalogTorboxTracks: (kind, videoId, hash) => invoke('catalog_torbox_tracks', { kind, videoId, hash }),
  /** Cambia el subtítulo de lo que se está viendo (mpv) sin reiniciar: `key` de la fila; `path` si es un archivo.
   *  @param {PlaybackId} id @param {string} key @param {string|null} path @returns {Promise<void>} */
  playbackSubtitle: (id, key, path) => invoke('playback_subtitle', { id, key, path }),
  /** Usuario y contraseña de OpenSubtitles.com (vacíos = borrar). Van al almacén seguro; nunca vuelven.
   *  @param {string} username @param {string} password @returns {Promise<void>} */
  setOpensubtitlesLogin: (username, password) => invoke('opensubtitles_login_set', { username, password }),
  /** "Contar seeders reales": se conecta a cada enjambre (~50 s por tanda). {hash: {seeds, peers}}; falta = no se pudo.
   *  @param {InfoHash[]} hashes @param {'quick'|'deep'=} depth @returns {Promise<Record<InfoHash, import('./types.ts').SwarmCount>>} */
  catalogSwarm: (hashes, depth = 'deep') => invoke('catalog_swarm', { hashes, depth }),
  /** Censo DHT sin conectarse (~12 s): {hash: direcciones}; falta = 0. @param {InfoHash[]} hashes @returns {Promise<Record<InfoHash, number>>} */
  catalogCensus: (hashes) => invoke('catalog_census', { hashes }),
  /** Corta los conteos en curso ("Detener" el análisis); lo ya contado queda. @returns {Promise<void>} */
  catalogStopSwarm: () => invoke('catalog_stop_swarm'),
  /** Subtítulos del video (fuentes gratis, hasta 5, `language` primero) con lo elegido y probado. `hash`: la opción que da el release.
   *  @param {string} videoId @param {InfoHash} hash @param {import('./types.ts').SubtitleLanguage} language @returns {Promise<import('./types.ts').CatalogSubtitles>} */
  catalogSubtitles: (videoId, hash, language) => invoke('catalog_subtitles', { videoId, hash, language }),
  /** "Usar" ese subtítulo para el video (encontrado, Premium o del video): devuelve {chosen, tried}.
   *  @param {string} videoId @param {InfoHash} hash @param {string} key @returns {Promise<import('./types.ts').SubtitlePicks>} */
  catalogSubtitleUse: (videoId, hash, key) => invoke('catalog_subtitle_use', { videoId, hash, key }),
  /** Cuota de Premium (OpenSubtitles.com). @returns {Promise<import('./types.ts').PremiumQuota>} */
  premiumQuota: () => invoke('premium_quota'),
  /** Busca en Premium, solo español. No gasta cuota. @param {string} videoId @param {InfoHash} hash @returns {Promise<import('./types.ts').SubtitleFound[]>} */
  catalogPremiumSearch: (videoId, hash) => invoke('catalog_premium_search', { videoId, hash }),
  /** Baja UN Premium (gasta 1) y lo deja elegido. Devuelve como catalogSubtitles.
   *  @param {string} videoId @param {InfoHash} hash @param {import('./types.ts').PremiumPick} pick @returns {Promise<import('./types.ts').CatalogSubtitles>} */
  catalogPremiumUse: (videoId, hash, pick) => invoke('catalog_premium_use', { videoId, hash, pick }),

  // Catálogo y addons (F4b, spec 09). kind: 'movie' | 'series'; videoId: 'tt…' o 'tt…:T:E'.
  /** FR-36: películas y series juntas, lo más popular primero. Una búsqueda nueva cancela la anterior (error "Cancelado.").
   *  @param {string} query @returns {Promise<import('./types.ts').CatalogItem[]>} */
  catalogSearch: (query) => invoke('catalog_search', { query }),
  /** Actores y directores para las sugerencias del buscador (hasta 6; vacío sin key de TMDB).
   *  @param {string} query @returns {Promise<import('./types.ts').SearchPerson[]>} */
  catalogPeople: (query) => invoke('catalog_people', { query }),
  /** Lo que actuó o dirigió la persona (de más a menos popular). Necesita key de TMDB.
   *  @param {number} id @param {'cast'|'director'} role @returns {Promise<import('./types.ts').CatalogItem[]>} */
  catalogPersonTitles: (id, role) => invoke('catalog_person_titles', { id, role }),
  /** En tendencia ahora (sin key de TMDB): {items, has_more}, 50 por página desde `skip`.
   *  @param {MediaKind} kind @param {number} skip @returns {Promise<import('./types.ts').BrowsePage>} */
  catalogTrending: (kind, skip) => invoke('catalog_trending', { kind, skip }),
  /** Ejemplos populares de cada subgénero de IMDb (filtro de géneros). @param {MediaKind} kind @param {string[]} ids
   *  @returns {Promise<Record<string, import('./types.ts').InterestExample[]>>} */
  catalogInterestExamples: (kind, ids) => invoke('catalog_interest_examples', { kind, ids }),
  /** Episodios de una temporada en los idiomas elegidos; vacío sin key de TMDB. @param {string} imdbId @param {number} season @returns {Promise<import('./types.ts').EpisodeText[]>} */
  catalogEpisodes: (imdbId, season) => invoke('catalog_episodes', { imdbId, season }),
  /** "Pegar magnet" con TorBox: estado, videos y (con `who`) qué película o serie es.
   *  @param {InfoHash} hash @param {string} name @param {boolean} who @returns {Promise<import('./types.ts').TorboxMagnetView>} */
  torboxMagnet: (hash, name, who) => invoke('torbox_magnet', { hash, name, who }),
  /** "Bajarlo en TorBox": lo agrega aunque no esté en caché; devuelve el estado nuevo. @param {InfoHash} hash @param {string} name @returns {Promise<import('./types.ts').MagnetStatus>} */
  torboxMagnetDownload: (hash, name) => invoke('torbox_magnet_download', { hash, name }),
  /** Ficha de TMDB (sinopsis, reparto, plataformas…). @param {MediaKind} kind @param {string} imdbId @returns {Promise<import('./types.ts').DetailsView>} */
  catalogDetails: (kind, imdbId) => once('catalog_details', { kind, imdbId }),
  /** @param {MediaKind} kind @param {string} imdbId @returns {Promise<import('./types.ts').Similar[]>} */
  catalogSimilar: (kind, imdbId) => invoke('catalog_similar', { kind, imdbId }),
  /** Puntaje promedio por temporada y estado de la serie. quick: no espera al índice de IMDb si se está armando (solo el estado).
   *  @param {string} imdbId @param {boolean=} quick @returns {Promise<import('./types.ts').SeasonRatings>} */
  catalogSeasonRatings: (imdbId, quick = false) => invoke('catalog_season_ratings', { imdbId, quick }),
  /** Premios de IMDb: totales y el detalle de los grandes. @param {string} imdbId @returns {Promise<import('./types.ts').TitleAwards>} */
  catalogAwards: (imdbId) => invoke('catalog_awards', { imdbId }),
  /** Explorar con filtros de IMDb (necesita key de TMDB): {items, has_more:false}. sort: 'popular' | 'rating'.
   *  languages: ['en','es'] = idioma original inglés o español; [] = cualquiera.
   *  @param {MediaKind} kind @param {'popular'|'rating'} sort @param {string} from @param {string|null} to @param {number} minVotes
   *  @param {string[]} languages @returns {Promise<import('./types.ts').BrowsePage>} */
  catalogBrowseTop: (kind, sort, from, to, minVotes, languages) => invoke('catalog_browse_top', { kind, sort, from, to, minVotes, languages }),
  /** Explorar con un género elegido: subgéneros de IMDb (`interests`, alcanza con uno), los mismos filtros, sin key de TMDB.
   *  @param {MediaKind} kind @param {'rating'|'popular'} sort @param {string} from @param {string|null} to @param {number} minVotes
   *  @param {string[]} languages @param {string[]} interests @returns {Promise<import('./types.ts').BrowsePage>} */
  catalogBrowseInterests: (kind, sort, from, to, minVotes, languages, interests) => invoke('catalog_browse_interests', { kind, sort, from, to, minVotes, languages, interests }),
  /** Abre el tráiler en YouTube, en el navegador. @param {string} youtubeId @returns {Promise<void>} */
  /** Tests de conexión de la última hora (datos guardados). @param {InfoHash[]} hashes @returns {Promise<Record<InfoHash, import('./types.ts').SavedTest>>} */
  catalogSwarmSaved: (hashes) => invoke('catalog_swarm_saved', { hashes }),
  /** Espacio libre del disco de descargas, en bytes (null si no se pudo leer). @returns {Promise<number|null>} */
  downloadsFreeBytes: () => invoke('downloads_free_bytes'),
  /** Abre la ficha de IMDb del título en el navegador. @param {string} imdbId @returns {Promise<void>} */
  catalogOpenImdb: (imdbId) => invoke('catalog_open_imdb', { imdbId }),
  /** FR-38/39: ficha con episodios. @param {MediaKind} kind @param {string} id @returns {Promise<import('./types.ts').Meta>} */
  catalogMeta: (kind, id) => once('catalog_meta', { kind, id }),
  /** FR-42: los streams llegan por el evento catalog-streams. @param {MediaKind} kind @param {string} videoId @returns {Promise<void>} */
  catalogStreams: (kind, videoId) => invoke('catalog_streams', { kind, videoId }),
  /** @returns {Promise<void>} */
  catalogStopStreams: () => invoke('catalog_stop_streams'),
  /** Copia subtítulos bajados a Descargas y abre la carpeta. Devuelve la ruta.
   *  @param {string} title @param {{path:string, name:string}[]} files @returns {Promise<string>} */
  saveSubtitles: (title, files) => invoke('save_subtitles', { title, files }),
  /** Magnet de una opción o, con `torbox`, el link https para castear (HLS): `orig` = idioma original ISO 639-1, `latino` = poner ese audio.
   *  @param {InfoHash} hash @param {boolean} torbox @param {string|null=} orig @param {boolean=} latino @returns {Promise<string>} */
  catalogLink: (hash, torbox, orig = null, latino = false) => invoke('catalog_link', { hash, torbox, orig, latino }),
  /** Agrega a la biblioteca sin analizar ("Reproducir" desde el catálogo). Devuelve las filas.
   *  @param {MediaKind} kind @param {string} videoId @param {InfoHash[]} hashes @returns {Promise<import('./types.ts').LibraryRow[]>} */
  catalogAdd: (kind, videoId, hashes) => invoke('catalog_add', { kind, videoId, hashes }),
  /** Ajustes → Fuentes (FR-41). Las URLs secretas vuelven enmascaradas. @returns {Promise<import('./types.ts').AddonView[]>} */
  catalogAddons: () => invoke('catalog_addons'),
  /** @param {string} url @returns {Promise<import('./types.ts').AddonView>} */
  catalogAddAddon: (url) => invoke('catalog_add_addon', { url }),
  /** @param {string} id @returns {Promise<void>} */
  catalogRemoveAddon: (id) => invoke('catalog_remove_addon', { id }),
  /** @param {string} id @param {boolean} enabled @returns {Promise<void>} */
  catalogSetAddonEnabled: (id, enabled) => invoke('catalog_set_addon_enabled', { id, enabled }),
  /** @returns {Promise<import('./types.ts').AddonView[]>} */
  catalogResetAddons: () => invoke('catalog_reset_addons'),
  /** Filtro "Sin anime" (FR-40). @param {boolean} exclude @returns {Promise<void>} */
  catalogSetExcludeJapanese: (exclude) => invoke('catalog_set_exclude_japanese', { exclude }),

  // Limpieza (FR-18–20)
  /** @returns {Promise<import('./types.ts').TempUsage>} */
  tempUsage: () => invoke('temp_usage'),
  /** @returns {Promise<import('./types.ts').CleanupReport>} */
  cleanTemp: () => invoke('clean_temp'),
  /** Velocidad de internet de esta red: la guardada o, con `force` (o sin medición), la mide
   *  (~10 s; el progreso llega como evento `speed-test`). @param {boolean=} force @returns {Promise<import('./types.ts').SpeedResult>} */
  speedTest: (force = false) => invoke('speed_test', { force }),
  /** Caché de datos (fichas, puntajes, datasets de IMDb): bytes que ocupa. @returns {Promise<number>} */
  dataCacheSize: () => invoke('data_cache_size'),
  /** Borra la caché de datos (devuelve los bytes liberados). @returns {Promise<number>} */
  clearDataCache: () => invoke('clear_data_cache'),
  /** ¿El puerto entrante llega desde internet? @returns {Promise<import('./types.ts').IncomingCheck>} */
  checkIncoming: () => invoke('check_incoming'),
  /** Últimas líneas del log detallado del núcleo (con nivel: INFO/WARN/ERROR/DEBUG). @param {number=} max @returns {Promise<string[]>} */
  logsTail: (max = 2000) => invoke('logs_tail', { max }),
  /** Copia los logs (y la actividad visible) a Descargas y muestra la carpeta. Devuelve la ruta. @param {string} friendly @returns {Promise<string>} */
  exportLogs: (friendly) => invoke('export_logs', { friendly }),
  openLogsWindow: () => invoke('open_logs_window'),
  /** @returns {Promise<void>} */
  openDownloadsFolder: () => invoke('open_downloads_folder'),

  // Configuración (NFR-04)
  /** @returns {Promise<import('./types.ts').Config>} */
  config: () => invoke('config_get'),
  // Un comando por ajuste: nunca se reescribe la config entera desde la UI.
  /** Reproductores de este equipo. @returns {Promise<import('./types.ts').PlayersStatus>} */
  playersStatus: () => invoke('players_status'),
  /** Con Homebrew instala mpv (minutos); si no, abre la guía. true = instalado. @returns {Promise<boolean>} */
  installMpv: () => invoke('install_mpv'),
  /** 'cine' | 'voices' | 'flat' + intensidad en % 0–150 (Ajustes → Reproductor, 2026-11-17). @param {import('./types.ts').Equalizer} equalizer @param {number} intensity @returns {Promise<void>} */
  setEqualizer: (equalizer, intensity) => invoke('config_set_equalizer', { equalizer, intensity }),
  /** Idiomas de la app y de los títulos: {app: 'es'|'en', titles: 'es'|'en'}. @param {import('./types.ts').LanguageConfig} language @returns {Promise<void>} */
  setLanguage: (language) => invoke('config_set_language', { language }),
  /** Ajustes → Red (ADR-30): entrantes / UPnP. @param {boolean} incoming @param {boolean} upnp @param {boolean} announceEarly @returns {Promise<void>} */
  setNetwork: (incoming, upnp, announceEarly) => invoke('config_set_network', { incoming, upnp, announceEarly }),
};

/**
 * Suscripción a eventos del núcleo (ver crates/core/src/events.rs).
 * Tipos: library-entry-updated · library-entry-removed ·
 * clipboard-history-unavailable · analyzer-progress · analyzer-queue · playback-updated ·
 * playback-removed · playback-log · catalog-streams · catalog-excluded · activity · status
 * @param {(event: CoreEvent) => void} handler
 * @returns {Promise<() => void>}
 */
export function onCoreEvent(handler) {
  return tauri.event.listen('core://event', (/** @type {{payload: CoreEvent}} */ e) => handler(e.payload));
}
