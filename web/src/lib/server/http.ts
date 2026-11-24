// Punto de entrada de los módulos de servidor: re-exporta `route`/`Fail` (http-route.ts) y `get` (fetch.ts), que
// importan los tests nuevos directo para no arrastrar `@sveltejs/kit`, y arma la respuesta de subtítulos.
export { Fail, route } from './http-route.ts';
export type { Cache } from './http-route.ts';
export { get } from './fetch.ts';

/** El subtítulo como descarga. `name`: nombre del archivo sin extensión (se limpia). Con BOM: algunas teles y
 * reproductores lo necesitan para leer los acentos. */
export function srtResponse(text: string, name: string, ext: 'srt' | 'ass'): Response {
	const clean = name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-').slice(0, 150);
	return new Response(`﻿${text}`, {
		headers: {
			'content-type': 'application/x-subrip; charset=utf-8',
			'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(`${clean}.es.${ext}`)}`
		}
	});
}
