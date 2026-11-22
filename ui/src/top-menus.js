// @ts-check
// Menú desplegable de la barra superior que todavía usa speed.js (Velocidad). El magnet copiado y Descargas ya son
// Svelte (components/CopiedMagnet.svelte, components/Downloads.svelte); se borra cuando speed.js migre.
import { el } from './dom.js';

const pop = el('div', { id: 'top-pop', class: 'top-pop', role: 'dialog', hidden: true });
document.body.append(pop);
/** Menú abierto: `{ btn, render }`, o `null`. @type {{btn: HTMLElement, render: () => unknown}|null} */
let open = null;

export function closePop() {
  if (!open) return;
  open.btn.setAttribute('aria-expanded', 'false');
  open.btn.classList.remove('active');
  open = null;
  pop.hidden = true;
  pop.replaceChildren();
}

/** Abre (o cierra, si ya estaba) el menú de `btn`; `render` llena `pop`. También lo usa `speed.js`. */
/** @param {HTMLElement} btn @param {() => unknown} render */
export async function togglePop(btn, render) {
  if (open?.btn === btn) { closePop(); return; }
  closePop();
  open = { btn, render };
  btn.setAttribute('aria-expanded', 'true');
  btn.classList.add('active');
  pop.setAttribute('aria-label', (btn.textContent ?? '').trim());
  const r = btn.getBoundingClientRect();
  pop.style.top = `${r.bottom + 8}px`;
  pop.style.right = `${Math.max(12, window.innerWidth - r.right)}px`;
  pop.hidden = false;
  await render();
}

document.addEventListener('pointerdown', (ev) => {
  const target = /** @type {Element} */ (ev.target);
  if (open && !pop.contains(target) && !open.btn.contains(target) && !target.closest('dialog')) closePop();
});
document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && open && !document.querySelector('dialog[open]')) closePop(); });
window.addEventListener('resize', closePop);

/** El elemento del menú abierto si es el de `btnId` (para redibujarlo), o null. */
/** @param {string} btnId @returns {HTMLElement|null} */
export const popFor = (btnId) => (open?.btn.id === btnId ? pop : null);
