// @ts-check
// DOM compartido: buscar y crear elementos, íconos, barra de estado
// y avisos para lectores de pantalla.
import { activity } from './activity.js';
import { t } from './i18n.js';

/** Busca un elemento que tiene que existir (si no, el error salta recién al usarlo). El tipo por defecto es HTMLElement:
 *  `$('#x')` → HTMLElement; para uno más específico, `$('#x')` con `@type {HTMLInputElement}` en un cast JSDoc.
 *  @template {Element} [E=HTMLElement] @param {string} sel @returns {E} */
export const $ = (sel) => /** @type {E} */ (document.querySelector(sel));

/** `$` para un `<input>` (`.value`, `.checked`, `.disabled`). @param {string} sel @returns {HTMLInputElement} */
export const $input = (sel) => /** @type {HTMLInputElement} */ (document.querySelector(sel));
/** `$` para un `<button>` (`.disabled`). @param {string} sel @returns {HTMLButtonElement} */
export const $button = (sel) => /** @type {HTMLButtonElement} */ (document.querySelector(sel));

// Nombre viejo → nuevo (2026-11-15): las preferencias guardadas como `tstream.*` pasan a
// `streamonte.*` una sola vez. dom.js se evalúa antes que los módulos que las leen al cargar.
try {
  for (const k of Object.keys(localStorage)) {
    if (!k.startsWith('tstream.')) continue;
    const to = `streamonte.${k.slice('tstream.'.length)}`;
    if (localStorage.getItem(to) === null) localStorage.setItem(to, localStorage.getItem(k) ?? '');
    localStorage.removeItem(k);
  }
} catch { /* sin almacenamiento */ }

/** @typedef {Node|string|number|boolean|null|undefined} ElLeaf */
/** @typedef {ElLeaf|ElLeaf[]|ElLeaf[][]} ElChild  los arrays se aplanan (hasta 2 niveles tipados) */
/** @typedef {string|number|boolean|null|undefined|((e: any) => void)} ElAttr  `on*` = listener (borde con el DOM: `any`) */

/** Crea un elemento. `attrs`: atributos (null/false no se ponen; true = atributo vacío) y `on*`
 *  como listeners. Hijos: nodos o texto; null/false se saltean y los arrays se aplanan. */
/** @template {keyof HTMLElementTagNameMap} K @param {K} tag @param {Record<string, ElAttr>=} attrs @param {ElChild[]} children @returns {HTMLElementTagNameMap[K]} */
export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (k === 'class') node.className = String(v);
    else node.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of /** @type {ElLeaf[]} */ (children.flat(Infinity))) if (c != null && c !== false) node.append(c instanceof Node ? c : String(c));
  return node;
}

// Íconos dibujados (trazo 2, 24×24), no glifos Unicode.
/** @type {Record<string, string>} */
const ICONS = {
  play: '<path d="M7 4.8v14.4a1 1 0 0 0 1.5.86l11.5-7.2a1 1 0 0 0 0-1.72L8.5 3.94A1 1 0 0 0 7 4.8z" fill="currentColor" stroke="none"/>',
  pause: '<rect x="6" y="5" width="4" height="14" rx="1.2" fill="currentColor" stroke="none"/><rect x="14" y="5" width="4" height="14" rx="1.2" fill="currentColor" stroke="none"/>',
  resume: '<path d="M8 5.5v13l10-6.5z"/>',
  refresh: '<path d="M20 12a8 8 0 1 1-2.34-5.66L20 8.5"/><path d="M20 4v4.5h-4.5"/>',
  // Filas (diseño cards-v3)
  chev: '<path d="M6 9l6 6 6-6"/>',
  arrow: '<path d="M5 12h14"/><path d="M13 6l6 6-6 6"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1.08-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1.08 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
  lock: '<rect x="5" y="10.5" width="14" height="10" rx="2.5"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5" stroke-width="2.4"/>',
  // Análisis profundo: un radar (se conectó y "escuchó" al enjambre).
  radar: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><path d="M12 12l5.5-5.5"/><circle cx="12" cy="12" r="1" fill="currentColor"/>',
  gauge: '<path d="M4.6 18.5a9 9 0 1 1 14.8 0"/><path d="M12 14.5l4.2-5"/><path d="M7 10.5l.9.6M12 6.8v1M17 10.5l-.9.6"/><circle cx="12" cy="14.5" r="1.6" fill="currentColor"/>',
  speaker: '<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2.5"/><path d="M16 8V6.5A2.5 2.5 0 0 0 13.5 4h-7A2.5 2.5 0 0 0 4 6.5v7A2.5 2.5 0 0 0 6.5 16H8"/>',
  subs: '<rect x="3" y="5.5" width="18" height="13" rx="3"/><path d="M10.5 10.2a2.2 2.2 0 1 0 0 3.6M17 10.2a2.2 2.2 0 1 0 0 3.6"/>',
  stop: '<rect x="6.5" y="6.5" width="11" height="11" rx="2" fill="currentColor" stroke="none"/>',
  download: '<path d="M12 4v11"/><path d="M7 10.5l5 5 5-5"/><path d="M5 19.5h14"/>',
  quick: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.3 15.3L20 20"/><path d="M11.5 6.8L9 10.8h3l-2.3 3.6"/>',
  external: '<path d="M14 4h6v6"/><path d="M20 4l-9 9"/><path d="M18 14v4.5A1.5 1.5 0 0 1 16.5 20h-11A1.5 1.5 0 0 1 4 18.5v-11A1.5 1.5 0 0 1 5.5 6H10"/>',
  // Tendencia del gráfico de temporadas y estado de la serie (2026-11-16).
  'trend-up': '<path d="M3 17l6-6 4 4 8-8"/><path d="M14 7h7v7"/>',
  'trend-down': '<path d="M3 7l6 6 4-4 8 8"/><path d="M14 17h7v-7"/>',
  'trend-flat': '<path d="M3 12h17"/><path d="M15 7l5 5-5 5"/>',
  folder: '<path d="M3 7.5A1.5 1.5 0 0 1 4.5 6h4.4l2 2.2h8.6A1.5 1.5 0 0 1 21 9.7v8.8a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5z"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4 4"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5.5"/><circle cx="12" cy="7.8" r=".9" fill="currentColor"/>',
  monitor: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>',
  award: '<circle cx="12" cy="9" r="6"/><path d="M8.6 13.9 7 21l5-2.6 5 2.6-1.6-7.1"/>',
  flag: '<path d="M5 21V4"/><path d="M5 4h12l-2.5 4.5L17 13H5"/>',
  ban: '<circle cx="12" cy="12" r="9"/><path d="M5.6 5.6l12.8 12.8"/>',
  list: '<path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1" fill="currentColor"/><circle cx="4.5" cy="12" r="1" fill="currentColor"/><circle cx="4.5" cy="18" r="1" fill="currentColor"/>',
  // Torrent (P2P, 2026-11-18): pares conectados entre sí.
  peers: '<circle cx="12" cy="5" r="2.5"/><circle cx="5" cy="18" r="2.5"/><circle cx="19" cy="18" r="2.5"/><path d="M10.8 7.2 6.2 15.8M13.2 7.2l4.6 8.6M7.5 18h9"/>',
  // Explorar, idiomas y bienvenida (2026-11-20, los de la web).
  star: '<path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z" fill="currentColor" stroke="none"/>',
  flame: '<path d="M12 21c-3.9 0-6.5-2.6-6.5-6.2 0-3.3 2.4-5.4 3.6-8.3.4 1.7 1.3 2.8 2.4 3.4.2-2.9 1.8-5.4 3.9-6.9-.3 2.8.8 4.6 2.2 6.2 1.3 1.5 2.4 3.1 2.4 5.6 0 3.6-2.6 6.2-6.5 6.2z"/>',
  film: '<rect x="3.5" y="4" width="17" height="16" rx="2.5"/><path d="M7.5 4v16M16.5 4v16M3.5 9h4M3.5 15h4M16.5 9h4M16.5 15h4"/>',
  tv: '<rect x="3" y="6" width="18" height="12.5" rx="2.5"/><path d="M8.5 2.5 12 6l3.5-3.5M8 21h8"/>',
  sliders: '<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4.5 20a7.5 7.5 0 0 1 15 0"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.6 3.7 5.6 3.7 9s-1.2 6.4-3.7 9c-2.5-2.6-3.7-5.6-3.7-9S9.5 5.6 12 3z"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="M10.8 12.2 19 4M15.5 7.5l2.5 2.5M17.5 5.5 20 8"/>',
  cloud: '<path d="M7 18.5h10a4 4 0 0 0 .6-7.95A6 6 0 0 0 6.2 9.2 4.7 4.7 0 0 0 7 18.5z"/>',
};
/** @param {string} name @param {number=} size @returns {HTMLSpanElement} */
export function icon(name, size = 16) {
  const s = el('span', { class: 'ico', 'aria-hidden': 'true' });
  s.innerHTML = `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[name]}</svg>`;
  return s;
}

/** Los mensajes del núcleo (Rust) llegan en español: pasan por el diccionario como cualquier texto. */
/** @param {string} message */
export function setStatus(message) {
  $('#status').textContent = t(message);
}

/** UiError {message, detail}: mostrar `message`, nunca el detalle técnico (NFR-12).
 *  Por defecto se anota también en la burbuja de actividad; el catálogo pasa
 *  `{ activity: false, ignoreCancelled: true }` (solo la barra, y sin los "Cancelado.").
 *  @param {unknown} err @param {{activity?: boolean, ignoreCancelled?: boolean}=} opts */
export function showError(err, { activity: toActivity = true, ignoreCancelled = false } = {}) {
  const message = /** @type {{message?: string}|null|undefined} */ (err)?.message;
  if (ignoreCancelled && message === 'Cancelado.') return;
  const msg = t(message ?? String(err));
  setStatus(msg);
  if (toActivity) activity.push({ area: 'general', level: 'error', text: msg });
}

