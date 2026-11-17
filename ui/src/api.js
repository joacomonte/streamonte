// Única puerta de la UI al núcleo (NFR-01). Espejo 1:1 de src-tauri/src/commands.rs.
// La UI nunca sabe qué motor corre ni dónde están los archivos.

/** @typedef {string} InfoHash  40 hex en minúsculas */
/** @typedef {string} VideoKey  un video: `<hex>` (torrent entero), `<hex>:s3e2` o `<hex>:f12` (campo `key` de filas y reproducciones) */
/** @typedef {number} PlaybackId */
/** @typedef {'mpv'|'vlc'} PlayerKind */
/** @typedef {'green'|'yellow'|'red'|'unknown'} Light */
/** @typedef {{kind:'all'}|{kind:'only-unmeasured'}|{kind:'one', hash:InfoHash}|{kind:'selected', hashes:InfoHash[]}|{kind:'quick', hash:InfoHash}} AnalyzeScope */
/** @typedef {'pause-download'|'resume-download'|'stop'|'stop-and-delete'|'open-folder'|'keep-downloading'} PlaybackAction */
/** @typedef {{message:string, detail:string}} UiError */

const tauri = window.__TAURI__;
const invoke = (cmd, args) => tauri.core.invoke(cmd, args);

export const api = {
  // Biblioteca (FR-01–04)
  library: () => invoke('library_get'),

  // Análisis (FR-05–08)
  /** @param {AnalyzeScope} scope */
  analyze: (scope) => invoke('analyze', { scope }),
  analyzerPause: () => invoke('analyzer_pause'),
  analyzerResume: () => invoke('analyzer_resume'),
  /** Lo último copiado si es un magnet: {raw, info_hash, name} o null. */
  copiedMagnet: () => invoke('copied_magnet'),
  /** Agrega solo los magnets elegidos (texto original de cada uno). */
  remove: (key) => invoke('library_remove', { key }),
  addSelected: (raws) => invoke('library_add_selected', { raws }),

  // Reproducción (FR-09–17)
  /** @param {VideoKey} key @param {PlayerKind=} player */
  /** @param {{code:string, aid:?number}=} audio  audio elegido (inglés / latino…) */
  play: (key, player = null, fileIndex = null, audio = null) => invoke('play', { key, player, fileIndex, audio }),
  /** "Cargar en background" (catálogo): baja de fondo sin reproductor; Reproducir después la retoma. */
  playBackground: (key) => invoke('play', { key, background: true }),
  /** @param {PlaybackId} id @param {PlaybackAction} action */
  playbackAction: (id, action) => invoke('playback_action', { id, action }),
  playbacks: () => invoke('playbacks_get'),
  playbackLog: (id) => invoke('playback_log', { id }),
  stopAllAndClean: () => invoke('stop_all_and_clean'),
  /** @param {'stop-all'|'leave-running'} choice */
  onClose: (choice) => invoke('on_close', { choice }),

  // API keys de servicios en el almacén seguro del sistema (NFR-16). Nunca se leen de vuelta.
  /** @param {'opensubtitles'|'wyzie'|'tmdb'} service @param {string} key  vacía = borrar */
  setApiKey: (service, key) => invoke('api_key_set', { service, key }),
  /** @returns {Promise<{service: string, configured: boolean}[]>} */
  apiKeys: () => invoke('api_keys'),
  /** Abre en el navegador la página para pedir la key. */
  openKeyPage: (service) => invoke('open_key_page', { service }),
  /** Póster de TMDB para un título sin imagen en Cinemeta (null sin key o si no lo tiene). */
  catalogPoster: (imdbId) => invoke('catalog_poster', { imdbId }),
  /** "Contar seeders reales": se conecta a cada enjambre (~50 s por tanda). {hash: {seeds, peers}}; falta = no se pudo. */
  catalogSwarm: (hashes, depth = 'deep') => invoke('catalog_swarm', { hashes, depth }),
  /** Censo DHT sin conectarse (~12 s): {hash: direcciones}; falta = 0. */
  catalogCensus: (hashes) => invoke('catalog_census', { hashes }),
  /** Corta los conteos en curso ("Detener" el análisis); lo ya contado queda. */
  catalogStopSwarm: () => invoke('catalog_stop_swarm'),
  /** "Bajar subtítulos" de una opción: hasta 5, `language` ('es'|'en') primero. Devuelve [{provider, language, release_name}]. */
  catalogSubtitles: (videoId, hash, language) => invoke('catalog_subtitles', { videoId, hash, language }),

  // Catálogo y addons (F4b, spec 09). kind: 'movie' | 'series'; videoId: 'tt…' o 'tt…:T:E'.
  /** FR-36: películas y series juntas, lo más popular primero. Una búsqueda nueva cancela la anterior (error "Cancelado."). */
  catalogSearch: (query) => invoke('catalog_search', { query }),
  /** En tendencia ahora (sin key de TMDB): {items, has_more}, 50 por página desde `skip`. */
  catalogTrending: (kind, genre, skip) => invoke('catalog_trending', { kind, genre, skip }),
  /** Puntaje promedio por temporada: {source: 'IMDb'|'TMDB', seasons: [{season, rating, episodes}], status}.
   *  quick: no espera al índice de IMDb si se está armando (solo el estado). */
  catalogDetails: (kind, imdbId) => invoke('catalog_details', { kind, imdbId }),
  catalogSimilar: (kind, imdbId) => invoke('catalog_similar', { kind, imdbId }),
  catalogSeasonRatings: (imdbId, quick = false) => invoke('catalog_season_ratings', { imdbId, quick }),
  /** Explorar con filtros de IMDb (necesita key de TMDB): {items, has_more:false}. sort: 'popular' | 'rating'.
   *  languages: ['en','es'] = idioma original inglés o español; [] = cualquiera. */
  catalogBrowseTop: (kind, sort, from, to, minVotes, languages, genre) => invoke('catalog_browse_top', { kind, sort, from, to, minVotes, languages, genre }),
  /** Abre la ficha de IMDb del título en el navegador. */
  catalogOpenTrailer: (youtubeId) => invoke('catalog_open_trailer', { youtubeId }),
  catalogSwarmSaved: (hashes) => invoke('catalog_swarm_saved', { hashes }),
  downloadsFreeBytes: () => invoke('downloads_free_bytes'),
  catalogOpenImdb: (imdbId) => invoke('catalog_open_imdb', { imdbId }),
  /** FR-38/39: ficha con episodios. */
  catalogMeta: (kind, id) => invoke('catalog_meta', { kind, id }),
  /** FR-42: los streams llegan por el evento catalog-streams. */
  catalogStreams: (kind, videoId) => invoke('catalog_streams', { kind, videoId }),
  catalogStopStreams: () => invoke('catalog_stop_streams'),
  /** Agrega a la biblioteca sin analizar ("Reproducir" desde el catálogo). Devuelve las filas. */
  catalogAdd: (kind, videoId, hashes) => invoke('catalog_add', { kind, videoId, hashes }),
  /** Ajustes → Fuentes (FR-41). Las URLs secretas vuelven enmascaradas. */
  catalogAddons: () => invoke('catalog_addons'),
  catalogAddAddon: (url) => invoke('catalog_add_addon', { url }),
  catalogRemoveAddon: (id) => invoke('catalog_remove_addon', { id }),
  catalogSetAddonEnabled: (id, enabled) => invoke('catalog_set_addon_enabled', { id, enabled }),
  catalogResetAddons: () => invoke('catalog_reset_addons'),
  /** Filtro "Sin anime" (FR-40). */
  catalogSetExcludeJapanese: (exclude) => invoke('catalog_set_exclude_japanese', { exclude }),

  // Limpieza (FR-18–20)
  tempUsage: () => invoke('temp_usage'),
  cleanTemp: () => invoke('clean_temp'),
  /** Caché de datos (fichas, puntajes, datasets de IMDb): bytes que ocupa / borrarla toda (devuelve los liberados). */
  /** Velocidad de internet de esta red: la guardada o, con `force` (o sin medición), la mide
   *  (~10 s; el progreso llega como evento `speed-test`). → `{mbps, measured_at}`. */
  speedTest: (force = false) => invoke('speed_test', { force }),
  dataCacheSize: () => invoke('data_cache_size'),
  clearDataCache: () => invoke('clear_data_cache'),
  /** ¿El puerto entrante llega desde internet? {port, reachable: bool|null, local_ip, problem}. */
  checkIncoming: () => invoke('check_incoming'),
  /** Últimas líneas del log detallado del núcleo (con nivel: INFO/WARN/ERROR/DEBUG). */
  logsTail: (max = 2000) => invoke('logs_tail', { max }),
  /** Copia los logs (y la actividad visible) a Descargas y muestra la carpeta. Devuelve la ruta. */
  exportLogs: (friendly) => invoke('export_logs', { friendly }),
  openDownloadsFolder: () => invoke('open_downloads_folder'),

  // Configuración (NFR-04)
  config: () => invoke('config_get'),
  // Un comando por ajuste: nunca se reescribe la config entera desde la UI.
  /** Ajustes → Red (ADR-30): entrantes / UPnP. */
  /** 'cine' | 'voices' | 'flat' (Ajustes → Reproductor, 2026-11-17). */
  /** Reproductores de este equipo: {mpv: 'bundled'|'installed'|'configured'|null, vlc, chosen, effective, can_install_mpv}. */
  playersStatus: () => invoke('players_status'),
  setPlayer: (player) => invoke('config_set_player', { player }),
  /** Con Homebrew instala mpv (minutos); si no, abre la guía. true = instalado. */
  installMpv: () => invoke('install_mpv'),
  setEqualizer: (equalizer) => invoke('config_set_equalizer', { equalizer }),
  setNetwork: (incoming, upnp, announceEarly) => invoke('config_set_network', { incoming, upnp, announceEarly }),
};

/**
 * Suscripción a eventos del núcleo (ver crates/core/src/events.rs).
 * Tipos: library-entry-updated · library-entry-removed ·
 * clipboard-history-unavailable · analyzer-progress · analyzer-queue · playback-updated ·
 * playback-removed · playback-log · catalog-streams · catalog-excluded · activity · status
 * @param {(event: {type: string} & Record<string, any>) => void} handler
 */
export function onCoreEvent(handler) {
  return tauri.event.listen('core://event', (e) => handler(e.payload));
}
