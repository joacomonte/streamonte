// Sesión del apodo (2026-11-24): cookie `apodo` httpOnly y firmada (HMAC-SHA256 con APODO_SECRET) que prueba que este
// navegador creó o acertó el código del apodo. Lleva la versión del código (`creado` en ms): si el admin lo resetea,
// la cookie deja de valer. /api/nick la pone; vistos, track y el layout confían solo en esto (nunca en un apodo que
// llegue del cliente). Sin APODO_SECRET: en Vercel falla (no hay sesión sin secreto); en local, uno al azar por proceso.
import { createHmac, timingSafeEqual } from 'node:crypto';
import { current, store, type Store } from './apodos.ts';
import { openCode, secret } from './apodo-cifrado.ts';
import { ANIMAL_IDS } from '../../../../packages/ui/src/animals/animals.ts';
import { cleanNick } from '../nick.ts';

export const COOKIE = 'apodo';
/** 5 años, como `dev`: se corta reseteando el código. */
export const MAX_AGE = 60 * 60 * 24 * 365 * 5;

/** ¿Se puede firmar la sesión? Se mira ANTES de crear o probar un código: si no, quedaría un código creado sin sesión. */
export function canSign(): boolean {
	try {
		return !!secret();
	} catch {
		return false;
	}
}

const mac = (nick: string, version: number, key: string) => createHmac('sha256', key).update(`apodo\n${nick}\n${version}`).digest();

/** Valor de la cookie: `<apodo en base64url>.<versión>.<firma>`. */
export function sign(nick: string, version: number, key = secret()): string {
	return `${Buffer.from(nick).toString('base64url')}.${version}.${mac(nick, version, key).toString('base64url')}`;
}

/** Apodo y versión de una cookie bien firmada (no mira si el código sigue igual). */
export function unsign(value: string | undefined, key = secret()): { nick: string; version: number } | null {
	const [n, v, m] = (value ?? '').split('.');
	if (!n || !v || !m || !/^\d{1,15}$/.test(v)) return null;
	const nick = cleanNick(Buffer.from(n, 'base64url').toString()).nick;
	if (!nick) return null;
	const want = mac(nick, Number(v), key);
	const got = Buffer.from(m, 'base64url');
	return got.length === want.length && timingSafeEqual(got, want) ? { nick, version: Number(v) } : null;
}

/** El apodo verificado de este pedido, o null. */
export async function verifiedNick(get: (name: string) => string | undefined, s: Store = store()): Promise<string | null> {
	try {
		const c = unsign(get(COOKIE));
		return c && (await current(s, c.nick, c.version)) ? c.nick : null;
	} catch (e) {
		console.error('apodo', e);
		return null;
	}
}

/** Los 2 animales (ids, en orden) del dueño con sesión verificada; `null` si no hay sesión. `animals` es null si el código
 * se creó antes del cifrado y todavía no se completó (se completa al acertarlo). Nunca de otro apodo que el de la cookie. */
export async function ownAnimals(get: (name: string) => string | undefined, s: Store = store()): Promise<{ nick: string; animals: string[] | null } | null> {
	const nick = await verifiedNick(get, s);
	if (!nick) return null;
	const row = await s.get(nick);
	const code = row?.cifrado ? openCode(row.cifrado) : null;
	return { nick, animals: code ? code.map((i) => ANIMAL_IDS[i]) : null };
}
