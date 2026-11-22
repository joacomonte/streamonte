import { json } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { tx } from './lang.ts';

/** Error con texto para mostrar al usuario: el texto en español es la clave del diccionario (i18n/en.ts) y
 * `vars` completa sus `{x}`; se traduce al idioma del pedido al responder. */
export class Fail extends Error {
	status: number;
	vars: Record<string, string | number> | undefined;
	constructor(status: number, message: string, vars?: Record<string, string | number>) {
		super(message);
		this.status = status;
		this.vars = vars;
	}
}

/** Envuelve un endpoint: devuelve JSON y, si falla, `{message}` con el status (nunca la URL, que puede llevar keys).
 */
export const route = (fn: (event: RequestEvent<Record<string, string>>) => Promise<unknown>) => async (event: RequestEvent<Record<string, string>>) => {
	try {
		const out = await fn(event);
		return out instanceof Response ? out : json(out);
	} catch (e) {
		const fail = e instanceof Fail;
		if (!fail) console.error(e);
		const msg = fail ? tx(e.message, e.vars) : tx('Falló: {m}', { m: String((e as Error)?.message ?? e) });
		return json({ message: msg }, { status: fail ? e.status : 500 });
	}
};

/** fetch con tope de tiempo. */
export async function get(url: string | URL, init: RequestInit = {}, ms = 12_000): Promise<Response> {
	return fetch(url, { ...init, signal: AbortSignal.timeout(ms) });
}
