import { json } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { LANG_PARAM, tx } from './lang.ts';

/** Error con texto para mostrar al usuario: el texto en español es la clave del diccionario (packages/ui/src/i18n/en.ts) y
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

/** Caché en el CDN de Vercel (`cdn` segundos, y hasta 4× más sirviendo la vieja mientras se renueva) y en el navegador
 * (`browser`). `perLang`: la respuesta depende del idioma, así que solo se cachea si el pedido lo trae en la URL (`l`,
 * ver hooks.server.ts); sin él el idioma sale de la cookie y el CDN mezclaría idiomas. Solo respuestas OK. Ojo: lo
 * cacheado lo sirve el CDN sin pasar por el candado de APP_PASSWORD (son datos públicos de TMDB/IMDb). */
export type Cache = { cdn: number; browser?: number; perLang?: boolean };

/** Envuelve un endpoint: devuelve JSON y, si falla, `{message}` con el status (nunca la URL, que puede llevar keys).
 */
export const route = (fn: (event: RequestEvent<Record<string, string>>) => Promise<unknown>, cache?: Cache) => async (event: RequestEvent<Record<string, string>>) => {
	try {
		const out = await fn(event);
		if (out instanceof Response) return out;
		if (cache && (!cache.perLang || LANG_PARAM.test(event.url.searchParams.get('l') ?? '')))
			return json(out, { headers: { 'cache-control': `public, max-age=${cache.browser ?? 0}, s-maxage=${cache.cdn}, stale-while-revalidate=${cache.cdn * 4}` } });
		return json(out);
	} catch (e) {
		const fail = e instanceof Fail;
		if (!fail) console.error(e);
		const msg = fail ? tx(e.message, e.vars) : tx('Falló: {m}', { m: String((e as Error)?.message ?? e) });
		return json({ message: msg }, { status: fail ? e.status : 500 });
	}
};
