// Calibración de la "salud estimada" del catálogo (2026-11-15), por PC: cuánto aporta cada seeder
// conectado según lo medido en esta máquina, y el tope de su conexión. Dos fuentes: lo medido
// que guarda la biblioteca (`live`, con sus seeders) y la carga en background
// del catálogo (velocidad promedio ÷ seeders contados al analizar; se guarda acá, `bg`). En
// localStorage también va lo que eligió el usuario en Ajustes: un valor fijo o "ignorar
// mediciones anteriores a" (Restablecer).

/** Aporte por seeder sin mediciones suficientes: conservador (un seeder casero sube ~10–20 Mbps
 *  repartidos en 4–6 conexiones). La única medición real al escribirlo dio ~26 (seedboxes). */
export const DEFAULT_SEED_MBPS = 3;
/** Mediciones mínimas para confiar en lo medido (por debajo: el default y sin tope). */
export const MIN_SAMPLES = 3;
const MIN_SECS = 10; // menos que esto es más arranque que velocidad sostenida
const KEY = 'tstream.health';
const MAX_BG = 30; // muestras de background guardadas (las más nuevas)

function load() {
  try { return JSON.parse(localStorage.getItem(KEY)) ?? {}; } catch { return {}; }
}
function save(v) {
  try { localStorage.setItem(KEY, JSON.stringify(v)); } catch { /* sin almacenamiento */ }
}

/** Mediciones útiles: con seeders y velocidad, desde el último Restablecer, una por torrent (un
 *  pack repite la misma en cada episodio; la de la biblioteca le gana a la de background). */
function measurements(rows, since, bg = {}) {
  const byHash = new Map();
  for (const [h, l] of Object.entries(bg)) {
    if (l.measured_secs >= MIN_SECS && !(since && Date.parse(l.measured_at) <= since)) byHash.set(h, l);
  }
  for (const e of rows) {
    const l = e.live;
    if (!l || l.partial || !(l.seeds > 0) || !(l.avg_speed_bps > 0) || l.measured_secs < MIN_SECS) continue;
    if (since && Date.parse(l.measured_at) <= since) continue;
    byHash.set(e.info_hash, l);
  }
  return [...byHash.values()];
}

/** `rows`: filas de la biblioteca. `seedMbps` = aporte por seeder; `capMbps` = lo más rápido que bajó
 *  esta PC (techo del aporte total; null sin mediciones suficientes); `n` = mediciones usadas. */
export function healthCalibration(rows) {
  const cfg = load();
  const live = measurements(rows, cfg.since, cfg.bg);
  const n = live.length;
  const capMbps = n >= MIN_SAMPLES ? Math.max(...live.map((l) => (l.max_speed_bps * 8) / 1e6)) : null;
  if (cfg.seedMbps > 0) return { seedMbps: cfg.seedMbps, capMbps, n, source: 'manual' };
  if (n < MIN_SAMPLES) return { seedMbps: DEFAULT_SEED_MBPS, capMbps, n, source: 'default' };
  const perSeed = live.map((l) => (l.avg_speed_bps * 8) / 1e6 / l.seeds).sort((a, b) => a - b);
  // Cuartil inferior: conservador, un torrent con seedboxes no infla a todos.
  return { seedMbps: perSeed[Math.floor((n - 1) / 4)], capMbps, n, source: 'measured' };
}

/** Muestra de una carga en background (la última de ese torrent pisa a la anterior). */
export function addBgSample(hash, sample) {
  const cfg = load();
  const bg = { ...cfg.bg, [hash]: { ...sample, measured_at: new Date().toISOString() } };
  const keep = Object.entries(bg).sort((a, b) => Date.parse(b[1].measured_at) - Date.parse(a[1].measured_at)).slice(0, MAX_BG);
  save({ ...cfg, bg: Object.fromEntries(keep) });
}

/** Fija el aporte a mano (Ajustes). */
export const setSeedMbps = (v) => save({ ...load(), seedMbps: v });
/** Vuelve a lo medido (borra el valor fijo). */
export const recalibrate = () => { const { since, bg } = load(); save({ since, bg }); };
/** Olvida las mediciones hechas hasta ahora (también las de background) y el valor fijo: default
 *  hasta juntar `MIN_SAMPLES`. */
export const resetCalibration = () => save({ since: Date.now() });
