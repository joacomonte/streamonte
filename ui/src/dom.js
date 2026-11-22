// @ts-check
// DOM compartido: buscar y crear elementos, íconos, barra de estado
// y avisos para lectores de pantalla.
import { activity } from './activity.js';
import { t } from './i18n.js';
// El set de íconos es uno solo, compartido con la web (relativo, no `$ui`: `node --test` no resuelve alias).
import { ICONS } from '../../packages/ui/src/components/icons.ts';

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

/** @param {string} name @param {number=} size @returns {HTMLSpanElement} */
export function icon(name, size = 16) {
  const s = el('span', { class: 'ico', 'aria-hidden': 'true' });
  s.innerHTML = `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${/** @type {Record<string, string>} */ (ICONS)[name]}</svg>`;
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

