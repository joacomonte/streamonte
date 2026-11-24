import { search } from '#lib/server/subs.ts';
import { route } from '#lib/server/http.ts';
import { imdbOrFail, osHash } from '#lib/server/params.ts';

export const GET = route(({ url }) => {
	const { imdb, s, e } = imdbOrFail(url);
	const file = osHash(url);
	return search(imdb, s, e, file?.size ? { hash: file.hash, size: file.size } : null);
});
