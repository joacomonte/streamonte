import { json } from '@sveltejs/kit';

/** Error con texto para mostrar al usuario. */
export class Fail extends Error {
	/** @param {number} status @param {string} message */
	constructor(status, message) {
		super(message);
		this.status = status;
	}
}

/** Envuelve un endpoint: devuelve JSON y, si falla, `{message}` con el status (nunca la URL, que puede llevar keys).
 * @param {(event: import('@sveltejs/kit').RequestEvent<Record<string, string>>) => Promise<unknown>} fn */
export const route = (fn) => async (/** @type {any} */ event) => {
	try {
		const out = await fn(event);
		return out instanceof Response ? out : json(out);
	} catch (e) {
		const fail = e instanceof Fail;
		if (!fail) console.error(e);
		const msg = fail ? e.message : `Falló: ${/** @type {Error} */ (e)?.message ?? e}`;
		return json({ message: msg }, { status: fail ? e.status : 500 });
	}
};

/** fetch con tope de tiempo. @param {string | URL} url @param {RequestInit} [init] */
export async function get(url, init = {}, ms = 12_000) {
	return fetch(url, { ...init, signal: AbortSignal.timeout(ms) });
}
