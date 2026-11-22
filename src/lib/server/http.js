import { json } from '@sveltejs/kit';
import { tx } from './lang.js';

/** Error con texto para mostrar al usuario: el texto en español es la clave del diccionario (i18n/en.js) y
 * `vars` completa sus `{x}`; se traduce al idioma del pedido al responder. */
export class Fail extends Error {
	/** @param {number} status @param {string} message @param {Record<string, string | number>} [vars] */
	constructor(status, message, vars) {
		super(message);
		this.status = status;
		this.vars = vars;
	}
}

/** Envuelve un endpoint: devuelve JSON y, si falla, `{message}` con el status (nunca la URL, que puede llevar keys).
 * @param {(event: import('@sveltejs/kit').RequestEvent<Record<string, string>>) => Promise<unknown>} fn */
export const route = (fn) => async (/** @type {import('@sveltejs/kit').RequestEvent<Record<string, string>>} */ event) => {
	try {
		const out = await fn(event);
		return out instanceof Response ? out : json(out);
	} catch (e) {
		const fail = e instanceof Fail;
		if (!fail) console.error(e);
		const msg = fail ? tx(e.message, e.vars) : tx('Falló: {m}', { m: String(/** @type {Error} */ (e)?.message ?? e) });
		return json({ message: msg }, { status: fail ? e.status : 500 });
	}
};

/** fetch con tope de tiempo. @param {string | URL} url @param {RequestInit} [init] */
export async function get(url, init = {}, ms = 12_000) {
	return fetch(url, { ...init, signal: AbortSignal.timeout(ms) });
}
