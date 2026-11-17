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

/** Abre el selector junto a `anchor`; resuelve con la opción elegida o `undefined` (cancelado).
 *  Cada opción: `{label, sub?, art?, tip?}` (`art`: ilustración; sin ella, el ícono de audio). `big`:
 *  más grande (elegir reproductor). */
function openPk(btn, opts, title = 'Elegí el audio', big = false) {
  // La lista del catálogo se redibuja mientras se prepara (2026-11-16): el botón tocado ya no está
  // en la página y su posición daría 0,0 (arriba a la izquierda). Se usa el que lo reemplazó.
  const anchor = btn.isConnected ? btn : (btn.id && document.getElementById(btn.id)) || btn;
  if (pkBtn) closePk(false, true);
  wantTip(null);
  pk.querySelector('.pk-h').textContent = title;
  pk.classList.toggle('big', big);
  pk.querySelector('.pk-l').replaceChildren(...opts.map((o, i) => el('button', {
    id: `pk-o-${i}`, class: `pk-o${i ? '' : ' pri'}`, type: 'button', 'data-i': String(i), ...(o.tip ? { 'data-tip': o.tip } : {}),
  }, o.art ?? icon('speaker', 18), el('span', {}, el('b', {}, o.label), o.sub ? el('small', {}, o.sub) : null), icon('play', 16))));
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

// Idioma original (2026-11-16): va primero en el selector. Manda el de TMDB (con key); sin él, se
// adivina por el país de Cinemeta. Solo los casos que el selector ofrece (Latino / Inglés /
// Español); el resto no cambia el orden.
const EN = ['United States', 'USA', 'United Kingdom', 'UK', 'Canada', 'Australia', 'Ireland', 'New Zealand'];
const LAT = ['Mexico', 'Argentina', 'Colombia', 'Chile', 'Peru', 'Venezuela', 'Uruguay', 'Paraguay', 'Bolivia', 'Ecuador', 'Cuba', 'Guatemala', 'Costa Rica', 'Puerto Rico', 'Dominican Republic'];
/** Código de audio del idioma original (`en`, `lat`, `es`) o null. `lang`: ISO 639-1 de TMDB;
 *  el país (primero de la lista) solo decide si falta, o entre Latino y España si es español. */
export function originalAudio(country, lang) {
  const first = country?.split(',')[0].trim();
  if (lang === 'es') return first === 'Spain' ? 'es' : 'lat';
  if (lang) return lang === 'en' ? 'en' : null;
  return EN.includes(first) ? 'en' : LAT.includes(first) ? 'lat' : first === 'Spain' ? 'es' : null;
}

/** Pregunta el idioma si el video trae más de un audio. `null` = nada que elegir; `undefined` = cancelado.
 *  `original`: código del idioma original, que pasa a ser el primero (el preseleccionado). */
async function askAudio(e, anchor, original) {
  // Ordenadas y con etiquetas cortas por el núcleo (`audio::play_options`); el original, primero.
  const base = e?.audio_options ?? [];
  const opts = original ? [...base].sort((a, b) => (b.code === original) - (a.code === original)) : base;
  if (opts.length < 2) return null;
  const at = anchor ?? $('.topbar');
  // Solo se aclara lo confirmado por el análisis (2026-11-17: "adivinado por el nombre" era ruido).
  const i = await openPk(at, opts.map((o) => ({ label: o.label, sub: o.confirmed ? 'Pista confirmada' : null,
    tip: o.code === 'lat' ? 'Con Latino, los subtítulos arrancan ocultos (S los muestra).' : null })));
  return i === undefined ? undefined : { code: opts[i].code, aid: opts[i].aid };
}

/** Con VLC instalado y un mpv que anda (2026-11-17), pregunta con cuál; si no, el que haya (null =
 *  el de Ajustes, con VLC de respaldo). `undefined` = cerró el aviso: no se reproduce. */
async function askPlayer(anchor) {
  const p = await api.playersStatus().catch(() => null);
  if (!p?.vlc || !p.mpv) return null;
  // El selector de siempre, más grande y con un dibujito de cada uno (2026-11-17). El de Ajustes, primero.
  const opts = [
    { value: 'mpv', label: 'mpv', sub: 'Recomendado: más liviano, subtítulos combinados y ecualizador', art: playerArt('mpv') },
    { value: 'vlc', label: 'VLC', sub: 'El clásico: sin subtítulos combinados ni ecualizador', art: playerArt('vlc') },
  ].sort((a, b) => (b.value === p.chosen) - (a.value === p.chosen));
  const i = await openPk(anchor ?? $('.topbar'), opts, '¿Con qué lo abrimos?', true);
  return i === undefined ? undefined : opts[i].value;
}
/** Dibujito de cada reproductor (inline, sin archivos): mpv, un disco con ▶; VLC, el cono naranja. */
function playerArt(kind) {
  const span = el('span', { class: `pk-art ${kind}`, 'aria-hidden': 'true' });
  span.innerHTML = kind === 'mpv'
    ? '<svg viewBox="0 0 48 48"><circle cx="24" cy="24" r="21" fill="#4b2a8a"/><circle cx="24" cy="24" r="15" fill="#6a3fc4"/><path d="M20 16v16l13-8z" fill="#fff"/></svg>'
    : '<svg viewBox="0 0 48 48"><path d="M19 6h10l9 34H10z" fill="#ff8800"/><path d="M16.4 16h15.2l1.6 6H14.8zM13.8 26h20.4l1.6 6H12.2z" fill="#fff"/><rect x="6" y="38" width="36" height="5" rx="2.5" fill="#d96f00"/></svg>';
  return span;
}

/** `entry`: la fila, si el que llama la tiene antes de que llegue su evento (catálogo). `original`:
 *  código de audio del idioma original (`originalAudio`), primero en el selector.
 *  Devuelve `true` si el núcleo aceptó el pedido (no si se canceló o falló). */
export async function play(key, anchor, entry = state.entries.get(key), original = null) {
  try {
    // Si ESTE video ya está en el panel (pausado) se retoma con el audio que se eligió la otra
    // vez. Otro episodio del mismo pack no cuenta: es otra clave.
    const resuming = [...state.playbacks.values()].some((p) => p.key === key);
    const audio = resuming ? null : await askAudio(entry, anchor, original);
    if (audio === undefined) return;
    const player = resuming ? null : await askPlayer(anchor);
    if (player === undefined) return;
    anchor?.classList.add('busy');
    activity.push({ area: 'reproduccion', text: `${resuming ? 'Retomando' : 'Abriendo'} ${titleOf(key)}${audio?.code ? ` con audio ${audio.code === 'lat' ? 'latino' : audio.code === 'en' ? 'en inglés' : audio.code}` : ''}…` });
    await api.play(key, player, null, audio);
    setStatus('Preparando la reproducción…');
    return true;
  } catch (e) {
    showError(e);
  } finally {
    anchor?.classList.remove('busy');
  }
}
