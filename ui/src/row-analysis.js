// Estado del análisis de UNA fila de Mis magnets (por info_hash) y qué implica cada estado.
import { state } from './state.js';

/** Fases de la preparación de una medición (`SpeedProgress.phase`) en texto. */
export const PHASE_TEXT = { connecting: 'conectando', metadata: 'buscando metadatos', preload: 'precargando' };

/** Qué significa cada `rowAnalysis(e).kind` para la fila (única fuente; antes eran listas sueltas):
 *  - `busy`: ya se está analizando (en cola, pedido, en pausa…): placeholder `text` en vez de la velocidad.
 *  - `working`: la fila se destaca como "trabajando".
 *  - `canPause`: el botón de la fila es "Pausar análisis".
 *  - `spin`: recién pedido (todavía no en cola): los botones quedan deshabilitados y gira el de
 *    `'quick'` (el primero) o el de `'speed'` (el último).
 *  - `restartQuick`: qué reinicia "Reiniciar análisis" (true = rápido; null = según lo último medido). */
export const ANALYSIS = {
  idle: { busy: false, working: false, canPause: false, spin: null, restartQuick: null, text: null },
  measuring: { busy: false, working: true, canPause: false, spin: null, restartQuick: false, text: null },
  'quick-req': { busy: true, working: true, canPause: false, spin: 'quick', restartQuick: true, text: 'leyendo datos…' },
  prep: { busy: true, working: true, canPause: false, spin: 'speed', restartQuick: false, text: 'preparando…' },
  quick: { busy: true, working: true, canPause: true, spin: null, restartQuick: true, text: 'leyendo datos…' },
  scraping: { busy: true, working: true, canPause: true, spin: null, restartQuick: false, text: 'consultando trackers…' },
  // Texto propio: "en cola #N".
  queued: { busy: true, working: false, canPause: true, spin: null, restartQuick: false, text: null },
  // Tiene su propio botón "Seguir analizando".
  held: { busy: true, working: false, canPause: false, spin: null, restartQuick: false, text: 'en pausa' },
  'paused-all': { busy: true, working: false, canPause: true, spin: null, restartQuick: false, text: 'análisis en pausa' },
};

/** Estado del análisis de UNA fila: `{ kind, live?, prov?, pos? }` (`kind` es una clave de
 *  `ANALYSIS`; `prov` = puntaje provisorio de esta fila que calcula el núcleo mientras mide). */
export function rowAnalysis(e) {
  const h = e.info_hash;
  const s = state.analyzerState;
  if (s.kind === 'measuring' && s.current === h) {
    return { kind: 'measuring', live: s.live, prov: s.provisional.find((p) => p.key === e.key)?.score ?? null };
  }
  if (state.held.has(h)) return { kind: 'held' };
  const pos = state.queued.indexOf(h);
  if (pos >= 0) {
    if (s.kind === 'paused') return { kind: 'paused-all' };
    if (s.kind === 'quick-scan' && !e.live) return { kind: 'quick' };
    if (e.status?.kind === 'scraping') return { kind: 'scraping' };
    return { kind: 'queued', pos: pos + 1 };
  }
  if (e.status?.kind === 'scraping') return { kind: 'scraping' };
  if (state.pending.has(h)) return { kind: state.pending.get(h) === 'quick' ? 'quick-req' : 'prep' };
  return { kind: 'idle' };
}

/** ¿Ya se está analizando (pedido, en cola, pausado o midiéndose)? */
export function isBusy(h) {
  const s = state.analyzerState;
  return state.pending.has(h) || state.queued.includes(h) || state.held.has(h)
    || (s.kind === 'measuring' && s.current === h);
}

/** Qué reinicia el botón de la fila: lo que está corriendo, o lo último que se hizo. */
export function restartIsQuick(e, a) {
  return ANALYSIS[a.kind].restartQuick ?? !(e.live?.avg_speed_bps > 0);
}
