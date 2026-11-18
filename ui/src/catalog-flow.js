// Pasos al elegir un video (pedido 2026-11-18): buscando torrents → torrent o TorBox (sin key, directo a torrent)
// → ¿audio latino? → resolución → lista. Con latino, antes de la resolución se busca por escalones: el nombre (al
// instante), los dudosos (MULTI / Dual / "español" sin aclarar) y, si el usuario quiere, de a tandas de los que no
// dicen nada (menos probable). Las migas de arriba vuelven a un paso; volver o cambiar de video corta lo que esté
// analizando. El estado vive en `state.side.flow` (uno por video, `newFlow`).

import { api } from './api.js';
import { el, icon } from './dom.js';
import { state, view } from './catalog-state.js';
import { inTorbox, knownSeeds, latOf, openGroup, renderStreamsOnly, resKey, resLabel, RES_ORDER, rowsOf } from './catalog-options.js';
import { readTracks } from './catalog-subs.js';
import { quickAnalyze, startAnalysis, stopTests, unlikely } from './catalog-tests.js';

/** step: 'mode' | 'lat' | 'scan' | 'res' | 'list'. `lat`: null = no se preguntó; `latOff`: eligió una calidad sin
 *  latino y la ve igual (sin el filtro); `scanned`: hashes cuyas pistas ya se intentaron leer en la búsqueda. */
export const newFlow = () => ({ step: 'mode', mode: null, lat: null, latOff: false, scan: null, scanned: new Set() });
const flow = () => state.side?.flow;

/** Primera búsqueda de latino: los dudosos con mejor salud, hasta 10. Después, "Seguir buscando" de a 5 (tope 10). */
const LAT_FIRST = 10, LAT_BATCH = 5, LAT_EXTRA_MAX = 10;
/** Lectura de pistas: por el enjambre el núcleo lee 3 a la vez y cada una tarda ~1 min (metadatos + comienzo del
 *  video + mpv); por TorBox, de a una, ~8 s. */
const SWARM_PARALLEL = 3, SWARM_SECS = 60, TORBOX_SECS = 8;

/** ¿Ya se puede elegir? La lista de todas las fuentes y, con key de TorBox, cuáles tiene listas. */
function ready() {
  const u = state.update;
  if (!u?.done || view.torboxKey === null) return false;
  return !view.torboxKey || state.side.torbox === 'done' || state.side.torbox === 'error';
}
/** Lo que entra según el modo elegido (TorBox: solo las que tiene listas). */
const pool = () => (state.update?.candidates ?? []).filter((c) => flow()?.mode !== 'torbox' || inTorbox.has(c.info_hash));
/** Filtro de la lista por el flujo (lo usa `passesFilters`): modo y, si pidió latino, latino o dudoso. */
export function flowFilter(c) {
  const f = flow();
  if (!f) return true;
  return (f.mode !== 'torbox' || inTorbox.has(c.info_hash)) && (!f.lat || f.latOff || latOf(c) != null);
}

const tracksRead = (h) => rowsOf(h).some((e) => e.live?.audio?.length);
/** Con salud para leer sus pistas: por TorBox todas; por torrent, con seeds y no muerta (no tiene sentido
 *  conectarse a una que no se va a poder ver). */
const healthy = (c) => flow()?.mode === 'torbox' || (!unlikely(c) && (knownSeeds(c) ?? 0) > 0);
const byPotential = (a, b) => (knownSeeds(b) ?? -1) - (knownSeeds(a) ?? -1) || (b.size_bytes ?? 0) - (a.size_bytes ?? 0);
/** Escalón b: dicen MULTI / Dual / español sin aclarar y todavía no se leyeron. */
const firstBatch = () => pool().filter((c) => latOf(c) === 'maybe' && healthy(c) && !flow().scanned.has(c.info_hash)).sort(byPotential).slice(0, LAT_FIRST);
/** Escalón c: los dudosos que quedaron y después los que no dicen ningún idioma (menos probable). */
function nextBatch() {
  const f = flow();
  const left = LAT_EXTRA_MAX - (f.scan?.extra ?? 0);
  if (left <= 0) return [];
  const open = pool().filter((c) => !f.scanned.has(c.info_hash) && !tracksRead(c.info_hash) && healthy(c) && !c.audio.includes('cast'));
  const maybe = open.filter((c) => latOf(c) === 'maybe').sort(byPotential);
  const silent = open.filter((c) => latOf(c) == null).sort(byPotential);
  return [...maybe, ...silent].slice(0, Math.min(LAT_BATCH, left));
}
/** "~40 s" / "~3 min" para leer las pistas de `n`. */
function eta(n) {
  const secs = flow()?.mode === 'torbox' ? n * TORBOX_SECS : Math.ceil(n / SWARM_PARALLEL) * SWARM_SECS;
  return secs < 60 ? `~${Math.max(10, Math.round(secs / 10) * 10)} s` : `~${Math.round(secs / 60)} min`;
}

/** Lee las pistas de esa tanda (TorBox de a una; torrent con el análisis rápido del núcleo) hasta que estén
 *  todas, se pase el tiempo o se corte. `extra`: es de "Seguir buscando". */
async function runScan(hashes, extra) {
  const f = flow();
  hashes.forEach((h) => f.scanned.add(h));
  const scan = (f.scan = { hashes, running: true, stopped: false, extra: (f.scan?.extra ?? 0) + (extra ? hashes.length : 0) });
  f.step = 'scan';
  renderStreamsOnly();
  const alive = () => flow() === f && f.scan === scan && !scan.stopped;
  if (f.mode === 'torbox') {
    for (const h of hashes) { if (!alive()) break; await readTracks(h, true); renderStreamsOnly(); }
  } else {
    quickAnalyze(hashes);
    const end = Date.now() + (Math.ceil(hashes.length / SWARM_PARALLEL) * SWARM_SECS + 30) * 1000;
    while (alive() && Date.now() < end && !hashes.every(tracksRead)) { await new Promise((r) => setTimeout(r, 1000)); renderStreamsOnly(); }
  }
  if (f.scan === scan) scan.running = false;
  if (flow() === f) renderStreamsOnly();
}
/** Corta la búsqueda de latino en curso (lo ya leído queda). */
function stopScan() {
  const s = flow()?.scan;
  if (!s?.running) return;
  s.stopped = true;
  s.running = false;
  if (flow().mode !== 'torbox') api.analyzerCancel(s.hashes.filter((h) => !tracksRead(h))).catch(() => {});
}
/** Al volver a un paso o dejar el video: corta todo lo que esté analizando. */
export function cancelFlowWork() {
  stopScan();
  if (state.side?.tests?.run) stopTests();
}

function goTo(step) {
  const f = flow();
  cancelFlowWork();
  if (step === 'mode') Object.assign(f, { mode: null, lat: null });
  if (step === 'mode' || step === 'lat') Object.assign(f, { lat: null, scan: null });
  f.latOff = false;
  f.step = step;
  view.openRes = '';
  renderStreamsOnly();
}
async function pickRes(r, latOff) {
  const f = flow();
  f.latOff = latOff;
  f.step = 'list';
  openGroup(r);
  if (f.mode === 'torbox') return;
  // Primera vez en esa calidad: la prueba de 30 s ordena por seeds reales; el análisis profundo se ofrece después.
  const t = state.side.tests;
  if (t.first[r] || state.side.deep?.res === r) return;
  for (let i = 0; i < 20 && !t.ready; i++) await new Promise((res) => setTimeout(res, 250));
  if (flow() === f && f.step === 'list' && view.openRes === r) startAnalysis(r, false, true);
}

// ---------- vista ----------
const choice = (id, ic, title, sub, onclick, { badge, disabled, primary, muted, cls = '' } = {}) =>
  el('button', { id, type: 'button', class: `cat-menu-item cat-choice ${cls} ${primary ? 'deep' : ''} ${muted ? 'muted' : ''}`, disabled: disabled || null, onclick: disabled ? null : onclick },
    el('span', { class: 'cat-menu-ic', 'aria-hidden': 'true' }, icon(ic, 28)),
    el('span', { class: 'cat-menu-text' }, el('b', {}, title, badge ? el('span', { class: 'cat-menu-badge' }, badge) : null), el('span', {}, sub)));
const screen = (title, ...body) => el('div', { class: 'cat-flow', id: 'cat-flow' }, crumbs(), el('h3', { class: 'cat-flow-title' }, title), ...body);

/** Migas: lo elegido hasta ahora; tocar una vuelve a ese paso. */
export function crumbs() {
  const f = flow();
  if (!f?.mode) return null;
  const items = [];
  if (view.torboxKey && state.side.torbox === 'done') items.push(['mode', f.mode === 'torbox' ? 'TorBox' : 'Torrent']);
  else items.push([null, 'Torrent']);
  if (f.lat != null) items.push(['lat', f.lat ? 'Audio latino' : 'Audio original']);
  if (f.step === 'list' && view.openRes) items.push(['res', resLabel(view.openRes)]);
  return el('nav', { class: 'cat-crumbs', 'aria-label': 'Pasos elegidos' },
    items.map(([step, label], i) => [i ? el('span', { class: 'cat-crumb-sep', 'aria-hidden': 'true' }, '›') : null,
      step && step !== f.step ? el('button', { id: `cat-crumb-${step}`, type: 'button', class: 'cat-crumb', title: 'Volver a este paso', onclick: () => goTo(step) }, label)
        : el('span', { class: 'cat-crumb current' }, label)]));
}

/** El paso actual, o null en la lista (la dibuja `renderStreamsBody`). */
export function flowStep() {
  const f = flow();
  if (!f) return null;
  if (!ready()) return searchScreen();
  // Sin TorBox (sin key o no respondió) no se pregunta: torrent.
  if (f.step === 'mode' && (!view.torboxKey || state.side.torbox !== 'done')) Object.assign(f, { mode: 'torrent', step: 'lat' });
  if (f.step === 'mode') return modeScreen();
  if (f.step === 'lat') return latScreen();
  if (f.step === 'scan') return scanScreen();
  if (f.step === 'res') return resScreen();
  return null;
}

function searchScreen() {
  const u = state.update;
  const ok = u ? u.addons.filter((a) => a.state !== 'pending').length : 0;
  const sub = !u?.done ? `${ok} de ${u?.addons.length ?? '…'} fuentes respondieron${u?.candidates.length ? ` · ${u.candidates.length} torrents hasta ahora` : ''}`
    : `${u.candidates.length} torrents · viendo cuáles están listos en TorBox…`;
  return el('div', { class: 'cat-flow cat-flow-wait', id: 'cat-flow', role: 'status', 'aria-busy': 'true' },
    el('span', { class: 'cat-res-spin big', 'aria-hidden': 'true' }),
    el('b', {}, 'Buscando torrents…'), el('span', {}, sub));
}

function modeScreen() {
  const f = flow();
  const all = state.update.candidates.length;
  const tb = state.update.candidates.filter((c) => inTorbox.has(c.info_hash)).length;
  const go = (mode) => () => { Object.assign(f, { mode, step: 'lat' }); renderStreamsOnly(); };
  return screen('¿Cómo lo querés ver?',
    choice('cat-flow-torbox', 'play', 'Por TorBox', tb ? `${tb} ${tb === 1 ? 'lista' : 'listas'} en sus servidores: arranca al instante y no depende de los seeds` : 'No hay torrents en TorBox para esto',
      go('torbox'), { badge: tb ? 'Al instante' : null, disabled: !tb, primary: !!tb, cls: 'torbox' }),
    choice('cat-flow-torrent', 'peers', 'Por torrent', `${all} torrents de otras personas (P2P): la velocidad depende de cuántos lo comparten`, go('torrent')));
}

function latScreen() {
  const f = flow();
  const p = pool();
  const named = p.filter((c) => latOf(c) === 'name' || latOf(c) === 'real').length;
  const toRead = firstBatch().length;
  const yesSub = [named ? `${named} ${named === 1 ? 'lo dice' : 'lo dicen'} en el nombre` : 'Ninguno lo dice en el nombre',
    toRead ? `reviso los audios de ${toRead} ${toRead === 1 ? 'dudoso' : 'dudosos'} (MULTI / Dual) · ${eta(toRead)}` : null].filter(Boolean).join(' · ');
  // El latino suele venir en releases más livianos: que no sorprenda no encontrarlo en 4K.
  const yesNote = el('span', { class: 'cat-choice-note' }, 'Ojo: el audio latino suele venir en menor resolución (1080p o 720p); en 4K es raro.');
  return screen('¿Necesitás audio latino?',
    choice('cat-flow-lat-no', 'speaker', 'Audio original', 'El idioma en que se filmó (al reproducir elegís otro si trae) · sigo directo a elegir la calidad', () => { Object.assign(f, { lat: false, step: 'res' }); renderStreamsOnly(); }),
    choice('cat-flow-lat-yes', 'search', 'Solo audio latino', [yesSub, yesNote], () => {
      f.lat = true;
      const batch = firstBatch().map((c) => c.info_hash);
      if (batch.length) runScan(batch, false);
      else { f.step = 'scan'; renderStreamsOnly(); }
    }, { badge: toRead ? 'Demora más' : null }));
}

function scanScreen() {
  const f = flow(), s = f.scan;
  const p = pool();
  const real = p.filter((c) => latOf(c) === 'real').length;
  const named = p.filter((c) => latOf(c) === 'name').length;
  const spa = p.filter((c) => latOf(c) === 'spa').length;
  if (s?.running) {
    const done = s.hashes.filter(tracksRead).length;
    return screen('Buscando audio latino',
      el('div', { class: 'cat-deep running', role: 'status' },
        el('span', { class: 'cat-deep-icon', 'aria-hidden': 'true' }, el('span', { class: 'cat-radar big' })),
        el('span', { class: 'cat-deep-text' }, el('span', { class: 'cat-deep-title' }, el('b', {}, `Leyendo los audios · ${done} de ${s.hashes.length}`)),
          el('span', { class: 'cat-deep-sub' }, f.mode === 'torbox' ? 'De a uno, desde TorBox' : 'Baja solo el comienzo de cada uno (los que tienen seeds)')),
        el('span', { class: 'cat-deep-icons' }, el('button', { id: 'cat-flow-stop', class: 'cat-icon-btn stop', 'aria-label': 'Detener', title: 'Detener: lo ya leído queda',
          onclick: () => { stopScan(); renderStreamsOnly(); } }, icon('stop', 14))),
        el('span', { class: 'cat-deep-bar' }, el('i', { style: `width:${Math.max(4, (done / s.hashes.length) * 100)}%` }))));
  }
  const more = nextBatch();
  const found = real + named;
  const summary = [real && `${real} con latino confirmado en sus pistas`, named && `${named} según el nombre`, spa && `${spa} en español sin aclarar si es latino`].filter(Boolean).join(' · ');
  return screen(found ? 'Encontré audio latino' : 'No encontré audio latino',
    el('p', { class: 'cat-flow-note', role: 'status' }, summary || 'Ninguno dice latino en el nombre ni en sus pistas.'),
    choice('cat-flow-res', 'monitor', 'Elegir la calidad', found ? 'Muestro las de latino primero' : 'Podés ver las calidades sin el filtro', () => { f.step = 'res'; renderStreamsOnly(); }, { primary: true }),
    more.length ? choice('cat-flow-more', 'search', `Seguir buscando · ${more.length} más`, `Menos probable: no dicen latino en el nombre · ${eta(more.length)}`, () => runScan(more.map((c) => c.info_hash), true)) : null);
}

function resScreen() {
  const f = flow();
  const p = pool();
  const rows = RES_ORDER.map((r) => {
    const all = p.filter((c) => resKey(c) === r);
    if (!all.length) return null;
    const n = all.length;
    const lat = all.filter((c) => latOf(c) != null).length;
    const real = all.filter((c) => latOf(c) === 'real').length;
    const unit = f.mode === 'torbox' ? (n === 1 ? 'lista' : 'listas') : n === 1 ? 'torrent' : 'torrents';
    const sub = !f.lat ? `${n} ${unit}`
      : lat ? `${lat} con latino${real ? ` (${real} confirmado${real === 1 ? '' : 's'})` : ''} de ${n}` : `Ninguna con latino · ver las ${n} igual`;
    return choice(`cat-flow-res-${r}`, 'monitor', resLabel(r), sub, () => pickRes(r, !!f.lat && !lat), { muted: !!f.lat && !lat });
  }).filter(Boolean);
  return screen('Elegí la calidad', ...rows);
}
