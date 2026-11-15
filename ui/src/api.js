// Única puerta de la UI al núcleo (NFR-01). Espejo 1:1 de src-tauri/src/commands.rs.
// La UI nunca sabe qué motor corre ni dónde están los archivos.

/** @typedef {string} InfoHash  40 hex en minúsculas */
/** @typedef {number} PlaybackId */
/** @typedef {'mpv'|'vlc'} PlayerKind */
/** @typedef {'green'|'yellow'|'red'|'unknown'} Light */
/** @typedef {{kind:'all'}|{kind:'only-unmeasured'}|{kind:'one', hash:InfoHash}} AnalyzeScope */
/** @typedef {'pause-download'|'resume-download'|'stop'|'stop-and-delete'|'open-folder'} PlaybackAction */
/** @typedef {{message:string, detail:string}} UiError */

const tauri = window.__TAURI__;
const invoke = (cmd, args) => tauri.core.invoke(cmd, args);

export const api = {
  // Biblioteca (FR-01–04)
  library: () => invoke('library_get'),
  readClipboard: () => invoke('library_read_clipboard'),
  addText: (text) => invoke('library_add_text', { text }),
  remove: (hash) => invoke('library_remove', { hash }),
  clearLibrary: () => invoke('library_clear'),
  magnet: (hash) => invoke('library_magnet', { hash }),

  // Análisis (FR-05–08)
  /** @param {AnalyzeScope} scope */
  analyze: (scope) => invoke('analyze', { scope }),
  analyzerPause: () => invoke('analyzer_pause'),
  analyzerResume: () => invoke('analyzer_resume'),
  /** "Listo": terminar la medición de velocidad en curso con lo medido. */
  analyzerFinish: () => invoke('analyzer_finish'),
  /** Pausar / reanudar el análisis de un solo magnet. */
  analyzerPauseOne: (hash) => invoke('analyzer_pause_one', { hash }),
  analyzerResumeOne: (hash) => invoke('analyzer_resume_one', { hash }),
  /** "Reiniciar análisis" de uno (rápido o con medición), aunque esté en cola o midiéndose. */
  analyzerRestart: (hash, quick) => invoke('analyzer_restart', { hash, quick }),
  /** Diálogo "Leer portapapeles": magnets del historial con fecha, para elegir. */
  clipboardPreview: () => invoke('clipboard_preview'),
  /** Agrega solo los magnets elegidos (texto original de cada uno). */
  addSelected: (raws) => invoke('library_add_selected', { raws }),

  // Reproducción (FR-09–17)
  /** @param {InfoHash} hash @param {PlayerKind=} player */
  /** @param {{code:string, aid:?number}=} audio  audio elegido (inglés / latino…) */
  play: (hash, player = null, fileIndex = null, audio = null) => invoke('play', { hash, player, fileIndex, audio }),
  /** @param {PlaybackId} id @param {PlaybackAction} action */
  playbackAction: (id, action) => invoke('playback_action', { id, action }),
  playbacks: () => invoke('playbacks_get'),
  playbackLog: (id) => invoke('playback_log', { id }),
  stopAllAndClean: () => invoke('stop_all_and_clean'),
  activePlaybacks: () => invoke('active_playbacks'),
  /** @param {'stop-all'|'leave-running'} choice */
  onClose: (choice) => invoke('on_close', { choice }),

  // Subtítulos: API keys en el almacén seguro del sistema (NFR-16). Nunca se leen de vuelta.
  /** @param {'opensubtitles'|'wyzie'} provider @param {string} key  vacía = borrar */
  subtitlesSetApiKey: (provider, key) => invoke('subtitles_set_api_key', { provider, key }),
  /** @returns {Promise<{provider: string, configured: boolean}[]>} */
  subtitlesApiKeys: () => invoke('subtitles_api_keys'),
  /** Abre en el navegador la página para pedir la key. */
  openKeyPage: (provider) => invoke('open_key_page', { provider }),

  // Catálogo y addons (F4b, spec 09). kind: 'movie' | 'series'; videoId: 'tt…' o 'tt…:T:E'.
  /** FR-36: {movies, series}. Una búsqueda nueva cancela la anterior (error "Cancelado."). */
  catalogSearch: (query) => invoke('catalog_search', { query }),
  /** Explorar: {items, has_more}, 50 por página. sort: 'popular' | 'rating'; year: número o null. */
  catalogBrowse: (kind, sort, year, skip) => invoke('catalog_browse', { kind, sort, year, skip }),
  /** Por fecha de estreno: from/to 'AAAA-MM-DD' (to null = hoy); cursor = `next` de la página anterior (null = primera). {items, has_more, next?}. */
  catalogBrowseReleased: (kind, from, to, cursor) => invoke('catalog_browse_released', { kind, from, to, cursor }),
  /** FR-38/39: ficha con episodios. */
  catalogMeta: (kind, id) => invoke('catalog_meta', { kind, id }),
  /** FR-42: los streams llegan por el evento catalog-streams. */
  catalogStreams: (kind, videoId) => invoke('catalog_streams', { kind, videoId }),
  catalogStopStreams: () => invoke('catalog_stop_streams'),
  /** Envía a Mis magnets (con su origen) y los analiza ahí; se reproducen desde Mis magnets. */
  catalogAnalyze: (kind, videoId, hashes) => invoke('catalog_analyze', { kind, videoId, hashes }),
  /** Ajustes → Fuentes (FR-41). Las URLs secretas vuelven enmascaradas. */
  catalogAddons: () => invoke('catalog_addons'),
  catalogAddAddon: (url) => invoke('catalog_add_addon', { url }),
  catalogRemoveAddon: (id) => invoke('catalog_remove_addon', { id }),
  catalogSetAddonEnabled: (id, enabled) => invoke('catalog_set_addon_enabled', { id, enabled }),
  catalogResetAddons: () => invoke('catalog_reset_addons'),

  // Limpieza (FR-18–20)
  tempUsage: () => invoke('temp_usage'),
  cleanTemp: () => invoke('clean_temp'),
  openDownloadsFolder: () => invoke('open_downloads_folder'),

  // Configuración (NFR-04)
  config: () => invoke('config_get'),
  setConfig: (config) => invoke('config_set', { config }),
};

/**
 * Suscripción a eventos del núcleo (ver crates/core/src/events.rs).
 * Tipos: library-entry-updated · library-entry-removed · library-cleared ·
 * clipboard-history-unavailable · analyzer-progress · playback-updated ·
 * playback-removed · playback-log · status · catalog-streams · catalog-excluded
 * @param {(event: {type: string} & Record<string, any>) => void} handler
 */
export function onCoreEvent(handler) {
  return tauri.event.listen('core://event', (e) => handler(e.payload));
}
