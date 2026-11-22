// @ts-check
// ---------- tooltip propio: burbuja animada en hover y foco de teclado (2026-11-14) ----------
// Reemplaza también los `title` nativos de toda la app (los pasa a `data-tip` al pasar por
// encima, antes de que el sistema muestre el suyo). Formato: "Título: explicación" → título en
// negrita + texto; "\n" separa párrafos; atajos "(Ctrl+V)", "(F5)", "(Enter)" van como teclas.
// Va en la capa superior (popover) para verse también sobre los diálogos.
import { el } from './dom.js';

const tip = el('div', { id: 'tip', class: 'tip', role: 'tooltip' });
const canPopover = typeof tip.showPopover === 'function';
if (canPopover) tip.setAttribute('popover', 'manual'); else tip.hidden = true;
document.body.append(tip);
/** @type {ReturnType<typeof setTimeout>|undefined} */
let tipT;
/** @type {ReturnType<typeof setTimeout>|undefined} */
let tipOffT;
/** @type {HTMLElement|null} */
let tipEl = null;
/** @type {HTMLElement|null} */
let tipFor = null;
/** Con el selector de audio abierto no se muestran tooltips (lo maneja `audio-picker.js`). */
let blocked = false;
/** @param {boolean} on */
export function blockTips(on) { blocked = on; }

const tipOpen = () => (canPopover ? tip.matches(':popover-open') : !tip.hidden);
function showTipLayer() { if (canPopover) { if (!tipOpen()) tip.showPopover(); } else tip.hidden = false; }
function hideTipLayer() { if (canPopover) { if (tipOpen()) tip.hidePopover(); } else tip.hidden = true; }
function hideTip() {
  clearTimeout(tipT);
  tip.classList.remove('on');
  clearTimeout(tipOffT);
  tipOffT = setTimeout(() => { if (!tip.classList.contains('on')) hideTipLayer(); }, 160);
  tipFor?.removeAttribute('aria-describedby');
  tipFor = null;
}

const KEY_RE = /\((Ctrl\+[^)]{1,12}|Shift\+[^)]{1,12}|Alt\+[^)]{1,12}|F\d{1,2}|Enter|Esc|Supr|Espacio)\)/g;
/** Texto con atajos de teclado como <kbd> (siempre como texto: puede traer nombres de torrents). */
/** @param {string} text @returns {(string|HTMLElement)[]} */
function withKeys(text) {
  /** @type {(string|HTMLElement)[]} */
  const out = [];
  let last = 0;
  for (const m of text.matchAll(KEY_RE)) {
    out.push(text.slice(last, m.index), el('kbd', {}, m[1]));
    last = (m.index ?? 0) + m[0].length;
  }
  out.push(text.slice(last));
  return out.filter((x) => x !== '');
}
/** @param {string} text */
function fillTip(text) {
  const paras = text.split('\n').map((p) => p.trim()).filter(Boolean);
  const m = paras[0]?.match(/^([^:\n]{2,42}):\s+(.+)$/);
  /** @type {HTMLElement[]} */
  const parts = [];
  if (m && !/https?$/.test(m[1])) {
    parts.push(el('strong', { class: 'tip-h' }, ...withKeys(m[1])));
    paras[0] = m[2].charAt(0).toUpperCase() + m[2].slice(1);
  }
  for (const p of paras) parts.push(el('p', {}, ...withKeys(p)));
  tip.classList.toggle('mini', !m && paras.length === 1 && text.length <= 48);
  tip.replaceChildren(el('span', { class: 'tip-arrow', 'aria-hidden': 'true' }), ...parts);
}

/** `title` nativo → `data-tip` (y nombre accesible si el botón es solo un ícono). */
/** @param {HTMLElement} n */
function adoptTitle(n) {
  const t = n.getAttribute('title');
  if (t == null) return;
  n.removeAttribute('title');
  if (!t.trim()) return;
  n.dataset.tip = t;
  if (!n.hasAttribute('aria-label') && (n.textContent ?? '').trim().length <= 2) n.setAttribute('aria-label', t);
}

/** Muestra el tooltip de `target` tras una pausa (o lo oculta con `null`). */
/** @param {HTMLElement|null} target */
export function wantTip(target) {
  if (target === tipEl) return;
  tipEl = target;
  clearTimeout(tipT);
  if (!target) { hideTip(); return; }
  tipT = setTimeout(() => {
    if (blocked || !target.isConnected || !target.dataset.tip) return;
    clearTimeout(tipOffT);
    tipFor?.removeAttribute('aria-describedby');
    const switching = tip.classList.contains('on');
    fillTip(target.dataset.tip);
    showTipLayer();
    if (!switching) tip.classList.remove('on');
    tip.classList.remove('below');
    const r = target.getBoundingClientRect();
    const w = tip.offsetWidth;
    const hgt = tip.offsetHeight;
    let y = r.top - hgt - 10;
    if (y < 8) { y = r.bottom + 10; tip.classList.add('below'); }
    const x = Math.max(8, Math.min(innerWidth - w - 8, r.left + r.width / 2 - w / 2));
    tip.style.left = `${x}px`;
    tip.style.top = `${y}px`;
    // La flecha apunta al centro del elemento aunque la burbuja se corra por el borde.
    tip.style.setProperty('--ax', `${Math.max(14, Math.min(w - 14, r.left + r.width / 2 - x))}px`);
    if (!target.hasAttribute('aria-label')) { target.setAttribute('aria-describedby', 'tip'); tipFor = target; }
    requestAnimationFrame(() => tip.classList.add('on'));
  }, Number(target.dataset.tipDelay) || (tip.classList.contains('on') ? 60 : 380)); // `data-tip-delay`: espera propia (fila de opción: 2 s)
}
/** @param {EventTarget|null} t @returns {HTMLElement|null} */
function tipScope(t) {
  const n = /** @type {HTMLElement|null} */ ((/** @type {Element} */ (t)).closest?.('[data-tip], [title]'));
  if (n?.hasAttribute('title')) adoptTitle(n);
  return n?.dataset.tip ? n : null;
}
document.addEventListener('pointerover', (ev) => wantTip(tipScope(ev.target)));
document.addEventListener('pointerout', (ev) => { if (!ev.relatedTarget) wantTip(null); });
document.addEventListener('pointerdown', () => wantTip(null), true);
document.addEventListener('focusin', (ev) => { const t = tipScope(ev.target); wantTip(t && t.matches(':focus-visible') ? t : null); });
document.addEventListener('focusout', () => wantTip(null));
document.addEventListener('scroll', () => wantTip(null), { capture: true, passive: true });
