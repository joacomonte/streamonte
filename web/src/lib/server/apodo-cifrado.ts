// Código del apodo cifrado (2026-11-24): el par de animales en AES-256-GCM, para que Ajustes se lo muestre a su dueño.
// Clave = HKDF(APODO_SECRET, contexto propio), distinta de la del HMAC de la cookie. IV al azar; el tag va guardado.
// Formato guardado: base64(iv 12 | tag 16 | cifrado). Cambiar APODO_SECRET lo vuelve ilegible (se completa al acertar).
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';

let devSecret: string | null = null;
/** APODO_SECRET (en Vercel falla si falta; en local, uno al azar por proceso). Lo usan también las cookies. */
export function secret(): string {
	const s = process.env.APODO_SECRET;
	if (s) return s;
	if (process.env.VERCEL) throw new Error('Falta APODO_SECRET');
	return (devSecret ??= randomBytes(32).toString('base64'));
}

const key = (s: string) => Buffer.from(hkdfSync('sha256', s, '', 'streamonte apodo codigo-cifrado v1', 32));

/** Cifra la posición de los animales (`Code`), en orden. */
export function sealCode(code: number[], s = secret()): string {
	const iv = randomBytes(12);
	const c = createCipheriv('aes-256-gcm', key(s), iv);
	const body = Buffer.concat([c.update(code.join('.'), 'utf8'), c.final()]);
	return Buffer.concat([iv, c.getAuthTag(), body]).toString('base64');
}

/** Descifra; `null` si no es válido o la clave no es la misma. */
export function openCode(sealed: string, s = secret()): number[] | null {
	try {
		const b = Buffer.from(sealed, 'base64');
		const d = createDecipheriv('aes-256-gcm', key(s), b.subarray(0, 12));
		d.setAuthTag(b.subarray(12, 28));
		const text = Buffer.concat([d.update(b.subarray(28)), d.final()]).toString('utf8');
		const code = text.split('.').map(Number);
		return code.length > 0 && code.every(Number.isInteger) ? code : null;
	} catch {
		return null;
	}
}
