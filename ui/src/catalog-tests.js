// Pruebas de conexión del catálogo (2026-11-17, separado de catalog.js): estado por torrent (rápida y
// a fondo, etapas), el embudo prueba rápida → análisis profundo, el modo "Elegí la mejor" y dejar
// pruebas de fondo al cambiar de video.

import { api } from './api.js';
import { confirmDialog } from './dialogs.js';
import { setStatus } from './dom.js';
import { currentNetwork } from './health-calib.js';
import { bgLoads, groupsOf, health, inScope, isSafeBest, knownSeeds, lowerRes, openGroup, renderStreamsOnly, RES_ORDER, resLabel, scheduleRender, seedsOf, sortOptions, startBg } from './catalog-options.js';
import { safeGet, safeSet, showError, state, view } from './catalog-state.js';

/** Estado de las pruebas de un video (2026-11-17, antes flags sueltos en `state.side`): `once` = lo
 *  que se hace una sola vez por video (subs, censo, tests guardados, timers del panel); `ready` = ya
 *  se cargaron los tests guardados de la última hora (antes no se prueba: los repetiría);
 *  `first[res]` = la primera tanda de la prueba rápida de esa resolución {hashes, at}; `run` = el
 *  análisis en curso {res, best, stage: 'quick' | 'deep', at} (uno solo a la vez en toda la app);
 *  `auto` = el resultado de "bajar la mejor al terminar" {step: 'done' | 'none', text};
 *  `intent` = la resolución elegida mientras todavía se buscaban torrents {res}. */
export function newVideoTests() {
  return { once: new Set(), ready: false, first: {}, run: null, auto: null, intent: null };
}
/** true la primera vez que se pide `key` en ese video. */
export function once(t, key) {
  if (t.once.has(key)) return false;
  t.once.add(key);
  return true;
}
/** Los testeados en la última hora (datos guardados, 2026-11-17) no se repiten; recién con eso se
 *  prueba. Si ya abrió una resolución mientras cargaban, arranca su prueba. */
export async function loadSavedTests(video, cands) {
  const saved = await api.catalogSwarmSaved(cands.map((c) => c.info_hash)).catch(() => ({}));
  if (state.side?.videoId !== video) return;
  for (const [h, t] of Object.entries(saved)) {
    if (!counted.has(h) && !counting.has(h)) { counted.set(h, t.count); testedAt.set(h, t.at); }
  }
  state.side.tests.ready = true;
  renderStreamsOnly();
  const intent = state.side.tests.intent;
  state.side.tests.intent = null;
  if (!intent) return;
  // Elegida mientras buscaba y al final no hubo ninguna de esa calidad: vuelve a las tarjetas.
  if (!groupsOf().get(intent.res)?.length) {
    state.side.tests.run = null;
    openGroup('');
    setStatus(`No apareció ningún torrent en ${resLabel(intent.res)}: elegí otra calidad.`);
    return;
  }
  startAnalysis(intent.res);
}

/** Tocar una resolución (2026-11-17): arranca su análisis. Mientras se buscan torrents queda anotado
 *  y arranca al terminar; tocar de nuevo lo anula. */
export function requestGroup(res) {
  const t = state.side.tests;
  if (!state.update?.done || !t.ready) {
    // Ya se muestra analizando (esperando la lista); arranca de verdad en `loadSavedTests`.
    stopTests();
    t.intent = { res };
    t.run = { res, best: false, stage: 'waiting', at: Date.now() };
    view.openRes = res;
    renderStreamsOnly();
    return;
  }
  startAnalysis(res);
}
/** Arranca el análisis de una resolución. Nunca dos a la vez: corta el que haya en curso (de este
 *  video o uno dejado de fondo en otro) y empieza de nuevo en esta. */
export function startAnalysis(res, best = false, quickOnly = false) {
  stopTests();
  if (quickOnly) quickList(res);
  else analyze(res, best);
}
/** "Ver lista" (2026-11-17): solo la primera tanda de la prueba rápida (~30 s) y la lista ordenada por
 *  seeds reales, para el que no quiere esperar el análisis a fondo. Lo que quede sigue de fondo. */
async function quickList(res) {
  const video = state.side?.videoId;
  const t = state.side.tests;
  const run = (t.run = { res, best: false, quickOnly: true, stage: 'quick', at: Date.now() });
  openGroup(res);
  runQuick(video, res);
  await waitUntil(() => t.run !== run || state.side?.videoId !== video || quickFirstDone(res));
  if (t.run === run) { t.run = null; renderStreamsOnly(); }
}
/** "Bajar la mejor al terminar" (2026-11-17): se prende o apaga mientras corre el análisis. */
export function toggleBest() {
  const run = state.side?.tests?.run;
  if (!run) return;
  run.best = !run.best;
  renderStreamsOnly();
}

/** El análisis de una resolución (2026-11-17): prueba rápida de todas → apenas termina su primera
 *  tanda, análisis profundo de las mejores. Con `best` además deja bajando de fondo la primera que
 *  ande sin cortes (`isSafeBest`, en el orden elegido); si en esa calidad no hay, sigue con la más baja
 *  siguiente (hasta 720p) y, si en ninguna hay, avisa. Se corta con `stopTests`. */
async function analyze(start, best) {
  const video = state.side?.videoId;
  const t = state.side.tests;
  const run = (t.run = { res: start, best, stage: 'quick', prev: null });
  const alive = () => t.run === run && state.side?.videoId === video;
  t.auto = null;
  let res = start;
  while (res) {
    Object.assign(run, { res, stage: 'quick', at: Date.now() });
    openGroup(res);
    runQuick(video, res);
    await waitUntil(() => !alive() || quickFirstDone(res));
    if (!alive()) return;
    learnEta('quick', (Date.now() - run.at) / 1000);
    Object.assign(run, { stage: 'deep', at: Date.now() });
    renderStreamsOnly();
    await runDeep(video, res);
    if (!alive()) return;
    const batches = Math.ceil((state.side.deep.hashes?.length ?? 0) / DEEP_BATCH);
    if (batches) learnEta('deepBatch', (Date.now() - run.at) / 1000 / batches);
    if (!run.best) break;
    const pick = sortOptions(groupsOf().get(res)).list.find(isSafeBest);
    if (pick) {
      try {
        if (!bgLoads.has(pick.info_hash)) await startBg(pick.info_hash);
        t.auto = { step: 'done', res, text: `elegí una de ${resLabel(res)} que anda sin cortes y ya la estoy descargando de fondo. Dale play cuando quieras.` };
      } catch (e) {
        showError(e);
        t.auto = { step: 'none', res, text: 'encontré una buena pero no pude empezar a bajarla. Probá con ▶ en la primera de la lista.' };
      }
      break;
    }
    run.prev = res;
    const lower = lowerRes(res);
    res = lower && RES_ORDER.indexOf(lower) <= RES_ORDER.indexOf('720p') ? lower : null;
    if (!res) t.auto = { step: 'none', res: run.prev, text: 'no encontré ninguna que ande sin cortes. Arriba de la lista quedó la mejor candidata: podés probarla igual o volver más tarde.' };
  }
  if (t.run === run) t.run = null;
  renderStreamsOnly();
}

/** Hashes cortados por "Detener": al volver sin resultado no cuentan como "nadie respondió". */
export const stopped = new Set();
/** "Detener" (2026-11-17): corta todo lo que esté probando (rápida y profunda, de cualquier video); lo
 *  ya probado queda. */
export function stopTests() {
  const t = state.side?.tests;
  // "Deteniendo…" mientras el núcleo corta las conexiones (tarda unos segundos): ver `groupPanel`.
  if (t?.run) t.stopping = { res: t.run.res };
  if (t) { t.run = null; t.intent = null; }
  const d = state.side?.deep;
  if (d?.status === 'run') d.stopped = true;
  counting.forEach((h) => stopped.add(h));
  quickRunning.clear();
  quickLive.clear();
  if (counting.size || t) api.catalogStopSwarm().catch(showError);
  renderStreamsOnly();
}
const waitUntil = async (ok) => { while (!ok()) await new Promise((r) => setTimeout(r, 500)); };

/** Al dejar un video con pruebas de conexión en curso (2026-11-17): seguir de fondo (los resultados
 *  quedan para cuando vuelvas) o cancelarlas. Cerrar el aviso = seguir. */
export async function leaveTests() {
  const n = new Set([...counting, ...quickRunning]).size;
  if (!n) return;
  const pick = await confirmDialog('¿Seguir testeando de fondo?',
    `Hay ${n} ${n === 1 ? 'prueba' : 'pruebas'} de conexión en curso de ${state.side?.name ?? 'este título'}. Pueden seguir de fondo mientras mirás otra cosa: cuando vuelvas, vas a ver los resultados.`,
    [{ id: 'dlg-tests-keep', label: 'Seguir de fondo', value: 'keep', primary: true },
      { id: 'dlg-tests-cancel', label: 'Cancelar pruebas', value: 'cancel' }]);
  state.side.tests.auto = null; // el automático no sigue sin el video abierto
  if (pick !== 'cancel') return;
  stopTests();
  counting.clear();
}


/** Testeados (conectándose al enjambre): hash → SwarmCount. Incluye los de la última hora que el
 *  núcleo guarda en los datos guardados (2026-11-17). */
export const counted = new Map();
/** Cuándo se testeó cada uno (ISO), para el tooltip. */
export const testedAt = new Map();
/** Censo DHT sin conectarse (spec 07): hash → direcciones únicas que dio la DHT. Solo informa
 *  (tooltips) y rescata a los 0/0 de "muerto"; no entra en la salud. */
export const census = new Map();
export const CENSUS_MAX = 40;
export async function runCensus(video, cands) {
  const hashes = [...cands].sort((a, b) => (seedsOf(b) ?? -1) - (seedsOf(a) ?? -1)).slice(0, CENSUS_MAX).map((c) => c.info_hash);
  try {
    const res = await api.catalogCensus(hashes);
    // Mapa vacío = cortado o sin DHT: no se sabe nada (no es "0 en todos").
    if (state.side?.videoId !== video || !Object.keys(res).length) return;
    hashes.forEach((h) => census.set(h, res[h] ?? 0));
    renderStreamsOnly();
  } catch (e) { showError(e); }
}
/** Hashes con un recuento en curso: el spinner sobrevive a los redibujos (varios a la vez). */
export const counting = new Set();
/** Conteo parcial de los que están contando (evento `catalog-swarm-progress`), hash → SwarmCount. */
export const liveCount = new Map();
/** Prueba rápida (2026-11-17, embudo paso 1): al abrir un grupo de resolución (también el que se abre
 *  solo al entrar) se prueban sus opciones ≤ 30 s (`swarm::Depth::Quick`), hash → SwarmCount con hasta `QUICK_ENOUGH` seeds reales. Descarta y
 *  ordena antes del test profundo, en vez del número anunciado por los trackers (muy inflado). */
export const quick = new Map();
export const quickRunning = new Set();
/** En vivo mientras prueba (evento `catalog-swarm-progress` rápido). */
export const quickLive = new Map();
/** Etapa de cada prueba en curso (rápida o a fondo) y desde cuándo, hash → {reached, t}: cada
 *  etapa tiene su barra, que arranca de cero al pasar a la siguiente (2026-11-17). */
export const phaseAt = new Map();
export function notePhase(hash, count) {
  const p = phaseAt.get(hash);
  if (!p || p.reached !== count.reached) phaseAt.set(hash, { reached: count.reached, t: Date.now() });
}
export const QUICK_ENOUGH = 8, QUICK_WEAK = 3;
/** Primera tanda de la prueba rápida = las que el núcleo prueba a la vez (`Depth::Quick`). */
export const QUICK_BATCH = 30;
/** ¿Terminó la primera tanda de ese grupo? (las de mejor pinta según los trackers). Con eso ya se
 *  ofrece el test profundo; el resto sigue probándose de fondo. */
export function quickFirstDone(res) {
  const first = state.side?.tests?.first[res];
  // Las rezagadas no traban el botón: pasado `QUICK_LATE_MS` se ofrece igual (siguen de fondo).
  return !first || first.hashes.every((h) => quick.has(h) || counted.has(h) || !quickRunning.has(h))
    || Date.now() - first.at > QUICK_LATE_MS;
}
/** A `QUICK_LATE_MS` la primera tanda se da por terminada (las rezagadas siguen de fondo). */
export const QUICK_LATE_MS = 45_000;
/** Del grupo: probándose todavía, y ya probadas con gente real (3+) que el test profundo no vio. */
export function quickPending(res) {
  const inRes = (state.update?.candidates ?? []).filter((c) => inScope(c, res));
  return {
    running: inRes.filter((c) => quickRunning.has(c.info_hash) && !quick.has(c.info_hash)).length,
    potential: inRes.filter((c) => !counted.has(c.info_hash) && !counting.has(c.info_hash) && quickGroup(c) <= 1).length,
  };
}
/** Grupo por la prueba rápida (menor = mejor): 0 = 8+ seeds reales o ya testeada a fondo, 1 = 3 a 7,
 *  2 = sin probar todavía, 3 = 1 o 2, o sin respuesta pero con gente conocida (poco confiable),
 *  4 = nadie (muerta). Solo baja opciones: no las saca de la lista. */
export function quickGroup(c) {
  if (counted.has(c.info_hash)) return 0;
  const q = quick.get(c.info_hash);
  if (!q) return 2;
  if (!q.reached) return q.peers ? 3 : 4;
  return q.seeds >= QUICK_ENOUGH ? 0 : q.seeds >= QUICK_WEAK ? 1 : q.seeds > 0 ? 3 : 4;
}
/** Mejores primero para el test profundo: prueba rápida y después seeds (reales si hay). */
export const byQuick = (a, b) => quickGroup(a) - quickGroup(b) || (knownSeeds(b) ?? -1) - (knownSeeds(a) ?? -1);
/** Prueba rápida de las opciones de esa resolución que no tengan dato real. Antes de `ready` (tests
 *  guardados todavía sin cargar) no: repetiría los de la última hora. */
export async function runQuick(video, res) {
  const t = state.side?.tests;
  if (!t?.ready || !res || state.side.videoId !== video) return;
  // Las de mejor pinta según los trackers primero: el núcleo las prueba en ese orden (primera tanda).
  const hashes = (state.update?.candidates ?? []).filter((c) => inScope(c, res))
    .filter((c) => !counted.has(c.info_hash) && !counting.has(c.info_hash) && !quick.has(c.info_hash) && !quickRunning.has(c.info_hash))
    .sort((a, b) => (seedsOf(b) ?? -1) - (seedsOf(a) ?? -1)).map((c) => c.info_hash);
  if (!hashes.length) return;
  // Solo una tanda, las de mejor pinta (2026-11-17): nada sigue probándose de fondo después, así la
  // lista queda quieta una vez que aparece.
  hashes.splice(QUICK_BATCH);
  t.first[res] = { hashes, at: Date.now() };
  hashes.forEach((h) => quickRunning.add(h));
  renderStreamsOnly();
  try {
    await api.catalogSwarm(hashes, 'quick'); // cada resultado llega antes por `catalog-swarm-counted`
  } catch { /* sin prueba rápida queda el orden por trackers */ } finally {
    hashes.forEach((h) => { quickRunning.delete(h); quickLive.delete(h); if (!counting.has(h)) phaseAt.delete(h); });
    if (state.side?.videoId === video) renderStreamsOnly();
  }
}
/** Análisis profundo de esas opciones: se conecta a cada enjambre y cuenta los seeders reales. */
export async function countSeeds(hashes) {
  const todo = hashes.filter((h) => !counting.has(h));
  if (!todo.length) return;
  todo.forEach((h) => counting.add(h)); // la barra arranca con su primer progreso (antes espera lugar)
  renderStreamsOnly();
  const video = state.side?.videoId;
  try {
    const found = await api.catalogSwarm(todo, 'deep');
    if (state.side?.videoId !== video) return; // se fue de ese video: el resultado no se usa
    // Sin resultado = ningún peer dio los metadatos a tiempo: cuenta como "nadie respondió", no se
    // queda con el número de los trackers (que suele ser justamente el inflado).
    // Detenido por el usuario: lo que no llegó a contarse queda sin contar (no "nadie respondió").
    for (const h of todo) {
      if (found[h] || !stopped.has(h)) { counted.set(h, found[h] ?? { seeds: 0, peers: 0, reached: false }); testedAt.set(h, new Date().toISOString()); }
      deepDone.add(h);
      stopped.delete(h);
    }
    logCensus(todo);
    if (todo.length === 1 && !found[todo[0]]) setStatus('No se pudo contar ese torrent: nadie respondió a tiempo.');
  } catch (e) { showError(e); } finally {
    todo.forEach((h) => { counting.delete(h); liveCount.delete(h); phaseAt.delete(h); });
    const d = state.side?.deep;
    if (d?.single && !counting.size) Object.assign(d, { status: d.after, single: false, hashes: [] });
    renderStreamsOnly();
  }
}

/** Log local para el experimento del spec 07 (`streamonte.census-log`, máx. 300 filas, la más nueva primero). */
export function logCensus(hashes) {
  try {
    const rows = hashes.map((hash) => {
      const c = state.update?.candidates.find((x) => x.info_hash === hash);
      const n = counted.get(hash);
      return { at: new Date().toISOString(), network: currentNetwork(), hash, res: c?.resolution ?? null, trackerSeeds: c ? seedsOf(c) : null,
        trackerLeechers: c?.leechers ?? null, completed: c?.completed ?? null, census: census.get(hash) ?? null,
        seeds: n?.seeds ?? null, peers: n?.peers ?? null, known: n?.known ?? null, level: c ? health(c)?.level ?? null : null };
    });
    const old = JSON.parse(safeGet('streamonte.census-log') ?? '[]');
    safeSet('streamonte.census-log', JSON.stringify([...rows, ...old].slice(0, 300)));
  } catch { /* el log es opcional */ }
}

/** Etapa 2 del embudo: cuántos se cuentan a fondo. 15 (pedido 2026-11-15): el núcleo cuenta 10 a la
 *  vez con hasta 30 conexiones cada uno (`swarm::Depth::Deep`), así que van en dos tandas. */
export const TOP = 15;
/** Cuánto tarda el análisis (2026-11-17), aprendido de los anteriores en esta compu (promedio móvil):
 *  la primera tanda de la prueba rápida y cada tanda del profundo (`DEEP_BATCH` a la vez, como
 *  `swarm::Depth::Deep`). Sin historia: lo típico. */
const ETA_KEY = 'streamonte.analysis-eta';
const DEEP_BATCH = 10;
const etaStats = () => { try { return JSON.parse(safeGet(ETA_KEY) ?? '{}'); } catch { return {}; } };
function learnEta(field, secs) {
  const s = etaStats();
  s[field] = s[field] ? s[field] * 0.7 + secs * 0.3 : secs;
  safeSet(ETA_KEY, JSON.stringify(s));
}
/** "~3 min" para analizar `n` opciones (sin dato todavía, como si fueran muchas). */
export function analysisEta(n = TOP) {
  const s = etaStats();
  const secs = (s.quick ?? 35) + Math.ceil(Math.min(TOP, n || TOP) / DEEP_BATCH) * (s.deepBatch ?? 110);
  return `~${Math.max(1, Math.round(secs / 60))} min`;
}
/** Finalistas que además reciben el análisis rápido (metadatos, duración, idiomas). */
export const FINALISTS = 8;
export function finalists(cands) {
  return cands.filter((c) => counted.get(c.info_hash)?.seeds > 0)
    .sort((a, b) => counted.get(b.info_hash).seeds - counted.get(a.info_hash).seeds || counted.get(b.info_hash).peers - counted.get(a.info_hash).peers)
    .slice(0, FINALISTS).map((c) => c.info_hash);
}
/** Hashes de la etapa en curso que ya respondieron (evento `catalog-swarm-counted`). */
export const deepDone = new Set();
/** Salteados por el análisis (2026-11-15), hash → por qué: 'dead' = trackers con 0 seeders y 0
 *  leechers y la fuente sin seeders; 'rest' = fuera de los `TOP`. Se analizan igual desde su fila. */
export const skipped = new Map();
// Con censo > 0 la DHT ve peers que los trackers no (spec 07): no se da por muerto.
export const unlikely = (c) => c.seeders === 0 && c.leechers === 0 && !(c.seeders_declared > 0) && !(census.get(c.info_hash) > 0);
/** Análisis profundo desde cero de esas opciones (borra lo contado antes). Una sola: se cuenta ya;
 *  varias: el embudo de `runDeep`. */
export function reanalyze(hashes, res = null) {
  const video = state.side?.videoId;
  if (hashes.length === 1) quickAnalyze(hashes);
  hashes.forEach((h) => { counted.delete(h); if (hashes.length === 1) skipped.delete(h); });
  if (hashes.length === 1) {
    // El panel de arriba muestra también los sueltos (2026-11-16): durante un lote suman a su "N de
    // M"; sin lote, el panel pasa a "Analizando N" y al terminar vuelve a lo que había (el usuario no
    // eligió analizar en lote).
    const d = state.side?.deep;
    if (d && d.status !== 'run') Object.assign(d, { status: 'run', single: true, after: d.status, hashes: [] });
    if (d && !d.hashes.includes(hashes[0])) { d.hashes.push(hashes[0]); deepDone.delete(hashes[0]); }
    countSeeds(hashes);
  } else {
    runDeep(video, res);
  }
}

/** Análisis profundo (2026-11-15): los trackers ya respondieron al cargar las opciones (el núcleo
 *  los consulta solo), así que de ahí sale el orden: se descartan los `unlikely` y se cuentan a
 *  fondo, todos a la vez, los `TOP` mejores. El progreso va en `state.side.deep.hashes` / `deepDone`. Se
 *  corta al salir del video. */
export async function runDeep(video, res) {
  const d = state.side.deep;
  if (d.status === 'run') return;
  d.status = 'run';
  d.res = res;
  const all = (state.update?.candidates ?? []).filter((c) => inScope(c, res));
  const todo = all.filter((c) => !counted.has(c.info_hash) && !counting.has(c.info_hash));
  todo.forEach((c) => skipped.delete(c.info_hash)); // reanalizar decide de nuevo
  todo.filter((c) => unlikely(c) || quickGroup(c) === 4).forEach((c) => skipped.set(c.info_hash, 'dead'));
  // Solo los TOP mejores según la prueba rápida y los trackers (más abajo casi nunca se ven bien).
  const ranked = todo.filter((c) => !skipped.has(c.info_hash)).sort(byQuick);
  ranked.slice(TOP).forEach((c) => skipped.set(c.info_hash, 'rest'));
  d.hashes = ranked.slice(0, TOP).map((c) => c.info_hash);
  deepDone.clear();
  renderStreamsOnly();
  if (d.hashes.length) await countSeeds(d.hashes);
  // Detenido: vuelve a ofrecer el análisis en lote; si no, queda hecho para esa resolución.
  if (state.side?.deep === d) { d.status = d.stopped ? null : 'done'; d.stopped = false; renderStreamsOnly(); }
  // Los finalistas, además, con análisis rápido (metadatos, duración, idiomas reales).
  if (state.side?.videoId === video) quickAnalyze(finalists(all));
}

/** Análisis rápido sin salir del catálogo (2026-11-15): se agrega a la biblioteca y el resultado
 *  aparece en la fila (duración, idiomas). Sin botón propio: va solo con cada "Analizar". */
export async function quickAnalyze(hashes) {
  if (!hashes.length) return;
  try {
    await api.catalogAdd(state.side.kind, state.side.videoId, hashes);
    await Promise.all(hashes.map((hash) => api.analyze({ kind: 'quick', hash })));
  } catch (e) { showError(e); }
}

/** Eventos de las pruebas del núcleo (2026-11-17, antes en `init` de catalog.js): progreso en vivo y
 *  resultado, de la rápida (`deep = false`) o la profunda. Se redibuja como mucho cada 400 ms. */
export function onSwarmEvent(event) {
  const { hash, count, deep } = event;
  if (event.type === 'catalog-swarm-progress') {
    if (!(deep ? counting : quickRunning).has(hash)) return;
    (deep ? liveCount : quickLive).set(hash, count);
    notePhase(hash, count);
    scheduleRender();
    return;
  }
  if (!deep) {
    quick.set(hash, count); // cada resultado reordena la lista al llegar
  } else {
    counted.set(hash, count);
    counting.delete(hash);
    liveCount.delete(hash);
    deepDone.add(hash);
  }
  if (state.update?.candidates.some((c) => c.info_hash === hash)) scheduleRender();
}
