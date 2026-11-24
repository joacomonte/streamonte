// Premium (OpenSubtitles.com): buscar en español. No gasta descargas.
import { premiumQuota, premiumSearch } from '#lib/server/subs.ts';
import { route } from '#lib/server/http.ts';
import { imdbOrFail, osHash } from '#lib/server/params.ts';

export const GET = route(async ({ url }) => {
	const { imdb, s, e } = imdbOrFail(url);
	const file = osHash(url);
	const results = await premiumSearch(imdb, s, e, file ? { hash: file.hash } : null);
	return { results, quota: await premiumQuota() };
});
