// Subtítulos de una opción (2026-11-18, docs/mockups/subs-dropdown/ELEGIDA.md): el paso "Subtítulos" del panel de
// Reproducir (`openWizard`). Son de cada torrent: nada se busca antes de que el usuario los pida, al reproducir, con
// clic derecho → Subtítulos… o con "Cambiar subtítulo" mientras se ve (se carga en el mpv abierto).
// Acá queda la LECTURA de pistas del video (qué trae en español, "Buscar sub ES") y los gestos del panel; lo que se ve
// (los que trae el video + buscar afuera + Premium con cuota) es `SubsStep.svelte` sobre `SubsPicker` de packages/ui.
// Clic en "Usar" = ese subtítulo al reproducir esa opción (o, con `live`, cargado en el mpv abierto).

import * as core from './core.ts';
import { openSettings } from './dialog-flows.ts';
import { el, setStatus, type ElChild } from './dom.ts';
import { t as tr } from './i18n.ts';
import { closeWizard, openWizard } from './audio-picker.ts';
import { rowsOf } from './catalog-options.ts';
import { quickAnalyze, side, sideOf } from './catalog-tests.ts';
import { showError } from './catalog-state.ts';
import { mountSubsStep } from './mount-shared.ts';
import type { SubtitleOption } from '../../packages/ui/src/types.ts';
import type { SubtitleFile } from '../../packages/ui/src/api.ts';
import type { UiError } from './types.ts';

/** Lo de una opción en el paso de subtítulos (ver `byHash`). `read`: lectura de sus pistas. */
type HashSubs = { read: 'reading' | 'done' | 'failed' | 'skipped' | null; error: string | null; torbox: boolean; asked: boolean };
/** El paso abierto: `next` sigue con Reproducir; `live` es el id de la reproducción donde se carga lo elegido. */
type Active = { hash: string; next: ((value?: unknown) => void) | null; live: number | null };
/** "Buscar sub ES" del video: null | 'running' | 'paused' | 'found' | 'none'. */
type ScanState = null | 'running' | 'paused' | 'found' | 'none';

/** Por opción (info hash) del video abierto. Se vacía al cambiar de video. */
const byHash = new Map<string, HashSubs>();
/** El paso dibujado por opción (se reusa: Svelte sigue montado cuando el panel se redibuja). */
const steps = new Map<string, { host: HTMLElement; unmount: () => void }>();
let forVideo: string | null | undefined = null;
/** Progreso de la búsqueda por video, que `catalog.js` sigue guardando; lo que se ve lo toma `SubsPicker` del evento.
 *  shortcut: sin lectores acá, se borra cuando `catalog.ts` deje de escribirlo. */
export const subsProgress = new Map<string, { downloading: boolean; done: number; total: number }>();
/** El paso abierto: {hash, next (Reproducir: seguir), live (id de la reproducción: cargarlo en mpv)}. */
let active: Active | null = null;
/** Avisa al panel que redibuje el paso (lo que muestra cambió). */
const changed = () => document.dispatchEvent(new Event('subs-changed'));

/** Lo que tarda como mucho la lectura corta de las pistas por el enjambre (como "Buscar LAT"); se puede cortar. */
const READ_WAIT_MS = 120_000;
/** Lo que se espera a que llegue la fila actualizada después de leerlas por TorBox. */
const ROW_WAIT_MS = 3_000;
function subsOf(hash: string): HashSubs {
  if (forVideo !== sideOf()?.videoId) {
    byHash.clear();
    for (const s of steps.values()) s.unmount();
    steps.clear();
    forVideo = sideOf()?.videoId;
  }
  return byHash.get(hash) ?? (byHash.set(hash, { read: null, error: null, torbox: false, asked: false }).get(hash) as HashSubs);
}
/** Los en español que trae esa opción; `null` = todavía no se leyeron sus pistas. */
const natives = (hash: string) => rowsOf(hash).find((e) => e.native_subs)?.native_subs ?? null;
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Lee las pistas (audio y subtítulos) de la opción de donde se va a ver, si todavía no se leyeron: `torbox` = su
 *  link de TorBox (el video ya está en sus servidores); si no, la lectura corta del enjambre. Termina siempre: leídas,
 *  falló o se cortó ("No esperar"). Lo usan el paso de audio (TorBox) y el de subtítulos. */
export async function readTracks(hash: string, torbox: boolean): Promise<void> {
  const s = subsOf(hash);
  if (natives(hash) != null || s.read) return;
  s.read = 'reading';
  s.torbox = torbox;
  changed();
  s.error = null;
  let wait = READ_WAIT_MS;
  if (torbox) {
    try { await core.catalogTorboxTracks(side().kind, side().videoId as string, hash); wait = ROW_WAIT_MS; } catch (e) { s.error = (e as Partial<UiError> | null)?.message ?? String(e); wait = 0; }
  } else quickAnalyze([hash]);
  for (const end = Date.now() + wait; natives(hash) == null && Date.now() < end && s.read === 'reading';) await sleep(250);
  // Sin leer (falló, se pasó el tiempo o "No esperar"): no se reintenta solo; el botón de la fila dice por qué.
  const skipped = (s.read as HashSubs['read']) === 'skipped';
  s.read = natives(hash) != null ? 'done' : skipped ? null : 'failed';
  if (s.read === 'failed' && !s.error) s.error = torbox ? tr('TorBox no devolvió sus pistas a tiempo') : tr('Nadie compartió el comienzo del video a tiempo (pocos seeds)');
  changed();
}

/** "Buscar sub ES" (2026-11-18, lista por torrent; en TorBox lo hace la búsqueda del mejor match): lee de a una, en el
 *  orden de la lista y por el enjambre, solo hasta encontrar una que sirva (`satisfied`: sub ES y, si se pidió, latino
 *  confirmado); saltea las que fallan y se pausa con el mismo botón (`toggleSubsScan`). Lo leído queda guardado por
 *  torrent. */
let auto: { video: string | null | undefined; busy: boolean; manual: ScanState } = { video: null, busy: false, manual: null };
export const isReading = (hash: string): boolean => subsOf(hash).read === 'reading';
/** Por qué no se pudo leer esa opción, o null. */
export const readError = (hash: string): string | null => (subsOf(hash).read === 'failed' ? subsOf(hash).error : null);
const forVideo$ = (): typeof auto => { if (auto.video !== sideOf()?.videoId) auto = { video: sideOf()?.videoId, busy: false, manual: null }; return auto; };
/** Estado de "Buscar sub ES" del video: null | 'running' | 'paused' | 'found' | 'none'. */
export const subsScan = (): ScanState => forVideo$().manual;
export function toggleSubsScan(): void {
  const a = forVideo$();
  a.manual = a.manual === 'running' ? 'paused' : 'running';
  changed();
}
export function readUntil(hashes: string[], satisfied: (hash: string) => boolean): void {
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
export function readSubsNow(hash: string, torbox = true): void {
  const s = subsOf(hash);
  if (s.read === 'failed') s.read = null;
  readTracks(hash, torbox);
}
/** Corta la espera de una lectura (el botón de la fila, otro clic): queda como no leída y se puede volver a pedir. */
export function stopReading(hash: string): void {
  const s = subsOf(hash);
  if (s.read === 'reading') s.read = 'skipped';
}

/** Usar una pista que trae el video: al reproducir esta opción (y, si Reproducir lo esperaba, sigue) o, mientras se ve, ya en el mpv abierto. */
async function useNative(hash: string, key: string): Promise<void> {
  const step = active;
  try {
    if (step?.live) {
      await core.playbackSubtitle(step.live, key, null);
      setStatus(tr('Subtítulo cambiado en el reproductor.'));
      return closeWizard();
    }
    await core.catalogSubtitleUse(side().videoId as string, hash, key);
    setStatus(tr('Listo: se usa ese subtítulo al reproducir.'));
    step?.next?.(true);
  } catch (e) { showError(e); }
}

/** Se eligió uno de afuera (el núcleo ya lo dejó elegido; Premium, ya bajado): con `live`, se carga en el mpv abierto. */
async function usedFound(sub: SubtitleOption, file: SubtitleFile): Promise<void> {
  const step = active;
  try {
    if (step?.live) {
      await core.playbackSubtitle(step.live, sub.id, file.path ?? sub.path ?? null);
      setStatus(tr('Subtítulo cambiado en el reproductor.'));
      return closeWizard();
    }
    setStatus(sub.premium ? tr('Bajado: se usa ese subtítulo al reproducir.') : tr('Listo: se usa ese subtítulo al reproducir.'));
    step?.next?.(true);
  } catch (e) { showError(e); }
}

/** Copia uno ya bajado a Descargas (`<título> (subtítulos)`) y abre la carpeta. */
async function saveSub(sub: SubtitleOption): Promise<void> {
  const [, s, e] = (side().videoId ?? '').split(':');
  const title = `${side().name ?? tr('Video')}${s ? ` S${s.padStart(2, '0')}E${e.padStart(2, '0')}` : ''}`;
  try {
    await core.saveSubtitles(title, [{ path: sub.path ?? '', name: `ES - ${sub.release}` }]);
    setStatus(tr('Subtítulo guardado en Descargas.'));
  } catch (err) { showError(err); }
}

/** El paso de una opción, montado una vez. */
function stepOf(hash: string, playing: boolean): HTMLElement {
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
    onUseNative: (k: string) => useNative(hash, k),
    onUse: usedFound,
    onSave: (sub: SubtitleOption) => void saveSub(sub),
    onSettings: async () => { closeWizard(); await openSettings(); document.getElementById('set-subs')?.scrollIntoView({ block: 'center' }); }
  });
  steps.set(key, { host, unmount });
  return host;
}

/** El paso "Subtítulos" de una opción para el panel de Reproducir: `render(next)`. `torbox`: se ve por TorBox (las
 *  pistas se leen de ahí); `live`: id de la reproducción en curso (lo elegido se carga en su mpv). */
export function subsStep(hash: string, torbox: boolean, live: number | null = null): (next: ((value?: unknown) => void) | null) => ElChild {
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
export function openSubs(hash: string, torbox: boolean, anchor: HTMLElement, live: number | null = null): void {
  const s = subsStep(hash, torbox, live);
  openWizard(anchor, [{ id: 'subs', title: live ? tr('Cambiar subtítulo') : tr('Subtítulos'), render: () => s(null) }]).then(() => { active = null; });
}
