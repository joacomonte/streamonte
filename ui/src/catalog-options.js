// @ts-check
// Opciones de un video (2026-11-17, separado de catalog.js): grupos por resolución, orden, fila de
// cada torrent, panel de pruebas, reproducir y bajar de fondo. Las pruebas en sí: `catalog-tests.js`.

import { api } from './api.js';
import { closeWizard, originalAudio, play } from './audio-picker.js';
import { $, el, icon, setStatus } from './dom.js';
import { t as tr } from './i18n.js';
import { ago, humanBytes, mbps, nf, nf1 } from '$ui/format.ts';
import { playbackText } from './format.js';
import { healthCalibration, notePrediction, speedOf, TRACKER_MIN, trackPlayback } from './health-store.ts';
import { state as lib } from './state.js';
import { renderSide } from './catalog-side.js';
import { safeGet, safeSet, showError, state, view } from './catalog-state.js';
import { isReading, openSubs, readError, readSubsNow, readTracks, readUntil, stopReading, subsScan, subsStep, toggleSubsScan } from './catalog-subs.js';
import { analysisEta, census, counted, counting, deepDone, liveCount, loadSavedTests, newVideoTests, once, phaseAt, quick, QUICK_ENOUGH, QUICK_LATE_MS, quickGroup, quickLive, quickPending, quickRunning, reanalyze, runCensus, runDeep, side, sideOf, skipped, startAnalysis, stopTests, testedAt, toggleBest, TOP, unlikely } from './catalog-tests.js';
import { crumbs, fitsNet, flowFilter, flowStep, hasResStep, isMatch, moreRow, newFlow } from './catalog-flow.js';
/** @typedef {import('./types.js').StreamCandidate} Candidate */
/** @typedef {import('./types.js').StreamsUpdate} StreamsUpdate */
/** @typedef {import('./types.js').LibraryRow} LibraryRow */
/** @typedef {import('./types.js').PlaybackRow} PlaybackRow */
/** @typedef {import('./catalog-tests.js').Count} Count */
/** @typedef {import('./catalog-tests.js').Run} Run */
/** @typedef {import('./catalog-tests.js').Deep} Deep */

/** @typedef {import('$ui/options/row.ts').OptionRowView} OptionRowView */
/** @typedef {import('$ui/options/row.ts').Action} Action */
/** @typedef {import('$ui/options/row.ts').Mid} Mid */
/** @typedef {import('$ui/options/row.ts').People} People */
/** @typedef {import('$ui/options/row.ts').Verdict} Verdict */
/** @typedef {import('$ui/options/row.ts').DockButton} DockButton */

import { healthOf } from '$ui/options/health.ts';
import { HDR_TIP, langTags as langTagsOf, qualityOf, QUALITY_TEXT, RES_ORDER as RES, resKey as resKeyOf, resLabel as resLabelOf, TipBook } from '$ui/options/row.ts';
import { flushOptions, optionsList } from './options-mount.svelte.ts';
import { latOf as latOfRows, mbpsOf as mbpsFor, neededBps as neededBpsFor, rankOptions, tierOf as tierOfCount, toMbps, typicalMbps } from '$ui/rank.ts';

/** Estado del audio latino de una opción ('lat' | 'likely' | 'spain' | 'check' | 'none'): la regla está en `packages/ui/src/rank.ts`.
 *  @param {Candidate} c @returns {import('$ui/types.ts').LatState}
 */
export const latOf = (c) => latOfRows(
  { release: c.release_name, file: c.file_name, audio: c.audio },
  rowsOf(c.info_hash).map((e) => ({ audioRead: !!e.live?.audio?.length, languages: (e.languages ?? []).map((l) => l.code) })),
);
/** Dice o trae español sin aclarar cuál (MULTI / Dual / español en el nombre, o una pista en español).
 *  @param {Candidate} c
 */
const saysSpanish = (c) => c.audio.includes('multi') || c.audio.includes('es')
  || !!rowsOf(c.info_hash).find((e) => e.live?.audio?.length)?.languages?.some((l) => l.code === 'es');
/** Sin confirmar pero vale la pena leer sus pistas: web latina, o español sin aclarar. Las que no dicen nada de
 *  idioma no se leen.
 *  @param {Candidate} c
 */
export const latToCheck = (c) => { const s = latOf(c); return s === 'likely' || (s === 'check' && saysSpanish(c)); };
/** Con potencial de latino (única regla): latino o vale la pena revisarla.
 *  @param {Candidate} c
 */
export const latPotential = (c) => latOf(c) === 'lat' || latToCheck(c);
/** ¿Pidió ver en latino? (paso "¿Necesitás audio latino?" del flujo). Afuera de ese modo, el latino solo se muestra
 *  confirmado. */
const wantsLatino = () => sideOf()?.flow?.lat === true;
/** ¿Trae subs en español? (2026-11-18): `true` / `false` según las pistas ya leídas (análisis o TorBox, guardadas
 *  por torrent) o un archivo .srt en español en la lista de TorBox (solo dice sí); `null` = no se sabe.
 *  @param {string} hash @returns {boolean|null}
 */
export function hasSpanishSubs(hash) {
  const subs = rowsOf(hash).find((e) => e.native_subs)?.native_subs;
  if (subs) return subs.length > 0;
  return torboxSpanishSubs.has(hash) ? true : null;
}
/** Globitos de los badges (2026-11-20, como la web): cuándo apareció cada uno, el primero de cada tipo explica qué significa
 *  y el badge tocado muestra el suyo al toque (`TipBook`, `$ui/options/row.ts`). Uno por video (`loadStreams` lo reinicia). */
export const tips = new TipBook();
/** Idioma ya sabido, como badges junto al peso (la regla es `langTags` de `$ui/options/row.ts`, igual que la web): audio y
 *  subtítulos. Gallego solo en pelis habladas en español o pidiendo latino; LAT siempre; el resto solo pidiendo latino.
 *  @param {Candidate} c @param {boolean} best
 */
function langTags(c, best) {
  const hash = c.info_hash;
  const native = rowsOf(hash).find((e) => e.native_subs)?.native_subs ?? [];
  return langTagsOf({
    hash, lat: latOf(c), want: wantsLatino(), spokenEs: sideOf()?.details?.details?.original_language === 'es', subs: hasSpanishSubs(hash), best,
    subsTitle: native.length ? `${tr('Trae subtítulos en español (siempre en sync):')}\n${native.map((x) => `· ${x.place} · ${x.kind}`).join('\n')}` : undefined,
    audioId: `cat-audio-${hash}`,
    onTap: (e) => { e.stopPropagation(); tips.tap(hash); renderStreamsOnly(); },
  }, tips, tr);
}
/** Lo que falta saber del idioma, como botones de la cápsula del ▶: "¿Trae subs?" y, pidiendo latino, "¿Audio
 *  latino?" (las dos leen las mismas pistas: una lectura responde ambas); "Elegir subs" si se sabe que no trae.
 *  @param {Candidate} c @returns {DockButton[]}
 */
function langActions(c) {
  const hash = c.info_hash;
  const subs = hasSpanishSubs(hash);
  /** @type {DockButton[]} */
  const out = [];
  if (subs == null && !wantsLatino()) out.push(checkButton(hash, 'subs'));
  if (wantsLatino() && latToCheck(c) && !rowsOf(hash).some((e) => e.live?.audio?.length)) out.push(checkButton(hash, 'lat'));
  if (subs === false) {
    out.push({ id: `cat-subfind-${hash}`, icon: 'search', text: tr('Elegir subs'), busy: null, cancel: '', aria: tr('Elegir subs'),
      title: tr('No trae subtítulos en español: elegí de afuera (muestra cuáles calzan con este archivo)'),
      onclick: (e) => { e.stopPropagation(); openSubs(hash, !!view.torboxKey && inTorbox.has(hash), e.currentTarget); } });
  }
  return out;
}
/** Leer las pistas (TorBox: un pedido, segundos; torrent: la prueba rápida, necesita seeds). Leyendo, el mismo botón
 *  queda cargando y otro clic corta la espera (lo leído hasta ahí no se pierde).
 *  @param {string} hash @param {'subs'|'lat'} kind @returns {DockButton}
 */
function checkButton(hash, kind) {
  const reading = isReading(hash);
  const error = readError(hash);
  const [ic, text0, busy, tip0] = kind === 'subs'
    ? [/** @type {const} */ ('subs'), tr('¿Trae subs?'), tr('Leyendo subs…'), tr('Mira adentro del video si trae subtítulos en español (no baja nada)')]
    : [/** @type {const} */ ('speaker'), tr('¿Audio latino?'), tr('Leyendo audio…'), tr('Lee sus pistas de audio para confirmar si es latino')];
  // No se pudo leer (2026-11-18: antes volvía al botón de siempre y parecía que no hizo nada): dice por qué.
  const text = error ? tr('No se pudo · reintentar') : text0;
  const tip = error ? tr('No se pudo leer: {error}. Tocá para reintentar', { error }) : tip0;
  return { id: `cat-${kind}check-${hash}`, icon: ic, text, busy: reading ? busy : null, cancel: tr('Cancelar'),
    title: reading ? tr('Tocá para cancelar') : `${tip} (${inTorbox.has(hash) ? tr('un pedido a TorBox, unos segundos') : tr('por torrent: necesita seeds')})`,
    aria: reading ? tr('{busy} Tocá para cancelar', { busy }) : text,
    onclick: (e) => { e.stopPropagation(); if (reading) stopReading(hash); else readSubsNow(hash, inTorbox.has(hash)); } };
}
// ---------- opciones (FR-42–49) ----------
/** @param {string} videoId @returns {Promise<void>} */
export async function loadStreams(videoId) {
  side().videoId = videoId;
  // Análisis profundo de la resolución elegida. `status`: null | 'run' | 'done'.
  side().deep = { status: null, hashes: [] };
  side().tests = newVideoTests();
  side().torbox = null; // null | 'checking' | 'done' | 'error'
  census.clear();
  // Pasos (2026-11-18): torrent o TorBox → ¿latino? → resolución → lista (`catalog-flow.js`).
  side().flow = newFlow();
  view.openRes = '';
  view.shownRows = PAGE_ROWS;
  view.onlyHdr = false;
  view.onlyEs = false;
  tips.reset();
  api.downloadsFreeBytes().then((b) => { view.freeBytes = b; renderStreamsOnly(); }).catch(() => {});
  state.update = null;
  renderSide();
  setStatus(tr('Pidiendo torrents a todas las fuentes…'));
  try {
    await api.catalogStreams(side().kind, videoId);
  } catch (e) { showError(e); }
}

// Lectura de subs en curso o terminada: el chip "¿Sub ES?" de la fila cambia.
document.addEventListener('subs-changed', () => { if (sideOf()?.videoId) renderStreamsOnly(); });

/** @param {StreamsUpdate} update @returns {void} */
export function onStreams(update) {
  if (update.video_id !== sideOf()?.videoId) return;
  state.update = update;
  const t = side().tests;
  if (update.done && update.candidates.length) {
    // Censo DHT apenas están las fuentes y los trackers (2026-11-16): una vez por video, en paralelo.
    if (once(t, 'census')) runCensus(update.video_id, update.candidates);
    if (once(t, 'saved')) loadSavedTests(update.video_id, update.candidates);
    if (once(t, 'torbox')) loadTorbox(update.video_id, update.candidates);
  }
  const ok = update.addons.filter((a) => a.state !== 'pending').length;
  setStatus(update.done
    ? tr('{n} opción(es) de {ok} fuente(s). Analizá o reproducí una.', { n: update.candidates.length, ok })
    : tr('{ok} de {n} fuentes respondieron…', { ok, n: update.addons.length }));
  renderStreamsOnly();
}

/** Filas de la biblioteca de ese torrent (una por episodio de un pack; el análisis es del torrent).
 *  @param {string} hash @returns {LibraryRow[]}
 */
export function rowsOf(hash) {
  if (view.libByHash) return view.libByHash.get(hash) ?? [];
  return [...state.library.values()].filter((e) => e.info_hash === hash);
}
/** Seeders sin análisis profundo: los de los trackers (chequeados recién, al cargar las opciones)
 *  mandan; un 0 de tracker con la fuente diciendo más suele ser un tracker que no conoce el torrent,
 *  y ahí vale la fuente.
 *  @param {Candidate} c @returns {boolean}
 */
export const trackersWin = (c) => (c.seeders ?? 0) > 0 || (c.seeders === 0 && !((c.seeders_declared ?? 0) > 0));
/** @param {Candidate} c @returns {number|null} */
export function seedsOf(c) {
  return trackersWin(c) ? c.seeders : c.seeders_declared ?? null;
}

/** Por seeders, leechers y peso (lo usan los subtítulos y el desempate de `sortOptions`).
 *  @param {Candidate} a @param {Candidate} b @returns {number}
 */
export const bySeeds = (a, b) => tierOf(b) - tierOf(a) || (knownSeeds(b) ?? -1) - (knownSeeds(a) ?? -1) || (leechersOf(b) ?? -1) - (leechersOf(a) ?? -1) || (b.size_bytes ?? 0) - (a.size_bytes ?? 0);

/** ¿Ya se testeó a fondo la resolución abierta? Hasta entonces se ordena solo por conexión y el
 *  selector de orden es una etiqueta (2026-11-17). */
export const deepTested = () => sideOf()?.deep?.status === 'done' && side().deep.res === view.openRes;
/** Orden de las opciones (2026-11-17): la regla está en `rankOptions` (`packages/ui/src/rank.ts`); acá se le pasa el estado.
 *  Antes del test profundo solo manda la conexión.
 *  @param {Candidate[]} cands
 */
export function sortOptions(cands) {
  return rankOptions(cands, {
    torbox: sideOf()?.flow?.mode === 'torbox',
    mode: deepTested() ? view.optSort : 'fast',
    health, fits, tierOf, knownSeeds, leechersOf, quickGroup, mbpsOf, isMatch, pinPlaying,
    sizeOf: (c) => c.size_bytes, sourceOf: (c) => c.source,
    reached: (c) => counted.get(c.info_hash)?.reached,
    // Prueba en curso que ya pasó a contar seeds reales (etapa 2/2).
    advancing: (c) => {
      const h = c.info_hash;
      const live = counting.has(h) ? liveCount.get(h) : quickRunning.has(h) && !quick.has(h) ? quickLive.get(h) : null;
      return live?.reached ? live : null;
    },
  });
}
/** Fija arriba (2026-11-18) lo que se reproduce o baja: el resto se reordena debajo sin moverla. Lo que se está
 *  preparando (▶ tocado, eligiendo audio y subtítulos) no se mueve: sube recién al arrancar.
 *  @template {{info_hash: string}} T @param {T[]} list @returns {T[]}
 */
function pinPlaying(list) {
  const active = new Set([...lib.playbacks.values()].filter((r) => r.state.kind !== 'failed').map((r) => r.key.split(':')[0]));
  return [...list.filter((c) => active.has(c.info_hash)), ...list.filter((c) => !active.has(c.info_hash))];
}

/** Grupo para ordenar (2 analizado a fondo … 0 nadie lo comparte): la regla está en `packages/ui/src/rank.ts`.
 *  @param {Candidate} c @returns {number}
 */
export const tierOf = (c) => tierOfCount(counted.get(c.info_hash));
/** Seeders que se saben de una opción, de lo más confiable a lo menos: contados al analizar
 *  (aunque sea 0), medidos al reproducir o cargar, según los trackers y, por último, la fuente.
 *  @param {Candidate} c @returns {number|null}
 */
export function knownSeeds(c) {
  const q = quick.get(c.info_hash);
  return seedsCounted(c) ?? (q?.reached ? q.seeds : null) ?? seedsOf(c);
}
/** Seeders contados o medidos de una opción (sin los de trackers); null si no hay ninguno.
 *  @param {Candidate} c @returns {number|null}
 */
export function seedsCounted(c) {
  const partial = liveCount.get(c.info_hash);
  return counted.get(c.info_hash)?.seeds ?? (partial?.reached ? partial.seeds : null)
    ?? rowsOf(c.info_hash).find((e) => (e.live?.seeds ?? 0) > 0)?.live?.seeds ?? null; // un 0 viejo (serde default) no es "0 contados"
}
/** Leechers (desempate): conectados sin el archivo completo al contar, o los del scrape automático.
 *  @param {Candidate} c @returns {number|null}
 */
export function leechersOf(c) {
  const partial = liveCount.get(c.info_hash);
  /** @type {{reached?: boolean, peers: number, seeds: number}|null|undefined} */
  const n = counted.get(c.info_hash) ?? (partial?.reached ? partial : null) ?? rowsOf(c.info_hash).find((e) => e.live)?.live;
  if (n?.reached === false) return null; // nadie respondió: esos peers solo los conoce la DHT
  return n ? Math.max(0, n.peers - n.seeds) : c.leechers ?? null;
}

/** Lo que entra en un análisis: esa resolución (o todas, sin `res`) y, si se pidió, solo HDR. */
/** Opciones que están en la caché de TorBox (2026-11-17; vacío sin key). */
export const inTorbox = new Set();
/** De esas, las que traen un subtítulo en español como archivo suelto (sale del mismo pedido). */
const torboxSpanishSubs = new Set();
/** Opciones que fallaron al reproducirse (sin video, archivo roto, el reproductor no abrió): quedan recordadas en esta
 *  compu, van al final y nunca son "buen match" (2026-11-20). Las últimas 500. */
const FAILED = 'streamonte.failed';
export const failedBefore = new Set((() => { try { return JSON.parse(safeGet(FAILED) ?? '[]'); } catch { return []; } })());
/** @param {string} hash */
export function markFailed(hash) {
  failedBefore.delete(hash);
  failedBefore.add(hash);
  safeSet(FAILED, JSON.stringify([...failedBefore].slice(-500)));
}
/** Una vez por video, apenas está la lista: cuáles están en TorBox. Sin key no pregunta nada.
 *  @param {string} video @param {Candidate[]} cands @returns {Promise<void>}
 */
export async function loadTorbox(video, cands) {
  if (!view.torboxKey) return;
  side().torbox = 'checking';
  const found = await api.catalogTorbox(video, cands.map((c) => c.info_hash)).catch(() => null);
  if (sideOf()?.videoId !== video) return;
  // null = TorBox no respondió (la key ya se sabe que está).
  side().torbox = found ? 'done' : 'error';
  found?.hashes.forEach((h) => inTorbox.add(h));
  found?.spanish_subs.forEach((h) => torboxSpanishSubs.add(h));
  // Calidad del archivo de video cuando el nombre del torrent no la dice (sale del mismo pedido).
  for (const v of found?.videos ?? []) {
    const c = cands.find((x) => x.info_hash === v.hash);
    if (!c) continue;
    c.resolution ??= v.resolution;
    c.source ??= v.source;
  }
  renderStreamsOnly();
}
api.apiKeys().then((ks) => {
  view.torboxKey = ks.some((k) => k.service === 'torbox' && k.configured);
  renderStreamsOnly();
}).catch(() => {});
// Key o código de TorBox recién cargado, o cambio de modo en Ajustes: se marca enseguida lo del video abierto.
document.addEventListener('streamonte:torbox-key', async () => {
  const ks = await api.apiKeys().catch(() => []);
  view.torboxKey = ks.some((k) => k.service === 'torbox' && k.configured);
  if (view.torboxKey && state.update?.done) loadTorbox(side().videoId, state.update.candidates);
  else renderStreamsOnly();
});
// Código rechazado por la web: el núcleo lo borró; hasta cargarlo de nuevo no hay TorBox.
document.addEventListener('streamonte:torbox-code', () => {
  view.torboxKey = false;
  renderStreamsOnly();
});
// ---------- clic derecho en una opción (2026-11-17): copiar su magnet o su link de TorBox ----------
const ctx = el('div', { id: 'cat-ctx', class: 'cat-ctx', role: 'menu' });
ctx.hidden = true;
document.body.append(ctx);
const closeCtx = () => { ctx.hidden = true; };
/** Copia el link que todavía se está pidiendo: con `ClipboardItem` + promesa el permiso del clic
 *  sigue valiendo después de esperar al núcleo (WebKit lo pierde con un `await` antes de copiar).
 *  @param {string} hash @param {boolean} torbox
 */
function copyLink(hash, torbox) {
  closeCtx();
  const f = sideOf()?.flow;
  const link = api.catalogLink(hash, torbox, sideOf()?.details?.details?.original_language ?? null, !!(f?.lat && !f.latOff));
  const done = typeof ClipboardItem === 'function'
    ? navigator.clipboard.write([new ClipboardItem({ 'text/plain': link.then((t) => new Blob([t], { type: 'text/plain' })) })])
    : link.then((t) => navigator.clipboard.writeText(t));
  if (torbox) setStatus(tr('Pidiéndole el link a TorBox…'));
  done.then(() => setStatus(torbox ? tr('Link para castear copiado (stream de TorBox): pegalo en Web Video Caster. Vence en unas horas.') : tr('Magnet copiado.'))).catch(showError);
}
document.addEventListener('contextmenu', (ev) => {
  const row = /** @type {HTMLElement|null} */ (/** @type {Element} */ (ev.target).closest?.('.cat-opt[data-hash]'));
  if (!row) return;
  ev.preventDefault();
  const hash = /** @type {string} */ (row.dataset.hash);
/** @param {string} id @param {string} label @param {boolean} torbox */
  const item = (id, label, torbox) => el('button', { id, class: 'cat-ctx-item', role: 'menuitem', type: 'button', onclick: () => copyLink(hash, torbox) }, icon(torbox ? 'external' : 'copy', 14), label);
  ctx.replaceChildren(.../** @type {HTMLElement[]} */ ([
    view.torboxKey && inTorbox.has(hash) ? item('cat-ctx-torbox', tr('Copiar link para castear (TorBox)'), true) : null,
    item('cat-ctx-magnet', tr('Copiar magnet'), false),
    el('button', { id: 'cat-ctx-subs', class: 'cat-ctx-item', role: 'menuitem', type: 'button',
      onclick: () => { closeCtx(); openSubs(hash, !!view.torboxKey && inTorbox.has(hash), document.getElementById(`cat-play-${hash}`) ?? row); } }, icon('subs', 14), tr('Subtítulos…')),
  ].filter(Boolean)));
  ctx.hidden = false;
  ctx.style.left = `${Math.min(ev.clientX, innerWidth - ctx.offsetWidth - 8)}px`;
  ctx.style.top = `${Math.min(ev.clientY, innerHeight - ctx.offsetHeight - 8)}px`;
  /** @type {HTMLElement} */ (ctx.querySelector('button')).focus({ preventScroll: true });
});
document.addEventListener('pointerdown', (ev) => { if (!ctx.hidden && !ctx.contains(/** @type {Node} */ (ev.target))) closeCtx(); });
document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') closeCtx(); });
document.addEventListener('scroll', closeCtx, { capture: true, passive: true });

/** Filtros de la lista (lo elegido en los pasos y "Solo HDR"): una regla para grupos y filas.
 *  @param {Candidate} c
 */
const passesFilters = (c) => flowFilter(c) && (!view.onlyHdr || c.hdr.length > 0) && (!view.onlyEs || hasSpanishSubs(c.info_hash) === true);
/** @param {Candidate} c @param {string|null|undefined} res @returns {boolean} */
export const inScope = (c, res) => (!res || resKey(c) === res) && passesFilters(c);

/** Arriba de la lista: el panel de búsqueda y test, solo (2026-11-17: subtítulos y HDR van aparte). */
export function optionsHead() {
  const auto = autoBar();
  return auto ? el('div', { class: 'cat-opt-head' }, auto) : null;
}

/** Cómo terminó "bajar la mejor al terminar" (2026-11-17): la elegida ya bajando, o que no hubo. */
export function autoBar() {
  const t = side().tests, a = t.auto;
  if (!a || !state.update?.done) return null;
  return el('div', { id: 'cat-auto-status', class: `cat-auto-status ${a.step}`, role: 'status' },
    icon(a.step === 'done' ? 'check' : 'ban', 16),
    el('span', { class: 'cat-auto-msg' }, el('b', {}, tr('La mejor · ')), a.text),
    el('button', { id: 'cat-auto-close', class: 'link', onclick: () => { t.auto = null; renderStreamsOnly(); } }, tr('Cerrar')));
}

/** Orden de la lista (2026-11-17), arriba de las opciones del grupo abierto (no junto al panel de
 *  test). Antes del test profundo es solo información.
 *  @param {Node|null} [extra]
 */
export function sortRow(extra = null) {
  // Filtro, a la derecha del orden: es sobre la lista, no sobre el test.
  const hdr = el('button', {
    id: 'cat-only-hdr', class: 'cat-hdr-filter', 'aria-pressed': String(view.onlyHdr),
    title: view.onlyHdr ? tr('Mostrando solo HDR / Dolby Vision: tocá para ver todas') : tr('Mostrar solo las opciones con HDR / Dolby Vision (más rango de luz y color)'),
    onclick: () => { view.onlyHdr = !view.onlyHdr; renderStreamsOnly(); },
  }, view.onlyHdr ? icon('check', 12) : null, tr('Solo HDR'));
  // Subs ES (2026-11-20, como la web): solo las que se sabe que traen subtítulos en español.
  const es = el('button', {
    id: 'cat-only-es', class: 'cat-hdr-filter', 'aria-pressed': String(view.onlyEs),
    title: tr('Solo las verificadas que traen subtítulos en español'),
    onclick: () => { view.onlyEs = !view.onlyEs; renderStreamsOnly(); },
  }, view.onlyEs ? icon('check', 12) : icon('subs', 12), tr('Subs ES'));
  const order = sideOf()?.flow?.mode === 'torbox' ? el('div', { class: 'cat-sort-row', id: 'cat-sort-info' },
    el('span', { class: 'cat-sort-label' }, tr('Ordenado por')),
    el('span', { class: 'cat-sort-fixed', title: tr('En TorBox se ven al instante desde sus servidores: los seeds no importan, manda la calidad') },
      icon('monitor', 13), tr('Mejor calidad')))
    : !deepTested() ? el('div', { class: 'cat-sort-row', id: 'cat-sort-info' },
    el('span', { class: 'cat-sort-label' }, tr('Ordenado por')),
    el('span', { class: 'cat-sort-fixed', title: tr('Hasta testearlas, se ordenan por mejor conexión: más seeds. Después del test podés ordenar por mejor imagen.') },
      icon('gauge', 13), tr('Mejor conexión')))
    : el('div', { class: 'cat-sort-row' }, el('span', { class: 'cat-sort-label', id: 'cat-sort-label' }, tr('Ordenar por')),
    el('div', { class: 'cat-sort', role: 'group', 'aria-labelledby': 'cat-sort-label' },
      /** @type {['quality'|'fast', string, string][]} */ ([['quality', tr('Mejor imagen'), tr('Arriba las testeadas que andan fluidas, de mejor a peor calidad de imagen; después el resto por conexión')], ['fast', tr('Arranca más rápido'), tr('Primero las de mejor conexión: las más fluidas y con más seeds')]]).map(([k, label, tip]) =>
        el('button', { id: `cat-sort-${k}`, 'aria-pressed': String(view.optSort === k), title: tip,
          onclick: () => { view.optSort = k; safeSet('streamonte.catalog.sort', k); renderStreamsOnly(); } }, label))));
  return el('div', { class: 'cat-list-bar' }, order, el('span', { class: 'cat-list-filters' }, extra, hdr, es));
}
/** "Buscar sub ES" (2026-11-18): lee de a una, en el orden de la lista, hasta encontrar una con subtítulos en español
 *  dentro del video; el mismo botón pausa y sigue. Sin pendientes ni resultado, no aparece.
 *  @param {Candidate[]} list
 */
function subsScanChip(list) {
  const st = subsScan();
  if (st === 'found' || list.some((c) => hasSpanishSubs(c.info_hash) === true)) return null;
  const left = list.filter((c) => hasSpanishSubs(c.info_hash) == null).length;
  if (st === 'none' || !left) return el('span', { id: 'cat-subscan', class: 'cat-hdr-filter done', role: 'status' }, icon('subs', 12), tr('Ninguna trae sub ES'));
  const running = st === 'running';
  return el('button', { id: 'cat-subscan', class: `cat-hdr-filter ${running ? 'busy' : ''}`, 'aria-pressed': String(running),
    title: running ? tr('Pausar la búsqueda (lo leído queda)') : tr('Lee de a una ({left} sin leer) hasta encontrar una que traiga subtítulos en español dentro del video', { left }),
    onclick: toggleSubsScan },
  running ? el('span', { class: 'cat-res-spin', 'aria-hidden': 'true' }) : icon('subs', 12),
  running ? tr('Buscando sub ES… · Pausar') : st === 'paused' ? tr('Seguir buscando sub ES') : tr('Buscar sub ES'));
}

/** Cada cuánto cambia la línea de avance aunque no lleguen resultados. */
const TICK_MS = 3200;
/** Lo que va pasando, en una línea que cambia cada `TICK_MS` (2026-11-17): para que se vea que avanza
 *  y no que quedó pensando. Sale de los datos que van llegando; sin datos, una frase de lo que hace.
 *  @param {string} res @param {'quick'|'deep'} stage @param {Run|null} run @returns {string}
 */
function progressLine(res, stage, run) {
  const t = side().tests;
/** @param {(string|number|boolean|null|undefined)[]} lines */
  const pick = (lines) => { const ok = lines.filter(Boolean); return /** @type {string} */ (ok[Math.floor(Date.now() / TICK_MS) % ok.length]); };
  if (stage === 'quick') {
    const first = /** @type {string[]} */ (t.first[res]?.hashes ?? []);
    const results = /** @type {Count[]} */ (first.map((h) => quick.get(h) ?? (counted.has(h) ? counted.get(h) : null)).filter(Boolean));
    const alive = results.filter((q) => q.reached && q.seeds > 0).length;
    const deadN = results.length - alive;
    const live = first.filter((h) => quickLive.has(h)).length;
    const asking = first.filter((h) => quickRunning.has(h) && !quick.has(h) && !quickLive.has(h)).length;
    const seeds = results.reduce((s, q) => s + (q.seeds || 0), 0) + first.reduce((s, h) => s + (quickLive.get(h)?.reached ? quickLive.get(h)?.seeds ?? 0 : 0), 0);
    const left = first.length - results.length;
    return pick([
      run?.prev && tr('En {a} ninguna anda sin cortes: sigo con {b}', { a: resLabel(run.prev), b: resLabel(res) }),
      !results.length && !live && tr('Preguntándole a la red quién tiene cada torrent…'),
      live && tr('Conectando con {live} {a} a la vez', { live, a: live === 1 ? 'torrent' : 'torrents' }),
      asking && tr('Esperando que respondan {asking} más', { asking }),
      results.length && tr('Ya respondieron {n} de {n2}', { n: results.length, n2: first.length }),
      alive && tr('Encontré {alive} con seeds reales', { alive }),
      seeds && tr('{seeds} seeds reales contados hasta ahora', { seeds }),
      deadN && tr('Descarté {deadN} que no tienen a nadie', { deadN }),
      left && results.length && tr(left === 1 ? 'Me falta 1 para pasar a la etapa 2' : 'Me faltan {n} para pasar a la etapa 2', { n: left }),
    ]) ?? tr('Buscando seeds reales…');
  }
  const d = side().deep;
  const hashes = d.hashes ?? [];
  const doneN = hashes.filter((h) => deepDone.has(h)).length;
  const lives = /** @type {Count[]} */ (hashes.map((h) => liveCount.get(h)).filter(Boolean));
  const peers = lives.reduce((s, l) => s + (l.peers || 0), 0);
  const counting = lives.filter((l) => l.reached).length;
  const cands = (state.update?.candidates ?? []).filter((c) => hashes.includes(c.info_hash));
  const fluid = cands.filter((c) => counted.has(c.info_hash) && health(c)?.level === 0).length;
  const left = hashes.length - doneN;
  return pick([
    tr('Verificando la salud de las mejores'),
    peers && tr('Midiendo la velocidad con {peers} conexiones', { peers }),
    counting && tr('Contando seeds reales en {counting} a la vez', { counting }),
    doneN && tr('{doneN} de {n} verificados', { doneN, n: hashes.length }),
    fluid && tr(fluid === 1 ? '{n} ya anda sin cortes' : '{n} ya andan sin cortes', { n: fluid }),
    left && doneN && tr(left === 1 ? 'Me falta 1' : 'Me faltan {n}', { n: left }),
    run?.best && tr('Al terminar dejo bajando la mejor'),
  ]);
}

/** Panel de la resolución abierta (2026-11-17, antes arriba de todo): el análisis en curso —
 *  1 de 2 prueba rápida, 2 de 2 análisis profundo — con "Detener", o el resultado con "Testear más".
 *  @param {string} res
 */
export function groupPanel(res) {
  const u = /** @type {StreamsUpdate} */ (state.update), d = side().deep, t = side().tests;
  const resText = res === 'other' ? tr('las otras resoluciones') : resLabel(res);
/** @param {string} cls @param {Node} ic @param {Node} title @param {string} sub @param {...Node} extra */
  const panel = (cls, ic, title, sub, ...extra) => el('div', { id: 'cat-deep', class: `cat-deep ${cls}`, role: 'status' },
    el('span', { class: 'cat-deep-icon', 'aria-hidden': 'true' }, ic),
    el('span', { class: 'cat-deep-text' }, el('span', { class: 'cat-deep-title' }, title), el('span', { class: 'cat-deep-sub' }, sub)), ...extra);
  // Deteniendo (2026-11-17): hasta que el núcleo cortó todo, para que se vea que el clic hizo algo.
  if (t.stopping?.res === res) {
    if (counting.size || d.status === 'run') {
      return el('div', { id: 'cat-deep', class: 'cat-deep running stopping', role: 'status', 'aria-busy': 'true' },
        el('span', { class: 'cat-deep-icon', 'aria-hidden': 'true' }, el('span', { class: 'cat-res-spin big' })),
        el('span', { class: 'cat-deep-text' }, el('span', { class: 'cat-deep-title' }, el('b', {}, tr('Deteniendo…'))),
          el('span', { class: 'cat-deep-sub' }, tr('Cortando las conexiones. Lo ya probado queda.'))),
        el('span', { class: 'cat-deep-bar waiting' }, el('i')));
    }
    t.stopping = null;
  }
  // Analizando (2026-11-17): título fijo, debajo en gris lo que va pasando (cambia cada pocos segundos
  // con los datos que llegan) y dos íconos: bajar la mejor al terminar (se prende/apaga) y detener.
  const run = t.run?.res === res ? t.run : null;
  const single = !run && d.status === 'run' && d.single;
  if (run || single) {
    const deepNow = single || run?.stage === 'deep';
    const { done, n, frac } = deepNow ? deepStatus(d) : { done: 0, n: 0, frac: 0 };
    const first = t.first[res];
    const elapsed = first ? Date.now() - first.at : 0;
    // Sin resultados nuevos igual cambia el texto: un redibujo cada `TICK_MS` mientras analiza.
    if (!t.tick) t.tick = setTimeout(() => { t.tick = null; scheduleRender(); }, TICK_MS);
    if (first && once(t, `timers-${res}`) && elapsed < QUICK_LATE_MS) setTimeout(scheduleRender, QUICK_LATE_MS + 100 - elapsed);
    const title = single ? tr('Verificando {a} · {done} de {n}', { a: n === 1 ? '1 torrent' : `${n} torrents`, done, n })
      : run?.quickOnly ? tr('Armando la lista de {resText} · estimado ~30 s', { resText })
        : tr('Analizando {resText} · {a}', { resText, a: deepNow ? tr('fase 2 de 2') : tr('fase 1 de 2') });
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
          title: run.best ? tr('Al terminar la dejo bajando de fondo (tocá para no hacerlo)')
            : tr('Al terminar dejo bajando de fondo la que ande sin cortes; si en esta calidad no hay, pruebo la siguiente más baja'),
          onclick: toggleBest }, icon(run.best ? 'check' : 'download', 14), run.best ? tr('La dejo bajando') : tr('Dejar bajando el mejor')) : null,
        el('button', { id: 'cat-deep-stop', class: 'cat-icon-btn stop', 'aria-label': tr('Detener'), title: tr('Detener: lo ya probado queda y se muestra la lista'),
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
      el('span', { class: 'cat-deep-offer-text' }, el('b', {}, tr('Análisis profundo: buscar el mejor torrent')),
        el('span', {}, tr('Verifico a fondo las {TOP} mejores y leo sus audios y subtítulos internos (sub ES, latino) · {a}', { TOP, a: analysisEta(u.candidates.filter((c) => inScope(c, res)).length) }))),
      el('span', { class: 'cat-res-arrow' }, icon('chev', 16)));
  }
  const inRes = u.candidates.filter((c) => inScope(c, res));
  const checkedN = inRes.filter((c) => counted.has(c.info_hash)).length;
  const alive = inRes.filter((c) => (counted.get(c.info_hash)?.seeds ?? 0) > 0).length;
  // Quedan sin contar (y no muertos): otra tanda, solo si el usuario quiere; primero las que la prueba
  // rápida encontró con seeds reales.
  const { potential } = quickPending(res);
  const more = Math.min(TOP, potential || inRes.filter((c) => !counted.has(c.info_hash) && !unlikely(c)).length);
  const next = more ? el('button', { id: 'cat-deep-more', class: 'cat-deep-go', onclick: () => runDeep(side().videoId, res) }, tr('Testear {more} más', { more }))
    : el('button', { id: 'cat-deep-go', class: 'cat-deep-go', onclick: () => startAnalysis(res) }, tr('Repetir'));
  return panel('done', icon('check', 16), el('b', {}, tr('Análisis completo')),
    tr('{resText}: {alive} de {checkedN} con seeds reales{a}', { resText, alive, checkedN, a: potential ? tr(' · {potential} más con seeds reales para testear', { potential }) : '' }), next);
}

/** Avance del análisis profundo en curso (`runDeep`): cuántos respondieron y fracción 0–1.
 *  @param {Deep} d
 */
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
 *  nuevo desde ahí, sin retroceder.
 *  @param {Deep} d @param {number} frac @param {number} n
 */
export function deepBar(d, frac, n) {
  return el('span', { class: 'cat-deep-bar' },
    el('i', { style: `width:${frac * 100}%` }),
    frac < 1 ? el('b', { class: 'cat-deep-creep', style: `left:${frac * 100}%;--slice:${(100 / Math.max(1, n)) * 0.9}%;animation-delay:-${Date.now() - /** @type {number} */ (d.lastAt)}ms` }) : null);
}

/** Línea de tooltip: direcciones que conoce la red (`known` del conteo manda sobre el censo).
 *  @param {string} hash @returns {string|null}
 */
export function knownLine(hash) {
  const n = counted.get(hash)?.known || census.get(hash);
  return (n ?? 0) > 0 ? tr('La red conoce ~{n} direcciones (DHT/trackers/PEX); no todas aceptan conexión.', { n }) : null;
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
/** Desde cuándo se ve una prueba sin fase anotada (la barra arranca ahí y no se reinicia al redibujar). */
const seenTesting = new Map();
/** Indicador de una prueba en curso: etapa 1 = conseguir los datos del torrent (sin eso no se sabe
 *  quién tiene el archivo completo), etapa 2 = contar los seeds reales.
 *  @param {string} hash @param {Count} live @param {boolean} quickMode @returns {Mid}
 */
export function testingPill(hash, live, quickMode) {
  const counting = live.reached;
  const label = counting ? tr('Contando seeds reales · {seeds}', { seeds: live.seeds })
    : live.peers ? tr('Pidiendo datos a {peers} conexiones…', { peers: live.peers }) : tr('Buscando seeds…');
  const key = `${hash}|${counting}`;
  if (!seenTesting.has(key)) seenTesting.set(key, Date.now());
  return { kind: 'testing', quick: quickMode, counting, step: counting ? '2/2' : '1/2', label, since: phaseAt.get(hash)?.t ?? seenTesting.get(key) };
}
/** ▶ tocado: info_hash → `key` del video (null mientras se agrega). Spinner hasta que la
 *  reproducción arranca o falla (evento `playback-updated`), no solo hasta que vuelve el invoke. */
export const starting = new Map();
export const PB_STARTING = new Set(['fetching-metadata', 'preparing']);

/** Bytes del archivo que se ve. En un pack (2026-11-16) no sirve el peso del pack entero: el del
 *  episodio si ya se analizó o reprodujo (fila de la biblioteca `hash:sXeY`: el archivo real leído
 *  de los metadatos, `live.file_size`; `video_size` a veces trae el de otra fuente), el que da la fuente si
 *  señala el archivo (`file_name`), o el del pack ÷ los episodios de la temporada. Un pack de varias
 *  temporadas sin más datos: null.
 *  @param {Candidate} c @returns {number|null}
 */
export function fileBytes(c) {
  if (!c.is_pack) return c.size_bytes ?? null;
  const [, season, episode] = (sideOf()?.videoId ?? '').split(':');
  const e = episode ? state.library.get(`${c.info_hash}:s${season}e${episode}`) : undefined;
  if (e?.live?.file_size || e?.video_size) return e.live?.file_size || e.video_size;
  if (!c.size_bytes) return null;
  if (c.file_name) return c.size_bytes;
  if (/\bS\d{1,2}\s*-\s*S?\d{1,2}\b|complete\s*series|integral/i.test(c.release_name)) return null;
  const eps = (sideOf()?.meta?.episodes ?? []).filter((x) => String(x.season) === season).length;
  return eps ? c.size_bytes / eps : null;
}
/** Bytes/s que hay que bajar sostenidos para verlo sin cortes = archivo ÷ duración (la real si se
 *  analizó, si no la de la ficha). `null` sin alguno de los dos.
 *  @param {Candidate} c @returns {number|null}
 */
export function neededBps(c) {
  const [, season, episode] = (sideOf()?.videoId ?? '').split(':');
  const e = c.is_pack && episode ? state.library.get(`${c.info_hash}:s${season}e${episode}`) : rowsOf(c.info_hash)[0];
  return neededBpsFor(fileBytes(c), e?.live?.duration_secs, sideOf()?.runtime);
}
/** Mbps que pide una opción para verse sin cortes: peso ÷ duración; sin dato, lo típico de su resolución. */
/** @param {Candidate} c @returns {number} */
export const mbpsOf = (c) => mbpsFor(c.resolution, neededBps(c));
/** Salud del stream: la cuenta está en `healthOf` (`options-rank.js`); acá se juntan los datos. Null sin seeders
 *  conocidos o si nadie respondió al contar.
 *  @param {Candidate} c
 */
export function health(c) {
  if (knownSeeds(c) == null || counted.get(c.info_hash)?.reached === false) return null;
  const cal = view.renderCal ?? healthCalibration(state.library.values());
  const ev = evidenceOf(c.info_hash, c);
  const pb = playbackOf(c.info_hash);
  return healthOf({ resolution: c.resolution, bps: neededBps(c), cal, ev, now: pb && speedOf(pb.key), trackerMin: TRACKER_MIN });
}

/** Veredicto en palabras (2026-11-17): lo que el usuario quiere saber, sin Mbps. */
export const HEALTH_WORD = [tr('Fluida'), tr('Puede cortarse'), tr('Se va a trabar')];
/** @param {number} v */
export const mbpsN = (v) => nf(v >= 10 ? Math.round(v) : v);
/** Veredicto de salud (2026-11-17): ícono de señal + palabra (lo dibuja la fila); el rango, de dónde sale y cuándo se
 *  testeó van en el tooltip. Tocarlo testea de nuevo. `compact` (reproduciendo): solo el ícono.
 *  @param {Candidate} c @param {boolean} [compact] @returns {Verdict|null}
 */
export function verdict(c, compact = false) {
  const h = health(c);
  if (!h) return null;
  const { shown, probable, range: r, conf, basis, need, exact, cal } = h;
  const ev = /** @type {import('./types.js').HealthEvidence} */ (h.ev);
  const word = HEALTH_WORD[shown];
  const asks = exact ? tr('pide ~{a}', { a: Math.round(need) }) : tr('un {a} suele pedir ~{b} (el real se sabe al testearlo)', { a: resLabel(resKey(c)), b: Math.round(need) });
  const k = basis === 'now' ? 1 : cal.bias?.[basis]?.factor ?? 1;
  const learned = Math.abs(k - 1) > 0.05 ? tr(' Corregido ×{a} con lo que anduvieron tus reproducciones en esta red.', { a: nf1(k) }) : '';
  const why = basis === 'now' ? tr('Es lo que está bajando ahora.')
    : basis === 'measured' ? tr('Medido al analizarlo: {a} Mbps.{learned}', { a: mbpsN(/** @type {number} */ (ev.analysis_mbps)), learned })
      : basis === 'counted' ? tr('{counted_seeds} seeders contados y {a} leechers.{learned}', { counted_seeds: ev.counted_seeds, a: ev.counted_leech ?? 0, learned })
        : tr('{tracker_seeds} seeders y {a} leechers según los trackers (sin testear).{learned}', { tracker_seeds: ev.tracker_seeds, a: ev.tracker_leechers ?? 0, learned });
  const internet = cal.capMbps && r.hi >= cal.capMbps ? tr(' Tope: tu internet, {a} Mbps.', { a: Math.round(cal.capMbps) }) : '';
  const at = testedAt.get(c.info_hash);
  const known = knownLine(c.info_hash);
  const tip = tr('{word}{a}: bajaría entre {b} y {c} Mbps, lo más probable ~{d}; {asks} ({e}×).\n{why}{internet}\nConfianza: {conf}.{f}\nTocá para testear de nuevo.{g}', { word, a: probable ? tr(' (probable)') : '', b: mbpsN(r.lo), c: mbpsN(r.hi), d: mbpsN(r.p50), asks, e: nf1(h.ratio), why, internet, conf: tr(conf), f: at ? tr(' Testeado {a}.', { a: ago(at) }) : '', g: known ? `\n${known}` : '' });
  return { id: `cat-health-${c.info_hash}`, level: /** @type {0|1|2} */ (shown), probable, word, tip, compact,
    aria: tr('{word}, confianza {conf}: testear de nuevo', { word, conf: tr(conf) }), onclick: () => reanalyze([c.info_hash]) };
}

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
 *  Null si no hay nada que prediga (esa reproducción no enseña).
 *  @param {string} hash @param {Candidate} [c]
 */
export function evidenceOf(hash, c = state.update?.candidates.find((x) => x.info_hash === hash)) {
  const live = rowsOf(hash).find((x) => x.live && !x.live.partial)?.live ?? null;
  const scrape = rowsOf(hash).find((x) => x.scrape)?.scrape ?? null;
  // Un 0 parcial (recién llegan los metadatos) no es "0 contados": taparía a los trackers.
  const sc0 = c ? seedsCounted(c) : live && live.seeds > 0 ? live.seeds : null;
  const sc = sc0 === 0 && counted.get(hash)?.seeds !== 0 ? null : sc0;
  const tracker = c ? seedsOf(c) : scrape?.seeders ?? null;
  const analysis = live && live.avg_speed_bps > 0 ? toMbps(live.avg_speed_bps) : null;
  if (tracker == null && sc == null && analysis == null) return null;
  const bps = c && neededBps(c);
  const knownN = counted.get(hash)?.known ?? 0;
  return {
    tracker_seeds: tracker,
    tracker_leechers: c ? c.leechers ?? null : scrape?.leechers ?? null,
    counted_seeds: sc,
    counted_leech: sc == null ? null : c ? leechersOf(c) ?? 0 : Math.max(0, /** @type {import('./types.js').LiveMeasurement} */ (live).peers - /** @type {import('./types.js').LiveMeasurement} */ (live).seeds),
    analysis_mbps: analysis,
    need_mbps: bps ? toMbps(bps) : c ? typicalMbps(c.resolution) : live?.duration_secs ? toMbps(live.file_size / live.duration_secs) : null,
    res: c?.resolution ?? null,
    known: knownN > 0 ? knownN : null,
    dht: census.get(hash) ?? null,
  };
}
/** @param {PlaybackRow} row */
export function measurePlayback(row) {
  const hash = row.key.split(':')[0];
  trackPlayback(row, evidenceOf(hash) ?? undefined);
  const b = [...bgLoads.values()].find((x) => x.key === row.key);
  if (b) b.row = row;
}
/** Texto de la card: "2,3× · alcanza" = promedio ÷ bitrate (tamaño ÷ duración). Sin duración
 *  (o pack) solo la velocidad.
 *  @param {Candidate} c
 */
export function bgText(c) {
  const b = bgLoads.get(c.info_hash);
  if (!b) return null;
  if (b.row?.state.kind === 'failed') return { cls: 'red', text: tr('falló'), tip: b.row.state.message };
  const speed = speedOf(b.key);
  if (!speed?.n) return { cls: 'measuring', text: tr('cargando…'), tip: tr('Buscando metadatos y precargando el principio; después mide la velocidad.') };
  const avg = speed.avg;
  // Cuánto va (2026-11-17): que se vea que está bajando, no solo si la velocidad alcanza.
  const pct = Math.floor((playbackOf(c.info_hash)?.progress ?? 0) * 100);
  const done = speed.done ? tr('completo · ') : tr('bajando {pct} % · ', { pct });
  const need = neededBps(c);
  if (!need) return { cls: 'none', text: `${done}${mbps(avg)}`, tip: tr('{a} de promedio bajando de fondo (sin duración conocida no se calcula si alcanza).', { a: mbps(avg) }) };
  const x = avg / need;
  const [cls, verdict] = x >= BG_GREEN ? ['green', tr('alcanza')] : x >= BG_YELLOW ? ['yellow', tr('justo')] : ['red', tr('no alcanza')];
  return { cls, text: `${done}${nf1(x)}× · ${verdict}`, tip: tr('{a} de promedio ÷ {b} que consume el video.', { a: mbps(avg), b: mbps(need) }) };
}
/** Deja bajando de fondo esa opción del video abierto (la usan el botón de la fila y "Elegí la
 *  mejor"). false si no se pudo agregar.
 *  @param {string} hash @returns {Promise<boolean>}
 */
export async function startBg(hash) {
  notePrediction(hash, evidenceOf(hash));
  const [row] = await api.catalogAdd(side().kind, side().videoId, [hash]);
  if (!row) return false;
  bgLoads.set(hash, { key: row.key, row: null });
  try { await api.playBackground(row.key); } catch (e) { bgLoads.delete(hash); throw e; }
  return true;
}
/** Arranca o cancela la carga en background. Cancelar = Detener: lo bajado queda guardado y
 *  Reproducir lo retoma.
 *  @param {string} hash @param {HTMLButtonElement} btn
 */
export async function toggleBg(hash, btn) {
  btn.disabled = true;
  const b = bgLoads.get(hash);
  try {
    if (b) {
      bgLoads.delete(hash);
      // Si ya se está viendo (Reproducir la retomó), cancelar no cierra el reproductor.
      if (b.row && ['fetching-metadata', 'preparing', 'background'].includes(b.row.state.kind)) await api.playbackAction(b.row.id, 'stop');
      setStatus(tr('Carga en background cancelada: lo bajado queda guardado.'));
    } else if (await startBg(hash)) {
      setStatus(tr('Cargando en background: la velocidad promedio aparece en la opción.'));
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
/** @param {string} hash @returns {PlaybackRow|undefined} */
export function playbackOf(hash) {
  return [...lib.playbacks.values()].filter((r) => r.key.split(':')[0] === hash)
    .sort((a, b) => PB_RANK.indexOf(a.state.kind) - PB_RANK.indexOf(b.state.kind))[0];
}

/** ¿Entra en el disco de descargas? (2026-11-17). Sin dato del espacio libre, sí.
 *  @param {Candidate} c @returns {boolean}
 */
export const fits = (c) => view.freeBytes == null || !((fileBytes(c) ?? 0) > view.freeBytes);

/** Una opción (2026-11-17, diseño de design/opciones-final.html): a la izquierda peso, calidad de
 *  imagen y si no entra; al medio el veredicto (o testear / testeando / nadie respondió / lo que
 *  hace la reproducción) con la gente debajo; a la derecha bajar de fondo y ▶. Quieto 2 s sobre la
 *  fila, todos los datos del torrent. Devuelve la vista que dibuja `$ui/options/OptionRow.svelte`.
 *  @param {Candidate} c @param {boolean} [best] @returns {OptionRowView}
 */
export function rowView(c, best = false) {
  const hash = c.info_hash;
  const bg = bgText(c);
  // Al dar ▶, los estados de la reproducción (2026-11-15). La de "bajar de fondo" la cuenta `bgText`.
  const pb = playbackOf(hash);
  const pbStatus = starting.has(hash) && !pb ? tr('cargando…') : pb && !(pb.state.kind === 'background' && bgLoads.has(hash)) ? playbackText(pb) : null;
  const live = rowsOf(hash).find((e) => e.live)?.live ?? null;
  const scraped = counted.get(hash);
  const busy = counting.has(hash);
  const qName = c.source ? QUALITY_TEXT[c.source]?.[0] : undefined;
  const tip = [`${c.release_name}: ${[c.resolution, qName && tr(qName)].filter(Boolean).join(' · ')}`, c.file_name && tr('Archivo: {file_name}', { file_name: c.file_name }), c.is_pack && tr('Pack: varios episodios en un torrent'), tr('Fuentes: {a}{b}', { a: c.addons.join(' + '), b: c.sites.length ? ` (${c.sites.join(', ')})` : '' })].filter(Boolean).join('\n');
  const hdrTip = c.hdr.map((x) => HDR_TIP[x]).filter(Boolean).map((x) => tr(x)).join('\n');
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
    ? tr('Prueba rápida: {seeds}{a} seeds (con el archivo completo) respondieron en menos de 30 s', { seeds: qk.seeds, a: qk.seeds >= QUICK_ENOUGH ? tr(' o más') : '' })
    : qk.peers ? tr('Prueba rápida: la red conoce {peers} direcciones, pero nadie respondió en 30 s', { peers: qk.peers }) : tr('Prueba rápida: nadie lo comparte'))
    + `${c.seeders != null ? tr(' (los trackers anuncian {seeders}, sin verificar)', { seeders: c.seeders }) : ''}.`;
  const dead = scraped?.reached === false;
  const big = !fits(c);
  const seedsTip = skipped.has(hash) && !scraped ? (skipped.get(hash) === 'dead'
    ? tr('Sin testear: los trackers y la fuente dan 0 seeders y 0 leechers (casi seguro muerto).')
    : tr('Sin testear a fondo: quedó fuera de las {TOP} mejores según la prueba rápida y los trackers.', { TOP }))
    : scraped && !dead ? tr('Testeado: {seeds} seeders (archivo completo) de {peers} conectados{a}. Al reproducir suelen aparecer algunos más.{b}', { seeds: scraped.seeds, peers: scraped.peers, a: c.seeders != null ? tr(' (los trackers anuncian {seeders}, sin verificar)', { seeders: c.seeders }) : '', b: (scraped.incoming ?? 0) > 0 ? tr(' {incoming} se conectaron solos (entrantes).', { incoming: scraped.incoming }) : '' })
      : quickTip ? quickTip
      : live ? tr('Seeders vistos al analizarlo: {seeds} ({peers} conectados).', { seeds: live.seeds, peers: live.peers })
        : checked === 'trackers' ? tr('{TRACKERS_TIP} {seeders} seeders, {a} leechers.', { TRACKERS_TIP, seeders: c.seeders, a: c.leechers ?? 0 })
          : tr('Según la fuente (los trackers no lo conocen o no respondieron).');
  // Todavía sin respuesta del tracker (la lista ya se ve mientras se escanea): el número es de la fuente.
  /** @type {People} */
  const people = { verdict: pbStatus ? verdict(c, true) : null, seeds: String(seedsLabel), tip: [seedsTip, knownLine(hash)].filter(Boolean).join('\n'),
    text: `${qk?.reached || (quickBusy && qLive) ? tr(' seeds reales') : ' seeds'}${quickBusy && qLive ? tr(' encontrados') : tr(' · {a} leechers', { a: leechersOf(c) ?? 0 })}` };
  const failedTip = scraped?.peers
    ? tr('Nadie respondió: la red conoce {peers} direcciones de peers con este torrent, pero ninguna contestó. Pueden estar apagadas o llenas, o tu router y el de ellos tienen el puerto cerrado. No quiere decir que esté muerto: probá de nuevo en un rato o elegí otra.', { peers: scraped.peers })
    : tr('Nadie lo comparte: no apareció nadie con este torrent. Casi seguro está muerto.');
  // "Mejor opción": testeada, fluida segura (B8: lo probable no se recomienda), que entre en el disco y no sea de cine.
  const confirmed = best && (side().flow?.mode === 'torbox' || (side().deep?.status === 'done' && isSafeBest(c)));
  const v = pbStatus || bg || busy || quickBusy || dead ? null : verdict(c);
  /** @type {Mid} */
  const main = pbStatus ? statusPill(pb, pbStatus)
    : bg ? { kind: 'bg', cls: bg.cls, text: bg.text, tip: bg.tip ?? '' }
    // El núcleo prueba de a tandas: los que todavía no arrancaron esperan su lugar (2026-11-17).
    : (busy && !partial) || (quickBusy && !qLive) ? { kind: 'waiting', text: tr('En espera…') }
    : busy ? testingPill(hash, /** @type {Count} */ (partial), false)
    : quickBusy ? testingPill(hash, /** @type {Count} */ (qLive), true)
    : dead ? { kind: 'failed', id: `cat-retry-${hash}`, text: scraped.peers ? tr('Nadie respondió') : tr('Nadie lo comparte'), tip: failedTip, retry: tr('Reintentar'), onclick: () => reanalyze([hash]) }
    : v ? { kind: 'verdict', verdict: v }
    : { kind: 'check', id: `cat-check-${hash}`, text: tr('Verificar salud'), onclick: () => reanalyze([hash]),
      title: tr('Verificar salud: se conecta unos segundos con los seeds de este torrent y estima si va a andar fluido. No baja el video, pero deja guardados sus metadatos: si después lo elegís, arranca más rápido.') };
  // En TorBox sin reproducirse, el medio queda vacío: peso y badges usan ese ancho (no bajan de renglón).
  const tbIdle = inTorbox.has(hash) && !pbStatus;
  const acts = pbStatus || bg ? [] : langActions(c);
  const { audio, subs } = langTags(c, confirmed);
  return {
    hash, title: tip, best: confirmed, bestText: tr('Mejor opción'), idle: tbIdle, tooBig: big, skipped: skipped.has(hash),
    size: humanBytes(c.size_bytes), hdr: hdrTip || null,
    res: hasResStep() ? null : resLabel(resKey(c)),
    heavy: hasResStep() || fitsNet(c) || c.size_bytes == null ? null : tr('Pide ~{a} Mbps: más de lo que da tu conexión', { a: Math.round(mbpsOf(c)) }),
    // Por TorBox ya se eligió en los pasos: el badge solo informa por torrent (2026-11-18).
    failedBefore: failedBefore.has(hash) && !pbStatus ? tr('Esta opción ya falló al reproducirse en esta compu (sin video, archivo roto o el reproductor no la abrió). Va al final de la lista.') : null,
    torbox: inTorbox.has(hash) && sideOf()?.flow?.mode !== 'torbox' ? tr('TorBox es un servicio pago que baja torrents a sus servidores y te los pasa como video en línea. Este ya lo tiene bajado: se ve al instante y sin depender de los seeds, sin bajar nada a tu Mac.') : null,
    audio, subs,
    quality: qualityOf(c.source, c.release_name, `cat-qinfo-${hash}`, tr),
    nofit: big ? { text: tr('No entra: te quedan {a}', { a: humanBytes(view.freeBytes) }), title: tr('No entra en el disco: pesa {a} y en el disco de descargas quedan {b} libres. Se cortaría a mitad: liberá espacio o elegí una más liviana.', { a: humanBytes(fileBytes(c)), b: humanBytes(view.freeBytes) }) } : null,
    // En TorBox (2026-11-17): se ve desde sus servidores, así que salud, seeds y bajar de fondo no aplican.
    // Viéndose o cargando por TorBox: solo su estado (seeds y pares no aplican).
    mid: tbIdle ? null : { main, people: inTorbox.has(hash) && !(pbStatus && !pb?.stream && pb) ? null : people },
    action: playButtons(c, acts),
  };
}

/** Bajar de fondo (círculo chico) y ▶ (2026-11-17). Con `acts` (lo que falta saber del idioma), van en una cápsula
 *  junto al ▶ (2026-11-18). Reproduciéndose o bajando: Detener.
 *  @param {Candidate} c @param {DockButton[]} [acts] @returns {Action}
 */
export function playButtons(c, acts = []) {
  const hash = c.info_hash, loading = bgLoads.has(hash), busy = starting.has(hash);
  const pb = playbackOf(hash);
  // Cargando (pasos de Reproducir, metadatos o precarga): Cancelar. Lo bajado queda guardado en Mis magnets.
  if ((busy && (!pb || !PB_LIVE.has(pb.state.kind))) || (pb && PB_STARTING.has(pb.state.kind) && !loading)) {
    return { kind: 'cancel', id: `cat-cancel-${hash}`, text: tr('Cancelar'), title: tr('Cancelar: no se reproduce; lo que ya bajó queda guardado'),
      onclick: (ev) => { ev.currentTarget.disabled = true; cancelPlay(hash, pb); } };
  }
  if (pb && PB_LIVE.has(pb.state.kind) && !loading) {
    return { kind: 'stop', id: `cat-stop-${hash}`, text: tr('Detener'),
      title: pb.stream ? tr('Detener: cierra el reproductor') : tr('Detener: cierra el reproductor y la descarga queda pausada y guardada'),
      onclick: (ev) => { ev.currentTarget.disabled = true; api.playbackAction(pb.id, 'stop').catch(showError); },
      // Mientras se ve (2026-11-18): otro subtítulo, cargado en el mpv abierto (VLC no se puede manejar desde acá).
      subchange: pb.player === 'mpv' && pb.state.kind !== 'ask-after-close' ? { id: `cat-subchange-${hash}`, title: tr('Cambiar subtítulo: elegí otro y se carga en el reproductor sin cortar'),
        onclick: (ev) => openSubs(hash, pb.stream, ev.currentTarget, pb.id) } : null };
  }
  const tb = inTorbox.has(hash);
  return { kind: 'play', id: `cat-play-${hash}`, tone: tb ? 'torbox' : 'accent', state: 'idle',
    // En TorBox (2026-11-17): ▶ verde que late, y reproduce desde sus servidores (al instante, sin P2P).
    label: tb ? tr('Ver ahora desde TorBox') : tr('Ver ahora'),
    title: tb ? tr('Ver ahora desde TorBox: arranca al instante desde sus servidores, sin depender de los seeds') : fits(c) ? tr('Ver ahora') : tr('No entra en el disco: se cortaría a mitad'),
    onclick: (ev) => playOption(hash, ev.currentTarget, tb),
    bg: tb && !loading ? null : { id: `cat-bg-${hash}`, on: loading,
      title: loading ? tr('Cancelar la descarga de fondo: lo bajado queda guardado') : tr('Bajar de fondo: baja sin abrir el reproductor y dice si la velocidad alcanza'),
      onclick: (ev) => toggleBg(hash, ev.currentTarget) },
    dock: acts };
}

/** Cancelar mientras carga (2026-11-18): corta los pasos y, si el núcleo ya arrancó, lo detiene conservando lo bajado.
 *  @param {string} hash @param {PlaybackRow|undefined} pb
 */
function cancelPlay(hash, pb) {
  starting.delete(hash);
  closeWizard();
  if (pb && PB_STARTING.has(pb.state.kind)) api.playbackAction(pb.id, 'stop').catch(showError);
  setStatus('Cancelado.');
  renderStreamsOnly();
}

/** Estado de la reproducción de una opción, en grande (2026-11-16): ícono (o barras que se mueven
 *  si se está viendo), el texto y, si va bajando, la barra de lo bajado.
 *  @param {PlaybackRow|undefined} pb @param {string} text @returns {Mid}
 */
export function statusPill(pb, text) {
  const k = pb?.state.kind ?? 'preparing';
  const progress = pb && !pb.stream && ['playing', 'background', 'paused', 'download-paused'].includes(k) ? pb.progress ?? 0 : null;
  return { kind: 'status', state: k, text: text.charAt(0).toUpperCase() + text.slice(1), progress,
    progressTip: progress == null ? '' : tr('{a} % bajado', { a: Math.floor(progress * 100) }) };
}

/** Qué se sabe de los seeders de una opción (leyenda de la fila): 'deep' = contados al conectarse
 *  (análisis profundo); 'trackers' = chequeados en los trackers al cargar las opciones (lo hace el
 *  núcleo solo, siempre); null = solo lo que dice la fuente. */
export const TRACKERS_TIP = tr('Chequeado recién en los trackers al cargar las opciones: más fiel que lo que dice la fuente.');
/** @param {Candidate} c */
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
  const rows = () => /** @type {HTMLElement[]} */ ([...box.querySelectorAll('.cat-opt[data-hash]')]);
  const before = new Map(rows().map((n) => [n.dataset.hash, { top: n.getBoundingClientRect().top, seeds: n.querySelector('.cat-people')?.textContent, testing: !!n.querySelector('.cat-testing:not(.quick)') }]));
  const prevBest = /** @type {HTMLElement|null} */ (box.querySelector('.cat-opt.best'))?.dataset.hash;
  view.libByHash = new Map();
  for (const e of state.library.values()) {
    const list = view.libByHash.get(e.info_hash);
    if (list) list.push(e); else view.libByHash.set(e.info_hash, [e]);
  }
  view.renderCal = healthCalibration(state.library.values());
  try { renderStreamsBody(box); } finally { view.libByHash = view.renderCal = null; }
  // Las filas son Svelte: se aplican ya, así lo de abajo mide la lista nueva.
  flushOptions();
  const at = `${sideOf()?.videoId}|${view.openRes}`;
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
    // La mejor opción recién encontrada entra con su propia animación (`new-best`), no con la de la lista.
    const firstBest = !prevOrder.has(hash) && n.classList.contains('best');
    if (firstBest) fx.set(`best|${hash}`, now);
    else if (!prevOrder.has(hash)) n.animate([{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'none' }], { duration: 380, delay: Math.min(fresh++, 10) * 35, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'backwards' });
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
    // Las filas quedan entre redibujos (lista con clave, `options-mount.svelte.ts`): la clase del efecto se pone una vez
    // (si el nodo es nuevo, con el corrimiento de lo que ya pasó) y se saca al terminar.
    for (const [kind, target, cls, ms] of /** @type {[string, HTMLElement|null, string, number][]} */ ([['flash', n.querySelector('.cat-people'), 'flash', 900], ['best', n, 'new-best', 1500], ['reveal', n.querySelector('.cat-verdict'), 'reveal', 1000]])) {
      const t = fx.get(`${kind}|${hash}`);
      if (t === undefined || !target) continue;
      if (now - t > ms) { fx.delete(`${kind}|${hash}`); target.classList.remove(cls); target.style.animationDelay = ''; continue; }
      if (target.classList.contains(cls)) continue;
      target.classList.add(cls);
      target.style.animationDelay = `${-(now - t)}ms`;
      // El brillo, la etiqueta y el ▶ arrancan después de la tarjeta: el CSS suma su demora a este corrimiento.
      if (cls === 'new-best') target.style.setProperty('--fx-d', `${-(now - t)}ms`);
    }
  }
}
/** Festejo de un test que dio "Fluida" (2026-11-17): un brillo verde y papelitos que saltan del ícono.
 *  Van en el panel (la lista se recrea en cada redibujo).
 *  @param {HTMLElement} row
 */
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
  const list = /** @type {StreamsUpdate} */ (u).candidates.filter(passesFilters);
  /** @type {Map<string, Candidate[]>} */
  const groups = new Map(RES_ORDER.map((r) => [r, []]));
  for (const c of list) /** @type {Candidate[]} */ (groups.get(resKey(c))).push(c);
  return groups;
}
/** La resolución más baja siguiente que tenga opciones ("Otras" no cuenta: SD o sin dato), o null.
 *  @param {string} res @param {Map<string, Candidate[]>} [groups] @returns {string|null}
 */
export function lowerRes(res, groups = groupsOf()) {
  return RES_ORDER.slice(RES_ORDER.indexOf(res) + 1).find((r) => r !== 'other' && groups.get(r)?.length) ?? null;
}
/** Abre un grupo de resolución (uno a la vez; '' = todos cerrados), sin scroll (2026-11-17).
 *  @param {string} r
 */
export function openGroup(r) {
  view.openRes = r;
  view.shownRows = PAGE_ROWS;
  renderStreamsOnly();
}
/** Todas las opciones sin separar por calidad (TorBox): de 4K a "Otras" y, dentro de cada una, el orden de
 *  `sortOptions` (calidad de imagen y peso).
 *  @param {Candidate[]} cands
 */
export const flatSorted = (cands) => sortOptions(cands).list;
/** La única que se recomienda ("Mejor opción") o se elige sola ("Elegí la mejor"): testeada a fondo,
 *  fluida segura (lo probable no), que entre en el disco y no sea de cine.
 *  @param {Candidate} c @returns {boolean}
 */
export function isSafeBest(c) {
  const h = health(c);
  return counted.get(c.info_hash)?.reached === true && h?.level === 0 && !h.probable && fits(c) && c.source !== 'CAM';
}

/** @param {HTMLElement} box */
export function renderStreamsBody(box) {
  const u = state.update;
  const body = $('#cat-side');
  const scroll = body?.scrollTop ?? 0;
  box.replaceChildren();
  if (u?.done && !u.candidates.length) {
    const anyOk = u.addons.some((a) => a.state === 'ok');
    box.append(el('p', { class: 'pop-empty' }, anyOk ? tr('Ninguna fuente tiene torrents para esto.') : tr('Ninguna fuente respondió. Cerrá y volvé a abrirlo para reintentar.')));
    return;
  }
  // Pasos antes de la lista (2026-11-18): buscando → torrent/TorBox → ¿latino? → calidad.
  const step = flowStep();
  if (step) { box.append(step); if (body) body.scrollTop = scroll; return; }
  const r = /** @type {string} */ (view.openRes);
  const groups = groupsOf(u);
  // Sin paso de calidad (TorBox, "Ver todas las opciones"): una sola lista con todas las calidades, cada fila con la suya.
  const flat = !hasResStep();
  const cands = flat ? [...groups.values()].flat() : /** @type {Candidate[]} */ (groups.get(/** @type {string} */ (r)));
  const n = cands.length;
  const head = optionsHead();
  const f = side().flow;
  // Mientras corre el análisis profundo, el borde de la lista gira (2026-11-16).
  const analyzing = side().deep?.status === 'run';
  box.append(.../** @type {Node[]} */ ([crumbs(), head && el('div', { class: 'cat-sticky' }, head),
    el('section', { class: `cat-group open ${analyzing ? 'analyzing' : ''}`, id: `cat-group-${flat ? 'all' : r}`, 'aria-busy': analyzing ? 'true' : null,
      style: analyzing ? `--group-phase:-${Date.now() % 4000}ms` : null },
    el('div', { class: 'cat-group-head', id: `cat-res-${r}` },
      el('span', { class: 'cat-group-name' }, flat ? tr('Todas las calidades') : resLabel(r)),
      el('span', { class: 'cat-res-count' }, `${n} ${n === 1 ? tr('opción') : tr('opciones')}`)),
    f.latOff ? el('p', { class: 'cat-flow-note inline', role: 'status' }, tr('Sin filtro de latino: se muestran todas.')) : null,
    (() => {
      // Analizando (2026-11-17): solo el panel con su avance y "Detener"; sin filas (eran decenas de
      // animaciones a la vez). Al terminar, el resultado y la lista ya ordenada.
      const gp = flat ? null : groupPanel(r);
      if (!flat && (side().tests.run?.res === r || side().tests.stopping?.res === r)) return gp;
      // Las que todavía se están probando de fondo no se muestran hasta terminar (2026-11-17): se
      // movían y cambiaban sin parar; aparecen ya ordenadas con su resultado.
      const probing = cands.filter((c) => quickRunning.has(c.info_hash) && !quick.has(c.info_hash) && !counting.has(c.info_hash));
      const flatList = flat ? flatSorted(cands) : null;
      const { list: sortedAll, best } = flatList ? { list: flatList, best: flatList.find(isMatch) ?? null } : sortOptions(cands);
      const sorted = probing.length ? sortedAll.filter((c) => !probing.includes(c)) : sortedAll;
      // "Buscar sub ES" de la barra (por torrent; en TorBox lo hace "Seguir buscando"): lee de a una solo hasta
      // encontrar una que sirva (sub ES y, si pidió latino, latino confirmado).
      const wantLat = f.lat && !f.latOff;
      const byHash = new Map(sorted.map((c) => [c.info_hash, c]));
      if (!flat) readUntil(sorted.map((c) => c.info_hash), (h) => hasSpanishSubs(h) === true && (!wantLat || latOf(/** @type {Candidate} */ (byHash.get(h))) === 'lat'));
      // Solo las primeras (2026-11-17): con 150+ filas redibujar todas trababa la compu; las de
      // abajo casi nunca se eligen y siguen probándose igual.
      const rest = sorted.length - view.shownRows;
      if (!n) return [gp, sortRow(), noMatches(/** @type {StreamsUpdate} */ (u).candidates.some((c) => flat || resKey(c) === r)), moreRow()];
      return [gp, sortRow(flat ? null : subsScanChip(sorted)), optionsList('main', sorted.slice(0, view.shownRows).map((c) => rowView(c, c === best))),
        rest > 0 ? el('button', { id: 'cat-more-rows', class: 'cat-more-rows', onclick: () => { view.shownRows += PAGE_ROWS; renderStreamsOnly(); } },
          tr('Mostrar {a} más · quedan {rest}', { a: Math.min(PAGE_ROWS, rest), rest })) : null,
        probing.length ? el('p', { class: 'cat-probing', role: 'status' }, el('span', { class: 'cat-res-spin', 'aria-hidden': 'true' }),
          tr('Probando {n} más de fondo: aparecen acá cuando terminan', { n: probing.length })) : null,
        moreRow(), flat ? null : lowerSuggestion(r, groups)];
    })())].filter(Boolean)));
  if (body) body.scrollTop = scroll;
}

/** Lista vacía (2026-11-18): si la resolución tiene torrents que los filtros esconden, lo dice y ofrece sacarlos;
 *  si no tiene ninguno, no hay nada que destrabar.
 *  @param {boolean} hasCandidates
 */
function noMatches(hasCandidates) {
  if (!hasCandidates) return el('p', { class: 'pop-empty', role: 'status' }, tr('No se encontraron torrents.'));
  return el('p', { class: 'pop-empty', role: 'status' }, tr('No hay opciones con estos filtros. '),
    el('button', { id: 'cat-filters-off', class: 'link', onclick: clearFilters }, tr('Quitar filtros')));
}
/** Quita todos los filtros que limitan la lista (2026-11-18): HDR, latino y TorBox (pasa a torrent, sin filtro).
 *  Antes, con TorBox puesto, el botón no alcanzaba y el mensaje se repetía. */
function clearFilters() {
  view.onlyHdr = false;
  view.onlyEs = false;
  const f = side().flow;
  if (f?.lat) f.latOff = true;
  if (f?.mode === 'torbox') f.mode = 'torrent';
  renderStreamsOnly();
}

/** Al final de la lista (2026-11-17, antes en el panel de arriba): con el test de esa resolución
 *  terminado y ninguna fluida, ofrece la siguiente más baja que tenga opciones.
 *  @param {string} res @param {Map<string, Candidate[]>} groups
 */
export function lowerSuggestion(res, groups) {
  const d = side().deep;
  if (d?.status !== 'done' || d.res !== res) return null;
  if (/** @type {Candidate[]} */ (groups.get(res)).some((c) => counted.get(c.info_hash)?.reached && health(c)?.level === 0)) return null;
  const lower = lowerRes(res, groups);
  if (!lower) return null;
  const fluid = /** @type {Candidate[]} */ (groups.get(lower)).filter((c) => health(c)?.shown === 0).length;
  const go = () => {
    openGroup(lower);
    reanalyze(/** @type {Candidate[]} */ (groups.get(lower)).map((c) => c.info_hash), lower);
  };
  return el('div', { class: 'cat-lower', role: 'status' },
    el('span', { class: 'cat-radar', 'aria-hidden': 'true' }),
    el('span', { class: 'cat-lower-text' }, el('b', {}, tr('Ninguna en {a} va a andar fluida', { a: resLabel(res) })),
      el('span', {}, fluid ? tr('En {a} hay {fluid} que sí: se ven un poco menos nítidas, pero sin cortes.', { a: resLabel(lower), fluid }) : tr('En {a} hay más chances: se ven un poco menos nítidas, pero sin cortes.', { a: resLabel(lower) }))),
    el('button', { id: 'cat-deep-lower', onclick: go }, tr('Ver {a} →', { a: resLabel(lower) })));
}

/** Grupos de resolución (2026-11-15): 4K, 2K, 1080p, 720p y "Otras" (SD y sin dato); la regla está en `$ui/options/row.ts`. */
export const RES_ORDER = RES;
/** @param {Candidate} c @returns {string} */
export const resKey = (c) => resKeyOf(c.resolution);
/** @param {string} r @returns {string} */
export const resLabel = (r) => resLabelOf(r, tr('Otras'));
/** Reproducir: lo agrega a la biblioteca y lo prepara con el flujo de siempre (audio → subtítulos → reproductor).
 *  Se queda en el catálogo (pedido 2026-11-15). `torbox`: se abre con el link de TorBox en vez del motor.
 *  @param {string} hash @param {HTMLButtonElement} btn @param {boolean} [torbox]
 */
export async function playOption(hash, btn, torbox = false) {
  btn.disabled = true;
  starting.set(hash, null);
  /** @type {boolean|undefined} */
  let started = false;
  try {
    notePrediction(hash, evidenceOf(hash));
    const [row] = await api.catalogAdd(side().kind, side().videoId, [hash]);
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
      /** @param {import('./types.js').PlayerKind|null} player @param {{code: string, aid: number|null}|null} audio */
      const start = async (player, audio) => {
        if (!starting.has(hash)) return false;
        if (torbox) {
          setStatus('Pidiéndole el video a TorBox…');
          await api.playTorbox(side().videoId, hash, player, audio);
        } else await api.play(row.key, player, null, audio);
        setStatus('Cargando…');
        return true;
      };
      if (starting.has(hash)) {
        // El audio ya se eligió en los pasos del video: original o latino (si está confirmado en las pistas).
        const lat = side().flow?.lat;
        started = await play(row.key, btn, fresh, originalAudio(side().meta?.country, side().details?.details?.original_language), subsStep(hash, torbox), start,
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

/** Suelta el spinner de ▶ cuando esa reproducción arrancó, falló o se cerró.
 *  @param {PlaybackRow} row
 */
export function onPlaybackRow(row) {
  if (PB_STARTING.has(row.state.kind)) return;
  for (const [hash, key] of starting) if (key === row.key) starting.delete(hash);
}
