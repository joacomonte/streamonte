// Calibración de la "salud estimada" del catálogo (desktop), por PC y por red: lo medido en las reproducciones y lo que eligió
// el usuario en Ajustes va a localStorage; la red y la velocidad de internet las fija el test (`speed-instance.ts`). Las
// cuentas son puras y viven en `$ui/options/health.ts`. Cada cambio avisa con `health-calib-changed`.
import {
	calibration, KINDS, rawPrediction, sustained, SHORT_FROM, SHORT_MIN, WIN_FROM, WIN_MIN, WIN_TO,
	type HealthCalibration, type HealthEvidence, type HealthMeasurement, type HealthStore, type MeasuredRow
} from '$ui/options/health.ts';
import type { PlaybackRow } from './types.ts';

export { DEFAULT_SEED_MBPS, MIN_SAMPLES, TRACKER_MIN, fidelity, predict } from '$ui/options/health.ts';

const KEY = 'streamonte.health';
const MAX_SAMPLES = 30; // mediciones guardadas (las más nuevas)
const PRED_TTL_MS = 6 * 3600e3, MAX_PRED = 60;
/** Segundos bajando sin ningún peer entrante para dar el puerto por cerrado. */
const INCOMING_SECS = 120;

/** Velocidad de internet de esta red (test de velocidad), en Mbps; null sin medir. */
let linkMbps: number | null = null;
/** Red actual (hash que da el test): cada red calibra aparte. Null hasta que responde el test. */
let network: string | null = null;
/** Red actual (null hasta que responde el test): la usa el log del censo. */
export const currentNetwork = (): string | null => network;
export function setLinkMbps(v: number, net: string | null = null): void {
	linkMbps = v > 0 ? v : null;
	network = net || null;
	window.dispatchEvent(new Event('health-calib-changed'));
}

function load(): HealthStore {
	try {
		const v: unknown = JSON.parse(localStorage.getItem(KEY) ?? 'null');
		return v && typeof v === 'object' ? (v as HealthStore) : {};
	} catch {
		return {};
	}
}
function save(v: HealthStore): void {
	try {
		localStorage.setItem(KEY, JSON.stringify(v));
	} catch {
		/* sin almacenamiento */
	}
	window.dispatchEvent(new Event('health-calib-changed'));
}

/** Calibración actual a partir de las filas de la biblioteca (ver `calibration`). */
export const healthCalibration = (rows: Iterable<MeasuredRow>): HealthCalibration => calibration(rows, load(), linkMbps, network, Date.now());

// ---------- medición automática mientras baja ----------
/** Reproducción que se está midiendo. `sum / n` = promedio de `speed_bps` (bytes/s, una muestra por evento ~1 s). */
type Tracked = { id: number; name: string; sum: number; n: number; max: number; speeds: number[]; win: number[][]; incoming: number; ev: HealthEvidence | undefined; source?: string; done?: boolean; active?: boolean };
/** Por video (`key`): la reproducción que se está midiendo. Solo de esta sesión. */
const playing = new Map<string, Tracked>();

/** Cada fila de reproducción del núcleo. `ev` = lo que sabía el análisis (respaldo si no hay foto fresca de `notePrediction`).
 * Sin evidencia se mide igual (la usa "Bajar de fondo") pero no calibra. */
export function trackPlayback(row: PlaybackRow, ev?: HealthEvidence): void {
	const hash = row.key.split(':')[0] ?? '';
	let t = playing.get(row.key);
	if (!t || t.id !== row.id) {
		const p = load().pred?.[hash];
		t = { id: row.id, name: row.name, sum: 0, n: 0, max: 0, speeds: [], win: [], incoming: 0, ev: p && Date.now() - Date.parse(p.at) < PRED_TTL_MS ? p : ev };
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
	if (t.n > SHORT_FROM && t.n <= WIN_TO && (row.progress ?? 0) < 0.95) t.win.push([t.n, row.speed_bps, row.seeds ?? 0, row.peers ?? 0, row.incoming_peers ?? 0]);
	t.incoming = Math.max(t.incoming, row.incoming_peers ?? 0);
	noteIncoming(t);
	// Cada 10 s se guarda (pisa la anterior de ese torrent): si se corta, queda lo medido hasta ahí.
	// Solo enseña si alguna evidencia predijo algo (si no, no hay contra qué comparar).
	const tracked = t;
	const predicts = KINDS.some((k) => rawPrediction(tracked.ev, k) != null);
	if (predicts && t.n % 10 === 0 && t.n <= WIN_TO + 10) addSample(hash, t);
	else window.dispatchEvent(new Event('health-calib-changed'));
}

/** Velocidad medida de ese video en esta sesión: `{avg, max, n, done}` en bytes/s, o null. */
export function speedOf(key: string): { avg: number; max: number; n: number; done: boolean | undefined } | null {
	const t = playing.get(key);
	return t ? { avg: t.n ? t.sum / t.n : 0, max: t.max, n: t.n, done: t.done } : null;
}

/** Lo que se está midiendo ahora (para el panel de Ajustes). */
export function measuringNow(): { name: string; source: string | undefined; ev: HealthEvidence | undefined; avg_speed_bps: number; secs: number }[] {
	return [...playing.values()].filter((t) => t.active).map((t) => ({ name: t.name, source: t.source, ev: t.ev, avg_speed_bps: t.n ? t.sum / t.n : 0, secs: t.n }));
}

/** Foto de lo que sabía el análisis al tocar ▶/⤓ (el panel está abierto): la usa la reproducción aunque después se cierre. */
export function notePrediction(hash: string, ev: HealthEvidence | null | undefined): void {
	if (!ev) return;
	const cfg = load();
	const all = { ...cfg.pred, [hash]: { ...ev, at: new Date().toISOString() } };
	const keep = Object.entries(all).sort((a, b) => Date.parse(b[1].at) - Date.parse(a[1].at)).slice(0, MAX_PRED);
	save({ ...cfg, pred: Object.fromEntries(keep) });
}

function addSample(hash: string, t: Tracked): void {
	const full = t.win.filter(([s = 0]) => s > WIN_FROM);
	const short = full.length < WIN_MIN;
	const w = short ? t.win : full;
	if (w.length < (short ? SHORT_MIN : WIN_MIN)) return;
	const col = (i: number): number[] => w.map((x) => x[i] ?? 0);
	const cfg = load();
	const sample: HealthMeasurement = { name: t.name, source: t.source, ev: t.ev, real_mbps: (sustained(col(1)) * 8) / 1e6, short, window_secs: w.length,
		real_seeds: Math.max(...col(2)), real_peers: Math.max(...col(3)), real_incoming: Math.max(...col(4)),
		known_peers: t.ev?.known ?? null, dht_peers: t.ev?.dht ?? null,
		avg_speed_bps: t.sum / t.n, sustained_bps: sustained(t.speeds), max_speed_bps: t.max, measured_secs: t.n,
		measured_at: new Date().toISOString(), network };
	const all = { ...cfg.bg, [hash]: sample };
	const keep = Object.entries(all).sort((a, b) => Date.parse(b[1].measured_at) - Date.parse(a[1].measured_at)).slice(0, MAX_SAMPLES);
	save({ ...cfg, bg: Object.fromEntries(keep) });
}

/** Fija el aporte a mano (Ajustes). */
export const setSeedMbps = (v: number): void => save({ ...load(), seedMbps: v });
/** Vuelve a lo medido (borra el valor fijo). */
export const recalibrate = (): void => {
	const { seedMbps: _omit, ...rest } = load();
	save(rest);
};
/** Olvida las mediciones hechas hasta ahora y el valor fijo: default hasta juntar `MIN_SAMPLES`. */
export const resetCalibration = (): void => save({ since: Date.now() });

// ---------- conexiones entrantes (2026-11-16) ----------
/** ¿Llegan conexiones entrantes en esta red? Sale de las reproducciones reales (IPv4 e IPv6). Se guarda por red. */
function noteIncoming(t: Tracked): void {
	if (!network || (!t.incoming && t.n < INCOMING_SECS)) return;
	const cfg = load();
	const prev = cfg.net?.[network];
	const open = t.incoming > 0;
	if (prev?.open === open && t.n % 60) return; // sin cambios: se refresca la fecha cada minuto
	save({ ...cfg, net: { ...cfg.net, [network]: { open, at: new Date().toISOString() } } });
}

/** `{open, at}` de la red actual, o null si todavía no se vio una reproducción de 2 min. */
export const incomingStatus = (): { open: boolean; at: string } | null => (network ? (load().net?.[network] ?? null) : null);
