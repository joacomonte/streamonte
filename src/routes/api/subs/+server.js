import { search } from '#lib/server/subs.js';
import { Fail, route } from '#lib/server/http.js';
import { episode } from '#lib/server/params.js';

export const GET = route(({ url }) => {
	const { imdb, s, e } = episode(url);
	if (!imdb) throw new Fail(400, 'Falta el IMDb id.');
	const hash = url.searchParams.get('hash') ?? '';
	const size = url.searchParams.get('size') ?? '';
	return search(imdb, s, e, /^[0-9a-f]{16}$/.test(hash) && /^\d+$/.test(size) ? { hash, size } : null);
});
