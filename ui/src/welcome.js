// Bienvenida por pasos a pantalla completa (2026-11-20, como Tour de la web), una sola vez: idioma de la app →
// idioma de los títulos → qué es la app → keys (TMDB / TorBox) → reproductor (mpv / VLC, solo informa). Flechas y
// botones para moverse; Saltar, Listo o Esc la cierran (se agranda apenas y se apaga) y la portada entra animada.
// Cambiar el idioma recarga la ventana: el paso abierto queda guardado y se retoma ahí. Solo anima transform y opacity.
import { api } from './api.js';
import { el, icon } from './dom.js';
import { t } from './i18n.js';
import { langPicker } from './lang-picker.js';
import { safeGet, safeSet } from './catalog-state.js';

/** 'done' = ya la vio (o la salteó); un número = el paso abierto (para retomarla tras recargar por el idioma). */
const STORE = 'streamonte.welcome';
/** Desde la carga del módulo: las tarjetas que se arman antes de abrirla ya esperan (app.js la abre al arrancar). */
let touring = safeGet(STORE) !== 'done';
/** La bienvenida tapa la portada: las tarjetas esperan para entrar (catalog.js). */
export const isTouring = () => touring;

const still = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

function steps() {
  return [
    { icon: 'globe', title: t('¿En qué idioma querés la app?'), body: t('Menús, botones y sinopsis. Lo cambiás cuando quieras en Ajustes.'), extra: () => langPicker('welcome-lang', 'app') },
    { icon: 'film', title: t('¿En qué idioma querés ver los títulos de pelis y series?'), body: t('Puede ser distinto del de la app. También lo cambiás en Ajustes.'), extra: () => langPicker('welcome-lang', 'titles') },
    { icon: 'play', title: t('Bienvenido a Streamonte'), body: t('Elegís una peli o un episodio y lo mirás al instante en esta compu: por torrent o desde TorBox, con audio latino o el original y subtítulos en español.') },
    { icon: 'key', title: t('Dos keys para sacarle todo'), body: t('Se pegan en Ajustes y quedan en el almacén seguro del sistema.'), extra: keysBox },
    { icon: 'monitor', title: t('Se ve en mpv o VLC'), body: t('Los videos se abren en un reproductor de esta compu. mpv viene recomendado: anda mejor, gasta menos y combina subtítulos.'), extra: playersBox },
  ];
}

/** Keys: para qué sirve cada una, si ya está y dónde pedirla. */
function keysBox() {
  const box = el('ul', { class: 'tour-list' });
  const row = (service, name, what, has) => el('li', { class: 'tour-item' },
    el('span', { class: 'tour-item-text' }, el('b', {}, name, has ? el('span', { class: 'tour-ok' }, icon('check', 12), t('Lista')) : null), el('small', {}, what)),
    has ? null : el('button', { id: `welcome-key-${service}`, type: 'button', onclick: () => api.openKeyPage(service).catch(() => {}) }, icon('external', 14), t('Pedirla')));
  const draw = (configured) => box.replaceChildren(
    row('tmdb', t('TMDB · gratis'), t('El catálogo con filtros por fecha, votos, idioma y géneros, pósters que faltan y dónde verla.'), configured.has('tmdb')),
    row('torbox', t('TorBox · pago, opcional'), t('Ve al instante desde sus servidores, sin depender de los seeds, y baja lo que todavía no tiene.'), configured.has('torbox')));
  draw(new Set());
  api.apiKeys().then((ks) => draw(new Set(ks.filter((k) => k.configured).map((k) => k.service)))).catch(() => {});
  return box;
}

/** Reproductores de esta compu: solo informa (cuál usar se elige al reproducir; mpv se instala desde Ajustes). */
function playersBox() {
  const box = el('ul', { class: 'tour-list' });
  const state = (s) => (s === 'bundled' ? t('Incluido en la app') : s ? t('Instalado') : t('No está: lo instalás desde Ajustes → Reproductor'));
  const draw = (p) => box.replaceChildren(
    el('li', { class: 'tour-item' }, el('span', { class: 'tour-item-text' }, el('b', {}, 'mpv', p?.mpv ? el('span', { class: 'tour-ok' }, icon('check', 12), t('Lista')) : null), el('small', {}, p ? state(p.mpv) : '…'))),
    el('li', { class: 'tour-item' }, el('span', { class: 'tour-item-text' }, el('b', {}, 'VLC', p?.vlc ? el('span', { class: 'tour-ok' }, icon('check', 12), t('Lista')) : null), el('small', {}, p ? (p.vlc ? t('Instalado') : t('No está instalado (opcional)')) : '…'))));
  draw(null);
  api.playersStatus().then(draw).catch(() => {});
  return box;
}

export function openWelcome() {
  const saved = safeGet(STORE);
  if (saved === 'done') return;
  const list = steps();
  let i = Math.min(list.length - 1, Math.max(0, Number(saved) || 0));
  let leaving = false;
  touring = true;
  const progress = el('div', { class: 'tour-progress', role: 'progressbar', 'aria-valuemin': 1, 'aria-valuemax': list.length });
  const skip = el('button', { id: 'welcome-skip', type: 'button', class: 'tour-skip', onclick: exit }, t('Saltar'));
  const stages = el('div', { class: 'tour-stages' });
  const back = el('button', { id: 'welcome-back', type: 'button', class: 'tour-btn ghost', onclick: () => go(i - 1) }, t('Atrás'));
  const next = el('button', { id: 'welcome-next', type: 'button', class: 'tour-btn primary', onclick: () => (i === list.length - 1 ? exit() : go(i + 1)) });
  const dlg = el('dialog', { id: 'dlg-welcome', class: 'tour', 'aria-label': t('Bienvenida'),
    oncancel: (e) => { e.preventDefault(); exit(); },
    onkeydown: (e) => { if (e.key === 'ArrowRight') go(i + 1); else if (e.key === 'ArrowLeft') go(i - 1); },
  }, el('div', { class: 'tour-frame' },
    el('header', { class: 'tour-head' }, progress, skip),
    stages,
    el('footer', { class: 'tour-foot' }, back, next)));

  function stage(s) {
    return el('div', { class: 'tour-stage' },
      el('div', { class: 'tour-art', 'aria-hidden': 'true' }, el('span', { class: 'tour-ring' }), el('span', { class: 'tour-ring late' }), el('span', { class: 'tour-disc' }, icon(s.icon, 56))),
      el('h2', { id: 'welcome-title' }, s.title), el('p', {}, s.body), s.extra ? el('div', { class: 'tour-extra' }, s.extra()) : null);
  }
  function draw(dir) {
    const last = i === list.length - 1;
    progress.setAttribute('aria-valuenow', String(i + 1));
    progress.setAttribute('aria-label', t('Paso {n} de {d}', { n: i + 1, d: list.length }));
    progress.replaceChildren(...list.map((_, n) => el('button', { id: `welcome-dot-${n}`, type: 'button', class: `tour-seg ${n <= i ? 'done' : ''}`, 'aria-label': t('Ir al paso {n}', { n: n + 1 }), onclick: () => go(n) }, el('span'))));
    skip.hidden = last;
    back.hidden = i === 0;
    next.replaceChildren(last ? t('Listo') : t('Siguiente'), last ? null : icon('arrow', 18));
    // El que sale y el que entra se cruzan: entra desde el lado hacia donde se avanza.
    const old = stages.firstElementChild;
    const now = stage(list[i]);
    stages.append(now);
    if (old) {
      if (still() || !dir) old.remove();
      else old.animate([{ transform: 'none', opacity: 1 }, { transform: `translateX(${-dir * 32}px)`, opacity: 0 }], { duration: 200, easing: 'ease-in' }).finished.then(() => old.remove(), () => old.remove());
    }
    if (dir && !still()) now.animate([{ transform: `translateX(${dir * 48}px)`, opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 460, easing: 'cubic-bezier(.16, 1, .3, 1)' });
    safeSet(STORE, String(i));
  }
  function go(to) {
    if (to < 0 || to >= list.length || to === i) return;
    const dir = to > i ? 1 : -1;
    i = to;
    draw(dir);
  }
  /** Sale con su animación y recién después se cierra (lo de atrás ya entra mientras se apaga). */
  function exit() {
    if (leaving) return;
    leaving = true;
    touring = false;
    safeSet(STORE, 'done');
    dlg.classList.add('leaving');
    window.dispatchEvent(new CustomEvent('welcome-done'));
    setTimeout(() => { dlg.close(); dlg.remove(); }, still() ? 0 : 380);
  }
  document.body.append(dlg);
  draw(0);
  dlg.showModal();
  next.focus();
}
