// Código del apodo (2026-11-24): 2 animales en orden (de los 20 de packages/ui/src/animals/animals.ts, 380 códigos) para
// que nadie escriba el apodo de otro y vea o ensucie sus Vistos. Tabla `apodos` de Neon (db/schema.sql; se crea sola si
// falta, como `vistos`): el hash scrypt con sal, la ayuda del login, fechas y fallos. Nunca se guarda ni se devuelve el
// código en claro, ni cuáles 2 de las 12 cartas de la ayuda son.
// Sin DATABASE_URL (dev local, escenas): los mismos datos en memoria del proceso; se pierden al reiniciar.
import { randomBytes, randomInt, scrypt, timingSafeEqual } from 'node:crypto';
import { sql } from './track.ts';
import { ALERT_FAILS, ANIMAL_IDS, CODE_LEN, HELP_SIZE, WAIT_SECONDS } from '../../../../packages/ui/src/animals/animals.ts';

/** Posiciones (en `ANIMAL_IDS`) de los animales elegidos, en orden. */
export type Code = number[];

/** Lo guardado de un apodo. `hash` null no pasa (sin código no hay fila); `creado` versiona la sesión. */
export type Row = {
	apodo: string;
	hash: string;
	sal: string;
	/** Las 12 cartas de la ayuda (posiciones), en el orden fijo en que se muestran. */
	ayuda: number[];
	creado: Date;
	fallos: number;
	ultimoFallo: Date | null;
	/** Hasta cuándo se rechaza otro intento (la espera de 15 s después de un error). */
	esperaHasta: Date | null;
	/** `fallos` cuando el admin marcó la alerta como vista: la alerta vuelve si hay fallos nuevos. */
	vistaFallos: number;
};

/** Dónde se guarda: Neon o memoria. `claim` reserva el intento (pone la espera) si no hay una en curso. */
export type Store = {
	get(apodo: string): Promise<Row | null>;
	/** Crea el código si el apodo no tiene; `null` si otro lo creó antes. Devuelve `creado`. */
	create(apodo: string, hash: string, sal: string, ayuda: number[]): Promise<Date | null>;
	/** `{ row }`: el intento quedó reservado (la espera ya corre); `{ wait }`: segundos que faltan; `null`: sin código. */
	claim(apodo: string): Promise<{ row: Row } | { wait: number } | null>;
	success(apodo: string): Promise<void>;
	failure(apodo: string): Promise<void>;
	reset(apodo: string): Promise<void>;
	markSeen(apodo: string): Promise<void>;
	alerts(): Promise<Row[]>;
};

const WAIT_MS = WAIT_SECONDS * 1000;

/** Valida lo que llega del cliente: `CODE_LEN` ids distintos y conocidos, en orden. */
export function parseCode(v: unknown): Code | null {
	if (!Array.isArray(v) || v.length !== CODE_LEN) return null;
	const out = v.map((id) => (typeof id === 'string' ? ANIMAL_IDS.indexOf(id) : -1));
	return out.every((n) => n >= 0) && new Set(out).size === CODE_LEN ? out : null;
}

const derive = (code: Code, sal: Buffer) =>
	new Promise<Buffer>((ok, ko) => scrypt(code.join('.'), sal, 32, { N: 2 ** 14 }, (e, k) => (e ? ko(e) : ok(k))));

export async function hashCode(code: Code): Promise<{ hash: string; sal: string }> {
	const sal = randomBytes(16);
	return { hash: (await derive(code, sal)).toString('base64'), sal: sal.toString('base64') };
}

/** Compara en tiempo constante. */
export async function checkCode(code: Code, hash: string, sal: string): Promise<boolean> {
	const want = Buffer.from(hash, 'base64');
	const got = await derive(code, Buffer.from(sal, 'base64'));
	return want.length === got.length && timingSafeEqual(want, got);
}

/** Las 12 cartas de la ayuda: el código + 10 señuelos al azar, mezclados. Se arma una vez (al crear el código) y se
 * guarda: así los señuelos son siempre los mismos y comparar intentos no deja deducir los 2. */
export function pickHelp(code: Code, rand: (max: number) => number = randomInt): number[] {
	const rest = ANIMAL_IDS.map((_, i) => i).filter((i) => !code.includes(i));
	const out = [...code];
	while (out.length < HELP_SIZE) out.push(rest.splice(rand(rest.length), 1)[0]);
	for (let i = out.length - 1; i > 0; i--) {
		const j = rand(i + 1);
		[out[i], out[j]] = [out[j], out[i]];
	}
	return out;
}

/** Orden de la grilla del login: las 12 de la ayuda y después las otras 8, en su orden de siempre. Ids. */
export const loginOrder = (ayuda: number[]): string[] =>
	[...ayuda, ...ANIMAL_IDS.map((_, i) => i).filter((i) => !ayuda.includes(i))].map((i) => ANIMAL_IDS[i]);

/** Lo que ve la pantalla del código antes de elegir. Nunca dice cuáles son los 2. */
export type Ask = { mode: 'nuevo' | 'login'; order: string[]; wait: number };

export async function ask(store: Store, apodo: string, now = Date.now()): Promise<Ask> {
	const row = await store.get(apodo);
	if (!row) return { mode: 'nuevo', order: [...ANIMAL_IDS], wait: 0 };
	return { mode: 'login', order: loginOrder(row.ayuda), wait: waitOf(row, now) };
}

const waitOf = (row: Row, now = Date.now()) => (row.esperaHasta && row.esperaHasta.getTime() > now ? Math.ceil((row.esperaHasta.getTime() - now) / 1000) : 0);

/** Resultado de crear o probar un código. `version` (ms de `creado`) va firmado en la cookie de sesión. */
export type Outcome =
	| { ok: true; version: number; created: boolean }
	| { ok: false; reason: 'wrong' | 'wait'; wait: number }
	| { ok: false; reason: 'taken' };

/** Sin código: lo crea. Con código: lo prueba (si no hay una espera en curso). */
export async function enter(store: Store, apodo: string, code: Code, mode: 'nuevo' | 'login'): Promise<Outcome> {
	if (mode === 'nuevo') {
		const { hash, sal } = await hashCode(code);
		const creado = await store.create(apodo, hash, sal, pickHelp(code));
		return creado ? { ok: true, version: creado.getTime(), created: true } : { ok: false, reason: 'taken' };
	}
	const c = await store.claim(apodo);
	if (!c) return { ok: false, reason: 'taken' };
	if ('wait' in c) return { ok: false, reason: 'wait', wait: c.wait };
	if (await checkCode(code, c.row.hash, c.row.sal)) {
		await store.success(apodo);
		return { ok: true, version: c.row.creado.getTime(), created: false };
	}
	await store.failure(apodo);
	return { ok: false, reason: 'wrong', wait: WAIT_SECONDS };
}

/** ¿La sesión firmada sigue valiendo? (el admin pudo resetear el código: entonces `creado` cambió o no hay fila). */
export async function current(store: Store, apodo: string, version: number): Promise<boolean> {
	const row = await store.get(apodo);
	return !!row && row.creado.getTime() === version;
}

/** Alerta del admin: más de `ALERT_FAILS` fallos sin resetear el código (acertar no los borra: la espera es `esperaHasta`), y alguno después de marcarla como vista. */
export const isAlert = (r: Pick<Row, 'fallos' | 'vistaFallos'>) => r.fallos > ALERT_FAILS && r.fallos > r.vistaFallos;

// ── en memoria (sin DATABASE_URL)

export function memoryStore(now: () => number = Date.now): Store {
	const rows = new Map<string, Row>();
	return {
		get: async (a) => (rows.has(a) ? { ...rows.get(a)! } : null),
		async create(a, hash, sal, ayuda) {
			if (rows.has(a)) return null;
			const creado = new Date(now());
			rows.set(a, { apodo: a, hash, sal, ayuda, creado, fallos: 0, ultimoFallo: null, esperaHasta: null, vistaFallos: 0 });
			return creado;
		},
		async claim(a) {
			const r = rows.get(a);
			if (!r) return null;
			const wait = waitOf(r, now());
			if (wait) return { wait };
			r.esperaHasta = new Date(now() + WAIT_MS);
			return { row: { ...r } };
		},
		async success(a) {
			const r = rows.get(a);
			if (r) r.esperaHasta = null;
		},
		async failure(a) {
			const r = rows.get(a);
			if (r) Object.assign(r, { fallos: r.fallos + 1, ultimoFallo: new Date(now()), esperaHasta: new Date(now() + WAIT_MS) });
		},
		reset: async (a) => void rows.delete(a),
		async markSeen(a) {
			const r = rows.get(a);
			if (r) r.vistaFallos = r.fallos;
		},
		alerts: async () => [...rows.values()].filter(isAlert).sort((x, y) => (y.ultimoFallo?.getTime() ?? 0) - (x.ultimoFallo?.getTime() ?? 0))
	};
}

// ── Neon

type DbRow = { apodo: string; hash: string; sal: string; ayuda: number[]; creado: string | Date; fallos: number; ultimo_fallo: string | Date | null; espera_hasta: string | Date | null; vista_fallos: number };
const toRow = (r: DbRow): Row => ({
	apodo: r.apodo, hash: r.hash, sal: r.sal, ayuda: r.ayuda.map(Number), creado: new Date(r.creado), fallos: r.fallos,
	ultimoFallo: r.ultimo_fallo ? new Date(r.ultimo_fallo) : null, esperaHasta: r.espera_hasta ? new Date(r.espera_hasta) : null,
	vistaFallos: r.vista_fallos
});

function neonStore(q: NonNullable<ReturnType<typeof sql>>): Store {
	let ready: Promise<unknown> | null = null;
	const db = async () => {
		ready ??= q`CREATE TABLE IF NOT EXISTS apodos (
			apodo text PRIMARY KEY, hash text NOT NULL, sal text NOT NULL, ayuda smallint[] NOT NULL,
			creado timestamptz NOT NULL DEFAULT now(), fallos integer NOT NULL DEFAULT 0, ultimo_fallo timestamptz,
			espera_hasta timestamptz, vista_fallos integer NOT NULL DEFAULT 0)`.catch((e) => ((ready = null), Promise.reject(e)));
		await ready;
		return q;
	};
	const one = async (p: Promise<unknown>) => ((await p) as DbRow[]).map(toRow)[0] ?? null;
	return {
		get: async (a) => one((await db())`SELECT * FROM apodos WHERE apodo = ${a}`),
		async create(a, hash, sal, ayuda) {
			const r = await one((await db())`INSERT INTO apodos (apodo, hash, sal, ayuda) VALUES (${a}, ${hash}, ${sal}, ${ayuda})
				ON CONFLICT (apodo) DO NOTHING RETURNING *`);
			return r?.creado ?? null;
		},
		async claim(a) {
			const d = await db();
			// Atómico: dos intentos a la vez no pasan los dos.
			const r = await one(d`UPDATE apodos SET espera_hasta = now() + make_interval(secs => ${WAIT_SECONDS})
				WHERE apodo = ${a} AND (espera_hasta IS NULL OR espera_hasta <= now()) RETURNING *`);
			if (r) return { row: r };
			const [w] = (await d`SELECT ceil(extract(epoch FROM espera_hasta - now()))::int AS wait FROM apodos WHERE apodo = ${a}`) as { wait: number | null }[];
			return w ? { wait: Math.max(1, w.wait ?? 1) } : null;
		},
		success: async (a) => void (await (await db())`UPDATE apodos SET espera_hasta = NULL WHERE apodo = ${a}`),
		failure: async (a) =>
			void (await (await db())`UPDATE apodos SET fallos = fallos + 1, ultimo_fallo = now(),
				espera_hasta = now() + make_interval(secs => ${WAIT_SECONDS}) WHERE apodo = ${a}`),
		reset: async (a) => void (await (await db())`DELETE FROM apodos WHERE apodo = ${a}`),
		markSeen: async (a) => void (await (await db())`UPDATE apodos SET vista_fallos = fallos WHERE apodo = ${a}`),
		alerts: async () =>
			((await (await db())`SELECT * FROM apodos WHERE fallos > ${ALERT_FAILS} AND fallos > vista_fallos ORDER BY ultimo_fallo DESC`) as DbRow[]).map(toRow)
	};
}

let chosen: Store | null = null;
/** Neon si hay DATABASE_URL; si no, memoria del proceso. */
export const store = (): Store => {
	if (chosen) return chosen;
	const q = sql();
	return (chosen = q ? neonStore(q) : memoryStore());
};
