// @ts-check
// Lógica pura del ranking de opciones (separada de `catalog-options.js`, 2026-11-22): audio latino, orden, nivel,
// Mbps que pide una opción, salud y calidad de imagen. Sin DOM ni estado global: lo que antes se leía de `state` /
// `rowsOf` / `counted` llega por parámetro (los envoltorios de `catalog-options.js` lo arman).

import { MIN_SECS, predict, shownLevel } from './health-calib.js';

/** @typedef {{ info_hash: string, release_name: string, file_name?: string | null, audio: string[], source?: string | null, resolution?: string | null }} RankCandidate */
/** @typedef {{ live?: { audio?: unknown[] | null, duration_secs?: number | null } | null, languages?: { code: string }[] | null }} RankRow */
/** @typedef {'lat' | 'likely' | 'spain' | 'check' | 'none'} LatState */
/** @typedef {{ reached?: boolean, peers?: number }} CountedEntry */

// Webs de origen dentro del nombre: solo orientan, no confirman (como la web, streamonte-web/src/lib/server/torrents.js).
const LAT_SITES = ['cinecalidad', 'verpeliculasonline', 'pelisplus', 'cuevana', 'pelispanda', 'pelismart'];
const SPAIN_SITES = ['mejortorrent', 'wolfmax4k', 'dontorrent', 'divxtotal', 'elitetorrent'];

/** Estado del audio latino (2026-11-21, única regla, igual que `latStatus` de la web):
 *  - Las pistas leídas ganan cuando dicen cuál español es (latino, castellano) o que no hay español.
 *  - Español sin variante no decide: decide el nombre (LATINO / banderas latinas o castellano) y, si no, la web.
 *  'lat' latino · 'likely' solo la web de origen es latina · 'spain' de España · 'check' no se sabe: probar a mano ·
 *  'none' leído y sin español. `rows` = filas de la biblioteca de ese torrent.
 *  @param {RankCandidate} c
 *  @param {RankRow[]} rows
 *  @returns {LatState} */
export function latOf(c, rows) {
  const read = rows.find((e) => e.live?.audio?.length);
  const codes = read?.languages?.map((l) => l.code) ?? [];
  if (codes.includes('lat')) return 'lat';
  if (codes.includes('cast')) return 'spain';
  if (read && !codes.includes('es')) return 'none';
  if (c.audio.includes('lat')) return 'lat';
  if (c.audio.includes('cast')) return 'spain';
  const name = `${c.release_name} ${c.file_name ?? ''}`.toLowerCase();
  if (LAT_SITES.some((w) => name.includes(w))) return 'likely';
  if (SPAIN_SITES.some((w) => name.includes(w))) return 'spain';
  return 'check';
}

/** Grupo para ordenar: 2 = analizado a fondo (arriba), 1 = el resto (trackers, fuente o una
 *  medición vieja de la biblioteca), 0,5 = sin respuesta pero con peers conocidos (no está muerto,
 *  2026-11-16), 0 = nadie lo comparte. `n` = lo contado de ese torrent (undefined si no se contó).
 *  @param {CountedEntry | undefined} n
 *  @returns {number} */
export function tierOf(n) {
  return !n ? 1 : n.reached !== false ? 2 : n.peers ? 0.5 : 0;
}

/** Mbps típicos por resolución (2026-11-16) cuando no se sabe cuánto pide (pack sin analizar): un
 *  4K web anda en 15–25, un 1080p en 5–10. Mejor una estimación que solo contar seeders.
 *  @type {Record<string, number>} */
export const TYPICAL_MBPS = { '2160p': 25, '1440p': 14, '1080p': 8, '720p': 4 };
/** @param {number} bps @returns {number} */
export const toMbps = (bps) => (bps * 8) / 1e6;
/** Mbps típicos de una resolución (3 si no se conoce).
 *  @param {string | null | undefined} resolution @returns {number} */
export const typicalMbps = (resolution) => (resolution ? TYPICAL_MBPS[resolution] : undefined) ?? 3;

/** Bytes/s que hay que bajar sostenidos para verlo sin cortes = archivo ÷ duración (la real si se
 *  analizó, si no la de la ficha). `null` sin alguno de los dos. `entry` = fila de la biblioteca que lo midió;
 *  `runtimeMin` = duración de la ficha en minutos; `bytes` = peso del archivo que se ve.
 *  @param {number | null} bytes
 *  @param {RankRow | undefined} entry
 *  @param {number | null | undefined} runtimeMin
 *  @returns {number | null} */
export function neededBps(bytes, entry, runtimeMin) {
  const secs = entry?.live?.duration_secs ?? (runtimeMin ? runtimeMin * 60 : undefined);
  return bytes && secs ? bytes / secs : null;
}

/** Mbps que pide una opción para verse sin cortes: peso ÷ duración; sin dato, lo típico de su resolución.
 *  @param {string | null | undefined} resolution
 *  @param {number | null} bps
 *  @returns {number} */
export const mbpsOf = (resolution, bps) => (bps ? toMbps(bps) : typicalMbps(resolution));

/** Calidad de imagen por la fuente del release: estrellas de 4 (los textos están en `QUALITY`, `catalog-options.js`).
 *  @type {Record<string, number>} */
export const QUALITY_STARS = { REMUX: 4, BluRay: 3, 'WEB-DL': 2, WEBRip: 2, HDTV: 1, DVDRip: 1, CAM: 1 };
/** Para "Mejor imagen": las estrellas; sin dato, entre Streaming y Blu-ray; la de cine, la última.
 *  @param {{ source?: string | null }} c
 *  @returns {number} */
export const qualityRank = (c) => (c.source === 'CAM' ? 0 : (c.source ? QUALITY_STARS[c.source] : undefined) ?? 2.5);

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

/** Lo que `rankOptions` lee del mundo (todo por función, para no tocar estado global).
 *  @template C
 *  @typedef {{
 *    torbox: boolean,
 *    mode: 'quality' | 'fast',
 *    health: (c: C) => Health | null,
 *    fits: (c: C) => boolean,
 *    tierOf: (c: C) => number,
 *    reached: (c: C) => boolean | undefined,
 *    knownSeeds: (c: C) => number | null,
 *    leechersOf: (c: C) => number | null,
 *    quickGroup: (c: C) => number,
 *    advancing: (c: C) => { seeds: number } | null,
 *    mbpsOf: (c: C) => number,
 *    isMatch: (c: C) => boolean,
 *    pinPlaying: (list: C[]) => C[],
 *  }} RankEnv */

/** Orden de las opciones (2026-11-17), recalculado en cada redibujo. Antes del test manda la
 *  conexión: el veredicto de salud y, sin veredicto, la gente que comparte (seeds, después leechers).
 *  "Mejor imagen": arriba las testeadas que andan fluidas, por calidad de imagen (ya se sabe que van a
 *  cargar bien); después todo lo demás por conexión. "Arranca más rápido": todo por conexión. Al final,
 *  siempre: las que no entran en el disco y las que nadie respondió. El peso nunca ordena. Arriba de
 *  todo va lo que se reproduce o baja. `best` = la primera que entra, no es de cine y anda fluida (la
 *  fila confirma que esté testeada).
 *  @template {RankCandidate & { size_bytes?: number | null }} C
 *  @param {C[]} cands
 *  @param {RankEnv<C>} env
 *  @returns {{ list: C[], best: C | null }} */
export function rankOptions(cands, env) {
  const { health, fits, tierOf: tier, reached, knownSeeds, leechersOf, quickGroup, advancing, mode } = env;
  // TorBox (2026-11-17): se ven desde sus servidores, así que seeds y salud no importan.
  if (env.torbox) {
    // Por bitrate (2026-11-18): más Mbps = más imagen por segundo; la resolución sola no dice cuánto se comprimió. A
    // igual bitrate, la de mejor calidad de imagen; la de cine al final.
    // Sin peso no se sabe cuánto pide: al final, como la de cine (2026-11-18: salía "Mejor opción" sin tamaño).
    /** @param {C} c */
    const unknown = (c) => Number(c.size_bytes == null || c.source === 'CAM');
    const list = [...cands].sort((a, b) => unknown(a) - unknown(b) || env.mbpsOf(b) - env.mbpsOf(a) || qualityRank(b) - qualityRank(a));
    return { list: env.pinPlaying(list), best: list.find(env.isMatch) ?? null };
  }
  /** @type {Map<C, number>} */
  const lvl = new Map(cands.map((c) => { const h = health(c); return [c, h ? h.shown + (h.probable ? 0.5 : 0) : 1.75]; }));
  /** @param {C} c @returns {number} */
  const level = (c) => /** @type {number} */ (lvl.get(c));
  /** @param {C} a @param {C} b */
  const byConnection = (a, b) => level(a) - level(b) || (knownSeeds(b) ?? -1) - (knownSeeds(a) ?? -1) || (leechersOf(b) ?? -1) - (leechersOf(a) ?? -1);
  /** @param {C} c */
  const tail = (c) => (tier(c) < 1 ? 3 : !fits(c) ? 2 : 0);
  /** @param {C} c */
  const proven = (c) => reached(c) && level(c) === 0;
  // Antes del test profundo (y debajo de las probadas a fondo) manda la prueba rápida: seeds reales.
  // Prueba en curso que ya pasó a contar seeds reales (etapa 2/2): arriba de todo mientras dura,
  // con más seeds primero (2026-11-17). Al terminar vuelve a su lugar por el resultado.
  /** @param {C} c */
  const group = (c) => (advancing(c) ? -1 : tail(c) ? 10 + tail(c) : mode === 'quality' && proven(c) ? 0 : 1 + quickGroup(c));
  const list = [...cands].sort((a, b) => group(a) - group(b)
    || (group(a) === -1 ? /** @type {{ seeds: number }} */ (advancing(b)).seeds - /** @type {{ seeds: number }} */ (advancing(a)).seeds : 0)
    || (mode === 'quality' && group(a) === 0 ? qualityRank(b) - qualityRank(a) : 0)
    || byConnection(a, b));
  const best = list.find((c) => fits(c) && c.source !== 'CAM' && level(c) === 0) ?? null;
  return { list: env.pinPlaying(list), best };
}
