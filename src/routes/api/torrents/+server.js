import { torrents } from '#lib/server/torrents.js';
import { Fail, route } from '#lib/server/http.js';
import { episode } from '#lib/server/params.js';

export const GET = route(({ url }) => {
	const { imdb, s, e } = episode(url);
	if (!imdb) throw new Fail(400, 'Falta el IMDb id.');
	return torrents(imdb, s, e);
});
