// Calibración de la "salud estimada" del catálogo (2026-11-15), por PC y por red: el techo de su
// conexión y, desde 2026-11-16, el sesgo análisis → reproducción: lo que bajó de verdad en los
// minutos 2–5 de cada reproducción ÷ lo que predijo el análisis (trackers, seeders contados o
// medición), aprendido por evidencia y por red (spec 04). En localStorage va lo medido y lo que
// eligió el usuario en Ajustes: un valor fijo o "ignorar mediciones anteriores a" (Restablecer).
// Cada cambio avisa con `health-calib-changed`.

/** Aporte por seeder sin mediciones suficientes: conservador (un seeder casero sube ~10–20 Mbps
 *  repartidos en 4–6 conexiones). La única medición real al escribirlo dio ~26 (seedboxes). */
export const DEFAULT_SEED_MBPS = 3;
/** Mediciones mínimas para confiar en lo medido (por debajo: el default y sin tope). */
export const MIN_SAMPLES = 3;
/** Segundos de descarga para que una medición cuente: menos es más arranque que velocidad sostenida. */
export const MIN_SECS = 10;
const KEY = 'streamonte.health';
/** Velocidad de internet de esta red (test de velocidad, `speed.js`), en Mbps; null sin medir. */
let linkMbps = null;
/** Red actual (hash que da el test): cada red calibra aparte (2026-11-16: el aporte por seeder
 *  depende de la red, p. ej. del puerto abierto). Null hasta que responde el test. */
let network = null;
/** Red actual (null hasta que responde el test): la usa el log del censo. */
export const currentNetwork = () => network;
export function setLinkMbps(v, net = null) {
  linkMbps = v > 0 ? v : null;
  network = net || null;
  window.dispatchEvent(new Event('health-calib-changed'));
}
const MAX_SAMPLES = 30; // mediciones guardadas (las más nuevas)

function load() {
  try { return JSON.parse(localStorage.getItem(KEY)) ?? {}; } catch { return {}; }
}
function save(v) {
  try { localStorage.setItem(KEY, JSON.stringify(v)); } catch { /* sin almacenamiento */ }
  window.dispatchEvent(new Event('health-calib-changed'));
}

/** Mediciones útiles, una por torrent (un pack repite la misma en cada episodio; la de la
 *  biblioteca le gana a la de esta app), desde el último Restablecer. Cada una:
 *  `{hash, name, source, seeds, avg_speed_bps, max_speed_bps, measured_secs, measured_at}`. */
function measurements(rows, since, saved = {}) {
  const byHash = new Map();
  // Las de otra red no cuentan; las viejas sin red (o de la biblioteca) se toman como de esta.
  const fresh = (l) => l.measured_secs >= MIN_SECS && !(since && Date.parse(l.measured_at) <= since)
    && !(network && l.network && l.network !== network);
  for (const [hash, l] of Object.entries(saved)) if (fresh(l)) byHash.set(hash, { hash, ...l });
  for (const e of rows) {
    const l = e.live;
    if (!l || l.partial || !(l.seeds > 0) || !(l.avg_speed_bps > 0) || !fresh(l)) continue;
    byHash.set(e.info_hash, { hash: e.info_hash, name: e.torrent_name || e.name, source: 'análisis', ...l });
  }
  return [...byHash.values()];
}

/** Velocidad sostenida de una medición, en Mbps (lo superado el 75 % del tiempo; ver `sustained`). */
const sustainedMbps = (l) => ((l.sustained_bps ?? l.avg_speed_bps) * 8) / 1e6;
/** Mediana: con pares toma la mitad baja. */
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor((s.length - 1) / 2)]; };
/** Cuantil p con la misma regla que `median` (p = 0,5 da lo mismo). */
const quantile = (xs, p) => [...xs].sort((a, b) => a - b)[Math.floor((xs.length - 1) * p)];

/** Banda del aporte por seeder (2026-11-16, spec 08): `{lo, p50, p75, hi, conf}` en Mbps. `q` =
 *  [p25, p50, p75] de las mediciones (null sin MIN_SAMPLES): con pocas, se ensancha ±1/(2√n). Sin
 *  mediciones, alrededor del default (×0,5 a ×8; el ×8 ≈ la medición real de seedboxes) movido por
 *  `bias` (sesgo aprendido, spec 04; 1 sin él). */
export function perSeedBand(q, n, bias = 1) {
  if (!q) { const d = DEFAULT_SEED_MBPS * bias; return { lo: d * 0.5, p50: d, p75: d * 4, hi: d * 8, conf: 'baja' }; }
  const w = 1 / (2 * Math.sqrt(n));
  return { lo: q[0] * (1 - w), p50: q[1], p75: q[2], hi: q[2] * (1 + w), conf: 'media' };
}
/** Rango de Mbps de un torrent: `eff` seeders equivalentes × la banda, con tope `cap` (null = sin). */
export function supplyRange(eff, band, cap) {
  const at = (x) => (cap ? Math.min(eff * x, cap) : eff * x);
  return { lo: at(band.lo), p50: at(band.p50), p75: at(band.p75), hi: at(band.hi), conf: band.conf };
}

// ---------- corrección aprendida análisis → reproducción (idea 4, 2026-11-16) ----------
/** Ventana de "lo real": segundos 120–300 de descarga activa (sin el arranque). Con menos de
 *  WIN_MIN ahí (se cortó antes), la ventana corta 30→fin con medio peso: si no, lo que anduvo mal
 *  y se abandonó no entraría nunca. */
const WIN_FROM = 120, WIN_TO = 300, WIN_MIN = 60, SHORT_FROM = 30, SHORT_MIN = 30;
/** Muestras equivalentes del "sin sesgo" y vida media de una muestra (días). */
const PRIOR_N = 2, HALF_LIFE_DAYS = 30;
const BIAS_MIN = -Math.log(4), BIAS_MAX = Math.log(20);
const MIN_PRED_MBPS = 0.5;
const KINDS = ['tracker', 'counted', 'measured'];

export const levelOf = (ratio) => (ratio >= 2 ? 0 : ratio >= 1 ? 1 : 2);

/** Predicción SIN corregir de una evidencia, en Mbps (null si no la hay): lo que diría el modelo base. */
export function rawPrediction(ev, kind) {
  if (!ev) return null;
  if (kind === 'measured') return ev.analysis_mbps > 0 ? ev.analysis_mbps : null;
  const [s, l] = kind === 'tracker' ? [ev.tracker_seeds, ev.tracker_leechers] : [ev.counted_seeds, ev.counted_leech];
  if (s == null || (kind === 'tracker' && !(s > 0))) return null; // 0 de tracker: no confiable (`trackersWin`)
  return Math.max(MIN_PRED_MBPS, (s + (l ?? 0) / 6) * DEFAULT_SEED_MBPS);
}
/** La evidencia que usa `health()` del catálogo (spec 08): lo medido y, si no, la de más Mbps entre
 *  contadas y trackers (con 0 contados, los trackers no entran). Compara predicciones sin corregir. */
export function basisOf(ev) {
  if (rawPrediction(ev, 'measured') != null) return 'measured';
  const c = rawPrediction(ev, 'counted'), t = rawPrediction(ev, 'tracker');
  if (c == null) return t == null ? null : 'tracker';
  return t != null && ev.counted_seeds !== 0 && t > c ? 'tracker' : 'counted';
}

function weightedMedian(pts) {
  const s = [...pts].sort((a, b) => a[0] - b[0]);
  const half = s.reduce((t, [, w]) => t + w, 0) / 2;
  let acc = 0;
  for (const [x, w] of s) { acc += w; if (acc >= half) return x; }
  return 0;
}

/** Sesgo aprendido por evidencia: mediana ponderada (por antigüedad) de ln(real ÷ predicción),
 *  contraída hacia 0 con PRIOR_N muestras equivalentes. Topadas por la línea y pesimistas: fuera. */
export function learnBias(samples, nowMs, link) {
  const out = {};
  for (const kind of KINDS) {
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
    const bias = pts.length ? Math.min(BIAS_MAX, Math.max(BIAS_MIN, (nEff * weightedMedian(pts)) / (nEff + PRIOR_N))) : 0;
    out[kind] = { bias, factor: Math.exp(bias), n: pts.length, nEff, ratios: pts.map(([r]) => Math.exp(r)) };
  }
  return out;
}

/** Qué tan fiel fue la salud en esta red: cada muestra se predice con lo aprendido SOLO de las
 *  anteriores. err = ln(predicción ÷ real): < 0 = pesimista. */
export function fidelity(samples, link) {
  const asc = [...samples].sort((a, b) => Date.parse(a.measured_at) - Date.parse(b.measured_at));
  const rows = [];
  asc.forEach((s, i) => {
    const kind = basisOf(s.ev);
    const need = s.ev?.need_mbps;
    if (!kind || !(need > 0)) return;
    const raw = rawPrediction(s.ev, kind);
    const k = learnBias(asc.slice(0, i), Date.parse(s.measured_at), link)[kind].factor;
    const cap = (x) => (link && kind !== 'measured' ? Math.min(x, link) : x);
    const after = cap(raw * k), real = levelOf(s.real_mbps / need), got = levelOf(after / need);
    rows.push({ before: Math.log(cap(raw) / s.real_mbps), after: Math.log(after / s.real_mbps), hit: got === real, pess: got > real });
  });
  if (!rows.length) return null;
  const med = (f) => median(rows.map(f));
  return {
    n: rows.length, biasBefore: med((r) => r.before), biasAfter: med((r) => r.after),
    typBefore: med((r) => Math.abs(r.before)), typAfter: med((r) => Math.abs(r.after)),
    hits: rows.filter((r) => r.hit).length, pessimistic: rows.filter((r) => r.pess).length,
  };
}

/** Muestra lista para aprender (migración al leer: ver spec 04 §5). Null = no aprende. */
function learnable(l) {
  if (l.ev && l.real_mbps > 0) return { ...l, weight: l.short ? 0.5 : 1 };
  if (l.source === 'análisis' || !(l.measured_secs >= WIN_FROM)) return null;
  return { ...l, weight: 0.5, real_mbps: sustainedMbps(l),
    ev: { counted_seeds: l.seeds ?? null, counted_leech: null, tracker_seeds: l.tracker_seeds ?? null, tracker_leechers: l.tracker_leechers ?? null, analysis_mbps: null, need_mbps: null } };
}

/** `rows`: filas de la biblioteca. `capMbps` = techo del aporte total: la velocidad de internet
 *  medida (`capFrom: 'test'`) o, sin test, lo más rápido que bajó esta PC (`'measured'`; null sin
 *  mediciones suficientes); `samples` = todas las mediciones (también las del análisis), la más nueva
 *  primero; `learnable` = las que aprenden; `bias` = `{tracker, counted, measured}: {bias, factor, n,
 *  nEff}`; `seedMbps` / `trackerSeedMbps` = aporte por seeder contado / de trackers (base × factor);
 *  `seedBand` / `trackerBand` = banda `{lo, p50, p75, hi, conf}` del aporte por seeder (spec 08);
 *  `measuredFactor` = corrección de lo medido por el análisis; `n` / `trackerN` = muestras de cada una. */
export function healthCalibration(rows) {
  const cfg = load();
  const samples = measurements(rows, cfg.since, cfg.bg)
    .sort((a, b) => Date.parse(b.measured_at) - Date.parse(a.measured_at));
  const fastest = samples.length >= MIN_SAMPLES ? Math.max(...samples.map((l) => (l.max_speed_bps * 8) / 1e6)) : null;
  const capMbps = linkMbps ?? fastest;
  const capFrom = linkMbps ? 'test' : fastest ? 'measured' : null;
  const learn = samples.map(learnable).filter(Boolean);
  // Sesgo aprendido (idea 4): lo real de min 2–5 vs lo que predijo el análisis, por evidencia.
  const bias = learnBias(learn, Date.now(), linkMbps);
  const manual = cfg.seedMbps > 0;
  // Banda por seeder (spec 08): su p50 es el aporte de arriba (default × factor); con MIN_SAMPLES
  // reproducciones, la dispersión sale de cuánto varió real ÷ predicción (cuartiles), si no, el prior.
  const bandOf = (b) => {
    const d = DEFAULT_SEED_MBPS * b.factor, m = quantile(b.ratios.length ? b.ratios : [1], 0.5);
    const q = b.n >= MIN_SAMPLES ? [d * Math.min(1, quantile(b.ratios, 0.25) / m), d, d * Math.max(1, quantile(b.ratios, 0.75) / m)] : null;
    return perSeedBand(q, b.n, b.factor);
  };
  const v = cfg.seedMbps, fixed = { lo: v, p50: v, p75: v, hi: v, conf: 'media' };
  return {
    capMbps, capFrom, samples, learnable: learn, bias,
    seedBand: manual ? fixed : bandOf(bias.counted), trackerBand: manual ? fixed : bandOf(bias.tracker),
    n: bias.counted.n, trackerN: bias.tracker.n,
    seedMbps: manual ? cfg.seedMbps : DEFAULT_SEED_MBPS * bias.counted.factor,
    trackerSeedMbps: manual ? cfg.seedMbps : DEFAULT_SEED_MBPS * bias.tracker.factor,
    measuredFactor: bias.measured.factor,
    source: manual ? 'manual' : bias.counted.n ? 'measured' : 'default',
  };
}

// ---------- medición automática mientras baja ----------
/** Por video (`key`): la reproducción que se está midiendo. `sum / n` = promedio de `speed_bps`
 *  (bytes/s, una muestra por evento ~1 s) mientras baja de verdad. Solo de esta sesión. */
const playing = new Map();

/** Cada fila de reproducción del núcleo. `ev` = lo que sabía el análisis (`evidenceOf` del catálogo,
 *  respaldo si no hay foto fresca de `notePrediction`). Sin evidencia se mide igual (la usa "Cargar
 *  en background") pero no calibra. */
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
  if (t.ev && t.n % 10 === 0 && t.n <= WIN_TO + 10) addSample(hash, t);
  else window.dispatchEvent(new Event('health-calib-changed'));
}

/** Velocidad medida de ese video en esta sesión: `{avg, max, n, done}` en bytes/s, o null. */
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
const sustained = (speeds) => [...speeds].sort((a, b) => a - b)[Math.floor((speeds.length - 1) / 4)];

const PRED_TTL_MS = 6 * 3600e3, MAX_PRED = 60;
/** Foto de lo que sabía el análisis al tocar ▶/⤓ (el panel está abierto): la usa la reproducción
 *  aunque después se cierre el panel. */
export function notePrediction(hash, ev) {
  if (!ev) return;
  const cfg = load();
  const all = { ...cfg.pred, [hash]: { ...ev, at: new Date().toISOString() } };
  const keep = Object.entries(all).sort((a, b) => Date.parse(b[1].at) - Date.parse(a[1].at)).slice(0, MAX_PRED);
  save({ ...cfg, pred: Object.fromEntries(keep) });
}

function addSample(hash, t) {
  const full = t.win.filter(([s]) => s > WIN_FROM);
  const short = full.length < WIN_MIN;
  const w = short ? t.win : full;
  if (w.length < (short ? SHORT_MIN : WIN_MIN)) return;
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
export const setSeedMbps = (v) => save({ ...load(), seedMbps: v });
/** Vuelve a lo medido (borra el valor fijo). */
export const recalibrate = () => { const { seedMbps, ...rest } = load(); save(rest); };
/** Olvida las mediciones hechas hasta ahora y el valor fijo: default hasta juntar `MIN_SAMPLES`. */
export const resetCalibration = () => save({ since: Date.now() });

// ---------- conexiones entrantes (2026-11-16) ----------
/** Segundos bajando sin ningún peer entrante para dar el puerto por cerrado. */
const INCOMING_SECS = 120;
/** ¿Llegan conexiones entrantes en esta red? Sale de las reproducciones reales (sirve para IPv4 e
 *  IPv6: ningún servicio público prueba IPv6, y sin acceso al router no hay otra forma). Se guarda
 *  por red. */
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
