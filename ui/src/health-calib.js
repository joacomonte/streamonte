// @ts-check
// Calibración de la "salud estimada" del catálogo (2026-11-15), por PC y por red: el techo de su
// conexión y, desde 2026-11-16, el sesgo análisis → reproducción: lo que bajó de verdad en los
// minutos 2–5 de cada reproducción ÷ lo que predijo el análisis (trackers, seeders contados o
// medición), aprendido por evidencia y por red (spec 04). En localStorage va lo medido y lo que
// eligió el usuario en Ajustes: un valor fijo o "ignorar mediciones anteriores a" (Restablecer).
// Cada cambio avisa con `health-calib-changed`.

/** @typedef {import('./types.js').HealthEvidence} HealthEvidence */
/** @typedef {import('./types.js').HealthMeasurement} HealthMeasurement */
/** @typedef {import('./types.js').HealthSample} HealthSample */
/** @typedef {import('./types.js').HealthKind} HealthKind */
/** @typedef {import('./types.js').HealthBias} HealthBias */
/** @typedef {import('./types.js').HealthCalInput} HealthCalInput */
/** @typedef {import('./types.js').HealthRange} HealthRange */
/** @typedef {import('./types.js').LibraryRow} LibraryRow */
/** @typedef {{before:number, after:number, hit:boolean, pess:boolean, opt:boolean, inBand:boolean}} FidRow */
/** Lo guardado en localStorage. @typedef {{since?:number, seedMbps?:number, bg?:Record<string, HealthMeasurement>,
 *   pred?:Record<string, HealthEvidence & {at:string}>, net?:Record<string, {open:boolean, at:string}>}} HealthStore */
/** Reproducción que se está midiendo. @typedef {{id:number, name:string, sum:number, n:number, max:number, speeds:number[],
 *   win:number[][], incoming:number, ev:HealthEvidence|undefined, source?:string, done?:boolean, active?:boolean}} Tracked */

/** Aporte por seeder sin mediciones suficientes: conservador (un seeder casero sube ~10–20 Mbps
 *  repartidos en 4–6 conexiones). La única medición real al escribirlo dio ~26 (seedboxes). */
export const DEFAULT_SEED_MBPS = 3;
/** Mediciones mínimas para confiar en lo medido (por debajo: el default y sin tope). */
export const MIN_SAMPLES = 3;
/** Reproducciones (nEff) para mostrar salud estimada solo con seeders de trackers. */
export const TRACKER_MIN = 5;
/** Segundos de descarga para que una medición cuente: menos es más arranque que velocidad sostenida. */
export const MIN_SECS = 10;
const KEY = 'streamonte.health';
/** Velocidad de internet de esta red (test de velocidad, `speed.js`), en Mbps; null sin medir. */
/** @type {number|null} */
let linkMbps = null;
/** Red actual (hash que da el test): cada red calibra aparte (2026-11-16: el aporte por seeder
 *  depende de la red, p. ej. del puerto abierto). Null hasta que responde el test. */
/** @type {string|null} */
let network = null;
/** Red actual (null hasta que responde el test): la usa el log del censo. */
export const currentNetwork = () => network;
/** @param {number} v @param {string|null=} net */
export function setLinkMbps(v, net = null) {
  linkMbps = v > 0 ? v : null;
  network = net || null;
  window.dispatchEvent(new Event('health-calib-changed'));
}
const MAX_SAMPLES = 30; // mediciones guardadas (las más nuevas)

/** @returns {HealthStore} */
function load() {
  try { return JSON.parse(localStorage.getItem(KEY) ?? 'null') ?? {}; } catch { return {}; }
}
/** @param {HealthStore} v */
function save(v) {
  try { localStorage.setItem(KEY, JSON.stringify(v)); } catch { /* sin almacenamiento */ }
  window.dispatchEvent(new Event('health-calib-changed'));
}

/** Mediciones útiles, una por torrent (un pack repite la misma en cada episodio; la de la
 *  biblioteca le gana a la de esta app), desde el último Restablecer. Cada una:
 *  `{hash, name, source, seeds, avg_speed_bps, max_speed_bps, measured_secs, measured_at}`. */
/** @param {Iterable<LibraryRow>} rows @param {number|undefined} since @param {Record<string, HealthMeasurement>=} saved @returns {HealthMeasurement[]} */
function measurements(rows, since, saved = {}) {
  /** @type {Map<string, HealthMeasurement>} */
  const byHash = new Map();
  // Las de otra red no cuentan; las viejas sin red (o de la biblioteca) se toman como de esta.
  /** @param {{measured_secs:number, measured_at:string, network?:string|null}} l */
  const fresh = (l) => l.measured_secs >= MIN_SECS && !(since && Date.parse(l.measured_at) <= since)
    && !(network && l.network && l.network !== network);
  for (const [hash, l] of Object.entries(saved)) if (fresh(l)) byHash.set(hash, { hash, ...l });
  for (const e of rows) {
    const l = e.live;
    if (!l || l.partial || !(l.seeds > 0) || !(l.avg_speed_bps > 0) || !fresh({ ...l, network: null })) continue;
    byHash.set(e.info_hash, { hash: e.info_hash, name: e.torrent_name || e.name, source: 'análisis', ...l });
  }
  return [...byHash.values()];
}

/** Velocidad sostenida de una medición, en Mbps (lo superado el 75 % del tiempo; ver `sustained`). */
/** @param {HealthMeasurement} l */
const sustainedMbps = (l) => ((l.sustained_bps ?? l.avg_speed_bps) * 8) / 1e6;
/** Mediana: con pares toma la mitad baja. */
/** @param {number[]} xs */
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor((s.length - 1) / 2)]; };
// ---------- salud fiel, Fase 1 (2026-11-16): corrección aprendida + rango ----------
// Spec: docs/plans/salud-fiel/salud-fiel.spec.md. Lo "real" es lo que bajó una reproducción en
// sus minutos 2 a 5; cada evidencia del análisis aprende cuánto se equivoca en esta red. Lo que se
// muestra (`predict`) y lo que evalúa la fidelidad son la misma predicción.
/** Ventana de "lo real" (segundos de descarga activa): 120–300; si se cortó antes, 30→fin a medio peso. */
const WIN_FROM = 120, WIN_TO = 300, WIN_MIN = 60, SHORT_FROM = 30, SHORT_MIN = 30;
/** Muestras equivalentes del "sin sesgo" y vida media de una muestra (días). */
const PRIOR_N = 2, HALF_LIFE_DAYS = 30;
const BIAS_MIN = -Math.log(4), BIAS_MAX = Math.log(20);
const MIN_PRED_MBPS = 0.5;
const LEECH = 1 / 6;
/** Evidencias: la medición del análisis (manda) y las estimaciones por seeders. */
/** @type {HealthKind[]} */
const KINDS = ['measured', 'counted', 'tracker'];
/** Banda sin muestras propias, × la predicción corregida: [lo, p75, hi]. Por seeders es amplia
 *  (el ×8 ≈ la única medición real de seedboxes); una medición, angosta. */
const PRIOR_BAND = { seeds: [0.5, 4, 8], measured: [0.8, 1.5, 2.5] };

/** @param {number} ratio @returns {0|1|2} */
export const levelOf = (ratio) => (ratio >= 2 ? 0 : ratio >= 1 ? 1 : 2);

/** Predicción SIN corregir de una evidencia, en Mbps (null si no la hay). */
/** @param {HealthEvidence|null|undefined} ev @param {HealthKind} kind @returns {number|null} */
export function rawPrediction(ev, kind) {
  if (!ev) return null;
  if (kind === 'measured') return (ev.analysis_mbps ?? 0) > 0 ? (ev.analysis_mbps ?? null) : null;
  const [s, l] = kind === 'tracker' ? [ev.tracker_seeds, ev.tracker_leechers] : [ev.counted_seeds, ev.counted_leech];
  if (s == null || (kind === 'tracker' && !(s > 0))) return null; // 0 de tracker: no confiable
  return Math.max(MIN_PRED_MBPS, (s + (l ?? 0) * LEECH) * DEFAULT_SEED_MBPS);
}

/** Cuantil ponderado de `[[x, peso]]` (el primero cuyo peso acumulado llega a `p` del total). */
/** @param {number[][]} pts @param {number} p */
function weightedQuantile(pts, p) {
  const s = [...pts].sort((a, b) => a[0] - b[0]);
  const total = s.reduce((t, [, w]) => t + w, 0);
  let acc = 0;
  for (const [x, w] of s) { acc += w; if (acc >= total * p) return x; }
  return 0;
}

/** Sesgo aprendido por evidencia: mediana ponderada (por antigüedad) de ln(real ÷ predicción),
 *  contraída hacia 0 con PRIOR_N muestras equivalentes; `lo`/`hi` = cuartiles de esos ln menos la
 *  mediana (ancho del rango). Las topadas por la línea que dan pesimista no enseñan: fuera. */
/** @param {HealthSample[]} samples @param {number} nowMs @param {number|null|undefined} link @returns {Record<HealthKind, HealthBias>} */
export function learnBias(samples, nowMs, link) {
  /** @type {Record<string, HealthBias>} */
  const out = {};
  for (const kind of KINDS) {
    /** @type {number[][]} */
    const pts = [];
    for (const s of samples) {
      const pred = rawPrediction(s.ev, kind);
      if (!pred || !(s.real_mbps > 0)) continue;
      const r = Math.log(s.real_mbps / pred);
      if (link && s.real_mbps >= 0.85 * link && r <= 0) continue;
      const age = Math.max(0, nowMs - Date.parse(s.measured_at)) / 864e5;
      pts.push([r, (s.weight ?? 1) * 0.5 ** (age / HALF_LIFE_DAYS)]);
    }
    const nEff = pts.reduce((t, [, w]) => t + w, 0);
    const m = pts.length ? weightedQuantile(pts, 0.5) : 0;
    const bias = pts.length ? Math.min(BIAS_MAX, Math.max(BIAS_MIN, (nEff * m) / (nEff + PRIOR_N))) : 0;
    out[kind] = { bias, factor: Math.exp(bias), n: pts.length, nEff,
      lo: pts.length ? weightedQuantile(pts, 0.25) - m : 0, hi: pts.length ? weightedQuantile(pts, 0.75) - m : 0 };
  }
  return /** @type {Record<HealthKind, HealthBias>} */ (out);
}

/** Rango corregido de una evidencia: `{kind, lo, p50, p75, hi, conf}` en Mbps, o null sin ella. */
/** @param {HealthEvidence|null|undefined} ev @param {HealthKind} kind @param {HealthCalInput} cal @returns {HealthRange|null} */
function rangeOf(ev, kind, cal) {
  const raw = rawPrediction(ev, kind);
  if (raw == null) return null;
  const bySeeds = kind !== 'measured';
  /** @param {number} x */
  const cap = (x) => (bySeeds && cal.capMbps ? Math.min(x, cal.capMbps) : x);
  if (bySeeds && cal.manual) { const v = cap((raw / DEFAULT_SEED_MBPS) * cal.manual); return { kind, lo: v, p50: v, p75: v, hi: v, conf: 'media' }; }
  const b = cal.bias?.[kind] ?? { factor: 1, nEff: 0, lo: 0, hi: 0 };
  const p50 = raw * b.factor;
  /** @type {number} */ let lo;
  /** @type {number} */ let p75;
  /** @type {number} */ let hi;
  /** @type {'alta'|'media'|'baja'} */ let conf;
  if (b.nEff >= MIN_SAMPLES) {
    const w = 1 / (2 * Math.sqrt(b.nEff)); // pocas muestras: los cuartiles subestiman la dispersión
    [lo, p75, conf] = [p50 * Math.exp(b.lo) * (1 - w), p50 * Math.exp(b.hi), 'media'];
    hi = p75 * (1 + w);
  } else {
    const [fl, f75, fh] = bySeeds ? PRIOR_BAND.seeds : PRIOR_BAND.measured;
    [lo, p75, hi, conf] = [p50 * fl, p50 * f75, p50 * fh, 'baja'];
  }
  return { kind, lo: cap(lo), p50: cap(p50), p75: cap(p75), hi: cap(hi), conf };
}

/** Lo que el catálogo muestra de una opción (`health()`) y lo que `fidelity` evalúa: la medición
 *  manda (B6); si no, entre seeders contados y de trackers gana el p50 más alto (todas subestiman);
 *  con 0 contados los trackers no entran. `cal` = {bias, manual, capMbps}. */
/** @param {HealthEvidence|null|undefined} ev @param {HealthCalInput} cal @returns {HealthRange|null} */
export function predict(ev, cal) {
  const measured = rangeOf(ev, 'measured', cal);
  if (measured) return measured;
  const counted = rangeOf(ev, 'counted', cal);
  const tracker = ev?.counted_seeds === 0 ? null : rangeOf(ev, 'tracker', cal);
  return [counted, tracker].reduce((/** @type {HealthRange|null} */ a, b) => (b && (!a || b.p50 > a.p50) ? b : a), null);
}

/** Nivel del p50 y nivel mostrado: sube uno ("probable") si el p75 alcanza el de arriba. */
/** @param {HealthRange} r @param {number} need @returns {import('./types.js').ShownLevel} */
export function shownLevel(r, need) {
  const level = levelOf(r.p50 / need);
  const probable = r.conf !== 'alta' && level > 0 && levelOf(r.p75 / need) < level;
  return { level, shown: probable ? level - 1 : level, probable };
}

/** Qué tan fiel fue la salud en esta red: cada muestra se predice con lo aprendido SOLO de las
 *  anteriores. err = ln(predicción ÷ real): < 0 = pesimista. */
/** @param {HealthSample[]} samples @param {number|null} link @returns {import('./types.js').HealthFidelity|null} */
export function fidelity(samples, link) {
  const asc = [...samples].sort((a, b) => Date.parse(a.measured_at) - Date.parse(b.measured_at));
  /** @type {FidRow[]} */
  const rows = [];
  asc.forEach((s, i) => {
    const need = s.ev?.need_mbps;
    if (!need || !(need > 0)) return;
    const before = predict(s.ev, { bias: {}, capMbps: link });
    const after = predict(s.ev, { bias: learnBias(asc.slice(0, i), Date.parse(s.measured_at), link), capMbps: link });
    if (!before || !after) return;
    const real = levelOf(s.real_mbps / need), got = shownLevel(after, need).shown;
    rows.push({ before: Math.log(before.p50 / s.real_mbps), after: Math.log(after.p50 / s.real_mbps), hit: got === real, pess: got > real, opt: got < real,
      inBand: after.lo <= s.real_mbps && s.real_mbps <= after.hi });
  });
  if (!rows.length) return null;
  /** @param {(r: FidRow) => number} f */
  const med = (f) => median(rows.map(f));
  /** @param {(r: FidRow) => boolean} f */
  const count = (f) => rows.filter(f).length;
  return { n: rows.length, biasBefore: med((r) => r.before), biasAfter: med((r) => r.after),
    typBefore: med((r) => Math.abs(r.before)), typAfter: med((r) => Math.abs(r.after)),
    hits: count((r) => r.hit), pessimistic: count((r) => r.pess), optimistic: count((r) => r.opt), inBand: count((r) => r.inBand) };
}

/** Muestra lista para aprender (migración al leer, nada se reescribe). Null = no aprende: las del
 *  análisis (son predicción) y las viejas de menos de 2 min. */
/** @param {HealthMeasurement} l @returns {HealthSample|null} */
function learnable(l) {
  if (l.ev && l.real_mbps && l.real_mbps > 0) return { ...l, ev: l.ev, real_mbps: l.real_mbps, weight: l.short ? 0.5 : 1 };
  if (l.source === 'análisis' || !(l.measured_secs >= WIN_FROM)) return null;
  // Viejas: su p25 incluye el arranque (pesimista) → medio peso. Un 0 viejo no es "0 contados".
  return { ...l, weight: 0.5, real_mbps: sustainedMbps(l),
    ev: { counted_seeds: (l.seeds ?? 0) > 0 ? (l.seeds ?? null) : null, counted_leech: null, tracker_seeds: l.tracker_seeds ?? null,
      tracker_leechers: l.tracker_leechers ?? null, analysis_mbps: null, need_mbps: null } };
}

/** `rows`: filas de la biblioteca. `bias` = sesgo aprendido por evidencia (salud fiel); `manual` =
 *  Mbps por seeder fijados a mano o null; `seedMbps`/`trackerSeedMbps` = 3 Mbps × su factor (para
 *  "Tu conexión"); `capMbps` = techo (test de velocidad o lo más rápido medido); `samples` = todas
 *  las mediciones (techo y lista); `learnable` = las que enseñan. */
/** @param {Iterable<LibraryRow>} rows @returns {import('./types.js').HealthCalibration} */
export function healthCalibration(rows) {
  const cfg = load();
  const samples = measurements(rows, cfg.since, cfg.bg)
    .sort((a, b) => Date.parse(b.measured_at) - Date.parse(a.measured_at));
  const fastest = samples.length >= MIN_SAMPLES ? Math.max(...samples.map((l) => (l.max_speed_bps * 8) / 1e6)) : null;
  const capMbps = linkMbps ?? fastest;
  const capFrom = linkMbps ? 'test' : fastest ? 'measured' : null;
  const learn = /** @type {HealthSample[]} */ (samples.map(learnable).filter(Boolean));
  const bias = learnBias(learn, Date.now(), linkMbps);
  const manual = (cfg.seedMbps ?? 0) > 0 ? (cfg.seedMbps ?? null) : null;
  return {
    capMbps, capFrom, samples, learnable: learn, bias, manual,
    n: bias.counted.n, trackerN: bias.tracker.n,
    seedMbps: manual ?? DEFAULT_SEED_MBPS * bias.counted.factor,
    trackerSeedMbps: manual ?? DEFAULT_SEED_MBPS * bias.tracker.factor,
    measuredFactor: bias.measured.factor,
    source: manual ? 'manual' : bias.counted.n ? 'measured' : 'default',
  };
}

// ---------- medición automática mientras baja ----------
/** Por video (`key`): la reproducción que se está midiendo. `sum / n` = promedio de `speed_bps`
 *  (bytes/s, una muestra por evento ~1 s) mientras baja de verdad. Solo de esta sesión. */
/** @type {Map<string, Tracked>} */
const playing = new Map();

/** Cada fila de reproducción del núcleo. `ev` = lo que sabía el análisis (`evidenceOf` del catálogo,
 *  respaldo si no hay foto fresca de `notePrediction`). Sin evidencia se mide igual (la usa "Cargar
 *  en background") pero no calibra. */
/** @param {import('./types.js').PlaybackRow} row @param {HealthEvidence=} ev */
export function trackPlayback(row, ev) {
  const hash = row.key.split(':')[0];
  let t = playing.get(row.key);
  if (!t || t.id !== row.id) {
    const p = load().pred?.[hash];
    t = { id: row.id, name: row.name, sum: 0, n: 0, max: 0, speeds: [], win: [], incoming: 0,
      ev: p && Date.now() - Date.parse(p.at) < PRED_TTL_MS ? p : ev };
    playing.set(row.key, t);
  }
  t.source = row.state.kind === 'background' ? 'background' : 'reproducción';
  t.done = (row.progress ?? 0) >= 0.999;
  t.active = ['playing', 'background'].includes(row.state.kind) && !t.done;
  if (!t.active) return;
  t.sum += row.speed_bps;
  t.n += 1;
  t.max = Math.max(t.max, row.speed_bps);
  if (t.speeds.length < 3600) t.speeds.push(row.speed_bps);
  // Ventana de "lo real": sin el arranque ni el final del archivo (endgame).
  if (t.n > SHORT_FROM && t.n <= WIN_TO && (row.progress ?? 0) < 0.95)
    t.win.push([t.n, row.speed_bps, row.seeds ?? 0, row.peers ?? 0, row.incoming_peers ?? 0]);
  t.incoming = Math.max(t.incoming, row.incoming_peers ?? 0);
  noteIncoming(t);
  // Cada 10 s se guarda (pisa la anterior de ese torrent): si se corta, queda lo medido hasta ahí.
  // Solo enseña si alguna evidencia predijo algo (si no, no hay contra qué comparar).
  const predicts = KINDS.some((k) => rawPrediction(t.ev, k) != null);
  if (predicts && t.n % 10 === 0 && t.n <= WIN_TO + 10) addSample(hash, t);
  else window.dispatchEvent(new Event('health-calib-changed'));
}

/** Velocidad medida de ese video en esta sesión: `{avg, max, n, done}` en bytes/s, o null. */
/** @param {string} key @returns {{avg:number, max:number, n:number, done:boolean|undefined}|null} */
export function speedOf(key) {
  const t = playing.get(key);
  return t ? { avg: t.n ? t.sum / t.n : 0, max: t.max, n: t.n, done: t.done } : null;
}

/** Lo que se está midiendo ahora (para el panel de Ajustes). */
export function measuringNow() {
  return [...playing.values()].filter((t) => t.active)
    .map((t) => ({ name: t.name, source: t.source, ev: t.ev, avg_speed_bps: t.n ? t.sum / t.n : 0, secs: t.n }));
}

/** Piso sostenido: la velocidad que se superó el 75 % del tiempo (percentil 25). */
/** @param {number[]} speeds */
const sustained = (speeds) => [...speeds].sort((a, b) => a - b)[Math.floor((speeds.length - 1) / 4)];

const PRED_TTL_MS = 6 * 3600e3, MAX_PRED = 60;
/** Foto de lo que sabía el análisis al tocar ▶/⤓ (el panel está abierto): la usa la reproducción
 *  aunque después se cierre el panel. */
/** @param {string} hash @param {HealthEvidence|null|undefined} ev */
export function notePrediction(hash, ev) {
  if (!ev) return;
  const cfg = load();
  const all = { ...cfg.pred, [hash]: { ...ev, at: new Date().toISOString() } };
  const keep = Object.entries(all).sort((a, b) => Date.parse(b[1].at) - Date.parse(a[1].at)).slice(0, MAX_PRED);
  save({ ...cfg, pred: Object.fromEntries(keep) });
}

/** @param {string} hash @param {Tracked} t */
function addSample(hash, t) {
  const full = t.win.filter(([s]) => s > WIN_FROM);
  const short = full.length < WIN_MIN;
  const w = short ? t.win : full;
  if (w.length < (short ? SHORT_MIN : WIN_MIN)) return;
  /** @param {number} i */
  const col = (i) => w.map((x) => x[i]);
  const cfg = load();
  const sample = { name: t.name, source: t.source, ev: t.ev, real_mbps: (sustained(col(1)) * 8) / 1e6, short, window_secs: w.length,
    real_seeds: Math.max(...col(2)), real_peers: Math.max(...col(3)), real_incoming: Math.max(...col(4)),
    known_peers: t.ev?.known ?? null, dht_peers: t.ev?.dht ?? null,
    avg_speed_bps: t.sum / t.n, sustained_bps: sustained(t.speeds), max_speed_bps: t.max, measured_secs: t.n,
    measured_at: new Date().toISOString(), network };
  const all = { ...cfg.bg, [hash]: sample };
  const keep = Object.entries(all).sort((a, b) => Date.parse(b[1].measured_at) - Date.parse(a[1].measured_at)).slice(0, MAX_SAMPLES);
  save({ ...cfg, bg: Object.fromEntries(keep) });
}

/** Fija el aporte a mano (Ajustes). */
/** @param {number} v */
export const setSeedMbps = (v) => save({ ...load(), seedMbps: v });
/** Vuelve a lo medido (borra el valor fijo). */
export const recalibrate = () => { const { seedMbps: _omit, ...rest } = load(); save(rest); };
/** Olvida las mediciones hechas hasta ahora y el valor fijo: default hasta juntar `MIN_SAMPLES`. */
export const resetCalibration = () => save({ since: Date.now() });

// ---------- conexiones entrantes (2026-11-16) ----------
/** Segundos bajando sin ningún peer entrante para dar el puerto por cerrado. */
const INCOMING_SECS = 120;
/** ¿Llegan conexiones entrantes en esta red? Sale de las reproducciones reales (sirve para IPv4 e
 *  IPv6: ningún servicio público prueba IPv6, y sin acceso al router no hay otra forma). Se guarda
 *  por red. */
/** @param {Tracked} t */
function noteIncoming(t) {
  if (!network || (!t.incoming && t.n < INCOMING_SECS)) return;
  const cfg = load();
  const prev = cfg.net?.[network];
  const open = t.incoming > 0;
  if (prev?.open === open && t.n % 60) return; // sin cambios: se refresca la fecha cada minuto
  save({ ...cfg, net: { ...cfg.net, [network]: { open, at: new Date().toISOString() } } });
}

/** `{open, at}` de la red actual, o null si todavía no se vio una reproducción de 2 min. */
export const incomingStatus = () => (network ? load().net?.[network] ?? null : null);
