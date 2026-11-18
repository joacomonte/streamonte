// Reproducir (FR-09b): un panel con pasos anclado al botón Ver (reproductor, audio y, en el catálogo,
// subtítulos) y abre el reproductor con lo elegido.
import { api } from './api.js';
import { activity } from './activity.js';
import { $, el, icon, setStatus, showError } from './dom.js';
import { state, titleOf } from './state.js';
import { blockTips, wantTip } from './tooltip.js';

// ---------- Reproducir: un solo panel con pasos, anclado al ▶ (2026-11-18) ----------
// Reproductor → audio → subtítulos (los que no aplican se saltean). Cada paso entra deslizándose; "‹" vuelve al
// anterior. Elegir en el último cierra el panel y resuelve con lo elegido; cerrar (Esc, clic afuera) cancela.
const pkBack = el('button', { id: 'pk-back', type: 'button', class: 'pk-back', 'aria-label': 'Paso anterior', hidden: true }, icon('arrow', 14));
const pkDots = el('span', { class: 'pk-dots', 'aria-hidden': 'true' });
const pkBody = el('div', { class: 'pk-l' });
const pk = el('div', { id: 'pk', class: 'pk', role: 'dialog', 'aria-labelledby': 'pkh' },
  el('div', { class: 'pk-top' }, pkBack, el('div', { class: 'pk-h', id: 'pkh' }), pkDots), pkBody);
pk.hidden = true;
document.body.append(pk);
let pkBtn = null;
let pkT;
/** El flujo abierto: {steps, i, results, resolve}. */
let wiz = null;

function closePk(refocus, instant) {
  if (!pkBtn) return;
  pk.classList.remove('on');
  pkBtn.setAttribute('aria-expanded', 'false');
  if (refocus) pkBtn.focus({ preventScroll: true });
  pkBtn = null;
  blockTips(false);
  clearTimeout(pkT);
  if (instant) pk.hidden = true; else pkT = setTimeout(() => (pk.hidden = true), 160);
  const w = wiz;
  wiz = null;
  w?.resolve(undefined);
}
/** Cierra el panel de Reproducir si está abierto (cancela). */
export const closeWizard = () => closePk(false);

/** El botón en la página: la lista del catálogo se redibuja mientras se prepara (2026-11-16) y el tocado ya no está
 *  (su posición daría 0,0). Se usa el que lo reemplazó: mismo `id`, o mismo `data-anchor` (▶ → Cancelar). */
function live(btn) {
  if (btn.isConnected) return btn;
  return (btn.id && document.getElementById(btn.id))
    || (btn.dataset?.anchor && document.querySelector(`[data-anchor="${btn.dataset.anchor}"]`)) || btn;
}

/** Ubica el panel junto a su botón (abajo, o arriba si no entra); se repite al cambiar de paso. */
function place() {
  pkBtn = live(pkBtn);
  const r = pkBtn.getBoundingClientRect();
  const w = pk.offsetWidth;
  const hgt = pk.offsetHeight;
  const left = Math.max(8, Math.min(innerWidth - w - 8, r.right - w));
  const up = r.bottom + 8 + hgt > innerHeight - 8 && r.top - hgt - 8 > 8;
  pk.classList.toggle('up', up);
  pk.style.left = `${left}px`;
  pk.style.top = `${Math.max(8, up ? r.top - hgt - 8 : r.bottom + 8)}px`;
  pk.style.transformOrigin = `${r.left + r.width / 2 - left}px ${up ? '100%' : '0'}`;
}

/** Dibuja el paso actual. `dir`: 1 = avanzó, -1 = volvió, 0 = mismo paso actualizado (sin animación). */
function renderStep(dir) {
  const step = wiz.steps[wiz.i];
  pk.querySelector('.pk-h').textContent = step.title;
  pk.classList.toggle('big', !!step.big || !!step.render);
  pkBack.hidden = wiz.i === 0;
  pkDots.replaceChildren(...(wiz.steps.length > 1 ? wiz.steps.map((_, i) => el('i', { class: i === wiz.i ? 'on' : i < wiz.i ? 'done' : '' })) : []));
  const content = step.render ? step.render(next) : step.opts.map((o, i) => el('button', {
    id: `pk-o-${step.id}-${i}`, class: `pk-o${i ? '' : ' pri'}`, type: 'button', 'data-i': String(i), ...(o.tip ? { 'data-tip': o.tip } : {}),
    onclick: () => next(i),
  }, o.art ?? icon('speaker', 18), el('span', {}, el('b', {}, o.label), o.sub ? el('small', {}, o.sub) : null)));
  pkBody.replaceChildren(...[content].flat().filter(Boolean));
  pkBody.classList.remove('step-next', 'step-prev');
  if (dir) { void pkBody.offsetWidth; pkBody.classList.add(dir > 0 ? 'step-next' : 'step-prev'); }
  place();
  if (dir || !pk.contains(document.activeElement)) (pkBody.querySelector('button:not([disabled])') ?? pk).focus({ preventScroll: true });
}
function next(value) {
  if (!wiz) return;
  wiz.results[wiz.steps[wiz.i].id] = value;
  if (wiz.i + 1 < wiz.steps.length) { wiz.i++; renderStep(1); return; }
  const w = wiz;
  wiz = null;
  closePk(true);
  w.resolve(w.results);
}
pkBack.addEventListener('click', () => { if (wiz?.i) { wiz.i--; renderStep(-1); } });
// Un paso propio (subtítulos) avisa que cambió lo que muestra: se redibuja sin animar.
document.addEventListener('subs-changed', () => { if (wiz?.steps[wiz.i].render) renderStep(0); });

/** Abre el panel junto a `btn` con sus pasos y resuelve con `{[id]: valor}` o `undefined` (se cerró). Cada paso:
 *  `{id, title, opts: [{label, sub?, art?, tip?}], big?}` (valor = índice elegido) o `{id, title, render(next)}`
 *  (dibuja lo suyo y llama `next(valor)` para seguir). */
export function openWizard(btn, steps) {
  const anchor = live(btn);
  if (pkBtn) closePk(false, true);
  wantTip(null);
  clearTimeout(pkT);
  pk.hidden = false;
  pk.classList.remove('on', 'up');
  pkBtn = anchor;
  blockTips(true);
  anchor.setAttribute('aria-expanded', 'true');
  const done = new Promise((resolve) => { wiz = { steps, i: 0, results: {}, resolve }; });
  renderStep(0);
  void pk.offsetWidth; // arranca la transición desde el estado cerrado
  pk.classList.add('on');
  return done;
}

pk.addEventListener('keydown', (ev) => {
  const os = [...pk.querySelectorAll('.pk-o')];
  const i = os.indexOf(document.activeElement);
  if (os.length && (ev.key === 'ArrowDown' || ev.key === 'ArrowUp')) {
    ev.preventDefault();
    os[(i + (ev.key === 'ArrowDown' ? 1 : -1) + os.length) % os.length].focus();
  }
});
document.addEventListener('pointerdown', (ev) => { if (pkBtn && !pk.contains(ev.target) && !live(pkBtn).contains(ev.target)) closePk(false); });
document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') { if (pkBtn) closePk(true); else wantTip(null); } });
// Scroll de la página (no el de adentro del panel): el ▶ se movió.
document.addEventListener('scroll', (ev) => { if (pkBtn && !pk.contains(ev.target)) closePk(false); }, { capture: true, passive: true });

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

/** Audios para elegir si el video trae más de uno (si no, `null`): ordenados y con etiquetas cortas por el núcleo
 *  (`audio::play_options`); `original`, el código del idioma original, va primero (el preseleccionado). */
function audioOptions(e, original) {
  const base = e?.audio_options ?? [];
  const opts = original ? [...base].sort((a, b) => (b.code === original) - (a.code === original)) : base;
  return opts.length < 2 ? null : opts;
}

/** Con VLC instalado y un mpv que anda (2026-11-17), con cuál; si no, `null` (el de Ajustes, con VLC de respaldo).
 *  El de Ajustes, primero. */
async function playerOptions() {
  const p = await api.playersStatus().catch(() => null);
  if (!p?.vlc || !p.mpv) return null;
  return [
    { value: 'mpv', label: 'mpv', sub: 'Recomendado: más liviano, subtítulos combinados y ecualizador', art: playerArt('mpv') },
    { value: 'vlc', label: 'VLC', sub: 'El clásico: sin subtítulos combinados ni ecualizador', art: playerArt('vlc') },
  ].sort((a, b) => (b.value === p.chosen) - (a.value === p.chosen));
}
/** Dibujito de cada reproductor (inline, sin archivos): mpv, un disco con ▶; VLC, el cono naranja. */
function playerArt(kind) {
  const span = el('span', { class: `pk-art ${kind}`, 'aria-hidden': 'true' });
  span.innerHTML = kind === 'mpv'
    ? '<svg viewBox="0 0 48 48"><circle cx="24" cy="24" r="21" fill="#4b2a8a"/><circle cx="24" cy="24" r="15" fill="#6a3fc4"/><path d="M20 16v16l13-8z" fill="#fff"/></svg>'
    : '<svg viewBox="0 0 48 48"><path d="M19 6h10l9 34H10z" fill="#ff8800"/><path d="M16.4 16h15.2l1.6 6H14.8zM13.8 26h20.4l1.6 6H12.2z" fill="#fff"/><rect x="6" y="38" width="36" height="5" rx="2.5" fill="#d96f00"/></svg>';
  return span;
}

/** Preparar la reproducción en un solo panel con pasos: reproductor → audio → subtítulos → abrirlo. Es el único
 *  camino al reproductor. `entry`: la fila, si el que llama la tiene antes de que llegue su evento (catálogo).
 *  `original`: código de audio del idioma original (`originalAudio`), primero. `subsStep(next)`: el paso de
 *  subtítulos (catálogo, 2026-11-18). `start(player, audio)`: cómo se abre (catálogo: motor o TorBox); sin él, por
 *  el motor. Devuelve `true` si el núcleo aceptó el pedido (no si se canceló o falló). */
export async function play(key, anchor, entry = state.entries.get(key), original = null, subsStep = null, start = null) {
  try {
    // Si ESTE video ya está en el panel (pausado) se retoma con el audio que se eligió la otra
    // vez. Otro episodio del mismo pack no cuenta: es otra clave.
    const resuming = [...state.playbacks.values()].some((p) => p.key === key);
    const players = resuming ? null : await playerOptions();
    const audios = resuming ? null : audioOptions(entry, original);
    const steps = [
      players && { id: 'player', title: '¿Con qué lo abrimos?', big: true, opts: players },
      // Solo se aclara lo confirmado por el análisis (2026-11-17: "adivinado por el nombre" era ruido).
      audios && { id: 'audio', title: 'Elegí el audio', opts: audios.map((o) => ({ label: o.label, sub: o.confirmed ? 'Pista confirmada' : null,
        tip: o.code === 'lat' ? 'Con Latino, los subtítulos arrancan ocultos (S los muestra).' : null })) },
      !resuming && subsStep && { id: 'subs', title: 'Subtítulos', render: subsStep },
    ].filter(Boolean);
    const got = steps.length ? await openWizard(anchor ?? $('.topbar'), steps) : {};
    if (!got) return;
    const player = got.player != null ? players[got.player].value : null;
    const audio = got.audio != null ? { code: audios[got.audio].code, aid: audios[got.audio].aid } : null;
    anchor?.classList.add('busy');
    activity.push({ area: 'reproduccion', text: `${resuming ? 'Retomando' : 'Abriendo'} ${titleOf(key)}${audio?.code ? ` con audio ${audio.code === 'lat' ? 'latino' : audio.code === 'en' ? 'en inglés' : audio.code}` : ''}…` });
    if (start) return await start(player, audio);
    await api.play(key, player, null, audio);
    setStatus('Cargando…');
    return true;
  } catch (e) {
    showError(e);
  } finally {
    anchor?.classList.remove('busy');
  }
}
