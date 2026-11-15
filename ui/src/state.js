// Estado compartido (biblioteca del núcleo, reproducciones, análisis): un solo objeto que los módulos leen y escriben (`state.x`).
// Solo lo que usa más de un módulo; lo propio de cada uno (caché de filas, marquesina…) vive ahí.

export const state = {
  /** @type {Map<string, any>} clave de video (`key` del núcleo: hash + episodio) → fila de la
   *  biblioteca. Un pack de temporada tiene una fila por episodio con el mismo info_hash: la fila,
   *  play, quitar, "Retomar" y "Volver a mpv" van por `key`; el análisis, por info_hash (torrent). */
  entries: new Map(),
  /** @type {Map<number, any>} id → fila de reproducción */
  playbacks: new Map(),
  /** @type {Map<number, string[]>} id → líneas de log recibidas en vivo (tope del núcleo) */
  logs: new Map(),
  /** Reproducción cuyo log está abierto en el diálogo (o null). */
  logOpenFor: null,
  /** Último `analyzer-progress` del núcleo. */
  analyzerState: { kind: 'idle' },
  /** Magnets esperando análisis y pausados uno por uno (evento `analyzer-queue`). */
  queued: [],
  held: new Set(),
  /** info_hash → 'quick' | 'speed': pedidos de análisis recién tocados (antes de que el núcleo los
   *  ponga en cola): la fila muestra "preparando…" al instante y el botón queda deshabilitado (2026-11-14). */
  pending: new Map(),
};

/** Una fila cualquiera de ese torrent (para lo que es por info_hash: el análisis). */
export function entryOfHash(h) {
  for (const e of state.entries.values()) if (e.info_hash === h) return e;
  return null;
}

/** Nombre completo para saber qué torrent se copió: el de los metadatos (se busca al pegar),
 *  si no el `dn` del magnet (Torrentio pone uno genérico). */
export function fullName(e) {
  return e.torrent_name || e.live?.torrent_name || e.name;
}

/** Nombre corto para los mensajes: de una fila (`key`) o de un torrent (info_hash). */
export function titleOf(k) {
  const e = state.entries.get(k) ?? entryOfHash(k);
  if (!e) return 'un torrent';
  const r = e.release;
  const ep = r?.season != null && r?.episode != null ? ` T${r.season}·E${r.episode}` : '';
  return `${r?.title || fullName(e)}${ep}`;
}
