// Grabador de respuestas para los contratos web (`HTTP_FIXTURES`, ver fetch.ts). Solo local: no se carga en producción.

// Solo APIs públicas o con key en la URL (que se saca del nombre); nunca TorBox ni OpenSubtitles.com (tokens en la respuesta).
const FIXTURE_HOSTS = new Set(['api.themoviedb.org', 'api.opensubtitles.org', 'torrentio.strem.fun', 'addon.peerflix.mov', 'comet.feels.legal', 'torrentsdb.com', 'hacktorrent.cc', 'pelispanda.org']);

/** Responde desde `dir` (o graba) si el host es de los grabables; si no, un fetch normal. */
export async function fixtureGet(dir: string, url: string | URL, init: RequestInit, ms: number): Promise<Response> {
	if (!FIXTURE_HOSTS.has(new URL(url).host)) return fetch(url, { ...init, signal: AbortSignal.timeout(ms) });
	return fixture(dir, new URL(url), init, ms);
}

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
