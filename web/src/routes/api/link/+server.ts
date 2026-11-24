import { link } from '#lib/server/torbox.ts';
import { route } from '#lib/server/http.ts';
import { episode, hash40 } from '#lib/server/params.ts';

export const GET = route(async ({ url }) => {
	const p = url.searchParams;
	const hash = hash40(url);
	const { s, e } = episode(url);
	return link({ hash, name: p.get('name') ?? '', file: p.get('file') || null, s, e, orig: p.get('orig') || null });
});
