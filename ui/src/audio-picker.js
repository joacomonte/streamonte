// Reproducir (FR-09b): si el video trae varios audios, pregunta Latino / Inglés en un selector
// anclado al botón Ver (diseño cards-v3) y abre mpv con el elegido.
import { api } from './api.js';
import { activity } from './activity.js';
import { $, el, icon, setStatus, showError } from './dom.js';
import { state, titleOf } from './state.js';
import { blockTips, wantTip } from './tooltip.js';

// ---------- selector de audio anclado al botón Ver (diseño cards-v3) ----------
const pk = el('div', { id: 'pk', class: 'pk', role: 'dialog', 'aria-labelledby': 'pkh' },
  el('div', { class: 'pk-h', id: 'pkh' }, 'Elegí el audio'), el('div', { class: 'pk-l' }));
pk.hidden = true;
document.body.append(pk);
let pkBtn = null;
let pkT;
let pkDone = null;

function closePk(refocus, instant) {
  if (!pkBtn) return;
  pk.classList.remove('on');
  pkBtn.setAttribute('aria-expanded', 'false');
  if (refocus) pkBtn.focus({ preventScroll: true });
  pkBtn = null;
  blockTips(false);
  clearTimeout(pkT);
  if (instant) pk.hidden = true; else pkT = setTimeout(() => (pk.hidden = true), 160);
  pkDone?.(undefined);
  pkDone = null;
}

/** Abre el selector junto a `anchor`; resuelve con la opción elegida o `undefined` (cancelado). */
function openPk(anchor, opts) {
  if (pkBtn) closePk(false, true);
  wantTip(null);
  pk.querySelector('.pk-l').replaceChildren(...opts.map((o, i) => el('button', {
    class: `pk-o${i ? '' : ' pri'}`, type: 'button', 'data-i': String(i),
    ...(o.code === 'lat' ? { 'data-tip': 'Con Latino, los subtítulos arrancan ocultos (S los muestra).' } : {}),
  }, icon('speaker', 18), el('span', {}, el('b', {}, o.label), el('small', {}, o.confirmed ? 'Pista confirmada' : 'Adivinado por el nombre')), icon('play', 16))));
  clearTimeout(pkT);
  pk.hidden = false;
  pk.classList.remove('on', 'up');
  const r = anchor.getBoundingClientRect();
  const w = pk.offsetWidth;
  const hgt = pk.offsetHeight;
  const left = Math.max(8, Math.min(innerWidth - w - 8, r.right - w));
  const up = r.bottom + 8 + hgt > innerHeight - 8 && r.top - hgt - 8 > 8;
  pk.classList.toggle('up', up);
  pk.style.left = `${left}px`;
  pk.style.top = `${up ? r.top - hgt - 8 : r.bottom + 8}px`;
  pk.style.transformOrigin = `${r.left + r.width / 2 - left}px ${up ? '100%' : '0'}`;
  pkBtn = anchor;
  blockTips(true);
  anchor.setAttribute('aria-expanded', 'true');
  void pk.offsetWidth; // arranca la transición desde el estado cerrado
  pk.classList.add('on');
  pk.querySelector('.pk-o').focus({ preventScroll: true });
  return new Promise((resolve) => { pkDone = resolve; });
}

pk.addEventListener('click', (ev) => {
  const o = ev.target.closest('.pk-o');
  if (!o) return;
  const done = pkDone;
  pkDone = null;
  closePk(true);
  done?.(Number(o.dataset.i));
});
pk.addEventListener('keydown', (ev) => {
  const os = [...pk.querySelectorAll('.pk-o')];
  const i = os.indexOf(document.activeElement);
  if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
    ev.preventDefault();
    os[(i + (ev.key === 'ArrowDown' ? 1 : -1) + os.length) % os.length].focus();
  }
});
pk.addEventListener('focusout', (ev) => { if (pkBtn && ev.relatedTarget && !pk.contains(ev.relatedTarget) && ev.relatedTarget !== pkBtn) closePk(false); });
document.addEventListener('pointerdown', (ev) => { if (pkBtn && !pk.contains(ev.target) && !pkBtn.contains(ev.target)) closePk(false); });
document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') { if (pkBtn) closePk(true); else wantTip(null); } });
document.addEventListener('scroll', () => { if (pkBtn) closePk(false); }, { capture: true, passive: true });

/** Pregunta el idioma si el video trae más de un audio. `null` = nada que elegir; `undefined` = cancelado. */
async function askAudio(e, anchor) {
  // Ya ordenadas y con etiquetas cortas por el núcleo (`audio::play_options`).
  const opts = e?.audio_options ?? [];
  if (opts.length < 2) return null;
  const at = anchor
    ?? document.querySelector(`.row[data-key="${e.key}"] [data-watch]`)
    ?? document.querySelector(`.row[data-key="${e.key}"]`)
    ?? $('.topbar');
  const i = await openPk(at, opts);
  return i === undefined ? undefined : { code: opts[i].code, aid: opts[i].aid };
}

/** `entry`: la fila, si el que llama la tiene antes de que llegue su evento (catálogo).
 *  Devuelve `true` si el núcleo aceptó el pedido (no si se canceló o falló). */
export async function play(key, anchor, entry = state.entries.get(key)) {
  try {
    // Si ESTE video ya está en el panel (pausado) se retoma con el audio que se eligió la otra
    // vez. Otro episodio del mismo pack no cuenta: es otra clave.
    const resuming = [...state.playbacks.values()].some((p) => p.key === key);
    const audio = resuming ? null : await askAudio(entry, anchor);
    if (audio === undefined) return;
    anchor?.classList.add('busy');
    activity.push({ area: 'reproduccion', text: `${resuming ? 'Retomando' : 'Abriendo'} ${titleOf(key)}${audio?.code ? ` con audio ${audio.code === 'lat' ? 'latino' : audio.code === 'en' ? 'en inglés' : audio.code}` : ''}…` });
    await api.play(key, null, null, audio);
    setStatus('Preparando la reproducción…');
    return true;
  } catch (e) {
    showError(e);
  } finally {
    anchor?.classList.remove('busy');
  }
}
