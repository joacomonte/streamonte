import { link } from '#lib/server/torbox.js';
import { Fail, route } from '#lib/server/http.js';
import { episode } from '#lib/server/params.js';

export const GET = route(async ({ url }) => {
	const p = url.searchParams;
	const hash = p.get('hash')?.toLowerCase() ?? '';
	if (!/^[0-9a-f]{40}$/.test(hash)) throw new Fail(400, 'Hash inválido.');
	const { s, e } = episode(url);
	return link({ hash, name: p.get('name') ?? '', file: p.get('file') || null, s, e, orig: p.get('orig') || null });
});
