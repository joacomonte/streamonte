// Opciones de un video (2026-11-17, separado de catalog.js): grupos por resolución, orden, fila de
// cada torrent, panel de pruebas, reproducir y bajar de fondo. Las pruebas en sí: `catalog-tests.js`.

import { api } from './api.js';
import { closeWizard, originalAudio, play } from './audio-picker.js';
import { $, el, icon, setStatus } from './dom.js';
import { ago, humanBytes, mbps, nf, nf1, playbackText } from './format.js';
import { healthCalibration, MIN_SECS, notePrediction, predict, shownLevel, speedOf, TRACKER_MIN, trackPlayback } from './health-calib.js';
import { state as lib } from './state.js';
import { renderSide } from './catalog-side.js';
import { safeSet, showError, state, view } from './catalog-state.js';
import { isReading, openSubs, readError, readSubsNow, readTracks, readUntil, stopReading, subsScan, subsStep, toggleSubsScan } from './catalog-subs.js';
import { analysisEta, census, counted, counting, deepDone, liveCount, loadSavedTests, newVideoTests, once, phaseAt, quick, QUICK_ENOUGH, QUICK_LATE_MS, quickGroup, quickLive, quickPending, quickRunning, reanalyze, runCensus, runDeep, skipped, startAnalysis, stopTests, testedAt, toggleBest, TOP, unlikely } from './catalog-tests.js';
import { crumbs, fitsNet, flowFilter, flowStep, hasResStep, isMatch, moreRow, newFlow } from './catalog-flow.js';

/** Tooltips del badge HDR (pedido 2026-11-15, en blanco y negro): HDR y Dolby Vision se muestran igual;
 *  el tooltip dice cuál es. */
export const HDR_TIP = {
  HDR: 'HDR: más rango de brillo y color. Se aprovecha con pantalla HDR; en una común se ve igual o un poco más apagado.',
  DV: 'Dolby Vision: HDR dinámico de Dolby. En pantallas sin Dolby Vision puede verse con colores raros (verde/violeta).',
};
/** ¿Audio latino? (2026-11-18). Con las pistas ya leídas mandan ellas: 'real' (pista latina), 'spa' (español sin
 *  aclarar la variante: puede ser latino o de España) o null. Sin leerlas, el nombre: 'name' (dice LATINO), 'maybe'
 *  (MULTI / Dual / español sin aclarar cuál: hay que validar) o null. */
export function latOf(c) {
  const read = rowsOf(c.info_hash).find((e) => e.live?.audio?.length);
  if (read) return read.languages?.some((l) => l.code === 'lat') ? 'real' : read.languages?.some((l) => l.code === 'es') ? 'spa' : null;
  if (c.audio.includes('lat')) return 'name';
  return !c.audio.includes('cast') && (c.audio.includes('multi') || c.audio.includes('es')) ? 'maybe' : null;
}
/** ¿Pidió ver en latino? (paso "¿Necesitás audio latino?" del flujo). Afuera de ese modo, el latino solo se muestra
 *  confirmado. */
const wantsLatino = () => state.side?.flow?.lat === true;
/** ¿Trae subs en español? (2026-11-18): `true` / `false` según las pistas ya leídas (análisis o TorBox, guardadas
 *  por torrent) o un archivo .srt en español en la lista de TorBox (solo dice sí); `null` = no se sabe. */
export function hasSpanishSubs(hash) {
  const subs = rowsOf(hash).find((e) => e.native_subs)?.native_subs;
  if (subs) return subs.length > 0;
  return torboxSpanishSubs.has(hash) ? true : null;
}
/** Idioma ya sabido, como badges junto a TORBOX (2026-11-18, design/opciones-acciones/variantes-v6.html): CC ES verde
 *  (trae subs), SIN CC ES gris (se leyó y no trae), LAT verde (pista latina confirmada) y, pidiendo latino, ES? gris
 *  (español sin aclarar si es latino o de España: leer de nuevo no lo aclara). */
function langTags(c) {
  const hash = c.info_hash;
  const subs = hasSpanishSubs(hash);
  const native = rowsOf(hash).find((e) => e.native_subs)?.native_subs ?? [];
  const lat = latOf(c);
  const tracks = rowsOf(hash).find((e) => e.live?.audio?.length)?.live.audio ?? [];
  return [
    subs === true ? el('span', { class: 'cat-tag cat-lang ok', title: native.length
      ? `Trae subtítulos en español (siempre en sync):\n${native.map((x) => `· ${x.place} · ${x.kind}`).join('\n')}`
      : 'Trae un archivo de subtítulos en español (según la lista de archivos de TorBox)' }, icon('subs', 11), 'ES') : null,
    subs === false ? el('span', { class: 'cat-tag cat-lang no', title: 'Se leyeron sus pistas: no trae subtítulos en español. Con "Elegir subs" buscás de afuera.' }, 'Sin', icon('subs', 11), 'ES') : null,
    lat === 'real' ? el('span', { class: 'cat-tag cat-lang ok', title: 'Audio latino: confirmado en las pistas del video' }, icon('check', 10), 'LAT') : null,
    lat === 'spa' && wantsLatino() ? el('span', { class: 'cat-tag cat-lang no', title: `Trae audio en español, pero sus pistas no aclaran si es latino o de España (se sabe escuchándolo unos segundos).\nPistas: ${tracks.map((t) => [t.lang, t.title].filter(Boolean).join(' · ') || 'sin dato').join(' | ')}` }, 'ES?') : null,
  ];
}
/** Lo que falta saber del idioma, como botones de la cápsula del ▶: "¿Trae subs?" y, pidiendo latino, "¿Audio
 *  latino?" (las dos leen las mismas pistas: una lectura responde ambas); "Elegir subs" si se sabe que no trae. */
function langActions(c) {
  const hash = c.info_hash;
  const subs = hasSpanishSubs(hash);
  const lat = latOf(c);
  return [
    subs == null ? checkButton(hash, 'subs') : null,
    wantsLatino() && (lat === 'name' || lat === 'maybe') ? checkButton(hash, 'lat') : null,
    subs === false ? el('button', { id: `cat-subfind-${hash}`, type: 'button', class: 'cat-dock-btn', title: 'No trae subtítulos en español: elegí de afuera (muestra cuáles calzan con este archivo)',
      onclick: (e) => { e.stopPropagation(); openSubs(hash, !!view.torboxKey && inTorbox.has(hash), e.currentTarget); } }, icon('search', 13), 'Elegir subs') : null,
  ].filter(Boolean);
}
/** Leer las pistas (TorBox: un pedido, segundos; torrent: la prueba rápida, necesita seeds). Leyendo, el mismo botón
 *  queda cargando y otro clic corta la espera (lo leído hasta ahí no se pierde). */
function checkButton(hash, kind) {
  const reading = isReading(hash);
  const error = readError(hash);
  const [ic, text0, busy, tip0] = kind === 'subs'
    ? ['subs', '¿Trae subs?', 'Leyendo subs…', 'Mira adentro del video si trae subtítulos en español (no baja nada)']
    : ['speaker', '¿Audio latino?', 'Leyendo audio…', 'Lee sus pistas de audio para confirmar si es latino'];
  // No se pudo leer (2026-11-18: antes volvía al botón de siempre y parecía que no hizo nada): dice por qué.
  const text = error ? 'No se pudo · reintentar' : text0;
  const tip = error ? `No se pudo leer: ${error}. Tocá para reintentar` : tip0;
  return el('button', { id: `cat-${kind}check-${hash}`, type: 'button', class: `cat-dock-btn ${reading ? 'loading' : ''}`,
    title: reading ? 'Tocá para cancelar' : `${tip} (${inTorbox.has(hash) ? 'un pedido a TorBox, unos segundos' : 'por torrent: necesita seeds'})`,
    'aria-label': reading ? `${busy} Tocá para cancelar` : text,
    onclick: (e) => { e.stopPropagation(); if (reading) stopReading(hash); else readSubsNow(hash, inTorbox.has(hash)); } },
  reading ? [el('span', { class: 'cat-dock-ic' }, el('span', { class: 'cat-res-spin', 'aria-hidden': 'true' }), icon('stop', 11)), el('span', { class: 'cat-dock-busy' }, busy), el('span', { class: 'cat-dock-cancel' }, 'Cancelar')]
    : [icon(ic, 13), text]);
}
// ---------- opciones (FR-42–49) ----------
export async function loadStreams(videoId) {
  state.side.videoId = videoId;
  // Análisis profundo de la resolución elegida. `status`: null | 'run' | 'done'.
  state.side.deep = { status: null, hashes: [] };
  state.side.tests = newVideoTests();
  state.side.torbox = null; // null | 'checking' | 'done' | 'error'
  census.clear();
  // Pasos (2026-11-18): torrent o TorBox → ¿latino? → resolución → lista (`catalog-flow.js`).
  state.side.flow = newFlow();
  view.openRes = '';
  view.shownRows = PAGE_ROWS;
  view.onlyHdr = false;
  api.downloadsFreeBytes().then((b) => { view.freeBytes = b; renderStreamsOnly(); }).catch(() => {});
  state.update = null;
  renderSide();
  setStatus('Pidiendo torrents a todas las fuentes…');
  try {
    await api.catalogStreams(state.side.kind, videoId);
  } catch (e) { showError(e); }
}

// Lectura de subs en curso o terminada: el chip "¿Sub ES?" de la fila cambia.
document.addEventListener('subs-changed', () => { if (state.side?.videoId) renderStreamsOnly(); });

export function onStreams(update) {
  if (update.video_id !== state.side?.videoId) return;
  state.update = update;
  const t = state.side.tests;
  if (update.done && update.candidates.length) {
    // Censo DHT apenas están las fuentes y los trackers (2026-11-16): una vez por video, en paralelo.
    if (once(t, 'census')) runCensus(update.video_id, update.candidates);
    if (once(t, 'saved')) loadSavedTests(update.video_id, update.candidates);
    if (once(t, 'torbox')) loadTorbox(update.video_id, update.candidates);
  }
  const ok = update.addons.filter((a) => a.state !== 'pending').length;
  setStatus(update.done
    ? `${update.candidates.length} opción(es) de ${ok} fuente(s). Analizá o reproducí una.`
    : `${ok} de ${update.addons.length} fuentes respondieron…`);
  renderStreamsOnly();
}

/** Filas de la biblioteca de ese torrent (una por episodio de un pack; el análisis es del torrent). */
export function rowsOf(hash) {
  if (view.libByHash) return view.libByHash.get(hash) ?? [];
  return [...state.library.values()].filter((e) => e.info_hash === hash);
}
/** Seeders sin análisis profundo: los de los trackers (chequeados recién, al cargar las opciones)
 *  mandan; un 0 de tracker con la fuente diciendo más suele ser un tracker que no conoce el torrent,
 *  y ahí vale la fuente. */
export const trackersWin = (c) => c.seeders > 0 || (c.seeders === 0 && !(c.seeders_declared > 0));
export function seedsOf(c) {
  return trackersWin(c) ? c.seeders : c.seeders_declared ?? null;
}

/** Por seeders, leechers y peso (lo usan los subtítulos y el desempate de `sortOptions`). */
export const bySeeds = (a, b) => tierOf(b) - tierOf(a) || (knownSeeds(b) ?? -1) - (knownSeeds(a) ?? -1) || (leechersOf(b) ?? -1) - (leechersOf(a) ?? -1) || (b.size_bytes ?? 0) - (a.size_bytes ?? 0);

/** ¿Ya se testeó a fondo la resolución abierta? Hasta entonces se ordena solo por conexión y el
 *  selector de orden es una etiqueta (2026-11-17). */
export const deepTested = () => state.side?.deep?.status === 'done' && state.side.deep.res === view.openRes;
/** Orden de las opciones (2026-11-17), recalculado en cada redibujo. Antes del test manda la
 *  conexión: el veredicto de salud y, sin veredicto, la gente que comparte (seeds, después leechers).
 *  "Mejor imagen": arriba las testeadas que andan fluidas, por calidad de imagen (ya se sabe que van a
 *  cargar bien); después todo lo demás por conexión. "Arranca más rápido": todo por conexión. Al final,
 *  siempre: las que no entran en el disco y las que nadie respondió. El peso nunca ordena. Arriba de
 *  todo va lo que se reproduce o baja. `best` = la primera que entra, no es de cine y anda fluida (la
 *  fila confirma que esté testeada). */
export function sortOptions(cands) {
  // TorBox (2026-11-17): se ven desde sus servidores, así que seeds y salud no importan.
  if (state.side?.flow?.mode === 'torbox') {
    // Por bitrate (2026-11-18): más Mbps = más imagen por segundo; la resolución sola no dice cuánto se comprimió. A
    // igual bitrate, la de mejor calidad de imagen; la de cine al final.
    // Sin peso no se sabe cuánto pide: al final, como la de cine (2026-11-18: salía "Mejor opción" sin tamaño).
    const unknown = (c) => c.size_bytes == null || c.source === 'CAM';
    const list = [...cands].sort((a, b) => unknown(a) - unknown(b) || mbpsOf(b) - mbpsOf(a) || qualityRank(b) - qualityRank(a));
    return { list: pinPlaying(list), best: list.find(isMatch) ?? null };
  }
  const mode = deepTested() ? view.optSort : 'fast';
  const lvl = new Map(cands.map((c) => { const h = health(c); return [c, h ? h.shown + (h.probable ? 0.5 : 0) : 1.75]; }));
  const byConnection = (a, b) => lvl.get(a) - lvl.get(b) || (knownSeeds(b) ?? -1) - (knownSeeds(a) ?? -1) || (leechersOf(b) ?? -1) - (leechersOf(a) ?? -1);
  const tail = (c) => (tierOf(c) < 1 ? 3 : !fits(c) ? 2 : 0);
  const proven = (c) => counted.get(c.info_hash)?.reached && lvl.get(c) === 0;
  // Antes del test profundo (y debajo de las probadas a fondo) manda la prueba rápida: seeds reales.
  // Prueba en curso que ya pasó a contar seeds reales (etapa 2/2): arriba de todo mientras dura,
  // con más seeds primero (2026-11-17). Al terminar vuelve a su lugar por el resultado.
  const advancing = (c) => {
    const h = c.info_hash;
    const live = counting.has(h) ? liveCount.get(h) : quickRunning.has(h) && !quick.has(h) ? quickLive.get(h) : null;
    return live?.reached ? live : null;
  };
  const group = (c) => (advancing(c) ? -1 : tail(c) ? 10 + tail(c) : mode === 'quality' && proven(c) ? 0 : 1 + quickGroup(c));
  const list = [...cands].sort((a, b) => group(a) - group(b)
    || (group(a) === -1 ? advancing(b).seeds - advancing(a).seeds : 0)
    || (mode === 'quality' && group(a) === 0 ? qualityRank(b) - qualityRank(a) : 0)
    || byConnection(a, b));
  const best = list.find((c) => fits(c) && c.source !== 'CAM' && lvl.get(c) === 0) ?? null;
  return { list: pinPlaying(list), best };
}
/** Fija arriba (2026-11-18) lo que se reproduce o baja: el resto se reordena debajo sin moverla. Lo que se está
 *  preparando (▶ tocado, eligiendo audio y subtítulos) no se mueve: sube recién al arrancar. */
function pinPlaying(list) {
  const active = new Set([...lib.playbacks.values()].filter((r) => r.state.kind !== 'failed').map((r) => r.key.split(':')[0]));
  return [...list.filter((c) => active.has(c.info_hash)), ...list.filter((c) => !active.has(c.info_hash))];
}

/** Grupo para ordenar: 2 = analizado a fondo (arriba), 1 = el resto (trackers, fuente o una
 *  medición vieja de la biblioteca), 0,5 = sin respuesta pero con peers conocidos (no está muerto,
 *  2026-11-16), 0 = nadie lo comparte. */
export function tierOf(c) {
  const n = counted.get(c.info_hash);
  return !n ? 1 : n.reached !== false ? 2 : n.peers ? 0.5 : 0;
}
/** Seeders que se saben de una opción, de lo más confiable a lo menos: contados al analizar
 *  (aunque sea 0), medidos al reproducir o cargar, según los trackers y, por último, la fuente. */
export function knownSeeds(c) {
  const q = quick.get(c.info_hash);
  return seedsCounted(c) ?? (q?.reached ? q.seeds : null) ?? seedsOf(c);
}
/** Seeders contados o medidos de una opción (sin los de trackers); null si no hay ninguno. */
export function seedsCounted(c) {
  const partial = liveCount.get(c.info_hash);
  return counted.get(c.info_hash)?.seeds ?? (partial?.reached ? partial.seeds : null)
    ?? rowsOf(c.info_hash).find((e) => e.live?.seeds > 0)?.live.seeds ?? null; // un 0 viejo (serde default) no es "0 contados"
}
/** Leechers (desempate): conectados sin el archivo completo al contar, o los del scrape automático. */
export function leechersOf(c) {
  const partial = liveCount.get(c.info_hash);
  const n = counted.get(c.info_hash) ?? (partial?.reached ? partial : null) ?? rowsOf(c.info_hash).find((e) => e.live)?.live;
  if (n?.reached === false) return null; // nadie respondió: esos peers solo los conoce la DHT
  return n ? Math.max(0, n.peers - n.seeds) : c.leechers ?? null;
}

/** Lo que entra en un análisis: esa resolución (o todas, sin `res`) y, si se pidió, solo HDR. */
/** Opciones que están en la caché de TorBox (2026-11-17; vacío sin key). */
export const inTorbox = new Set();
/** De esas, las que traen un subtítulo en español como archivo suelto (sale del mismo pedido). */
const torboxSpanishSubs = new Set();
/** Una vez por video, apenas está la lista: cuáles están en TorBox. Sin key no pregunta nada. */
export async function loadTorbox(video, cands) {
  if (!view.torboxKey) return;
  state.side.torbox = 'checking';
  const found = await api.catalogTorbox(video, cands.map((c) => c.info_hash)).catch(() => null);
  if (state.side?.videoId !== video) return;
  // null = TorBox no respondió (la key ya se sabe que está).
  state.side.torbox = found ? 'done' : 'error';
  found?.hashes.forEach((h) => inTorbox.add(h));
  found?.spanish_subs.forEach((h) => torboxSpanishSubs.add(h));
  renderStreamsOnly();
}
api.apiKeys().then((ks) => {
  view.torboxKey = ks.some((k) => k.service === 'torbox' && k.configured);
  renderStreamsOnly();
}).catch(() => {});
// Key de TorBox recién cargada en Ajustes: se marca enseguida lo del video abierto.
document.addEventListener('streamonte:torbox-key', () => {
  view.torboxKey = true;
  if (state.update?.done) loadTorbox(state.side.videoId, state.update.candidates);
  else renderStreamsOnly();
});
// ---------- clic derecho en una opción (2026-11-17): copiar su magnet o su link de TorBox ----------
const ctx = el('div', { id: 'cat-ctx', class: 'cat-ctx', role: 'menu' });
ctx.hidden = true;
document.body.append(ctx);
const closeCtx = () => { ctx.hidden = true; };
/** Copia el link que todavía se está pidiendo: con `ClipboardItem` + promesa el permiso del clic
 *  sigue valiendo después de esperar al núcleo (WebKit lo pierde con un `await` antes de copiar). */
function copyLink(hash, torbox) {
  closeCtx();
  const f = state.side?.flow;
  const link = api.catalogLink(hash, torbox, state.side?.details?.details?.original_language ?? null, !!(f?.lat && !f.latOff));
  const done = typeof ClipboardItem === 'function'
    ? navigator.clipboard.write([new ClipboardItem({ 'text/plain': link.then((t) => new Blob([t], { type: 'text/plain' })) })])
    : link.then((t) => navigator.clipboard.writeText(t));
  if (torbox) setStatus('Pidiéndole el link a TorBox…');
  done.then(() => setStatus(torbox ? 'Link para castear copiado (stream de TorBox): pegalo en Web Video Caster. Vence en unas horas.' : 'Magnet copiado.')).catch(showError);
}
document.addEventListener('contextmenu', (ev) => {
  const row = ev.target.closest?.('.cat-opt[data-hash]');
  if (!row) return;
  ev.preventDefault();
  const hash = row.dataset.hash;
  const item = (id, label, torbox) => el('button', { id, class: 'cat-ctx-item', role: 'menuitem', type: 'button', onclick: () => copyLink(hash, torbox) }, icon(torbox ? 'external' : 'copy', 14), label);
  ctx.replaceChildren(...[
    view.torboxKey && inTorbox.has(hash) ? item('cat-ctx-torbox', 'Copiar link para castear (TorBox)', true) : null,
    item('cat-ctx-magnet', 'Copiar magnet', false),
    el('button', { id: 'cat-ctx-subs', class: 'cat-ctx-item', role: 'menuitem', type: 'button',
      onclick: () => { closeCtx(); openSubs(hash, !!view.torboxKey && inTorbox.has(hash), document.getElementById(`cat-play-${hash}`) ?? row); } }, icon('subs', 14), 'Subtítulos…'),
  ].filter(Boolean));
  ctx.hidden = false;
  ctx.style.left = `${Math.min(ev.clientX, innerWidth - ctx.offsetWidth - 8)}px`;
  ctx.style.top = `${Math.min(ev.clientY, innerHeight - ctx.offsetHeight - 8)}px`;
  ctx.querySelector('button').focus({ preventScroll: true });
});
document.addEventListener('pointerdown', (ev) => { if (!ctx.hidden && !ctx.contains(ev.target)) closeCtx(); });
document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') closeCtx(); });
document.addEventListener('scroll', closeCtx, { capture: true, passive: true });

/** Filtros de la lista (lo elegido en los pasos y "Solo HDR"): una regla para grupos y filas. */
const passesFilters = (c) => flowFilter(c) && (!view.onlyHdr || c.hdr.length);
export const inScope = (c, res) => (!res || resKey(c) === res) && passesFilters(c);

/** Arriba de la lista: el panel de búsqueda y test, solo (2026-11-17: subtítulos y HDR van aparte). */
export function optionsHead() {
  const auto = autoBar();
  return auto ? el('div', { class: 'cat-opt-head' }, auto) : null;
}

/** Cómo terminó "bajar la mejor al terminar" (2026-11-17): la elegida ya bajando, o que no hubo. */
export function autoBar() {
  const t = state.side.tests, a = t.auto;
  if (!a || !state.update?.done) return null;
  return el('div', { id: 'cat-auto-status', class: `cat-auto-status ${a.step}`, role: 'status' },
    icon(a.step === 'done' ? 'check' : 'ban', 16),
    el('span', { class: 'cat-auto-msg' }, el('b', {}, 'La mejor · '), a.text),
    el('button', { id: 'cat-auto-close', class: 'link', onclick: () => { t.auto = null; renderStreamsOnly(); } }, 'Cerrar'));
}

/** Orden de la lista (2026-11-17), arriba de las opciones del grupo abierto (no junto al panel de
 *  test). Antes del test profundo es solo información. */
export function sortRow(extra = null) {
  // Filtro, a la derecha del orden: es sobre la lista, no sobre el test.
  const hdr = el('button', {
    id: 'cat-only-hdr', class: 'cat-hdr-filter', 'aria-pressed': String(view.onlyHdr),
    title: view.onlyHdr ? 'Mostrando solo HDR / Dolby Vision: tocá para ver todas' : 'Mostrar solo las opciones con HDR / Dolby Vision (más rango de luz y color)',
    onclick: () => { view.onlyHdr = !view.onlyHdr; renderStreamsOnly(); },
  }, view.onlyHdr ? icon('check', 12) : null, 'Solo HDR');
  const order = state.side?.flow?.mode === 'torbox' ? el('div', { class: 'cat-sort-row', id: 'cat-sort-info' },
    el('span', { class: 'cat-sort-label' }, 'Ordenado por'),
    el('span', { class: 'cat-sort-fixed', title: 'En TorBox se ven al instante desde sus servidores: los seeds no importan, manda la calidad' },
      icon('monitor', 13), 'Mejor calidad'))
    : !deepTested() ? el('div', { class: 'cat-sort-row', id: 'cat-sort-info' },
    el('span', { class: 'cat-sort-label' }, 'Ordenado por'),
    el('span', { class: 'cat-sort-fixed', title: 'Hasta testearlas, se ordenan por mejor conexión: más seeds. Después del test podés ordenar por mejor imagen.' },
      icon('gauge', 13), 'Mejor conexión'))
    : el('div', { class: 'cat-sort-row' }, el('span', { class: 'cat-sort-label', id: 'cat-sort-label' }, 'Ordenar por'),
    el('div', { class: 'cat-sort', role: 'group', 'aria-labelledby': 'cat-sort-label' },
      [['quality', 'Mejor imagen', 'Arriba las testeadas que andan fluidas, de mejor a peor calidad de imagen; después el resto por conexión'], ['fast', 'Arranca más rápido', 'Primero las de mejor conexión: las más fluidas y con más seeds']].map(([k, label, tip]) =>
        el('button', { id: `cat-sort-${k}`, 'aria-pressed': String(view.optSort === k), title: tip,
          onclick: () => { view.optSort = k; safeSet('streamonte.catalog.sort', k); renderStreamsOnly(); } }, label))));
  return el('div', { class: 'cat-list-bar' }, order, el('span', { class: 'cat-list-filters' }, extra, hdr));
}
/** "Buscar sub ES" (2026-11-18): lee de a una, en el orden de la lista, hasta encontrar una con subtítulos en español
 *  dentro del video; el mismo botón pausa y sigue. Sin pendientes ni resultado, no aparece. */
function subsScanChip(list) {
  const st = subsScan();
  if (st === 'found' || list.some((c) => hasSpanishSubs(c.info_hash) === true)) return null;
  const left = list.filter((c) => hasSpanishSubs(c.info_hash) == null).length;
  if (st === 'none' || !left) return el('span', { id: 'cat-subscan', class: 'cat-hdr-filter done', role: 'status' }, icon('subs', 12), 'Ninguna trae sub ES');
  const running = st === 'running';
  return el('button', { id: 'cat-subscan', class: `cat-hdr-filter ${running ? 'busy' : ''}`, 'aria-pressed': String(running),
    title: running ? 'Pausar la búsqueda (lo leído queda)' : `Lee de a una (${left} sin leer) hasta encontrar una que traiga subtítulos en español dentro del video`,
    onclick: toggleSubsScan },
  running ? el('span', { class: 'cat-res-spin', 'aria-hidden': 'true' }) : icon('subs', 12),
  running ? 'Buscando sub ES… · Pausar' : st === 'paused' ? 'Seguir buscando sub ES' : 'Buscar sub ES');
}

/** Cada cuánto cambia la línea de avance aunque no lleguen resultados. */
const TICK_MS = 3200;
/** Lo que va pasando, en una línea que cambia cada `TICK_MS` (2026-11-17): para que se vea que avanza
 *  y no que quedó pensando. Sale de los datos que van llegando; sin datos, una frase de lo que hace. */
function progressLine(res, stage, run) {
  const t = state.side.tests;
  const pick = (lines) => { const ok = lines.filter(Boolean); return ok[Math.floor(Date.now() / TICK_MS) % ok.length]; };
  if (stage === 'quick') {
    const first = t.first[res]?.hashes ?? [];
    const results = first.map((h) => quick.get(h) ?? (counted.has(h) ? counted.get(h) : null)).filter(Boolean);
    const alive = results.filter((q) => q.reached && q.seeds > 0).length;
    const deadN = results.length - alive;
    const live = first.filter((h) => quickLive.has(h)).length;
    const asking = first.filter((h) => quickRunning.has(h) && !quick.has(h) && !quickLive.has(h)).length;
    const seeds = results.reduce((s, q) => s + (q.seeds || 0), 0) + first.reduce((s, h) => s + (quickLive.get(h)?.reached ? quickLive.get(h).seeds : 0), 0);
    const left = first.length - results.length;
    return pick([
      run?.prev && `En ${resLabel(run.prev)} ninguna anda sin cortes: sigo con ${resLabel(res)}`,
      !results.length && !live && 'Preguntándole a la red quién tiene cada torrent…',
      live && `Conectando con ${live} ${live === 1 ? 'torrent' : 'torrents'} a la vez`,
      asking && `Esperando que respondan ${asking} más`,
      results.length && `Ya respondieron ${results.length} de ${first.length}`,
      alive && `Encontré ${alive} con seeds reales`,
      seeds && `${seeds} seeds reales contados hasta ahora`,
      deadN && `Descarté ${deadN} que no tienen a nadie`,
      left && results.length && `Me ${left === 1 ? 'falta 1' : `faltan ${left}`} para pasar a la etapa 2`,
    ]) ?? 'Buscando seeds reales…';
  }
  const d = state.side.deep;
  const hashes = d.hashes ?? [];
  const doneN = hashes.filter((h) => deepDone.has(h)).length;
  const lives = hashes.map((h) => liveCount.get(h)).filter(Boolean);
  const peers = lives.reduce((s, l) => s + (l.peers || 0), 0);
  const counting = lives.filter((l) => l.reached).length;
  const cands = (state.update?.candidates ?? []).filter((c) => hashes.includes(c.info_hash));
  const fluid = cands.filter((c) => counted.has(c.info_hash) && health(c)?.level === 0).length;
  const left = hashes.length - doneN;
  return pick([
    'Verificando la salud de las mejores',
    peers && `Midiendo la velocidad con ${peers} conexiones`,
    counting && `Contando seeds reales en ${counting} a la vez`,
    doneN && `${doneN} de ${hashes.length} verificados`,
    fluid && `${fluid} ya ${fluid === 1 ? 'anda' : 'andan'} sin cortes`,
    left && doneN && `Me ${left === 1 ? 'falta 1' : `faltan ${left}`}`,
    run?.best && 'Al terminar dejo bajando la mejor',
  ]);
}

/** Panel de la resolución abierta (2026-11-17, antes arriba de todo): el análisis en curso —
 *  1 de 2 prueba rápida, 2 de 2 análisis profundo — con "Detener", o el resultado con "Testear más". */
export function groupPanel(res) {
  const u = state.update, d = state.side.deep, t = state.side.tests;
  const resText = res === 'other' ? 'las otras resoluciones' : resLabel(res);
  const panel = (cls, ic, title, sub, ...extra) => el('div', { id: 'cat-deep', class: `cat-deep ${cls}`, role: 'status' },
    el('span', { class: 'cat-deep-icon', 'aria-hidden': 'true' }, ic),
    el('span', { class: 'cat-deep-text' }, el('span', { class: 'cat-deep-title' }, title), el('span', { class: 'cat-deep-sub' }, sub)), ...extra);
  // Deteniendo (2026-11-17): hasta que el núcleo cortó todo, para que se vea que el clic hizo algo.
  if (t.stopping?.res === res) {
    if (counting.size || d.status === 'run') {
      return el('div', { id: 'cat-deep', class: 'cat-deep running stopping', role: 'status', 'aria-busy': 'true' },
        el('span', { class: 'cat-deep-icon', 'aria-hidden': 'true' }, el('span', { class: 'cat-res-spin big' })),
        el('span', { class: 'cat-deep-text' }, el('span', { class: 'cat-deep-title' }, el('b', {}, 'Deteniendo…')),
          el('span', { class: 'cat-deep-sub' }, 'Cortando las conexiones. Lo ya probado queda.')),
        el('span', { class: 'cat-deep-bar waiting' }, el('i')));
    }
    t.stopping = null;
  }
  // Analizando (2026-11-17): título fijo, debajo en gris lo que va pasando (cambia cada pocos segundos
  // con los datos que llegan) y dos íconos: bajar la mejor al terminar (se prende/apaga) y detener.
  const run = t.run?.res === res ? t.run : null;
  const single = !run && d.status === 'run' && d.single;
  if (run || single) {
    const deepNow = single || run.stage === 'deep';
    const { done, n, frac } = deepNow ? deepStatus(d) : { done: 0, n: 0, frac: 0 };
    const first = t.first[res];
    const elapsed = first ? Date.now() - first.at : 0;
    // Sin resultados nuevos igual cambia el texto: un redibujo cada `TICK_MS` mientras analiza.
    if (!t.tick) t.tick = setTimeout(() => { t.tick = null; scheduleRender(); }, TICK_MS);
    if (first && once(t, `timers-${res}`) && elapsed < QUICK_LATE_MS) setTimeout(scheduleRender, QUICK_LATE_MS + 100 - elapsed);
    const title = single ? `Verificando ${n === 1 ? '1 torrent' : `${n} torrents`} · ${done} de ${n}`
      : run.quickOnly ? `Armando la lista de ${resText} · estimado ~30 s`
        : `Analizando ${resText} · ${deepNow ? 'fase 2 de 2' : 'fase 1 de 2'}`;
    return el('div', { id: 'cat-deep', class: 'cat-deep running', role: 'status' },
      el('span', { class: 'cat-deep-icon', 'aria-hidden': 'true' }, el('span', { class: 'cat-radar big' })),
      el('span', { class: 'cat-deep-text' }, el('span', { class: 'cat-deep-title' }, el('b', {}, title)),
        // La línea entra animada solo cuando cambia (la lista se redibuja cada 400 ms).
        (() => {
          const line = progressLine(res, deepNow ? 'deep' : 'quick', run);
          const fresh = t.lastLine !== line;
          t.lastLine = line;
          return el('span', { class: `cat-deep-sub cat-progress-line ${fresh ? 'fresh' : ''}`, 'aria-live': 'polite' }, line);
        })()),
      el('span', { class: 'cat-deep-icons' },
        // Texto sutil que es botón (2026-11-17): se prende o apaga mientras analiza.
        run && !run.quickOnly ? el('button', { id: 'cat-run-best', class: `cat-best-toggle ${run.best ? 'on' : ''}`, 'aria-pressed': String(run.best),
          title: run.best ? 'Al terminar la dejo bajando de fondo (tocá para no hacerlo)'
            : 'Al terminar dejo bajando de fondo la que ande sin cortes; si en esta calidad no hay, pruebo la siguiente más baja',
          onclick: toggleBest }, icon(run.best ? 'check' : 'download', 14), run.best ? 'La dejo bajando' : 'Dejar bajando el mejor') : null,
        el('button', { id: 'cat-deep-stop', class: 'cat-icon-btn stop', 'aria-label': 'Detener', title: 'Detener: lo ya probado queda y se muestra la lista',
          onclick: (ev) => { ev.currentTarget.disabled = true; stopTests(); } }, icon('stop', 14))),
      // Avance real: cuántas de la tanda ya respondieron (y en la fase 2, cuántas se verificaron).
      deepNow ? deepBar(d, frac, n)
        : (() => {
          const total = first?.hashes.length ?? 0;
          const ready = first ? first.hashes.filter((h) => quick.has(h) || counted.has(h)).length : 0;
          return el('span', { class: 'cat-deep-bar', role: 'progressbar', 'aria-valuenow': String(ready), 'aria-valuemax': String(total) },
            el('i', { style: `width:${total ? Math.max(4, (ready / total) * 100) : 4}%` }));
        })());
  }
  // Lista armada con la prueba rápida ("Ver lista") y todavía sin análisis a fondo: se ofrece.
  if (d.status !== 'done' || d.res !== res) {
    if (!t.first[res] || d.status === 'run') return null;
    return el('button', { id: 'cat-deep-go', class: 'cat-deep-offer', onclick: () => startAnalysis(res) },
      el('span', { class: 'cat-deep-offer-text' }, el('b', {}, 'Análisis profundo: buscar el mejor torrent'),
        el('span', {}, `Verifico a fondo las ${TOP} mejores y leo sus audios y subtítulos internos (sub ES, latino) · ${analysisEta(u.candidates.filter((c) => inScope(c, res)).length)}`)),
      el('span', { class: 'cat-res-arrow' }, icon('chev', 16)));
  }
  const inRes = u.candidates.filter((c) => inScope(c, res));
  const checkedN = inRes.filter((c) => counted.has(c.info_hash)).length;
  const alive = inRes.filter((c) => counted.get(c.info_hash)?.seeds > 0).length;
  // Quedan sin contar (y no muertos): otra tanda, solo si el usuario quiere; primero las que la prueba
  // rápida encontró con seeds reales.
  const { potential } = quickPending(res);
  const more = Math.min(TOP, potential || inRes.filter((c) => !counted.has(c.info_hash) && !unlikely(c)).length);
  const next = more ? el('button', { id: 'cat-deep-more', class: 'cat-deep-go', onclick: () => runDeep(state.side.videoId, res) }, `Testear ${more} más`)
    : el('button', { id: 'cat-deep-go', class: 'cat-deep-go', onclick: () => startAnalysis(res) }, 'Repetir');
  return panel('done', icon('check', 16), el('b', {}, 'Análisis completo'),
    `${resText}: ${alive} de ${checkedN} con seeds reales${potential ? ` · ${potential} más con seeds reales para testear` : ''}`, next);
}

/** Avance del análisis profundo en curso (`runDeep`): cuántos respondieron y fracción 0–1. */
export function deepStatus(d) {
  const n = d.hashes.length;
  const done = d.hashes.filter((h) => deepDone.has(h)).length;
  // Desde cuándo no termina ninguno: la barra avanza sola dentro del tramo siguiente (ver `deepBar`).
  if (d.lastDone !== done || !d.lastAt) Object.assign(d, { lastDone: done, lastAt: Date.now() });
  return { done, n, frac: n ? done / n : 0 };
}

/** Barra del análisis (2026-11-16): lo terminado, y delante un tramo que avanza solo y despacio
 *  hacia el próximo torrent (hasta el 90 % de su parte), para que no parezca congelada. El avance
 *  sale del reloj (`animation-delay` negativo): redibujar no lo reinicia; al terminar uno arranca de
 *  nuevo desde ahí, sin retroceder. */
export function deepBar(d, frac, n) {
  return el('span', { class: 'cat-deep-bar' },
    el('i', { style: `width:${frac * 100}%` }),
    frac < 1 ? el('b', { class: 'cat-deep-creep', style: `left:${frac * 100}%;--slice:${(100 / Math.max(1, n)) * 0.9}%;animation-delay:-${Date.now() - d.lastAt}ms` }) : null);
}

/** Línea de tooltip: direcciones que conoce la red (`known` del conteo manda sobre el censo). */
export function knownLine(hash) {
  const n = counted.get(hash)?.known || census.get(hash);
  return n > 0 ? `La red conoce ~${n} direcciones (DHT/trackers/PEX); no todas aceptan conexión.` : null;
}
/** Un solo redibujo cada 400 ms como mucho para lo que llega de las pruebas (progreso y resultados):
 *  con 30 a la vez, redibujar la lista entera por cada uno trababa la compu (2026-11-17). */
export function scheduleRender() {
  // Ventana oculta o minimizada: no se dibuja nada; al volver, un solo redibujo.
  if (document.hidden) { view.renderOnShow = true; return; }
  if (!view.liveRender) view.liveRender = setTimeout(() => { view.liveRender = null; if (state.update) renderStreamsOnly(); }, 400);
}
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && view.renderOnShow) { view.renderOnShow = false; if (state.update) renderStreamsOnly(); }
});
/** Filas dibujadas del grupo abierto (de a `PAGE_ROWS`, "Mostrar más"). */
export const PAGE_ROWS = 25;
/** Indicador de una prueba en curso: etapa 1 = conseguir los datos del torrent (sin eso no se sabe
 *  quién tiene el archivo completo), etapa 2 = contar los seeds reales. */
export function testingPill(hash, live, quickMode) {
  const counting = live.reached;
  const label = counting ? `Contando seeds reales · ${live.seeds}`
    : live.peers ? `Pidiendo datos a ${live.peers} conexiones…` : 'Buscando seeds…';
  return el('span', { class: `cat-testing ${quickMode ? 'quick' : ''} ${counting ? 'phase-count' : 'phase-meta'}`, role: 'status',
    style: `--t:-${Date.now() - (phaseAt.get(hash)?.t ?? Date.now())}ms` },
  el('span', { class: 'cat-testing-line' }, el('span', { class: 'cat-radar', 'aria-hidden': 'true' }),
    el('span', { class: 'cat-testing-step' }, counting ? '2/2' : '1/2'), label),
  el('span', { class: 'cat-testing-bar' }, el('i')));
}
/** ▶ tocado: info_hash → `key` del video (null mientras se agrega). Spinner hasta que la
 *  reproducción arranca o falla (evento `playback-updated`), no solo hasta que vuelve el invoke. */
export const starting = new Map();
export const PB_STARTING = new Set(['fetching-metadata', 'preparing']);

/** Bytes del archivo que se ve. En un pack (2026-11-16) no sirve el peso del pack entero: el del
 *  episodio si ya se analizó o reprodujo (fila de la biblioteca `hash:sXeY`: el archivo real leído
 *  de los metadatos, `live.file_size`; `video_size` a veces trae el de otra fuente), el que da la fuente si
 *  señala el archivo (`file_name`), o el del pack ÷ los episodios de la temporada. Un pack de varias
 *  temporadas sin más datos: null. */
export function fileBytes(c) {
  if (!c.is_pack) return c.size_bytes ?? null;
  const [, season, episode] = (state.side?.videoId ?? '').split(':');
  const e = episode && state.library.get(`${c.info_hash}:s${season}e${episode}`);
  if (e?.live?.file_size || e?.video_size) return e.live?.file_size || e.video_size;
  if (!c.size_bytes) return null;
  if (c.file_name) return c.size_bytes;
  if (/\bS\d{1,2}\s*-\s*S?\d{1,2}\b|complete\s*series|integral/i.test(c.release_name)) return null;
  const eps = (state.side?.meta?.episodes ?? []).filter((x) => String(x.season) === season).length;
  return eps ? c.size_bytes / eps : null;
}
/** Bytes/s que hay que bajar sostenidos para verlo sin cortes = archivo ÷ duración (la real si se
 *  analizó, si no la de la ficha). `null` sin alguno de los dos. */
export function neededBps(c) {
  const [, season, episode] = (state.side?.videoId ?? '').split(':');
  const e = c.is_pack && episode ? state.library.get(`${c.info_hash}:s${season}e${episode}`) : rowsOf(c.info_hash)[0];
  const secs = e?.live?.duration_secs ?? (state.side?.runtime && state.side.runtime * 60);
  const bytes = fileBytes(c);
  return bytes && secs ? bytes / secs : null;
}
/** Mbps típicos por resolución (2026-11-16) cuando no se sabe cuánto pide (pack sin analizar): un
 *  4K web anda en 15–25, un 1080p en 5–10. Mejor una estimación que solo contar seeders. */
export const TYPICAL_MBPS = { '2160p': 25, '1440p': 14, '1080p': 8, '720p': 4 };
export const toMbps = (bps) => (bps * 8) / 1e6;
/** Mbps que pide una opción para verse sin cortes: peso ÷ duración; sin dato, lo típico de su resolución. */
export const mbpsOf = (c) => { const b = neededBps(c); return b ? toMbps(b) : TYPICAL_MBPS[c.resolution] ?? 3; };
/** Salud del stream (salud fiel, 2026-11-16): un RANGO de Mbps contra lo que pide (tamaño ÷
 *  duración). Lo que baja ahora manda; si no, `predict` (medición del análisis > el p50 más alto entre
 *  seeders contados y de trackers) corregido con lo aprendido en esta red. `level` = nivel del p50
 *  (0 ≥ 2×, 1 ≥ 1×, 2); `shown` sube uno si el p75 alcanza ("probable"). Null sin seeders conocidos,
 *  si nadie respondió al contar, o si solo hay trackers y esta red todavía no aprendió cuánto se
 *  equivocan (< 5 reproducciones: decisión del usuario; queda "Verificar salud"). */
export function health(c) {
  if (knownSeeds(c) == null || counted.get(c.info_hash)?.reached === false) return null;
  const bps = neededBps(c);
  const cal = view.renderCal ?? healthCalibration(state.library.values());
  const ev = evidenceOf(c.info_hash, c);
  const pb = playbackOf(c.info_hash);
  const now = pb && speedOf(pb.key);
  // Lo que baja ahora (reproduciendo o ⤓, ≥ MIN_SECS) es lo real: manda, sin corregir (B6).
  const nowMbps = now?.n >= MIN_SECS ? toMbps(now.avg) : null;
  const r = nowMbps ? { kind: 'now', lo: nowMbps, p50: nowMbps, p75: nowMbps, hi: nowMbps, conf: 'alta' } : ev && predict(ev, cal);
  if (!r || (r.kind === 'tracker' && ev.counted_seeds == null && !(cal.bias?.tracker?.nEff >= TRACKER_MIN))) return null;
  const need = ev?.need_mbps ?? (bps ? toMbps(bps) : TYPICAL_MBPS[c.resolution] ?? 3);
  return { ...shownLevel(r, need), range: r, basis: r.kind, conf: r.conf, ratio: r.p50 / need, supply: r.p50, need, exact: !!bps, ev, cal };
}

/** Veredicto en palabras (2026-11-17): lo que el usuario quiere saber, sin Mbps. */
export const HEALTH_WORD = ['Fluida', 'Puede cortarse', 'Se va a trabar'];
export const mbpsN = (v) => nf(v >= 10 ? Math.round(v) : v);
/** Veredicto de salud (2026-11-17): ícono de señal + palabra; el rango, de dónde sale y cuándo se
 *  testeó van en el tooltip. Tocarlo testea de nuevo. `compact` (reproduciendo): solo el ícono. */
export function verdict(c, compact = false) {
  const h = health(c);
  if (!h) return null;
  const { shown, probable, range: r, conf, basis, need, exact, ev, cal } = h;
  const word = HEALTH_WORD[shown];
  const cls = ['cat-health-good', 'cat-health-fair', 'cat-health-risky'][shown];
  const asks = exact ? `pide ~${Math.round(need)}` : `un ${resLabel(resKey(c))} suele pedir ~${Math.round(need)} (el real se sabe al testearlo)`;
  const k = cal.bias?.[basis]?.factor ?? 1;
  const learned = Math.abs(k - 1) > 0.05 ? ` Corregido ×${nf1(k)} con lo que anduvieron tus reproducciones en esta red.` : '';
  const why = basis === 'now' ? 'Es lo que está bajando ahora.'
    : basis === 'measured' ? `Medido al analizarlo: ${mbpsN(ev.analysis_mbps)} Mbps.${learned}`
      : basis === 'counted' ? `${ev.counted_seeds} seeders contados y ${ev.counted_leech ?? 0} leechers.${learned}`
        : `${ev.tracker_seeds} seeders y ${ev.tracker_leechers ?? 0} leechers según los trackers (sin testear).${learned}`;
  const internet = cal.capMbps && r.hi >= cal.capMbps ? ` Tope: tu internet, ${Math.round(cal.capMbps)} Mbps.` : '';
  const at = testedAt.get(c.info_hash);
  const known = knownLine(c.info_hash);
  const tip = `${word}${probable ? ' (probable)' : ''}: bajaría entre ${mbpsN(r.lo)} y ${mbpsN(r.hi)} Mbps, lo más probable ~${mbpsN(r.p50)}; ${asks} (${nf1(h.ratio)}×).\n${why}${internet}\nConfianza: ${conf}.${at ? ` Testeado ${ago(at)}.` : ''}\nTocá para testear de nuevo.${known ? `\n${known}` : ''}`;
  const attrs = { id: `cat-health-${c.info_hash}`, title: tip, 'aria-label': `${word}, confianza ${conf}: testear de nuevo`, onclick: () => reanalyze([c.info_hash]) };
  const ic = el('span', { class: 'cat-health-ic', 'aria-hidden': 'true' });
  ic.innerHTML = signalSvg(3 - shown, probable);
  if (compact) return el('button', { ...attrs, class: `cat-verdict compact ${cls}` }, ic);
  return el('button', { ...attrs, class: `cat-verdict ${cls}` }, ic, el('strong', {}, word));
}
/** Ícono de señal: `bars` llenas de 3 (0 = sin verificar); `maybe`: la más alta, a medias (probable). */
export const signalSvg = (bars, maybe = false) => `<svg viewBox="0 0 16 14" width="16" height="14" aria-hidden="true">${[1, 2, 3].map((b) => `<rect x="${b * 5 - 4}" y="${12 - b * 4}" width="3.4" height="${b * 4}" rx="1" class="${b <= bars ? 'on' : ''}${maybe && b === bars ? ' maybe' : ''}"/>`).join('')}</svg>`;

/** "Cargar en background" (2026-11-15): info_hash → {key, row}; `row` = última fila. La velocidad
 *  la mide `health-calib.js` (la misma medición calibra la salud estimada). */
export const bgLoads = new Map();
export const BG_GREEN = 1.5; // mismos márgenes que el ranking (`green_margin` / `yellow_margin`)
export const BG_YELLOW = 1;
/** Fila de una reproducción: la mide (calibra la salud si se conoce lo que predijo el análisis) y, si es de una
 *  carga en background, la guarda para su texto. */
/** Lo que el análisis sabe de una opción (salud fiel): de los candidatos del panel si está; si no, de
 *  la fila de la biblioteca (análisis `live` y trackers `scrape`). Entrada de `predict` (la salud que
 *  se muestra) y foto que se guarda al tocar ▶/⤓ (`notePrediction`), así se aprende de lo mostrado.
 *  Null si no hay nada que prediga (esa reproducción no enseña). */
export function evidenceOf(hash, c = state.update?.candidates.find((x) => x.info_hash === hash)) {
  const live = rowsOf(hash).find((x) => x.live && !x.live.partial)?.live ?? null;
  const scrape = rowsOf(hash).find((x) => x.scrape)?.scrape ?? null;
  // Un 0 parcial (recién llegan los metadatos) no es "0 contados": taparía a los trackers.
  const sc0 = c ? seedsCounted(c) : live?.seeds > 0 ? live.seeds : null;
  const sc = sc0 === 0 && counted.get(hash)?.seeds !== 0 ? null : sc0;
  const tracker = c ? seedsOf(c) : scrape?.seeders ?? null;
  const analysis = live?.avg_speed_bps > 0 ? toMbps(live.avg_speed_bps) : null;
  if (tracker == null && sc == null && analysis == null) return null;
  const bps = c && neededBps(c);
  return {
    tracker_seeds: tracker,
    tracker_leechers: c ? c.leechers ?? null : scrape?.leechers ?? null,
    counted_seeds: sc,
    counted_leech: sc == null ? null : c ? leechersOf(c) ?? 0 : Math.max(0, live.peers - live.seeds),
    analysis_mbps: analysis,
    need_mbps: bps ? toMbps(bps) : c ? TYPICAL_MBPS[c.resolution] ?? 3 : live?.duration_secs ? toMbps(live.file_size / live.duration_secs) : null,
    res: c?.resolution ?? null,
    known: counted.get(hash)?.known > 0 ? counted.get(hash).known : null,
    dht: census.get(hash) ?? null,
  };
}
export function measurePlayback(row) {
  const hash = row.key.split(':')[0];
  trackPlayback(row, evidenceOf(hash));
  const b = [...bgLoads.values()].find((x) => x.key === row.key);
  if (b) b.row = row;
}
/** Texto de la card: "2,3× · alcanza" = promedio ÷ bitrate (tamaño ÷ duración). Sin duración
 *  (o pack) solo la velocidad. */
export function bgText(c) {
  const b = bgLoads.get(c.info_hash);
  if (!b) return null;
  if (b.row?.state.kind === 'failed') return { cls: 'red', text: 'falló', tip: b.row.state.message };
  const speed = speedOf(b.key);
  if (!speed?.n) return { cls: 'measuring', text: 'cargando…', tip: 'Buscando metadatos y precargando el principio; después mide la velocidad.' };
  const avg = speed.avg;
  // Cuánto va (2026-11-17): que se vea que está bajando, no solo si la velocidad alcanza.
  const pct = Math.floor((playbackOf(c.info_hash)?.progress ?? 0) * 100);
  const done = speed.done ? 'completo · ' : `bajando ${pct} % · `;
  const need = neededBps(c);
  if (!need) return { cls: 'none', text: `${done}${mbps(avg)}`, tip: `${mbps(avg)} de promedio bajando de fondo (sin duración conocida no se calcula si alcanza).` };
  const x = avg / need;
  const [cls, verdict] = x >= BG_GREEN ? ['green', 'alcanza'] : x >= BG_YELLOW ? ['yellow', 'justo'] : ['red', 'no alcanza'];
  return { cls, text: `${done}${nf1(x)}× · ${verdict}`, tip: `${mbps(avg)} de promedio ÷ ${mbps(need)} que consume el video.` };
}
/** Deja bajando de fondo esa opción del video abierto (la usan el botón de la fila y "Elegí la
 *  mejor"). false si no se pudo agregar. */
export async function startBg(hash) {
  notePrediction(hash, evidenceOf(hash));
  const [row] = await api.catalogAdd(state.side.kind, state.side.videoId, [hash]);
  if (!row) return false;
  bgLoads.set(hash, { key: row.key, row: null });
  try { await api.playBackground(row.key); } catch (e) { bgLoads.delete(hash); throw e; }
  return true;
}
/** Arranca o cancela la carga en background. Cancelar = Detener: lo bajado queda guardado y
 *  Reproducir lo retoma. */
export async function toggleBg(hash, btn) {
  btn.disabled = true;
  const b = bgLoads.get(hash);
  try {
    if (b) {
      bgLoads.delete(hash);
      // Si ya se está viendo (Reproducir la retomó), cancelar no cierra el reproductor.
      if (b.row && ['fetching-metadata', 'preparing', 'background'].includes(b.row.state.kind)) await api.playbackAction(b.row.id, 'stop');
      setStatus('Carga en background cancelada: lo bajado queda guardado.');
    } else if (await startBg(hash)) {
      setStatus('Cargando en background: la velocidad promedio aparece en la opción.');
    }
  } catch (e) { if (!b) bgLoads.delete(hash); showError(e); } finally {
    btn.disabled = false;
    if (state.update) renderStreamsOnly();
  }
}

/** La reproducción de ese torrent que importa ahora: un torrent puede tener varias (otro episodio del
 *  pack, una vieja que se está cerrando); gana la más viva. */
/** Estados en que la opción muestra Detener en vez de ▶. */
export const PB_LIVE = new Set(['fetching-metadata', 'preparing', 'playing', 'download-paused', 'background', 'ask-after-close']);
export const PB_RANK = ['playing', 'preparing', 'fetching-metadata', 'download-paused', 'ask-after-close', 'background', 'paused', 'stopping', 'failed'];
export function playbackOf(hash) {
  return [...lib.playbacks.values()].filter((r) => r.key.split(':')[0] === hash)
    .sort((a, b) => PB_RANK.indexOf(a.state.kind) - PB_RANK.indexOf(b.state.kind))[0];
}

/** Calidad de imagen por la fuente del release (2026-11-17), en palabras para alguien no técnico:
 *  [nombre, estrellas de 4, explicación]. */
export const QUALITY = {
  REMUX: ['Máster', 4, 'REMUX: copia exacta del Blu-ray, sin recomprimir. La mejor imagen y sonido posibles; pesa mucho.'],
  BluRay: ['Blu-ray', 3, 'Sacada del Blu-ray y comprimida: muy buena y más liviana.'],
  'WEB-DL': ['Streaming', 2, 'WEB-DL: bajada de una plataforma de streaming. La calidad que verías ahí.'],
  WEBRip: ['Streaming', 2, 'WEBRip: grabada desde una plataforma de streaming. Casi como WEB-DL.'],
  HDTV: ['TV', 1, 'HDTV: grabada de la tele.'],
  DVDRip: ['DVD', 1, 'Sacada de un DVD: definición baja.'],
  CAM: ['Cine (cámara)', 1, 'CAM / TS: alguien la grabó con una cámara en la sala. Se ve movida y el sonido es malo.'],
};
/** Para "Mejor imagen": las estrellas; sin dato, entre Streaming y Blu-ray; la de cine, la última. */
export const qualityRank = (c) => (c.source === 'CAM' ? 0 : QUALITY[c.source]?.[1] ?? 2.5);
export function qualityLine(c) {
  const q = QUALITY[c.source];
  // Sin fuente en el nombre (2026-11-17): se dice por qué falta la calidad, en gris y chico.
  const unknown = el('button', { id: `cat-qinfo-${c.info_hash}`, type: 'button', class: 'cat-quality-unknown',
    title: `Calidad sin dato: el nombre del torrent no dice de dónde salió el video (Blu-ray, streaming, TV o cámara de cine), así que no se puede saber la calidad de imagen.\nNombre: ${c.release_name}` },
  icon('info', 13), 'Calidad sin dato');
  return el('span', { class: `cat-quality ${c.source === 'CAM' ? 'cam' : ''}` },
    q ? el('span', { class: 'cat-quality-q', title: `Calidad de imagen: ${q[2]}` }, icon('monitor', 13),
      el('span', { class: 'cat-stars', role: 'img', 'aria-label': `${q[1]} de 4` }, [1, 2, 3, 4].map((i) => el('i', { class: i <= q[1] ? 'on' : '' }, '★'))), q[0]) : unknown);
}
/** ¿Entra en el disco de descargas? (2026-11-17). Sin dato del espacio libre, sí. */
export const fits = (c) => view.freeBytes == null || !(fileBytes(c) > view.freeBytes);

/** Una opción (2026-11-17, diseño de design/opciones-final.html): a la izquierda peso, calidad de
 *  imagen y si no entra; al medio el veredicto (o testear / testeando / nadie respondió / lo que
 *  hace la reproducción) con la gente debajo; a la derecha bajar de fondo y ▶. Quieto 2 s sobre la
 *  fila, todos los datos del torrent. */
export function optionRow(c, best = false) {
  const hash = c.info_hash;
  const bg = bgText(c);
  // Al dar ▶, los estados de la reproducción (2026-11-15). La de "bajar de fondo" la cuenta `bgText`.
  const pb = playbackOf(hash);
  const pbStatus = starting.has(hash) && !pb ? 'cargando…' : pb && !(pb.state.kind === 'background' && bgLoads.has(hash)) ? playbackText(pb) : null;
  const live = rowsOf(hash).find((e) => e.live)?.live ?? null;
  const scraped = counted.get(hash);
  const busy = counting.has(hash);
  const q = QUALITY[c.source];
  const tip = [`${c.release_name}: ${[c.resolution, q?.[0]].filter(Boolean).join(' · ')}`, c.file_name && `Archivo: ${c.file_name}`, c.is_pack && 'Pack: varios episodios en un torrent', `Fuentes: ${c.addons.join(' + ')}${c.sites.length ? ` (${c.sites.join(', ')})` : ''}`].filter(Boolean).join('\n');
  const hdrTip = c.hdr.map((x) => HDR_TIP[x]).filter(Boolean).join('\n');
  const checked = checkedBy(c);
  const partial = busy ? liveCount.get(hash) : null; // en vivo mientras testea
  // Prueba rápida en curso (2026-11-17): igual que el test, con los seeds reales llegando en vivo.
  const quickBusy = !busy && quickRunning.has(hash) && !quick.has(hash);
  const qLive = quickBusy ? quickLive.get(hash) : null;
  const seedsNow = partial?.reached ? partial.seeds : knownSeeds(c);
  // Prueba rápida sin test profundo: "8+" es su techo (cuenta hasta 8 y corta).
  const qk = !scraped && !partial?.reached && seedsCounted(c) == null ? quick.get(hash) : null;
  const seedsLabel = quickBusy && qLive ? (qLive.reached ? qLive.seeds : 0)
    : qk?.reached && qk.seeds >= QUICK_ENOUGH ? `${qk.seeds}+` : seedsNow ?? '—';
  const quickTip = qk && (qk.reached
    ? `Prueba rápida: ${qk.seeds}${qk.seeds >= QUICK_ENOUGH ? ' o más' : ''} seeds (con el archivo completo) respondieron en menos de 30 s`
    : qk.peers ? `Prueba rápida: la red conoce ${qk.peers} direcciones, pero nadie respondió en 30 s` : 'Prueba rápida: nadie lo comparte')
    + `${c.seeders != null ? ` (los trackers anuncian ${c.seeders}, sin verificar)` : ''}.`;
  const dead = scraped?.reached === false;
  const big = !fits(c);
  const seedsTip = skipped.has(hash) && !scraped ? (skipped.get(hash) === 'dead'
    ? 'Sin testear: los trackers y la fuente dan 0 seeders y 0 leechers (casi seguro muerto).'
    : `Sin testear a fondo: quedó fuera de las ${TOP} mejores según la prueba rápida y los trackers.`)
    : scraped && !dead ? `Testeado: ${scraped.seeds} seeders (archivo completo) de ${scraped.peers} conectados${c.seeders != null ? ` (los trackers anuncian ${c.seeders}, sin verificar)` : ''}. Al reproducir suelen aparecer algunos más.${scraped.incoming > 0 ? ` ${scraped.incoming} se conectaron solos (entrantes).` : ''}`
      : quickTip ? quickTip
      : live ? `Seeders vistos al analizarlo: ${live.seeds} (${live.peers} conectados).`
        : checked === 'trackers' ? `${TRACKERS_TIP} ${c.seeders} seeders, ${c.leechers ?? 0} leechers.`
          : 'Según la fuente (los trackers no lo conocen o no respondieron).';
  // Todavía sin respuesta del tracker (la lista ya se ve mientras se escanea): el número es de la fuente.
  const people = el('span', { class: 'cat-people', title: [seedsTip, knownLine(hash)].filter(Boolean).join('\n') },
    pbStatus ? verdict(c, true) : null, el('b', {}, seedsLabel), ` seeds${qk?.reached || (quickBusy && qLive) ? ' reales' : ''}${quickBusy && qLive ? ' encontrados' : ` · ${leechersOf(c) ?? 0} leechers`}`);
  const failedTip = scraped?.peers
    ? `Nadie respondió: la red conoce ${scraped.peers} direcciones de peers con este torrent, pero ninguna contestó. Pueden estar apagadas o llenas, o tu router y el de ellos tienen el puerto cerrado. No quiere decir que esté muerto: probá de nuevo en un rato o elegí otra.`
    : 'Nadie lo comparte: no apareció nadie con este torrent. Casi seguro está muerto.';
  // "Mejor opción": testeada, fluida segura (B8: lo probable no se recomienda), que entre en el disco y no sea de cine.
  const confirmed = best && (state.side.flow?.mode === 'torbox' || (state.side.deep?.status === 'done' && isSafeBest(c)));
  const main = pbStatus ? statusPill(pb, pbStatus)
    : bg ? el('span', { class: `cat-speed bg-${bg.cls}`, title: bg.tip ?? '', role: 'status' }, bg.text)
    // El núcleo prueba de a tandas: los que todavía no arrancaron esperan su lugar (2026-11-17).
    : (busy && !partial) || (quickBusy && !qLive) ? el('span', { class: 'cat-waiting', role: 'status' }, el('span', { class: 'cat-waiting-dot', 'aria-hidden': 'true' }), 'En espera…')
    : busy ? testingPill(hash, partial, false)
    : quickBusy ? testingPill(hash, qLive, true)
    : dead ? el('span', { class: 'cat-failed' },
      el('span', { class: 'cat-failed-msg', title: failedTip, tabindex: 0 }, icon('ban', 14), scraped.peers ? 'Nadie respondió' : 'Nadie lo comparte'),
      el('button', { id: `cat-retry-${hash}`, class: 'cat-retry', onclick: () => reanalyze([hash]) }, 'Reintentar'))
    : verdict(c) ?? el('button', { id: `cat-check-${hash}`, class: 'cat-test',
      title: 'Verificar salud: se conecta unos segundos con los seeds de este torrent y estima si va a andar fluido. No baja el video, pero deja guardados sus metadatos: si después lo elegís, arranca más rápido.',
      onclick: () => reanalyze([hash]) }, el('span', { class: 'cat-radar', 'aria-hidden': 'true' }), 'Verificar salud');
  // En TorBox sin reproducirse, el medio queda vacío: peso y badges usan ese ancho (no bajan de renglón).
  const tbIdle = inTorbox.has(hash) && !pbStatus;
  const acts = pbStatus || bg ? [] : langActions(c);
  return el('li', { class: `cat-opt ${tbIdle ? 'tb-idle' : ''} ${acts.length ? 'pend' : ''} ${confirmed ? 'best' : ''} ${big ? 'too-big' : ''} ${skipped.has(hash) ? 'skipped' : ''}`, title: tip, 'data-tip-delay': 2000, 'data-hash': hash,
    // Cada redibujo recrea la fila: la fase sale del reloj para que la animación no reinicie.
    style: busy ? `--live-phase:-${Date.now() % 3600}ms` : null },
    confirmed ? el('span', { class: 'cat-best-tags' }, el('span', { class: 'cat-best-tag' }, 'Mejor opción')) : null,
    el('span', { class: 'cat-size-cell' },
      el('span', { class: 'cat-size-line' }, el('span', { class: 'cat-size' }, humanBytes(c.size_bytes)),
        hdrTip ? el('span', { class: 'cat-tag cat-hdr', title: hdrTip }, 'HDR') : null,
        hasResStep() ? null : el('span', { class: 'cat-tag cat-res', title: 'Resolución' }, resLabel(resKey(c))),
        hasResStep() || fitsNet(c) || c.size_bytes == null ? null : el('span', { class: 'cat-tag cat-heavy', title: `Pide ~${Math.round(mbpsOf(c))} Mbps: más de lo que da tu conexión` }, 'Puede cortarse'),
        // Por TorBox ya se eligió en los pasos: el badge solo informa por torrent (2026-11-18).
        inTorbox.has(hash) && state.side?.flow?.mode !== 'torbox' ? el('span', { class: 'cat-tag cat-torbox', title: 'TorBox es un servicio pago que baja torrents a sus servidores y te los pasa como video en línea. Este ya lo tiene bajado: se ve al instante y sin depender de los seeds, sin bajar nada a tu Mac.' }, 'TorBox') : null,
        langTags(c)),
      qualityLine(c),
      big ? el('span', { class: 'cat-nofit', title: `No entra en el disco: pesa ${humanBytes(fileBytes(c))} y en el disco de descargas quedan ${humanBytes(view.freeBytes)} libres. Se cortaría a mitad: liberá espacio o elegí una más liviana.` },
        icon('ban', 12), `No entra: te quedan ${humanBytes(view.freeBytes)}`) : null),
    // En TorBox (2026-11-17): se ve desde sus servidores, así que salud, seeds y bajar de fondo no aplican.
    // Viéndose o cargando por TorBox: solo su estado (seeds y pares no aplican).
    tbIdle ? null
      : inTorbox.has(hash) && !(pbStatus && !pb?.stream && pb) ? el('span', { class: 'cat-mid' }, main)
      : el('span', { class: 'cat-mid' }, main, people),
    el('span', { class: 'cat-opt-actions' }, playButtons(c, acts)));
}

/** Bajar de fondo (círculo chico) y ▶ (2026-11-17). Con `acts` (lo que falta saber del idioma), van en una cápsula
 *  junto al ▶ (2026-11-18). Reproduciéndose o bajando: Detener. */
export function playButtons(c, acts = []) {
  const hash = c.info_hash, loading = bgLoads.has(hash), busy = starting.has(hash);
  const pb = playbackOf(hash);
  // Cargando (pasos de Reproducir, metadatos o precarga): Cancelar. Lo bajado queda guardado en Mis magnets.
  if ((busy && (!pb || !PB_LIVE.has(pb.state.kind))) || (pb && PB_STARTING.has(pb.state.kind) && !loading)) {
    return el('button', { id: `cat-cancel-${hash}`, class: 'cat-stop', 'data-anchor': `opt-${hash}`, title: 'Cancelar: no se reproduce; lo que ya bajó queda guardado',
      onclick: (ev) => { ev.currentTarget.disabled = true; cancelPlay(hash, pb); } }, icon('stop', 16), 'Cancelar');
  }
  if (pb && PB_LIVE.has(pb.state.kind) && !loading) {
    return el('span', { class: 'cat-play-btns' },
      // Mientras se ve (2026-11-18): otro subtítulo, cargado en el mpv abierto (VLC no se puede manejar desde acá).
      pb.player === 'mpv' && pb.state.kind !== 'ask-after-close' ? el('button', { id: `cat-subchange-${hash}`, type: 'button', class: 'cat-subchange',
        title: 'Cambiar subtítulo: elegí otro y se carga en el reproductor sin cortar',
        onclick: (ev) => openSubs(hash, pb.stream, ev.currentTarget, pb.id) }, icon('subs', 15)) : null,
      el('button', { id: `cat-stop-${hash}`, class: 'cat-stop', title: pb.stream ? 'Detener: cierra el reproductor' : 'Detener: cierra el reproductor y la descarga queda pausada y guardada',
        onclick: (ev) => { ev.currentTarget.disabled = true; api.playbackAction(pb.id, 'stop').catch(showError); } }, icon('stop', 16), 'Detener'));
  }
  const play = inTorbox.has(hash) ? el('button', { id: `cat-play-${hash}`, class: 'cat-play torbox', 'data-anchor': `opt-${hash}`, 'aria-label': 'Ver ahora desde TorBox',
    title: 'Ver ahora desde TorBox: arranca al instante desde sus servidores, sin depender de los seeds',
    onclick: (ev) => playOption(hash, ev.currentTarget, true) }, icon('play', 18))
    : el('button', { id: `cat-play-${hash}`, class: 'cat-play', 'data-anchor': `opt-${hash}`, title: fits(c) ? 'Ver ahora' : 'No entra en el disco: se cortaría a mitad',
      'aria-label': 'Ver ahora', onclick: (ev) => playOption(hash, ev.currentTarget) }, icon('play', 18));
  return el('span', { class: 'cat-play-btns' },
    inTorbox.has(hash) && !loading ? null : el('button', { id: `cat-bg-${hash}`, class: `cat-bg-btn ${loading ? 'on' : ''}`, 'aria-pressed': String(loading),
      title: loading ? 'Cancelar la descarga de fondo: lo bajado queda guardado' : 'Bajar de fondo: baja sin abrir el reproductor y dice si la velocidad alcanza',
      onclick: (ev) => toggleBg(hash, ev.currentTarget) }, icon(loading ? 'stop' : 'download', 15)),
    // En TorBox (2026-11-17): ▶ verde que late, y reproduce desde sus servidores (al instante, sin P2P).
    acts.length ? el('span', { class: 'cat-dock' }, el('span', { class: 'cat-dock-acts' }, acts), el('span', { class: 'cat-dock-div', 'aria-hidden': 'true' }), play) : play);
}

/** Cancelar mientras carga (2026-11-18): corta los pasos y, si el núcleo ya arrancó, lo detiene conservando lo bajado. */
function cancelPlay(hash, pb) {
  starting.delete(hash);
  closeWizard();
  if (pb && PB_STARTING.has(pb.state.kind)) api.playbackAction(pb.id, 'stop').catch(showError);
  setStatus('Cancelado.');
  renderStreamsOnly();
}

/** Estado de la reproducción de una opción, en grande (2026-11-16): ícono (o barras que se mueven
 *  si se está viendo), el texto y, si va bajando, la barra de lo bajado. */
export function statusPill(pb, text) {
  const k = pb?.state.kind ?? 'preparing';
  const ic = { paused: 'pause', 'download-paused': 'pause', background: 'download', failed: 'ban', 'ask-after-close': 'pause' }[k];
  const lead = k === 'playing' ? el('span', { class: 'cat-eq', 'aria-hidden': 'true' }, el('i'), el('i'), el('i'))
    : ic ? icon(ic, 15) : el('span', { class: 'cat-deep-spin small', 'aria-hidden': 'true' });
  const progress = pb && !pb.stream && ['playing', 'background', 'paused', 'download-paused'].includes(k) ? pb.progress ?? 0 : null;
  return el('span', { class: `cat-status st-${k}`, role: 'status' },
    el('span', { class: 'cat-status-line' }, lead, el('b', {}, text.charAt(0).toUpperCase() + text.slice(1))),
    progress != null ? el('span', { class: 'cat-status-bar', title: `${Math.floor(progress * 100)} % bajado` }, el('i', { style: `width:${Math.max(2, Math.round(progress * 100))}%` })) : null);
}

/** Qué se sabe de los seeders de una opción (leyenda de la fila): 'deep' = contados al conectarse
 *  (análisis profundo); 'trackers' = chequeados en los trackers al cargar las opciones (lo hace el
 *  núcleo solo, siempre); null = solo lo que dice la fuente. */
export const TRACKERS_TIP = 'Chequeado recién en los trackers al cargar las opciones: más fiel que lo que dice la fuente.';
export const checkedBy = (c) => (counted.has(c.info_hash) ? 'deep' : trackersWin(c) ? 'trackers' : null);

/** Qué filas ya se mostraron y en qué orden, por video y grupo abierto (2026-11-18). Vive acá y no en el DOM:
 *  `renderSide` rearma el panel cuando llegan la ficha o los puntajes, y con eso todas parecían nuevas y
 *  volvían a entrar animadas ("se refresca la lista"). */
const shown = { at: '', order: new Map() };
/** Redibuja y anima lo que cambió (2026-11-15): una fila entra deslizándose solo la primera vez que se ve
 *  (al abrir el grupo); se desliza a su lugar (FLIP) solo si su posición en la lista cambió de verdad; el
 *  número de seeders que cambió destella y la "Mejor opción" nueva entra con un pulso. */
export function renderStreamsOnly() {
  const box = $('#cat-streams');
  if (!box) return;
  const rows = () => [...box.querySelectorAll('.cat-opt[data-hash]')];
  const before = new Map(rows().map((n) => [n.dataset.hash, { top: n.getBoundingClientRect().top, seeds: n.querySelector('.cat-people')?.textContent, testing: !!n.querySelector('.cat-testing:not(.quick)') }]));
  const prevBest = box.querySelector('.cat-opt.best')?.dataset.hash;
  view.libByHash = new Map();
  for (const e of state.library.values()) {
    const list = view.libByHash.get(e.info_hash);
    if (list) list.push(e); else view.libByHash.set(e.info_hash, [e]);
  }
  view.renderCal = healthCalibration(state.library.values());
  try { renderStreamsBody(box); } finally { view.libByHash = view.renderCal = null; }
  const at = `${state.side?.videoId}|${view.openRes}`;
  if (shown.at !== at) { shown.at = at; shown.order.clear(); }
  const order = new Map(rows().map((n, i) => [n.dataset.hash, i]));
  const prevOrder = new Map(shown.order);
  for (const [h, i] of order) shown.order.set(h, i);
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const now = performance.now();
  let fresh = 0;
  for (const n of rows()) {
    const hash = n.dataset.hash, old = before.get(hash);
    // Primera vez que se ve (se abrió el grupo o llegó de las fuentes): entra deslizándose, escalonada.
    if (!prevOrder.has(hash)) n.animate([{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'none' }], { duration: 380, delay: Math.min(fresh++, 10) * 35, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'backwards' });
    if (old) {
      const dy = old.top - n.getBoundingClientRect().top;
      if (prevOrder.get(hash) !== order.get(hash) && Math.abs(dy) > 1) n.animate([{ transform: `translateY(${dy}px)` }, { transform: 'none' }], { duration: 450, easing: 'cubic-bezier(.2,.8,.2,1)' });
      if (old.seeds !== undefined && n.querySelector('.cat-people')?.textContent !== old.seeds) fx.set(`flash|${hash}`, now);
      // Terminó el test (2026-11-17): las barras suben, entra la palabra y, si anda fluida, festeja.
      if (old.testing && n.querySelector('.cat-verdict')) {
        fx.set(`reveal|${hash}`, now);
        if (n.querySelector('.cat-verdict.cat-health-good')) celebrate(n);
      }
      if (n.classList.contains('best') && prevBest && prevBest !== hash) fx.set(`best|${hash}`, now);
    }
    // Las filas se recrean en cada redibujo: el efecto sigue donde iba (delay negativo).
    for (const [kind, target, cls, ms] of [['flash', n.querySelector('.cat-people'), 'flash', 900], ['best', n, 'new-best', 900], ['reveal', n.querySelector('.cat-verdict'), 'reveal', 1000]]) {
      const t = fx.get(`${kind}|${hash}`);
      if (t === undefined || !target) continue;
      if (now - t > ms) { fx.delete(`${kind}|${hash}`); continue; }
      target.classList.add(cls);
      target.style.animationDelay = `${-(now - t)}ms`;
      const tag = cls === 'new-best' && n.querySelector('.cat-best-tag');
      if (tag) tag.style.animationDelay = target.style.animationDelay;
    }
  }
}
/** Festejo de un test que dio "Fluida" (2026-11-17): un brillo verde y papelitos que saltan del ícono.
 *  Van en el panel (la lista se recrea en cada redibujo). */
export function celebrate(row) {
  const list = $('#cat-side');
  const ic = row.querySelector('.cat-verdict .cat-health-ic');
  if (!list || !ic) return;
  row.animate([{ boxShadow: '0 0 0 0 color-mix(in srgb, var(--green) 45%, transparent)' }, { boxShadow: '0 0 0 14px transparent' }], { duration: 1300, delay: 450, easing: 'cubic-bezier(.16,1,.3,1)' });
  const a = ic.getBoundingClientRect(), box = list.getBoundingClientRect();
  for (let i = 0; i < 10; i++) {
    const ang = (Math.PI * 2 * i) / 10;
    const p = el('span', { class: 'cat-confetti', 'aria-hidden': 'true', style: `left:${a.left - box.left + a.width / 2}px;top:${a.top - box.top + list.scrollTop + a.height / 2}px;background:${['var(--green)', 'var(--accent-fg)', '#e8c26a'][i % 3]}` });
    list.append(p);
    p.animate([{ transform: 'translate(0,0) rotate(0)', opacity: 1 }, { transform: `translate(${Math.cos(ang) * 36}px,${Math.sin(ang) * 26 - 10}px) rotate(${i * 40}deg)`, opacity: 0 }],
      { duration: 900, delay: 420, easing: 'cubic-bezier(.16,1,.3,1)', fill: 'backwards' }).finished.then(() => p.remove(), () => p.remove());
  }
}
/** Último texto de reproducción mostrado por opción (hash → firma): evita redibujos iguales. */
export const cardSig = new Map();
/** Efectos en curso: `flash|hash` / `best|hash` → cuándo empezaron (ms). */
export const fx = new Map();

/** Opciones del video por resolución (respetan los filtros), en el orden de `RES_ORDER`. */
export function groupsOf(u = state.update) {
  const list = u.candidates.filter(passesFilters);
  const groups = new Map(RES_ORDER.map((r) => [r, []]));
  for (const c of list) groups.get(resKey(c)).push(c);
  return groups;
}
/** La resolución más baja siguiente que tenga opciones ("Otras" no cuenta: SD o sin dato), o null. */
export function lowerRes(res, groups = groupsOf()) {
  return RES_ORDER.slice(RES_ORDER.indexOf(res) + 1).find((r) => r !== 'other' && groups.get(r).length) ?? null;
}
/** Abre un grupo de resolución (uno a la vez; '' = todos cerrados), sin scroll (2026-11-17). */
export function openGroup(r) {
  view.openRes = r;
  view.shownRows = PAGE_ROWS;
  renderStreamsOnly();
}
/** Todas las opciones sin separar por calidad (TorBox): de 4K a "Otras" y, dentro de cada una, el orden de
 *  `sortOptions` (calidad de imagen y peso). */
export const flatSorted = (cands) => sortOptions(cands).list;
/** La única que se recomienda ("Mejor opción") o se elige sola ("Elegí la mejor"): testeada a fondo,
 *  fluida segura (lo probable no), que entre en el disco y no sea de cine. */
export function isSafeBest(c) {
  const h = health(c);
  return counted.get(c.info_hash)?.reached === true && h?.level === 0 && !h.probable && fits(c) && c.source !== 'CAM';
}

export function renderStreamsBody(box) {
  const u = state.update;
  const body = $('#cat-side');
  const scroll = body?.scrollTop ?? 0;
  box.replaceChildren();
  if (u?.done && !u.candidates.length) {
    const anyOk = u.addons.some((a) => a.state === 'ok');
    box.append(el('p', { class: 'pop-empty' }, anyOk ? 'Ninguna fuente tiene torrents para esto.' : 'Ninguna fuente respondió. Cerrá y volvé a abrirlo para reintentar.'));
    return;
  }
  // Pasos antes de la lista (2026-11-18): buscando → torrent/TorBox → ¿latino? → calidad.
  const step = flowStep();
  if (step) { box.append(step); if (body) body.scrollTop = scroll; return; }
  const r = view.openRes;
  const groups = groupsOf(u);
  // Sin paso de calidad (TorBox, "Ver todas las opciones"): una sola lista con todas las calidades, cada fila con la suya.
  const flat = !hasResStep();
  const cands = flat ? [...groups.values()].flat() : groups.get(r);
  const n = cands.length;
  const head = optionsHead();
  const f = state.side.flow;
  // Mientras corre el análisis profundo, el borde de la lista gira (2026-11-16).
  const analyzing = state.side.deep?.status === 'run';
  box.append(...[crumbs(), head && el('div', { class: 'cat-sticky' }, head),
    el('section', { class: `cat-group open ${analyzing ? 'analyzing' : ''}`, id: `cat-group-${flat ? 'all' : r}`, 'aria-busy': analyzing ? 'true' : null,
      style: analyzing ? `--group-phase:-${Date.now() % 4000}ms` : null },
    el('div', { class: 'cat-group-head', id: `cat-res-${r}` },
      el('span', { class: 'cat-group-name' }, flat ? 'Todas las calidades' : resLabel(r)),
      el('span', { class: 'cat-res-count' }, `${n} ${n === 1 ? 'opción' : 'opciones'}`)),
    f.latOff ? el('p', { class: 'cat-flow-note inline', role: 'status' }, 'Sin filtro de latino: se muestran todas.') : null,
    (() => {
      // Analizando (2026-11-17): solo el panel con su avance y "Detener"; sin filas (eran decenas de
      // animaciones a la vez). Al terminar, el resultado y la lista ya ordenada.
      const gp = flat ? null : groupPanel(r);
      if (!flat && (state.side.tests.run?.res === r || state.side.tests.stopping?.res === r)) return gp;
      // Las que todavía se están probando de fondo no se muestran hasta terminar (2026-11-17): se
      // movían y cambiaban sin parar; aparecen ya ordenadas con su resultado.
      const probing = cands.filter((c) => quickRunning.has(c.info_hash) && !quick.has(c.info_hash) && !counting.has(c.info_hash));
      const flatList = flat ? flatSorted(cands) : null;
      const { list: sortedAll, best } = flat ? { list: flatList, best: flatList.find(isMatch) ?? null } : sortOptions(cands);
      const sorted = probing.length ? sortedAll.filter((c) => !probing.includes(c)) : sortedAll;
      // "Buscar sub ES" de la barra (por torrent; en TorBox lo hace "Seguir buscando"): lee de a una solo hasta
      // encontrar una que sirva (sub ES y, si pidió latino, latino confirmado).
      const wantLat = f.lat && !f.latOff;
      const byHash = new Map(sorted.map((c) => [c.info_hash, c]));
      if (!flat) readUntil(sorted.map((c) => c.info_hash), (h) => hasSpanishSubs(h) === true && (!wantLat || latOf(byHash.get(h)) === 'real'));
      // Solo las primeras (2026-11-17): con 150+ filas redibujar todas trababa la compu; las de
      // abajo casi nunca se eligen y siguen probándose igual.
      const rest = sorted.length - view.shownRows;
      if (!n) return [gp, sortRow(), noMatches(u.candidates.some((c) => flat || resKey(c) === r)), moreRow()];
      return [gp, sortRow(flat ? null : subsScanChip(sorted)), el('ul', { class: 'cat-options' }, sorted.slice(0, view.shownRows).map((c) => optionRow(c, c === best))),
        rest > 0 ? el('button', { id: 'cat-more-rows', class: 'cat-more-rows', onclick: () => { view.shownRows += PAGE_ROWS; renderStreamsOnly(); } },
          `Mostrar ${Math.min(PAGE_ROWS, rest)} más · quedan ${rest}`) : null,
        probing.length ? el('p', { class: 'cat-probing', role: 'status' }, el('span', { class: 'cat-res-spin', 'aria-hidden': 'true' }),
          `Probando ${probing.length} más de fondo: aparecen acá cuando terminan`) : null,
        moreRow(), flat ? null : lowerSuggestion(r, groups)];
    })())].filter(Boolean));
  if (body) body.scrollTop = scroll;
}

/** Lista vacía (2026-11-18): si la resolución tiene torrents que los filtros esconden, lo dice y ofrece sacarlos;
 *  si no tiene ninguno, no hay nada que destrabar. */
function noMatches(hasCandidates) {
  if (!hasCandidates) return el('p', { class: 'pop-empty', role: 'status' }, 'No se encontraron torrents.');
  return el('p', { class: 'pop-empty', role: 'status' }, 'No hay opciones con estos filtros. ',
    el('button', { id: 'cat-filters-off', class: 'link', onclick: clearFilters }, 'Quitar filtros'));
}
/** Quita todos los filtros que limitan la lista (2026-11-18): HDR, latino y TorBox (pasa a torrent, sin filtro).
 *  Antes, con TorBox puesto, el botón no alcanzaba y el mensaje se repetía. */
function clearFilters() {
  view.onlyHdr = false;
  const f = state.side.flow;
  if (f?.lat) f.latOff = true;
  if (f?.mode === 'torbox') f.mode = 'torrent';
  renderStreamsOnly();
}

/** Al final de la lista (2026-11-17, antes en el panel de arriba): con el test de esa resolución
 *  terminado y ninguna fluida, ofrece la siguiente más baja que tenga opciones. */
export function lowerSuggestion(res, groups) {
  const d = state.side.deep;
  if (d?.status !== 'done' || d.res !== res) return null;
  if (groups.get(res).some((c) => counted.get(c.info_hash)?.reached && health(c)?.level === 0)) return null;
  const lower = lowerRes(res, groups);
  if (!lower) return null;
  const fluid = groups.get(lower).filter((c) => health(c)?.shown === 0).length;
  const go = () => {
    openGroup(lower);
    reanalyze(groups.get(lower).map((c) => c.info_hash), lower);
  };
  return el('div', { class: 'cat-lower', role: 'status' },
    el('span', { class: 'cat-radar', 'aria-hidden': 'true' }),
    el('span', { class: 'cat-lower-text' }, el('b', {}, `Ninguna en ${resLabel(res)} va a andar fluida`),
      el('span', {}, fluid ? `En ${resLabel(lower)} hay ${fluid} que sí: se ven un poco menos nítidas, pero sin cortes.` : `En ${resLabel(lower)} hay más chances: se ven un poco menos nítidas, pero sin cortes.`)),
    el('button', { id: 'cat-deep-lower', onclick: go }, `Ver ${resLabel(lower)} →`));
}

/** Grupos de resolución (2026-11-15): 4K, 1440p (2026-11-16), 1080p, 720p y "Otras" (SD y sin dato). */
export const RES_ORDER = ['2160p', '1440p', '1080p', '720p', 'other'];
export const resKey = (c) => (RES_ORDER.includes(c.resolution) ? c.resolution : 'other');
export const resLabel = (r) => ({ '2160p': '4K', '1440p': '2K', other: 'Otras' }[r] ?? r);
/** Reproducir: lo agrega a la biblioteca y lo prepara con el flujo de siempre (audio → subtítulos → reproductor).
 *  Se queda en el catálogo (pedido 2026-11-15). `torbox`: se abre con el link de TorBox en vez del motor. */
export async function playOption(hash, btn, torbox = false) {
  btn.disabled = true;
  starting.set(hash, null);
  let started = false;
  try {
    notePrediction(hash, evidenceOf(hash));
    const [row] = await api.catalogAdd(state.side.kind, state.side.videoId, [hash]);
    if (row && starting.has(hash)) {
      starting.set(hash, row.key);
      // TorBox (2026-11-17): video en línea, sin motor ni fila de reproducción. Sus pistas se leen de TorBox antes de
      // preguntar el audio (2026-11-18).
      if (torbox) {
        setStatus('Leyendo audios y subtítulos en TorBox…');
        await readTracks(hash, true);
      }
      const fresh = rowsOf(hash).find((e) => e.key === row.key) ?? row;
      // El último paso: por TorBox (en línea) o por el motor. Si se canceló mientras tanto, no arranca.
      const start = async (player, audio) => {
        if (!starting.has(hash)) return false;
        if (torbox) {
          setStatus('Pidiéndole el video a TorBox…');
          await api.playTorbox(state.side.videoId, hash, player, audio);
        } else await api.play(row.key, player, null, audio);
        setStatus('Cargando…');
        return true;
      };
      if (starting.has(hash)) {
        // El audio ya se eligió en los pasos del video: original o latino (si está confirmado en las pistas).
        const lat = state.side.flow?.lat;
        started = await play(row.key, btn, fresh, originalAudio(state.side.meta?.country, state.side.details?.details?.original_language), subsStep(hash, torbox), start,
          lat === true ? 'lat' : lat === false ? 'original' : null);
      }
    }
  } catch (e) { showError(e); }
  // Cancelado, error, o ya se estaba viendo (el núcleo no manda evento): se suelta ya.
  const pb = started && [...lib.playbacks.values()].find((r) => r.key === starting.get(hash) && r.state.kind !== 'paused');
  if (!started || (pb && !PB_STARTING.has(pb.state.kind))) starting.delete(hash);
  btn.disabled = false;
  if (state.update) renderStreamsOnly();
}

/** Suelta el spinner de ▶ cuando esa reproducción arrancó, falló o se cerró. */
export function onPlaybackRow(row) {
  if (PB_STARTING.has(row.state.kind)) return;
  for (const [hash, key] of starting) if (key === row.key) starting.delete(hash);
}
