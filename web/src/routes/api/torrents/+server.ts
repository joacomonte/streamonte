import { torrents } from '#lib/server/torrents.ts';
import { Fail, route } from '#lib/server/http.ts';
import { imdbOrFail } from '#lib/server/params.ts';
import { tx } from '#lib/server/lang.ts';
import { recordVerification, verificationFrom } from '#lib/server/novedades.ts';

/** La respuesta va en líneas JSON a medida que avanza: `{stage, done, total}` por fuente, `{stage: 'torbox'}` y al
 * final `{result}` (o `{error}`), para mostrar "Buscando torrents… 2 de 4 fuentes". */
export const GET = route(async ({ url }) => {
	const { imdb, s, e } = imdbOrFail(url);
	const enc = new TextEncoder();
	const body = new ReadableStream({
		async start(c) {
			const send = (x: unknown) => c.enqueue(enc.encode(JSON.stringify(x) + '\n'));
			try {
				const result = await torrents(imdb, s, e, send);
				send({ result });
				// "Novedades": lo que ya se encontró queda como verificación (sin pedidos extra; nunca rompe esta ruta).
				const v = verificationFrom(imdb, s, e, result.list);
				if (v) void recordVerification(v).catch(() => {});
			} catch (err) {
				send({ error: err instanceof Fail ? tx(err.message, err.vars) : tx('Falló: {m}', { m: String((err as Error)?.message ?? err) }) });
			}
			c.close();
		}
	});
	return new Response(body, { headers: { 'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-store' } });
});
