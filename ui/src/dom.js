// DOM compartido: buscar y crear elementos, íconos, barra de estado
// y avisos para lectores de pantalla.
import { activity } from './activity.js';

export const $ = (sel) => document.querySelector(sel);

// Nombre viejo → nuevo (2026-11-15): las preferencias guardadas como `tstream.*` pasan a
// `streamonte.*` una sola vez. dom.js se evalúa antes que los módulos que las leen al cargar.
try {
  for (const k of Object.keys(localStorage)) {
    if (!k.startsWith('tstream.')) continue;
    const to = `streamonte.${k.slice('tstream.'.length)}`;
    if (localStorage.getItem(to) === null) localStorage.setItem(to, localStorage.getItem(k));
    localStorage.removeItem(k);
  }
} catch { /* sin almacenamiento */ }

/** Crea un elemento. `attrs`: atributos (null/false no se ponen; true = atributo vacío) y `on*`
 *  como listeners. Hijos: nodos o texto; null/false se saltean y los arrays se aplanan. */
export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else if (k === 'class') node.className = v;
    else node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c != null && c !== false) node.append(c instanceof Node ? c : String(c));
  return node;
}

// Íconos dibujados (trazo 2, 24×24), no glifos Unicode.
const ICONS = {
  play: '<path d="M7 4.8v14.4a1 1 0 0 0 1.5.86l11.5-7.2a1 1 0 0 0 0-1.72L8.5 3.94A1 1 0 0 0 7 4.8z" fill="currentColor" stroke="none"/>',
  pause: '<rect x="6" y="5" width="4" height="14" rx="1.2" fill="currentColor" stroke="none"/><rect x="14" y="5" width="4" height="14" rx="1.2" fill="currentColor" stroke="none"/>',
  resume: '<path d="M8 5.5v13l10-6.5z"/>',
  refresh: '<path d="M20 12a8 8 0 1 1-2.34-5.66L20 8.5"/><path d="M20 4v4.5h-4.5"/>',
  // Filas (diseño cards-v3)
  chev: '<path d="M6 9l6 6 6-6"/>',
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
};
export function icon(name, size = 16) {
  const s = el('span', { class: 'ico', 'aria-hidden': 'true' });
  s.innerHTML = `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[name]}</svg>`;
  return s;
}

export function setStatus(message) {
  $('#status').textContent = message;
}

/** UiError {message, detail}: mostrar `message`, nunca el detalle técnico (NFR-12).
 *  Por defecto se anota también en la burbuja de actividad; el catálogo pasa
 *  `{ activity: false, ignoreCancelled: true }` (solo la barra, y sin los "Cancelado."). */
export function showError(err, { activity: toActivity = true, ignoreCancelled = false } = {}) {
  if (ignoreCancelled && err?.message === 'Cancelado.') return;
  const msg = err?.message ?? String(err);
  setStatus(msg);
  if (toActivity) activity.push({ area: 'general', level: 'error', text: msg });
}

