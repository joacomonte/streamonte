// Calibración de la "salud estimada" del catálogo (2026-11-15), por PC: cuánto aporta cada seeder
// conectado según lo medido en esta máquina, y el tope de su conexión. Es automática: cada vez que
// se ve o se carga en background algo que se analizó (se conocen sus seeders), su velocidad
// promedio ÷ esos seeders es una medición. También cuenta lo medido que guarda la biblioteca
// (`live`). En localStorage va lo medido y lo que eligió el usuario en Ajustes: un valor fijo o
// "ignorar mediciones anteriores a" (Restablecer). Cada cambio avisa con `health-calib-changed`.

/** Aporte por seeder sin mediciones suficientes: conservador (un seeder casero sube ~10–20 Mbps
 *  repartidos en 4–6 conexiones). La única medición real al escribirlo dio ~26 (seedboxes). */
export const DEFAULT_SEED_MBPS = 3;
/** Mediciones mínimas para confiar en lo medido (por debajo: el default y sin tope). */
export const MIN_SAMPLES = 3;
/** Segundos de descarga para que una medición cuente: menos es más arranque que velocidad sostenida. */
export const MIN_SECS = 10;
const KEY = 'tstream.health';
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
  const fresh = (l) => l.measured_secs >= MIN_SECS && !(since && Date.parse(l.measured_at) <= since);
  for (const [hash, l] of Object.entries(saved)) if (fresh(l)) byHash.set(hash, { hash, ...l });
  for (const e of rows) {
    const l = e.live;
    if (!l || l.partial || !(l.seeds > 0) || !(l.avg_speed_bps > 0) || !fresh(l)) continue;
    byHash.set(e.info_hash, { hash: e.info_hash, name: e.torrent_name || e.name, source: 'análisis', ...l });
  }
  return [...byHash.values()];
}

/** `rows`: filas de la biblioteca. `seedMbps` = aporte por seeder; `capMbps` = lo más rápido que bajó
 *  esta PC (techo del aporte total; null sin mediciones suficientes); `n` = mediciones usadas;
 *  `samples` = esas mediciones, la más nueva primero. */
export function healthCalibration(rows) {
  const cfg = load();
  const samples = measurements(rows, cfg.since, cfg.bg)
    .sort((a, b) => Date.parse(b.measured_at) - Date.parse(a.measured_at));
  const n = samples.length;
  const capMbps = n >= MIN_SAMPLES ? Math.max(...samples.map((l) => (l.max_speed_bps * 8) / 1e6)) : null;
  if (cfg.seedMbps > 0) return { seedMbps: cfg.seedMbps, capMbps, n, samples, source: 'manual' };
  if (n < MIN_SAMPLES) return { seedMbps: DEFAULT_SEED_MBPS, capMbps, n, samples, source: 'default' };
  const perSeed = samples.map((l) => (l.avg_speed_bps * 8) / 1e6 / l.seeds).sort((a, b) => a - b);
  // Cuartil inferior: conservador, un torrent con seedboxes no infla a todos.
  return { seedMbps: perSeed[Math.floor((n - 1) / 4)], capMbps, n, samples, source: 'measured' };
}

// ---------- medición automática mientras baja ----------
/** Por video (`key`): la reproducción que se está midiendo. `sum / n` = promedio de `speed_bps`
 *  (bytes/s, una muestra por evento ~1 s) mientras baja de verdad. Solo de esta sesión. */
const playing = new Map();

/** Cada fila de reproducción del núcleo. `seeds` = seeders contados al analizarla (o null): sin
 *  ellos se mide la velocidad igual (la usa "Cargar en background") pero no calibra. */
export function trackPlayback(row, seeds) {
  let t = playing.get(row.key);
  if (!t || t.id !== row.id) { t = { id: row.id, name: row.name, sum: 0, n: 0, max: 0 }; playing.set(row.key, t); }
  t.seeds = seeds > 0 ? seeds : null;
  t.source = row.state.kind === 'background' ? 'background' : 'reproducción';
  t.done = (row.progress ?? 0) >= 0.999;
  t.active = ['playing', 'background'].includes(row.state.kind) && !t.done;
  if (!t.active) return;
  t.sum += row.speed_bps;
  t.n += 1;
  t.max = Math.max(t.max, row.speed_bps);
  // Cada 10 s se guarda (pisa la anterior de ese torrent): si se corta, queda lo medido hasta ahí.
  if (t.seeds && t.n >= MIN_SECS && t.n % 10 === 0) addSample(row.key.split(':')[0], t);
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
    .map((t) => ({ name: t.name, source: t.source, seeds: t.seeds, avg_speed_bps: t.n ? t.sum / t.n : 0, secs: t.n }));
}

function addSample(hash, t) {
  const cfg = load();
  const sample = { name: t.name, source: t.source, seeds: t.seeds, avg_speed_bps: t.sum / t.n, max_speed_bps: t.max, measured_secs: t.n, measured_at: new Date().toISOString() };
  const all = { ...cfg.bg, [hash]: sample };
  const keep = Object.entries(all).sort((a, b) => Date.parse(b[1].measured_at) - Date.parse(a[1].measured_at)).slice(0, MAX_SAMPLES);
  save({ ...cfg, bg: Object.fromEntries(keep) });
}

/** Fija el aporte a mano (Ajustes). */
export const setSeedMbps = (v) => save({ ...load(), seedMbps: v });
/** Vuelve a lo medido (borra el valor fijo). */
export const recalibrate = () => { const { since, bg } = load(); save({ since, bg }); };
/** Olvida las mediciones hechas hasta ahora y el valor fijo: default hasta juntar `MIN_SAMPLES`. */
export const resetCalibration = () => save({ since: Date.now() });
