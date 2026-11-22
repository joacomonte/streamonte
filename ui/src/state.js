// @ts-check
// Fachada del estado en vivo (live.svelte.ts) para los JS que todavía no migraron (audio-picker.js, dialogs.js,
// catalog-options.js, speed.js): solo lectura de `entries`/`playbacks`; `logs`/`logOpenFor` son del diálogo de log.
import { live } from './live.svelte.ts';
import { titleOf as titleIn } from './live.ts';

export const state = {
  get entries() { return live.v.entries; },
  get playbacks() { return live.v.playbacks; },
  /** @type {Map<number, string[]>} id → líneas de log recibidas en vivo (tope del núcleo) */
  logs: new Map(),
  /** Reproducción cuyo log está abierto en el diálogo (o null). @type {number|null} */
  logOpenFor: null,
};

/** Nombre corto para los mensajes: de una fila (`key`) o de un torrent (info_hash). @param {string} k */
export const titleOf = (k) => titleIn(live.v, k);
