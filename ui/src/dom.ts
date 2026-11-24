// DOM compartido: buscar y crear elementos, íconos, barra de estado
// y avisos para lectores de pantalla.
import { activity } from './live.svelte.ts';
import { t } from './i18n.ts';
// El set de íconos es uno solo, compartido con la web (relativo, no `$ui`: `node --test` no resuelve alias).
import { ICONS } from '../../packages/ui/src/components/icons.ts';

/** Busca un elemento que tiene que existir (si no, el error salta recién al usarlo). El tipo por defecto es HTMLElement:
 *  `$('#x')` → HTMLElement; para uno más específico, `$<HTMLInputElement>('#x')`. */
export const $ = <E extends Element = HTMLElement>(sel: string): E => document.querySelector(sel) as E;

/** `$` para un `<input>` (`.value`, `.checked`, `.disabled`). */
export const $input = (sel: string): HTMLInputElement => document.querySelector(sel) as HTMLInputElement;
/** `$` para un `<button>` (`.disabled`). */
export const $button = (sel: string): HTMLButtonElement => document.querySelector(sel) as HTMLButtonElement;

// Nombre viejo → nuevo (2026-11-15): las preferencias guardadas como `tstream.*` pasan a
// `streamonte.*` una sola vez. dom.ts se evalúa antes que los módulos que las leen al cargar.
try {
  for (const k of Object.keys(localStorage)) {
    if (!k.startsWith('tstream.')) continue;
    const to = `streamonte.${k.slice('tstream.'.length)}`;
    if (localStorage.getItem(to) === null) localStorage.setItem(to, localStorage.getItem(k) ?? '');
    localStorage.removeItem(k);
  }
} catch { /* sin almacenamiento */ }

export type ElLeaf = Node | string | number | boolean | null | undefined;
/** Los arrays se aplanan (hasta 2 niveles tipados). */
export type ElChild = ElLeaf | ElLeaf[] | ElLeaf[][];
/** `on*` = listener (borde con el DOM: `any`). */
export type ElAttr = string | number | boolean | null | undefined | ((e: any) => void);

/** Crea un elemento. `attrs`: atributos (null/false no se ponen; true = atributo vacío) y `on*`
 *  como listeners. Hijos: nodos o texto; null/false se saltean y los arrays se aplanan. */
export function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, ElAttr> = {}, ...children: ElChild[]): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (k === 'class') node.className = String(v);
    else node.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children.flat(Infinity) as ElLeaf[]) if (c != null && c !== false) node.append(c instanceof Node ? c : String(c));
  return node;
}

export function icon(name: string, size = 16): HTMLSpanElement {
  const s = el('span', { class: 'ico', 'aria-hidden': 'true' });
  s.innerHTML = `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${(ICONS as Record<string, string>)[name]}</svg>`;
  return s;
}

/** Los mensajes del núcleo (Rust) llegan en español: pasan por el diccionario como cualquier texto. */
export function setStatus(message: string): void {
  $('#status').textContent = t(message);
}

/** UiError {message, detail}: mostrar `message`, nunca el detalle técnico (NFR-12).
 *  Por defecto se anota también en la burbuja de actividad; el catálogo pasa
 *  `{ activity: false, ignoreCancelled: true }` (solo la barra, y sin los "Cancelado.").
 */
export function showError(err: unknown, { activity: toActivity = true, ignoreCancelled = false }: { activity?: boolean; ignoreCancelled?: boolean } = {}): void {
  const message = (err as { message?: string } | null | undefined)?.message;
  if (ignoreCancelled && message === 'Cancelado.') return;
  const msg = t(message ?? String(err));
  setStatus(msg);
  if (toActivity) activity.push({ area: 'general', level: 'error', text: msg });
}

