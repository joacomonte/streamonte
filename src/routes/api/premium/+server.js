// Premium (OpenSubtitles.com): buscar en español. No gasta descargas.
import { premiumQuota, premiumSearch } from '#lib/server/subs.js';
import { Fail, route } from '#lib/server/http.js';
import { episode } from '#lib/server/params.js';

export const GET = route(async ({ url }) => {
	const { imdb, s, e } = episode(url);
	if (!imdb) throw new Fail(400, 'Falta el IMDb id.');
	const hash = url.searchParams.get('hash') ?? '';
	const results = await premiumSearch(imdb, s, e, /^[0-9a-f]{16}$/.test(hash) ? { hash } : null);
	return { results, quota: await premiumQuota() };
});
