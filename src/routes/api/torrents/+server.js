import { torrents } from '#lib/server/torrents.js';
import { Fail, route } from '#lib/server/http.js';
import { episode } from '#lib/server/params.js';
import { tx } from '#lib/server/lang.js';

/** La respuesta va en líneas JSON a medida que avanza: `{stage, done, total}` por fuente, `{stage: 'torbox'}` y al
 * final `{result}` (o `{error}`), para mostrar "Buscando torrents… 2 de 4 fuentes". */
export const GET = route(async ({ url }) => {
	const { imdb, s, e } = episode(url);
	if (!imdb) throw new Fail(400, 'Falta el IMDb id.');
	const enc = new TextEncoder();
	const body = new ReadableStream({
		async start(c) {
			const send = (/** @type {unknown} */ x) => c.enqueue(enc.encode(JSON.stringify(x) + '\n'));
			try {
				send({ result: await torrents(imdb, s, e, send) });
			} catch (err) {
				send({ error: err instanceof Fail ? tx(err.message, err.vars) : tx('Falló: {m}', { m: String(/** @type {Error} */ (err)?.message ?? err) }) });
			}
			c.close();
		}
	});
	return new Response(body, { headers: { 'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-store' } });
});
