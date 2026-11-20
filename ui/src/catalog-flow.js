// Pasos al elegir un video (pedido 2026-11-18): buscando torrents → torrent o TorBox (sin key, directo a torrent)
// → ¿audio latino? → (por torrent) resolución → lista.
// Por torrent, con latino se confirma leyendo los audios reales mientras se ve la lista: de a `SWARM_PARALLEL`, de la
// mejor candidata a la peor (`toConfirm`), hasta la primera con latino confirmado; "Seguir buscando" sigue.
// Por TorBox (2026-11-18) no hay paso de calidad ni lista larga: se busca el PRIMER BUEN MATCH (`isMatch`) leyendo
// pistas de a una, de mejor a peor calidad (pantalla "Buscando…"), y se muestra solo ese, con "Seguir buscando" el
// próximo y "Ver todas las opciones". Con audio original suma debajo las de mejor calidad, con subs de afuera.
// Las migas de arriba vuelven a un paso; volver o cambiar de video corta lo que esté analizando. El estado vive en
// `state.side.flow` (uno por video, `newFlow`).

import { api } from './api.js';
import { el, icon } from './dom.js';
import { t as tr } from './i18n.js';
import { state, view } from './catalog-state.js';
import { failedBefore, flatSorted, hasSpanishSubs, inTorbox, knownSeeds, latOf, mbpsOf, openGroup, optionRow, renderStreamsOnly, resKey, resLabel, RES_ORDER, rowsOf } from './catalog-options.js';
import { readTracks } from './catalog-subs.js';
import { quickAnalyze, startAnalysis, stopTests, unlikely } from './catalog-tests.js';

/** step: 'mode' | 'lat' | 'res' | 'list'. `lat`: null = no se preguntó; `latOff`: sacó el filtro de latino
 *  ("Quitar filtros"); `scanned`: hashes cuyas pistas ya se intentaron leer en la búsqueda. TorBox: `found`, los buenos
 *  matches que se muestran (en el orden en que aparecieron); `all`: pidió "Ver todas las opciones". */
export const newFlow = () => ({ step: 'mode', mode: null, net: null, lat: null, latOff: false, scan: null, scanned: new Set(), found: [], all: false, spain: false });
const flow = () => state.side?.flow;

/** Conexión donde se va a ver por TorBox (2026-11-18): el usuario la elige en cada video y pone el tope de
 *  bitrate del buen match; "¿Se cortó?" baja un nivel. `mbps`: lo más que se le pide al video (el piso del rango). */
const NET = [
  { key: 'terrible', label: tr('Muy baja'), range: tr('Menos de 8 Mbps o señal que se corta: busco una muy liviana'), mbps: 4 },
  { key: 'low', label: tr('Baja'), range: tr('8 a 25 Mbps, o la tele en wifi 2.4 GHz'), mbps: 10 },
  { key: 'normal', label: tr('Normal'), range: tr('25 a 100 Mbps'), mbps: 25 },
  { key: 'high', label: tr('Alta'), range: tr('Más de 100 Mbps, en wifi 5 GHz o por cable'), mbps: Infinity },
];
/** La conexión elegida para este video: se pregunta siempre (pedido 2026-11-18: cambia según dónde se vea). */
const net = () => flow()?.net ?? null;
/** ¿Entra en la conexión elegida? Sin peso no se sabe cuánto pide: no entra (no puede ser el buen match). */
export const fitsNet = (c) => c.size_bytes != null && mbpsOf(c) <= (net()?.mbps ?? Infinity);
function setNet(n) {
  const f = flow();
  Object.assign(f, { net: n, found: [], all: false });
  f.scanned.clear();
}
/** ¿Se pregunta la resolución? Solo por torrent: en TorBox se busca el mejor match entre todas las calidades. */
export const hasResStep = () => flow()?.mode !== 'torbox';

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
const pool = () => (state.update?.candidates ?? [])
  .filter((c) => flow()?.mode !== 'torbox' || inTorbox.has(c.info_hash))
  // Las que ya fallaron al reproducirse van al final (orden estable: el resto queda igual).
  .sort((a, b) => failedBefore.has(a.info_hash) - failedBefore.has(b.info_hash));
/** Donde se busca latino: el modo y, con paso de resolución, la calidad abierta. */
const scope = () => pool().filter((c) => !hasResStep() || !view.openRes || resKey(c) === view.openRes);
/** Única regla de "potencial de latino": confirmado ('real'), dice LATINO ('name'), dudosa ('maybe': MULTI / Dual /
 *  español sin aclarar) o pista en español sin variante ('spa'). Las que no dicen nada de idioma no cuentan. */
const hasPotential = (c) => latOf(c) != null;
/** Única regla de "buen match" en TorBox: pidiendo latino, latino confirmado en sus pistas (los subs no importan); con
 *  audio original, subtítulos en español nativos (dentro del video o .srt en la lista de TorBox). De cine, nunca. */
export const isMatch = (c) => c.source !== 'CAM' && !failedBefore.has(c.info_hash) && (flow()?.lat ? latOf(c) === 'real' : hasSpanishSubs(c.info_hash) === true);
/** Filtro de la lista por el flujo (lo usa `passesFilters`): modo y, si pidió latino, solo las con potencial. */
export function flowFilter(c) {
  const f = flow();
  if (!f) return true;
  return (f.mode !== 'torbox' || inTorbox.has(c.info_hash)) && (!f.lat || f.latOff || hasPotential(c));
}

const tracksRead = (h) => rowsOf(h).some((e) => e.live?.audio?.length);
/** Con salud para leer sus pistas: por TorBox todas; por torrent, con seeds y no muerta (no tiene sentido
 *  conectarse a una que no se va a poder ver). */
const healthy = (c) => flow()?.mode === 'torbox' || (!unlikely(c) && (knownSeeds(c) ?? 0) > 0);
const byPotential = (a, b) => (knownSeeds(b) ?? -1) - (knownSeeds(a) ?? -1) || (b.size_bytes ?? 0) - (a.size_bytes ?? 0);
/** Grupo de candidata a latino: 0 dice LATINO, 1 dudosa (MULTI / Dual / español sin aclarar). */
const latTier = (c) => (latOf(c) === 'name' ? 0 : 1);
/** Candidatas a leer (única regla): sin leer, con salud y que puedan ser lo pedido (latino: con potencial; audio
 *  original: sin saber si trae sub ES). TorBox: de mejor a peor calidad (resolución, imagen y peso), como la lista.
 *  Torrent: por grupo (`latTier`), mejor resolución y seeds, así la primera confirmada es la mejor. */
function toConfirm(cands, lat = flow().lat) {
  const f = flow();
  const pending = cands.filter((c) => !f.scanned.has(c.info_hash) && !tracksRead(c.info_hash) && healthy(c)
    && (lat ? hasPotential(c) : hasSpanishSubs(c.info_hash) == null));
  if (f.mode === 'torbox') return flatSorted(pending.filter(fitsNet));
  return pending.sort(byPotential).sort((a, b) => latTier(a) - latTier(b) || RES_ORDER.indexOf(resKey(a)) - RES_ORDER.indexOf(resKey(b)));
}
/** De donde sale el buen match en TorBox: las que entran en la conexión, de mejor a peor (con latino, solo las con
 *  potencial). "Ver todas" muestra también las que no entran. */
const ranked = () => flatSorted(pool().filter((c) => flowFilter(c) && fitsNet(c)));
/** TorBox: el próximo buen match todavía no mostrado, si viene antes (en calidad) que la próxima candidata sin leer;
 *  si no, null (hay que leer). */
function nextMatch() {
  const f = flow();
  const pending = new Set(toConfirm(pool()).map((c) => c.info_hash));
  const first = ranked().find((c) => pending.has(c.info_hash) || (isMatch(c) && !f.found.includes(c.info_hash)));
  return first && !pending.has(first.info_hash) ? first : null;
}
/** "~40 s" / "~3 min" para leer las pistas de `n`. */
function eta(n) {
  const secs = flow()?.mode === 'torbox' ? n * TORBOX_SECS : Math.ceil(n / SWARM_PARALLEL) * SWARM_SECS;
  return secs < 60 ? `~${Math.max(10, Math.round(secs / 10) * 10)} s` : tr('~{a} min', { a: Math.round(secs / 60) });
}

/** Lee las candidatas de `scope`, en orden, hasta el próximo buen match. TorBox: de a una, y para en el primer match
 *  nuevo (`nextMatch`, que suma a `found`). Torrent (latino): con el análisis rápido del núcleo, de a `SWARM_PARALLEL`
 *  (de a una sería 3 veces más lento), y para en la primera tanda con latino confirmado. También para al agotarlas o
 *  al cortarla; las que se pasan del tiempo quedan como revisadas. */
async function runScan() {
  const f = flow();
  const tb = f.mode === 'torbox';
  const total = toConfirm(scope()).length;
  if (!total && !(tb && nextMatch())) return renderStreamsOnly();
  const scan = (f.scan = { total, batch: [], done: 0, running: true, stopped: false });
  renderStreamsOnly();
  const alive = () => flow() === f && f.scan === scan && !scan.stopped;
  while (alive()) {
    const match = tb && nextMatch();
    if (match) { f.found.push(match.info_hash); break; }
    const batch = (scan.batch = toConfirm(scope()).slice(0, tb ? 1 : SWARM_PARALLEL).map((c) => c.info_hash));
    if (!batch.length) break;
    batch.forEach((h) => f.scanned.add(h));
    if (tb) await readTracks(batch[0], true);
    else {
      quickAnalyze(batch);
      const end = Date.now() + (SWARM_SECS + 30) * 1000;
      while (alive() && Date.now() < end && !batch.every(tracksRead)) { await new Promise((r) => setTimeout(r, 1000)); renderStreamsOnly(); }
    }
    scan.done += batch.length;
    if (flow() === f) renderStreamsOnly();
    if (!tb && batch.some((h) => latOf(state.update.candidates.find((c) => c.info_hash === h)) === 'real')) break;
  }
  if (f.scan === scan) scan.running = false;
  if (flow() === f) renderStreamsOnly();
}
/** Pidiendo latino, al llegar a la lista: busca salvo que ya haya una confirmada (de una lectura anterior). */
function autoScan() {
  if (flow().lat && !scope().some((c) => latOf(c) === 'real')) runScan();
  else renderStreamsOnly();
}
/** Corta la búsqueda de latino en curso (lo ya leído queda; lo que no llegó a leerse vuelve a ser candidata). */
function stopScan() {
  const f = flow();
  const s = f?.scan;
  if (!s?.running) return;
  s.stopped = true;
  s.running = false;
  const pending = s.batch.filter((h) => !tracksRead(h));
  pending.forEach((h) => f.scanned.delete(h));
  if (f.mode !== 'torbox') api.analyzerCancel(pending).catch(() => {});
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
  if (step === 'mode' || step === 'lat' || step === 'net') Object.assign(f, { lat: null, scan: null, found: [], all: false });
  f.latOff = false;
  f.spain = false;
  f.step = step;
  view.openRes = '';
  renderStreamsOnly();
}
async function pickRes(r) {
  const f = flow();
  f.step = 'list';
  openGroup(r);
  autoScan();
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
/** Título de la pantalla dibujada antes: redibujar la misma (llega una lectura, arranca un ▶) no repite la entrada. */
let lastScreen = null;
const screen = (title, ...body) => {
  const again = lastScreen === title;
  lastScreen = title;
  return el('div', { class: `cat-flow ${again ? 'still' : ''}`, id: 'cat-flow' }, crumbs(), title ? el('h3', { class: 'cat-flow-title' }, title) : null, ...body);
};

/** Migas: lo elegido hasta ahora; tocar una vuelve a ese paso. */
export function crumbs() {
  const f = flow();
  if (!f?.mode) return null;
  const items = [];
  if (view.torboxKey && state.side.torbox === 'done') items.push(['mode', f.mode === 'torbox' ? 'TorBox' : 'Torrent']);
  else items.push([null, 'Torrent']);
  if (f.mode === 'torbox' && net() && f.step !== 'net') items.push(['net', tr('Conexión {a}', { a: net().label.toLowerCase() })]);
  if (f.lat != null) items.push(['lat', f.lat ? tr('Audio latino') : tr('Audio original')]);
  if (f.step === 'list' && view.openRes) items.push(['res', resLabel(view.openRes)]);
  return el('nav', { class: 'cat-crumbs', 'aria-label': tr('Pasos elegidos') },
    items.map(([step, label], i) => [i ? el('span', { class: 'cat-crumb-sep', 'aria-hidden': 'true' }, '›') : null,
      step && step !== f.step ? el('button', { id: `cat-crumb-${step}`, type: 'button', class: 'cat-crumb', title: tr('Volver a este paso'), onclick: () => goTo(step) }, label)
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
  if (f.step === 'net') return netScreen();
  if (f.step === 'lat') return latScreen();
  if (f.step === 'res') return resScreen();
  // TorBox: buscando el primer match, solo la búsqueda; después, el resultado (o la lista entera si la pidió).
  if (f.mode === 'torbox' && !f.all && f.spain) return spainScreen();
  if (f.mode === 'torbox' && !f.all) return f.scan?.running && !f.found.length ? scanScreen() : matchScreen();
  lastScreen = null;
  return null;
}

/** TorBox: mientras no aparezca el primer buen match, solo la búsqueda. */
function scanScreen() {
  const f = flow(), s = f.scan;
  const svg = (tag, attrs, ...kids) => { const n = document.createElementNS('http://www.w3.org/2000/svg', tag); for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v); n.append(...kids); return n; };
  // Radar (como la web): el barrido da una vuelta cada 2,4 s y cada punto se enciende cuando le pasa por encima.
  const radar = svg('svg', { class: 'cat-hunt-radar', viewBox: '0 0 120 120', 'aria-hidden': 'true' },
    svg('circle', { class: 'ring', cx: 60, cy: 60, r: 52 }), svg('circle', { class: 'ring inner', cx: 60, cy: 60, r: 34 }),
    svg('g', { class: 'sweep' }, svg('path', { d: 'M60 60L60 8A52 52 0 0 1 105 34Z' })),
    ...[[60, 20], [94, 46], [88, 88], [40, 96], [24, 52]].map(([x, y], i) => svg('circle', { class: 'blip', cx: x, cy: y, r: 4, style: `--i:${i}` })),
    svg('circle', { class: 'core', cx: 60, cy: 60, r: 16 }), svg('path', { class: 'core-play', d: 'M55 52.5v15l12.5-7.5z' }));
  return screen(null,
    el('div', { class: 'cat-hunt', role: 'status', 'aria-live': 'polite' }, radar,
      el('b', { class: 'cat-hunt-title' }, tr('Buscando el mejor torrent para vos')),
      el('span', { class: 'cat-hunt-bar' }, el('i', { style: `width:${Math.max(4, (s.done / s.total) * 100)}%` })),
      el('span', { class: 'cat-hunt-count' }, tr('{a} de {n}', { a: Math.min(s.done + 1, s.total), n: s.total })),
      el('button', { id: 'cat-flow-stop', type: 'button', class: 'cat-flow-btn', title: tr('Detener: muestro las de mejor calidad con lo leído hasta ahora'),
        onclick: () => { stopScan(); renderStreamsOnly(); } }, icon('stop', 14), tr('Detener'))));
}

/** TorBox, el resultado: solo los buenos matches encontrados, sin título ni nota encima (la fila ya dice "Mejor opción"
 *  y sus badges explican por qué, 2026-11-20). Sin ningún match, las 3 de mejor calidad con el aviso. Al pie, del mismo
 *  tamaño, "¿Se cortó?", "Seguir buscando" y "Ver todas las opciones". */
function matchScreen() {
  const f = flow();
  const list = ranked();
  const found = f.found.map((h) => list.find((c) => c.info_hash === h)).filter(Boolean);
  const rows = (cs, mark) => el('ul', { class: 'cat-options' }, cs.map((c) => optionRow(c, mark)));
  const searched = !toConfirm(pool()).length;
  const spanish = pool().filter(spanishNotLat);
  // Ninguna entra en la conexión elegida: las 3 mejores igual (marcadas "Puede cortarse"), con el aviso.
  const fitsNone = !list.length;
  const none = fitsNone ? tr('Todas piden más de lo que da tu conexión: mirá "Ver todas" o cambiá la conexión')
    : f.lat ? tr('No encontré latino confirmado') : tr('Ninguna trae sub ES nativo: los subs se buscan afuera');
  const title = found.length ? null : fitsNone ? tr('Ninguna entra en tu conexión') : f.lat ? tr('Sin latino confirmado') : tr('Sin subtítulos en español adentro');
  return screen(title,
    found.length ? rows(found, true)
      : el('p', { class: 'cat-flow-note', role: 'status' }, searched || fitsNone ? none : tr('Búsqueda detenida: estas son las de mejor calidad')),
    found.length ? null : rows((fitsNone ? flatSorted(pool().filter(flowFilter)) : list).slice(0, 3), false),
    el('div', { class: 'cat-flow-actions rows' },
      lighterRow(),
      moreRow(),
      ...(f.lat && !found.length && !f.scan?.running ? [
        spanish.length ? el('button', { id: 'cat-match-spain', type: 'button', class: 'cat-flow-btn', onclick: () => { f.spain = true; renderStreamsOnly(); } },
          icon('speaker', 15), el('span', { class: 'cat-flow-text' }, el('b', {}, tr('Con español, casi seguro de España')), el('small', {}, tr('Alta probabilidad de que no sea latino · Ver la lista'))),
          el('span', { class: 'cat-flow-count' }, String(spanish.length))) : null,
        originalRow('cat-match-original')] : []),
      el('button', { id: 'cat-match-all', type: 'button', class: 'cat-flow-btn', onclick: () => { f.all = true; renderStreamsOnly(); } },
        icon('list', 15), tr('Ver todas las opciones'), el('span', { class: 'cat-flow-count' }, String(pool().filter(flowFilter).length)))));
}
/** Leídas con audio en español que no es latino (sin variante o castellano): casi seguro de España. */
const spanishNotLat = (c) => latOf(c) !== 'real'
  && !!rowsOf(c.info_hash).find((e) => e.live?.audio?.length)?.languages?.some((l) => l.code === 'es' || l.code === 'cast');
/** Pidió latino y no hubo: busca de nuevo con audio original (el primer match con subs en español adentro). */
function toOriginal() {
  const f = flow();
  cancelFlowWork();
  Object.assign(f, { lat: false, found: [], all: false, spain: false, scan: null });
  runScan();
}
const originalRow = (id) => el('button', { id, type: 'button', class: 'cat-flow-btn', title: tr('Busco de nuevo la primera que traiga subtítulos en español adentro'), onclick: toOriginal },
  icon('speaker', 15), el('span', { class: 'cat-flow-text' }, el('b', {}, tr('Buscar con audio original')), el('small', {}, tr('Con subtítulos en español'))));
/** Sin latino: las que traen español que no es latino (casi seguro de España), de mejor a peor. */
function spainScreen() {
  const f = flow();
  const list = flatSorted(pool().filter(spanishNotLat));
  return screen(tr('Probablemente español de España'),
    el('p', { class: 'cat-flow-note' }, tr('Traen audio en español sin decir que es latino (o marcado de España): casi seguro es castellano.')),
    el('ul', { class: 'cat-options' }, list.map((c) => optionRow(c, false))),
    el('div', { class: 'cat-flow-actions rows' },
      originalRow('cat-spain-original'),
      el('button', { id: 'cat-spain-all', type: 'button', class: 'cat-flow-btn', onclick: () => { f.spain = false; f.all = true; renderStreamsOnly(); } },
        icon('list', 15), tr('Ver todas las opciones'), el('span', { class: 'cat-flow-count' }, String(pool().filter(flowFilter).length)))));
}
/** "¿Se cortó?": baja un nivel de conexión y busca de nuevo con el tope nuevo (en la más baja no aparece). */
function lighterRow() {
  const i = NET.indexOf(net());
  if (i <= 0) return null;
  const lower = NET[i - 1];
  return el('button', { id: 'cat-lighter', type: 'button', class: 'cat-flow-btn', title: tr('Paso a conexión {a} ({range}) y busco de nuevo', { a: lower.label.toLowerCase(), range: lower.range }),
    onclick: () => { cancelFlowWork(); setNet(lower); runScan(); } }, icon('gauge', 15), tr('¿Se cortó? Una más liviana'));
}

/** TorBox: cómo es la conexión donde se va a ver (cada vez; se cambia desde la miga). */
function netScreen() {
  const f = flow();
  const cur = net();
  return screen(tr('¿Cómo es tu internet donde lo vas a ver?'),
    // La más rápida arriba (pedido 2026-11-18); `NET` queda de menor a mayor para que "¿Se cortó?" baje un nivel.
    [...NET].reverse().map((n) => choice(`cat-flow-net-${n.key}`, 'gauge', n.label, n.range, () => { setNet(n); f.step = 'lat'; renderStreamsOnly(); }, { primary: cur?.key === n.key })));
}

function searchScreen() {
  const u = state.update;
  const ok = u ? u.addons.filter((a) => a.state !== 'pending').length : 0;
  const sub = !u?.done ? tr('{ok} de {a} fuentes respondieron{b}', { ok, a: u?.addons.length ?? '…', b: u?.candidates.length ? tr(' · {n} torrents hasta ahora', { n: u.candidates.length }) : '' })
    : tr('{n} torrents · viendo cuáles están listos en TorBox…', { n: u.candidates.length });
  return el('div', { class: 'cat-flow cat-flow-wait', id: 'cat-flow', role: 'status', 'aria-busy': 'true' },
    el('span', { class: 'cat-res-spin big', 'aria-hidden': 'true' }),
    el('b', {}, tr('Buscando torrents…')), el('span', {}, sub));
}

function modeScreen() {
  const f = flow();
  const all = state.update.candidates.length;
  const tb = state.update.candidates.filter((c) => inTorbox.has(c.info_hash)).length;
  const go = (mode) => () => { Object.assign(f, { mode, step: mode === 'torbox' ? 'net' : 'lat' }); renderStreamsOnly(); };
  return screen(tr('¿Cómo lo querés ver?'),
    choice('cat-flow-torbox', 'play', tr('Por TorBox'), tb ? tr('{tb} {a} en sus servidores: arranca al instante y no depende de los seeds', { tb, a: tb === 1 ? tr('lista') : tr('listas') }) : tr('No hay torrents en TorBox para esto'),
      go('torbox'), { badge: tb ? tr('Al instante') : null, disabled: !tb, primary: !!tb, cls: 'torbox' }),
    choice('cat-flow-torrent', 'peers', tr('Por torrent'), tr('{all} torrents de otras personas (P2P): la velocidad depende de cuántos lo comparten', { all }), go('torrent')));
}

function latScreen() {
  const f = flow();
  const p = pool();
  const potential = p.filter(hasPotential);
  const none = !potential.length;
  const named = potential.filter((c) => latOf(c) === 'name' || latOf(c) === 'real').length;
  const doubtful = potential.length - named;
  const left = toConfirm(p, true).length;
  const how = f.mode === 'torbox' ? tr('de a una, de mejor a peor calidad') : tr('de a {SWARM_PARALLEL}, en la calidad que elijas', { SWARM_PARALLEL });
  const yesSub = none ? tr('No hay torrents con audio latino')
    : [named ? tr('{named} {a} en el nombre', { named, a: named === 1 ? tr('lo dice') : tr('lo dicen') }) : null, doubtful ? tr('{doubtful} {a} (MULTI / Dual)', { doubtful, a: doubtful === 1 ? tr('dudosa') : tr('dudosas') }) : null]
      .filter(Boolean).concat(left ? tr('reviso {how}, hasta encontrar latino', { how }) : []).join(' · ');
  // El latino suele venir en releases más livianos: que no sorprenda no encontrarlo en 4K.
  const yesNote = el('span', { class: 'cat-choice-note' }, tr('Ojo: el audio latino suele venir en menor resolución (1080p o 720p); en 4K es raro.'));
  // Por torrent se elige la calidad (y la búsqueda de latino arranca ahí, `pickRes`); por TorBox se busca ya el mejor match.
  const pick = (lat) => () => {
    Object.assign(f, { lat, step: hasResStep() ? 'res' : 'list' });
    view.openRes = '';
    if (hasResStep()) renderStreamsOnly();
    else runScan();
  };
  const origSub = f.mode === 'torbox' ? tr('El idioma en que se filmó · busco la primera que traiga subtítulos en español adentro')
    : tr('El idioma en que se filmó, sin preguntar al reproducir · sigo directo a elegir la calidad');
  return screen(tr('¿Necesitás audio latino?'),
    choice('cat-flow-lat-no', 'speaker', tr('Audio original'), origSub, pick(false)),
    choice('cat-flow-lat-yes', 'search', tr('Solo audio latino'), none ? yesSub : [yesSub, yesNote], pick(true), { badge: left ? tr('Demora más') : null, disabled: none }));
}

/** Al pie de lo que se ve (por TorBox siempre; por torrent, pidiendo latino): la búsqueda en curso (con Detener),
 *  "Seguir buscando" la próxima o, revisadas todas, que no hay más para buscar. */
export function moreRow() {
  const f = flow();
  const tb = f?.mode === 'torbox';
  if (!f || (!tb && !f.lat) || f.latOff) return null;
  const what = f.lat ? tr('latino') : tr('sub ES');
  const s = f.scan;
  if (s?.running) {
    return el('div', { class: 'cat-lat-more', role: 'status' },
      el('span', { class: 'cat-res-spin', 'aria-hidden': 'true' }),
      el('span', {}, tr('Leyendo pistas para encontrar {what} · {done} de {total}', { what, done: s.done, total: s.total })),
      el('button', { id: 'cat-lat-stop', type: 'button', class: 'link', onclick: () => { stopScan(); renderStreamsOnly(); } }, tr('Detener')));
  }
  const left = toConfirm(scope()).length;
  const step = tb ? 1 : SWARM_PARALLEL;
  // TorBox: también hay "más" si queda un match ya sabido (p. ej. un .srt en español) sin mostrar.
  if (!left && !(tb && nextMatch())) {
    if (!f.scanned.size) return null;
    const found = tb ? f.found.length : scope().some((c) => latOf(c) === 'real');
    return el('p', { class: 'cat-lat-more done', role: 'status' }, icon(found ? 'check' : 'ban', 13),
      tb ? tr('No hay más para buscar.') : found ? tr('Revisé todas: no hay más para buscar.') : tr('No encontré latino confirmado en sus pistas: quedan las que lo dicen en el nombre.'));
  }
  return el('button', { id: 'cat-lat-more', type: 'button', class: 'cat-lat-more go', onclick: () => runScan() },
    icon('search', 14), el('span', {}, el('b', {}, tr('Seguir buscando {what}', { what })),
      left ? el('small', {}, tr('{left} {a} · {b} cada {c}', { left, a: left === 1 ? tr('candidata queda') : tr('candidatas quedan'), b: eta(step), c: step === 1 ? tr('una') : step })) : null));
}

function resScreen() {
  const f = flow();
  const p = pool();
  const rows = RES_ORDER.map((r) => {
    const all = p.filter((c) => resKey(c) === r);
    if (!all.length) return null;
    const n = all.length;
    const lat = all.filter(hasPotential).length;
    const real = all.filter((c) => latOf(c) === 'real').length;
    const named = all.filter((c) => latOf(c) === 'name').length;
    const doubtful = lat - real - named;
    const unit = n === 1 ? 'torrent' : 'torrents';
    // Lo dudoso (MULTI / Dual / español sin aclarar) no se cuenta como latino.
    const sub = !f.lat ? `${n} ${unit}`
      : lat ? [real && tr('{real} con latino confirmado', { real }), named && tr(named === 1 ? '{n} dice latino' : '{n} dicen latino', { n: named }), doubtful && tr(doubtful === 1 ? '{n} dudosa' : '{n} dudosas', { n: doubtful })]
        .filter(Boolean).join(' · ') + tr(' de {n}', { n }) : tr('Ninguna con latino de {n}', { n });
    return choice(`cat-flow-res-${r}`, 'monitor', resLabel(r), sub, () => pickRes(r), { muted: !!f.lat && !lat });
  }).filter(Boolean);
  return screen(tr('Elegí la calidad'), ...rows);
}
