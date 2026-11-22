// @ts-check
// Salud estimada del stream (desktop: depende de `health-calib.js`, la calibración por PC y red). El resto del ranking de
// opciones (audio latino, orden, nivel, Mbps, calidad de imagen) vive en packages/ui/src/rank.ts.
import { MIN_SECS, predict, shownLevel } from './health-calib.js';
import { toMbps, typicalMbps } from '../../packages/ui/src/rank.ts';

/** @typedef {import('./types.js').HealthEvidence} HealthEvidence */
/** @typedef {import('./types.js').HealthCalInput} HealthCalInput */
/** Rango de Mbps de la salud: el de `predict` o, si ya baja, el medido ahora (`'now'`).
 *  @typedef {{ lo: number, p50: number, p75: number, hi: number, conf: 'alta' | 'media' | 'baja', kind: import('./types.js').HealthKind | 'now' }} HealthRange */
/** Veredicto de salud (el resto de lo que lee `verdict`: rango, de dónde sale, nivel). `ev` y `cal` son lo que usó.
 *  @typedef {{ level: number, shown: number, probable: boolean, range: HealthRange, basis: HealthRange['kind'], conf: HealthRange['conf'],
 *    ratio: number, supply: number, need: number, exact: boolean, ev: HealthEvidence | null, cal: HealthCalInput }} Health */

/** Salud del stream (salud fiel, 2026-11-16): un RANGO de Mbps contra lo que pide (tamaño ÷
 *  duración). Lo que baja ahora manda; si no, `predict` (medición del análisis > el p50 más alto entre
 *  seeders contados y de trackers) corregido con lo aprendido en esta red. `level` = nivel del p50
 *  (0 ≥ 2×, 1 ≥ 1×, 2); `shown` sube uno si el p75 alcanza ("probable"). Null sin seeders conocidos,
 *  si nadie respondió al contar, o si solo hay trackers y esta red todavía no aprendió cuánto se
 *  equivocan (< 5 reproducciones: decisión del usuario; queda "Verificar salud"). Quien llama ya descartó
 *  "sin seeders conocidos / nadie respondió". `now` = velocidad medida de lo que baja ahora (`speedOf`).
 *  @param {{ resolution: string | null | undefined, bps: number | null, cal: HealthCalInput, ev: HealthEvidence | null,
 *    now: { n: number, avg: number } | null | undefined, trackerMin: number }} p
 *  @returns {Health | null} */
export function healthOf({ resolution, bps, cal, ev, now, trackerMin }) {
  // Lo que baja ahora (reproduciendo o ⤓, ≥ MIN_SECS) es lo real: manda, sin corregir (B6).
  const nowMbps = now && now.n >= MIN_SECS ? toMbps(now.avg) : null;
  /** @type {HealthRange | null} */
  const r = nowMbps ? { kind: 'now', lo: nowMbps, p50: nowMbps, p75: nowMbps, hi: nowMbps, conf: 'alta' } : ev && predict(ev, cal);
  if (!r || (r.kind === 'tracker' && ev?.counted_seeds == null && !((cal.bias?.tracker?.nEff ?? 0) >= trackerMin))) return null;
  const need = ev?.need_mbps ?? (bps ? toMbps(bps) : typicalMbps(resolution));
  // shownLevel solo lee p50, p75 y conf: `kind` ('now') le da igual.
  return { ...shownLevel(/** @type {import('./types.js').HealthRange} */ (r), need), range: r, basis: r.kind, conf: r.conf, ratio: r.p50 / need, supply: r.p50, need, exact: !!bps, ev, cal };
}
