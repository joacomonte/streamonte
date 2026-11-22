// Salud estimada del stream (salud fiel, 2026-11-16): cuentas puras, sin DOM ni almacenamiento. El desktop guarda lo medido
// y la red actual en `ui/src/health-store.ts` y le pasa eso a estas funciones. Spec: docs/plans/salud-fiel/salud-fiel.spec.md.
// Lo "real" es lo que bajó una reproducción en sus minutos 2 a 5; cada evidencia del análisis aprende cuánto se equivoca en
// esta red. Lo que se muestra (`predict`) y lo que evalúa la fidelidad son la misma predicción.
import { toMbps, typicalMbps } from '../rank.ts';

/** Lo que sabía el análisis de una opción al predecir su velocidad (`evidenceOf` del catálogo). */
export type HealthEvidence = {
	analysis_mbps?: number | null;
	tracker_seeds?: number | null;
	tracker_leechers?: number | null;
	counted_seeds?: number | null;
	counted_leech?: number | null;
	need_mbps?: number | null;
	known?: number | null;
	dht?: number | null;
};
/** Medición guardada (localStorage `streamonte.health` → `bg`) o de la biblioteca; `ev`/`real_mbps` si ya es muestra. */
export type HealthMeasurement = {
	hash?: string;
	name?: string;
	source?: string;
	seeds?: number;
	avg_speed_bps: number;
	max_speed_bps: number;
	sustained_bps?: number;
	measured_secs: number;
	measured_at: string;
	network?: string | null;
	partial?: boolean;
	ev?: HealthEvidence;
	real_mbps?: number;
	short?: boolean;
	window_secs?: number;
	real_seeds?: number;
	real_peers?: number;
	real_incoming?: number;
	known_peers?: number | null;
	dht_peers?: number | null;
	weight?: number;
	tracker_seeds?: number | null;
	tracker_leechers?: number | null;
};
/** Muestra que enseña (`learnable`). */
export type HealthSample = HealthMeasurement & { ev: HealthEvidence; real_mbps: number; weight?: number };
export type HealthKind = 'measured' | 'counted' | 'tracker';
export type HealthBias = { bias: number; factor: number; n: number; nEff: number; lo: number; hi: number };
export type HealthBiasMap = Partial<Record<HealthKind, HealthBias>>;
/** Entrada de `predict`/`rangeOf`: `{bias, manual, capMbps}`. */
export type HealthCalInput = { bias?: HealthBiasMap; manual?: number | null; capMbps?: number | null };
/** Rango en Mbps de una predicción. */
export type HealthRange = { kind: HealthKind; lo: number; p50: number; p75: number; hi: number; conf: 'alta' | 'media' | 'baja' };
export type ShownLevel = { level: number; shown: number; probable: boolean };
export type HealthFidelity = {
	n: number;
	biasBefore: number;
	biasAfter: number;
	typBefore: number;
	typAfter: number;
	hits: number;
	pessimistic: number;
	optimistic: number;
	inBand: number;
};
/** Resultado de `calibration`. */
export type HealthCalibration = {
	capMbps: number | null;
	capFrom: 'test' | 'measured' | null;
	samples: HealthMeasurement[];
	learnable: HealthSample[];
	bias: Record<HealthKind, HealthBias>;
	manual: number | null;
	n: number;
	trackerN: number;
	seedMbps: number;
	trackerSeedMbps: number;
	measuredFactor: number;
	source: 'manual' | 'measured' | 'default';
};
/** Lo guardado en localStorage (lo lee y escribe `ui/src/health-store.ts`). */
export type HealthStore = {
	since?: number;
	seedMbps?: number;
	bg?: Record<string, HealthMeasurement>;
	pred?: Record<string, HealthEvidence & { at: string }>;
	net?: Record<string, { open: boolean; at: string }>;
};
/** Lo que `calibration` lee de una fila de la biblioteca (desktop). */
export type MeasuredRow = {
	info_hash: string;
	name: string;
	torrent_name?: string | null;
	live: { partial: boolean; seeds: number; avg_speed_bps: number; max_speed_bps: number; measured_secs: number; measured_at: string } | null;
};

/** Aporte por seeder sin mediciones suficientes: conservador (un seeder casero sube ~10–20 Mbps repartidos en 4–6
 * conexiones). La única medición real al escribirlo dio ~26 (seedboxes). */
export const DEFAULT_SEED_MBPS = 3;
/** Mediciones mínimas para confiar en lo medido (por debajo: el default y sin tope). */
export const MIN_SAMPLES = 3;
/** Reproducciones (nEff) para mostrar salud estimada solo con seeders de trackers. */
export const TRACKER_MIN = 5;
/** Segundos de descarga para que una medición cuente: menos es más arranque que velocidad sostenida. */
export const MIN_SECS = 10;
/** Ventana de "lo real" (segundos de descarga activa): 120–300; si se cortó antes, 30→fin a medio peso. */
export const WIN_FROM = 120, WIN_TO = 300, WIN_MIN = 60, SHORT_FROM = 30, SHORT_MIN = 30;
/** Muestras equivalentes del "sin sesgo" y vida media de una muestra (días). */
const PRIOR_N = 2, HALF_LIFE_DAYS = 30;
const BIAS_MIN = -Math.log(4), BIAS_MAX = Math.log(20);
const MIN_PRED_MBPS = 0.5;
const LEECH = 1 / 6;
/** Evidencias: la medición del análisis (manda) y las estimaciones por seeders. */
export const KINDS: HealthKind[] = ['measured', 'counted', 'tracker'];
/** Banda sin muestras propias, × la predicción corregida: [lo, p75, hi]. Por seeders es amplia (el ×8 ≈ la única medición
 * real de seedboxes); una medición, angosta. */
const PRIOR_BAND = { seeds: [0.5, 4, 8], measured: [0.8, 1.5, 2.5] };

/** Velocidad sostenida de una medición, en Mbps (lo superado el 75 % del tiempo). */
const sustainedMbps = (l: HealthMeasurement): number => ((l.sustained_bps ?? l.avg_speed_bps) * 8) / 1e6;
/** Mediana: con pares toma la mitad baja. */
const median = (xs: number[]): number => {
	const s = [...xs].sort((a, b) => a - b);
	return s[Math.floor((s.length - 1) / 2)] ?? 0;
};
/** Piso sostenido: la velocidad que se superó el 75 % del tiempo (percentil 25). */
export const sustained = (speeds: number[]): number => [...speeds].sort((a, b) => a - b)[Math.floor((speeds.length - 1) / 4)] ?? 0;

export const levelOf = (ratio: number): 0 | 1 | 2 => (ratio >= 2 ? 0 : ratio >= 1 ? 1 : 2);

/** Predicción SIN corregir de una evidencia, en Mbps (null si no la hay). */
export function rawPrediction(ev: HealthEvidence | null | undefined, kind: HealthKind): number | null {
	if (!ev) return null;
	if (kind === 'measured') return (ev.analysis_mbps ?? 0) > 0 ? (ev.analysis_mbps ?? null) : null;
	const [s, l] = kind === 'tracker' ? [ev.tracker_seeds, ev.tracker_leechers] : [ev.counted_seeds, ev.counted_leech];
	if (s == null || (kind === 'tracker' && !(s > 0))) return null; // 0 de tracker: no confiable
	return Math.max(MIN_PRED_MBPS, (s + (l ?? 0) * LEECH) * DEFAULT_SEED_MBPS);
}

/** Cuantil ponderado de `[[x, peso]]` (el primero cuyo peso acumulado llega a `p` del total). */
function weightedQuantile(pts: [number, number][], p: number): number {
	const s = [...pts].sort((a, b) => a[0] - b[0]);
	const total = s.reduce((t, [, w]) => t + w, 0);
	let acc = 0;
	for (const [x, w] of s) {
		acc += w;
		if (acc >= total * p) return x;
	}
	return 0;
}

/** Sesgo aprendido por evidencia: mediana ponderada (por antigüedad) de ln(real ÷ predicción), contraída hacia 0 con PRIOR_N
 * muestras equivalentes; `lo`/`hi` = cuartiles de esos ln menos la mediana (ancho del rango). Las topadas por la línea que
 * dan pesimista no enseñan: fuera. */
export function learnBias(samples: HealthSample[], nowMs: number, link: number | null | undefined): Record<HealthKind, HealthBias> {
	const one = (kind: HealthKind): HealthBias => {
		const pts: [number, number][] = [];
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
		return { bias, factor: Math.exp(bias), n: pts.length, nEff, lo: pts.length ? weightedQuantile(pts, 0.25) - m : 0, hi: pts.length ? weightedQuantile(pts, 0.75) - m : 0 };
	};
	return { measured: one('measured'), counted: one('counted'), tracker: one('tracker') };
}

/** Rango corregido de una evidencia: `{kind, lo, p50, p75, hi, conf}` en Mbps, o null sin ella. */
function rangeOf(ev: HealthEvidence | null | undefined, kind: HealthKind, cal: HealthCalInput): HealthRange | null {
	const raw = rawPrediction(ev, kind);
	if (raw == null) return null;
	const bySeeds = kind !== 'measured';
	const cap = (x: number): number => (bySeeds && cal.capMbps ? Math.min(x, cal.capMbps) : x);
	if (bySeeds && cal.manual) {
		const v = cap((raw / DEFAULT_SEED_MBPS) * cal.manual);
		return { kind, lo: v, p50: v, p75: v, hi: v, conf: 'media' };
	}
	const b = cal.bias?.[kind] ?? { factor: 1, nEff: 0, lo: 0, hi: 0 };
	const p50 = raw * b.factor;
	let lo: number, p75: number, hi: number, conf: HealthRange['conf'];
	if (b.nEff >= MIN_SAMPLES) {
		const w = 1 / (2 * Math.sqrt(b.nEff)); // pocas muestras: los cuartiles subestiman la dispersión
		lo = p50 * Math.exp(b.lo) * (1 - w);
		p75 = p50 * Math.exp(b.hi);
		conf = 'media';
		hi = p75 * (1 + w);
	} else {
		const [fl = 1, f75 = 1, fh = 1] = bySeeds ? PRIOR_BAND.seeds : PRIOR_BAND.measured;
		[lo, p75, hi, conf] = [p50 * fl, p50 * f75, p50 * fh, 'baja'];
	}
	return { kind, lo: cap(lo), p50: cap(p50), p75: cap(p75), hi: cap(hi), conf };
}

/** Lo que el catálogo muestra de una opción y lo que `fidelity` evalúa: la medición manda (B6); si no, entre seeders contados
 * y de trackers gana el p50 más alto (todas subestiman); con 0 contados los trackers no entran. */
export function predict(ev: HealthEvidence | null | undefined, cal: HealthCalInput): HealthRange | null {
	const measured = rangeOf(ev, 'measured', cal);
	if (measured) return measured;
	const counted = rangeOf(ev, 'counted', cal);
	const tracker = ev?.counted_seeds === 0 ? null : rangeOf(ev, 'tracker', cal);
	return [counted, tracker].reduce<HealthRange | null>((a, b) => (b && (!a || b.p50 > a.p50) ? b : a), null);
}

/** Nivel del p50 y nivel mostrado: sube uno ("probable") si el p75 alcanza el de arriba. */
export function shownLevel(r: { p50: number; p75: number; conf: HealthRange['conf'] }, need: number): ShownLevel {
	const level = levelOf(r.p50 / need);
	const probable = r.conf !== 'alta' && level > 0 && levelOf(r.p75 / need) < level;
	return { level, shown: probable ? level - 1 : level, probable };
}

type FidRow = { before: number; after: number; hit: boolean; pess: boolean; opt: boolean; inBand: boolean };
/** Qué tan fiel fue la salud en esta red: cada muestra se predice con lo aprendido SOLO de las anteriores.
 * err = ln(predicción ÷ real): < 0 = pesimista. */
export function fidelity(samples: HealthSample[], link: number | null): HealthFidelity | null {
	const asc = [...samples].sort((a, b) => Date.parse(a.measured_at) - Date.parse(b.measured_at));
	const rows: FidRow[] = [];
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
	const med = (f: (r: FidRow) => number): number => median(rows.map(f));
	const count = (f: (r: FidRow) => boolean): number => rows.filter(f).length;
	return { n: rows.length, biasBefore: med((r) => r.before), biasAfter: med((r) => r.after), typBefore: med((r) => Math.abs(r.before)), typAfter: med((r) => Math.abs(r.after)),
		hits: count((r) => r.hit), pessimistic: count((r) => r.pess), optimistic: count((r) => r.opt), inBand: count((r) => r.inBand) };
}

/** Muestra lista para aprender (migración al leer, nada se reescribe). Null = no aprende: las del análisis (son predicción)
 * y las viejas de menos de 2 min. */
function learnable(l: HealthMeasurement): HealthSample | null {
	if (l.ev && l.real_mbps && l.real_mbps > 0) return { ...l, ev: l.ev, real_mbps: l.real_mbps, weight: l.short ? 0.5 : 1 };
	if (l.source === 'análisis' || !(l.measured_secs >= WIN_FROM)) return null;
	// Viejas: su p25 incluye el arranque (pesimista) → medio peso. Un 0 viejo no es "0 contados".
	return { ...l, weight: 0.5, real_mbps: sustainedMbps(l),
		ev: { counted_seeds: (l.seeds ?? 0) > 0 ? (l.seeds ?? null) : null, counted_leech: null, tracker_seeds: l.tracker_seeds ?? null,
			tracker_leechers: l.tracker_leechers ?? null, analysis_mbps: null, need_mbps: null } };
}

/** Mediciones útiles, una por torrent (un pack repite la misma en cada episodio; la de la biblioteca le gana a la guardada),
 * desde el último Restablecer y de esta red (`network`; las viejas sin red se toman como de esta). */
function measurements(rows: Iterable<MeasuredRow>, cfg: HealthStore, network: string | null): HealthMeasurement[] {
	const byHash = new Map<string, HealthMeasurement>();
	const fresh = (l: { measured_secs: number; measured_at: string; network?: string | null }): boolean =>
		l.measured_secs >= MIN_SECS && !(cfg.since && Date.parse(l.measured_at) <= cfg.since) && !(network && l.network && l.network !== network);
	for (const [hash, l] of Object.entries(cfg.bg ?? {})) if (fresh(l)) byHash.set(hash, { hash, ...l });
	for (const e of rows) {
		const l = e.live;
		if (!l || l.partial || !(l.seeds > 0) || !(l.avg_speed_bps > 0) || !fresh({ ...l, network: null })) continue;
		byHash.set(e.info_hash, { hash: e.info_hash, name: e.torrent_name || e.name, source: 'análisis', ...l });
	}
	return [...byHash.values()];
}

/** `rows`: filas de la biblioteca; `cfg`: lo guardado; `link`: velocidad de internet medida (Mbps) o null; `network`: red
 * actual. `bias` = sesgo aprendido por evidencia; `manual` = Mbps por seeder fijados a mano o null; `seedMbps`/
 * `trackerSeedMbps` = 3 Mbps × su factor; `capMbps` = techo (test de velocidad o lo más rápido medido). */
export function calibration(rows: Iterable<MeasuredRow>, cfg: HealthStore, link: number | null, network: string | null, nowMs: number): HealthCalibration {
	const samples = measurements(rows, cfg, network).sort((a, b) => Date.parse(b.measured_at) - Date.parse(a.measured_at));
	const fastest = samples.length >= MIN_SAMPLES ? Math.max(...samples.map((l) => (l.max_speed_bps * 8) / 1e6)) : null;
	const capMbps = link ?? fastest;
	const capFrom = link ? 'test' : fastest ? 'measured' : null;
	const learn = samples.map(learnable).filter((s): s is HealthSample => !!s);
	const bias = learnBias(learn, nowMs, link);
	const manual = (cfg.seedMbps ?? 0) > 0 ? (cfg.seedMbps ?? null) : null;
	return {
		capMbps, capFrom, samples, learnable: learn, bias, manual,
		n: bias.counted.n, trackerN: bias.tracker.n,
		seedMbps: manual ?? DEFAULT_SEED_MBPS * bias.counted.factor,
		trackerSeedMbps: manual ?? DEFAULT_SEED_MBPS * bias.tracker.factor,
		measuredFactor: bias.measured.factor,
		source: manual ? 'manual' : bias.counted.n ? 'measured' : 'default'
	};
}

/** Rango de Mbps de la salud: el de `predict` o, si ya baja, el medido ahora (`'now'`). */
export type HealthNowRange = Omit<HealthRange, 'kind'> & { kind: HealthKind | 'now' };
/** Veredicto de salud: nivel, rango, de dónde sale; `ev` y `cal` son lo que usó. */
export type Health = ShownLevel & {
	range: HealthNowRange;
	basis: HealthNowRange['kind'];
	conf: HealthRange['conf'];
	ratio: number;
	supply: number;
	need: number;
	exact: boolean;
	ev: HealthEvidence | null;
	cal: HealthCalInput;
};

/** Salud del stream: un RANGO de Mbps contra lo que pide (tamaño ÷ duración). Lo que baja ahora manda; si no, `predict`
 * corregido con lo aprendido en esta red. `level` = nivel del p50 (0 ≥ 2×, 1 ≥ 1×, 2); `shown` sube uno si el p75 alcanza
 * ("probable"). Null si solo hay trackers y esta red todavía no aprendió cuánto se equivocan (< `trackerMin` reproducciones:
 * queda "Verificar salud"). `now` = velocidad medida de lo que baja ahora (bytes/s). */
export function healthOf(p: { resolution: string | null | undefined; bps: number | null; cal: HealthCalInput; ev: HealthEvidence | null; now: { n: number; avg: number } | null | undefined; trackerMin: number }): Health | null {
	const { resolution, bps, cal, ev, now, trackerMin } = p;
	// Lo que baja ahora (reproduciendo o ⤓, ≥ MIN_SECS) es lo real: manda, sin corregir (B6).
	const nowMbps = now && now.n >= MIN_SECS ? toMbps(now.avg) : null;
	const r: HealthNowRange | null = nowMbps ? { kind: 'now', lo: nowMbps, p50: nowMbps, p75: nowMbps, hi: nowMbps, conf: 'alta' } : ev && predict(ev, cal);
	if (!r || (r.kind === 'tracker' && ev?.counted_seeds == null && !((cal.bias?.tracker?.nEff ?? 0) >= trackerMin))) return null;
	const need = ev?.need_mbps ?? (bps ? toMbps(bps) : typicalMbps(resolution));
	return { ...shownLevel(r, need), range: r, basis: r.kind, conf: r.conf, ratio: r.p50 / need, supply: r.p50, need, exact: !!bps, ev, cal };
}
