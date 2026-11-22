// @ts-check
// Subtítulos de una opción (2026-11-18, docs/mockups/subs-dropdown/ELEGIDA.md): el paso "Subtítulos" del panel de
// Reproducir (`openWizard`). Son de cada torrent: nada se busca antes de que el usuario los pida, al reproducir, con
// clic derecho → Subtítulos… o con "Cambiar subtítulo" mientras se ve (se carga en el mpv abierto).
// Acá queda la LECTURA de pistas del video (qué trae en español, "Buscar sub ES") y los gestos del panel; lo que se ve
// (los que trae el video + buscar afuera + Premium con cuota) es `SubsStep.svelte` sobre `SubsPicker` de packages/ui.
// Clic en "Usar" = ese subtítulo al reproducir esa opción (o, con `live`, cargado en el mpv abierto).

import { api } from './api.js';
import { openSettings } from './dialogs.js';
import { el, setStatus } from './dom.js';
import { t as tr } from './i18n.js';
import { closeWizard, openWizard } from './audio-picker.js';
import { rowsOf } from './catalog-options.ts';
import { quickAnalyze, side, sideOf } from './catalog-tests.ts';
import { showError } from './catalog-state.js';
import { mountSubsStep } from './mount-shared.ts';

/** @typedef {import('./dom.js').ElChild} ElChild */
/** Lo de una opción en el paso de subtítulos (ver `byHash`). `read`: lectura de sus pistas.
 *  @typedef {{read: 'reading'|'done'|'failed'|'skipped'|null, error: string|null, torbox: boolean, asked: boolean}} HashSubs */
/** El paso abierto: `next` sigue con Reproducir; `live` es el id de la reproducción donde se carga lo elegido.
 *  @typedef {{hash: string, next: ((value?: unknown) => void)|null, live: number|null}} Active */
/** "Buscar sub ES" del video: null | 'running' | 'paused' | 'found' | 'none'. @typedef {null|'running'|'paused'|'found'|'none'} ScanState */

/** Por opción (info hash) del video abierto. Se vacía al cambiar de video. @type {Map<string, HashSubs>} */
const byHash = new Map();
/** El paso dibujado por opción (se reusa: Svelte sigue montado cuando el panel se redibuja). @type {Map<string, {host: HTMLElement, unmount: () => void}>} */
const steps = new Map();
/** @type {string|null|undefined} */
let forVideo = null;
/** Progreso de la búsqueda por video, que `catalog.js` sigue guardando; lo que se ve lo toma `SubsPicker` del evento.
 *  shortcut: sin lectores acá, se borra cuando `catalog.js` deje de escribirlo. @type {Map<string, {downloading: boolean, done: number, total: number}>} */
export const subsProgress = new Map();
/** El paso abierto: {hash, next (Reproducir: seguir), live (id de la reproducción: cargarlo en mpv)}. @type {Active|null} */
let active = null;
/** Avisa al panel que redibuje el paso (lo que muestra cambió). */
const changed = () => document.dispatchEvent(new Event('subs-changed'));

/** Lo que tarda como mucho la lectura corta de las pistas por el enjambre (como "Buscar LAT"); se puede cortar. */
const READ_WAIT_MS = 120_000;
/** Lo que se espera a que llegue la fila actualizada después de leerlas por TorBox. */
const ROW_WAIT_MS = 3_000;
/** @param {string} hash @returns {HashSubs} */
function subsOf(hash) {
  if (forVideo !== sideOf()?.videoId) {
    byHash.clear();
    for (const s of steps.values()) s.unmount();
    steps.clear();
    forVideo = sideOf()?.videoId;
  }
  return byHash.get(hash) ?? /** @type {HashSubs} */ (byHash.set(hash, { read: null, error: null, torbox: false, asked: false }).get(hash));
}
/** Los en español que trae esa opción; `null` = todavía no se leyeron sus pistas. */
/** @param {string} hash */
const natives = (hash) => rowsOf(hash).find((e) => e.native_subs)?.native_subs ?? null;
/** @param {number} ms */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Lee las pistas (audio y subtítulos) de la opción de donde se va a ver, si todavía no se leyeron: `torbox` = su
 *  link de TorBox (el video ya está en sus servidores); si no, la lectura corta del enjambre. Termina siempre: leídas,
 *  falló o se cortó ("No esperar"). Lo usan el paso de audio (TorBox) y el de subtítulos. */
/** @param {string} hash @param {boolean} torbox @returns {Promise<void>} */
export async function readTracks(hash, torbox) {
  const s = subsOf(hash);
  if (natives(hash) != null || s.read) return;
  s.read = 'reading';
  s.torbox = torbox;
  changed();
  s.error = null;
  let wait = READ_WAIT_MS;
  if (torbox) {
    try { await api.catalogTorboxTracks(side().kind, side().videoId, hash); wait = ROW_WAIT_MS; } catch (e) { s.error = /** @type {Partial<import('./types.js').UiError>|null} */ (e)?.message ?? String(e); wait = 0; }
  } else quickAnalyze([hash]);
  for (const end = Date.now() + wait; natives(hash) == null && Date.now() < end && s.read === 'reading';) await sleep(250);
  // Sin leer (falló, se pasó el tiempo o "No esperar"): no se reintenta solo; el botón de la fila dice por qué.
  const skipped = /** @type {HashSubs['read']} */ (s.read) === 'skipped';
  s.read = natives(hash) != null ? 'done' : skipped ? null : 'failed';
  if (s.read === 'failed' && !s.error) s.error = torbox ? tr('TorBox no devolvió sus pistas a tiempo') : tr('Nadie compartió el comienzo del video a tiempo (pocos seeds)');
  changed();
}

/** "Buscar sub ES" (2026-11-18, lista por torrent; en TorBox lo hace la búsqueda del mejor match): lee de a una, en el
 *  orden de la lista y por el enjambre, solo hasta encontrar una que sirva (`satisfied`: sub ES y, si se pidió, latino
 *  confirmado); saltea las que fallan y se pausa con el mismo botón (`toggleSubsScan`). Lo leído queda guardado por
 *  torrent. */
/** @type {{video: string|null|undefined, busy: boolean, manual: ScanState}} */
let auto = { video: null, busy: false, manual: null };
/** @param {string} hash */
export const isReading = (hash) => subsOf(hash).read === 'reading';
/** Por qué no se pudo leer esa opción, o null. */
/** @param {string} hash @returns {string|null} */
export const readError = (hash) => (subsOf(hash).read === 'failed' ? subsOf(hash).error : null);
const forVideo$ = () => { if (auto.video !== sideOf()?.videoId) auto = { video: sideOf()?.videoId, busy: false, manual: null }; return auto; };
/** Estado de "Buscar sub ES" del video: null | 'running' | 'paused' | 'found' | 'none'. */
/** @returns {ScanState} */
export const subsScan = () => forVideo$().manual;
export function toggleSubsScan() {
  const a = forVideo$();
  a.manual = a.manual === 'running' ? 'paused' : 'running';
  changed();
}
/** @param {string[]} hashes @param {(hash: string) => boolean} satisfied */
export function readUntil(hashes, satisfied) {
  const a = forVideo$();
  if (a.manual !== 'running') return;
  if (hashes.some(satisfied)) { a.manual = 'found'; changed(); return; }
  if (a.busy) return;
  const next = hashes.find((h) => natives(h) == null && !subsOf(h).read);
  if (!next) { a.manual = 'none'; changed(); return; }
  a.busy = true;
  readTracks(next, false).then(() => {
    a.busy = false;
    changed();
  });
}
/** El botón de la fila: lee esa opción (también si una lectura anterior falló). */
/** @param {string} hash @param {boolean} [torbox] */
export function readSubsNow(hash, torbox = true) {
  const s = subsOf(hash);
  if (s.read === 'failed') s.read = null;
  readTracks(hash, torbox);
}
/** Corta la espera de una lectura (el botón de la fila, otro clic): queda como no leída y se puede volver a pedir. */
/** @param {string} hash */
export function stopReading(hash) {
  const s = subsOf(hash);
  if (s.read === 'reading') s.read = 'skipped';
}

/** Usar una pista que trae el video: al reproducir esta opción (y, si Reproducir lo esperaba, sigue) o, mientras se ve, ya en el mpv abierto. */
/** @param {string} hash @param {string} key */
async function useNative(hash, key) {
  const step = active;
  try {
    if (step?.live) {
      await api.playbackSubtitle(step.live, key, null);
      setStatus(tr('Subtítulo cambiado en el reproductor.'));
      return closeWizard();
    }
    await api.catalogSubtitleUse(side().videoId, hash, key);
    setStatus(tr('Listo: se usa ese subtítulo al reproducir.'));
    step?.next?.(true);
  } catch (e) { showError(e); }
}

/** Se eligió uno de afuera (el núcleo ya lo dejó elegido; Premium, ya bajado): con `live`, se carga en el mpv abierto. */
/** @param {import('../../packages/ui/src/types.ts').SubtitleOption} sub @param {import('../../packages/ui/src/api.ts').SubtitleFile} file */
async function usedFound(sub, file) {
  const step = active;
  try {
    if (step?.live) {
      await api.playbackSubtitle(step.live, sub.id, file.path ?? sub.path ?? null);
      setStatus(tr('Subtítulo cambiado en el reproductor.'));
      return closeWizard();
    }
    setStatus(sub.premium ? tr('Bajado: se usa ese subtítulo al reproducir.') : tr('Listo: se usa ese subtítulo al reproducir.'));
    step?.next?.(true);
  } catch (e) { showError(e); }
}

/** Copia uno ya bajado a Descargas (`<título> (subtítulos)`) y abre la carpeta. */
/** @param {import('../../packages/ui/src/types.ts').SubtitleOption} sub */
async function saveSub(sub) {
  const [, s, e] = (side().videoId ?? '').split(':');
  const title = `${side().name ?? tr('Video')}${s ? ` S${s.padStart(2, '0')}E${e.padStart(2, '0')}` : ''}`;
  try {
    await api.saveSubtitles(title, [{ path: sub.path ?? '', name: `ES - ${sub.release}` }]);
    setStatus(tr('Subtítulo guardado en Descargas.'));
  } catch (err) { showError(err); }
}

/** El paso de una opción, montado una vez. @param {string} hash @param {boolean} playing */
function stepOf(hash, playing) {
  const s = subsOf(hash);
  const key = `${hash}|${playing}`;
  const hit = steps.get(key);
  if (hit) return hit.host;
  const host = el('div', { class: 'subs-step-host' });
  const unmount = mountSubsStep(host, {
    hash, playing,
    ref: { kind: side().kind === 'series' ? 'tv' : 'movie', videoId: side().videoId },
    read: () => ({ reading: s.read, torbox: s.torbox, natives: natives(hash) }),
    onNoWait: () => { s.read = 'skipped'; },
    onSkip: () => active?.next?.(true),
    onUseNative: (/** @type {string} */ k) => useNative(hash, k),
    onUse: usedFound,
    onSave: (/** @type {import('../../packages/ui/src/types.ts').SubtitleOption} */ sub) => void saveSub(sub),
    onSettings: async () => { closeWizard(); await openSettings(); document.getElementById('set-subs')?.scrollIntoView({ block: 'center' }); }
  });
  steps.set(key, { host, unmount });
  return host;
}

/** El paso "Subtítulos" de una opción para el panel de Reproducir: `render(next)`. `torbox`: se ve por TorBox (las
 *  pistas se leen de ahí); `live`: id de la reproducción en curso (lo elegido se carga en su mpv). */
/** @param {string} hash @param {boolean} torbox @param {number|null} [live] @returns {(next: ((value?: unknown) => void)|null) => ElChild} */
export function subsStep(hash, torbox, live = null) {
  return (next) => {
    active = { hash, next: live ? null : next, live };
    const s = subsOf(hash);
    // Una sola vez: si se cortó con "No esperar", redibujar el panel no vuelve a leer.
    if (!s.asked) { s.asked = true; void readTracks(hash, torbox); }
    return stepOf(hash, !!next && !live);
  };
}

/** Clic derecho → Subtítulos… (sin reproducir) o "Cambiar subtítulo" mientras se ve (`live`): el mismo panel, solo
 *  con este paso. */
/** @param {string} hash @param {boolean} torbox @param {HTMLElement} anchor @param {number|null} [live] */
export function openSubs(hash, torbox, anchor, live = null) {
  const s = subsStep(hash, torbox, live);
  openWizard(anchor, [{ id: 'subs', title: live ? tr('Cambiar subtítulo') : tr('Subtítulos'), render: () => s(null) }]).then(() => { active = null; });
}
