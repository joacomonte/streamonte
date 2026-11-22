import { json } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { tx } from './lang.ts';

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

/** fetch con tope de tiempo. Con `HTTP_FIXTURES=<carpeta>` (solo local, lo pone scripts/contracts.sh) responde desde
 * respuestas grabadas y graba las que faltan: los contratos web corren sin red y siempre con los mismos datos. */
export async function get(url: string | URL, init: RequestInit = {}, ms = 12_000): Promise<Response> {
	const dir = process.env.VERCEL ? undefined : process.env.HTTP_FIXTURES;
	if (dir && FIXTURE_HOSTS.has(new URL(url).host)) return fixture(dir, new URL(url), init, ms);
	return fetch(url, { ...init, signal: AbortSignal.timeout(ms) });
}

// Solo APIs públicas o con key en la URL (que se saca del nombre); nunca TorBox ni OpenSubtitles.com (tokens en la respuesta).
const FIXTURE_HOSTS = new Set(['api.themoviedb.org', 'api.opensubtitles.org', 'torrentio.strem.fun', 'addon.peerflix.mov', 'comet.feels.legal', 'torrentsdb.com']);

async function fixture(dir: string, url: URL, init: RequestInit, ms: number): Promise<Response> {
	const { createHash } = await import('node:crypto');
	const fs = await import('node:fs/promises');
	const clean = new URL(url);
	clean.searchParams.delete('api_key');
	const name = createHash('sha1').update(`${init.method ?? 'GET'} ${clean} ${typeof init.body === 'string' ? init.body : ''}`).digest('hex');
	const file = `${dir}/${clean.host}-${name.slice(0, 16)}.json`;
	const saved = await fs.readFile(file, 'utf8').catch(() => null);
	if (saved) {
		const s = JSON.parse(saved) as { status: number; type: string; body: string };
		return new Response(s.status === 204 ? null : Buffer.from(s.body, 'base64'), { status: s.status, headers: { 'content-type': s.type } });
	}
	const r = await fetch(url, { ...init, signal: AbortSignal.timeout(ms) });
	const body = Buffer.from(await r.arrayBuffer());
	if (r.ok) {
		await fs.mkdir(dir, { recursive: true });
		await fs.writeFile(file, JSON.stringify({ status: r.status, type: r.headers.get('content-type') ?? '', body: body.toString('base64') }));
	}
	return new Response(r.status === 204 ? null : body, { status: r.status, headers: { 'content-type': r.headers.get('content-type') ?? '' } });
}
