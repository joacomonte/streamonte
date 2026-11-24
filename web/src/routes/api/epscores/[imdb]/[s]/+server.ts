import { episodeRatings } from '#lib/server/episode-ratings.ts';
import { Fail, route } from '#lib/server/http.ts';

export const GET = route(({ params }) => {
	if (!/^tt\d+$/.test(params.imdb) || !/^\d+$/.test(params.s)) throw new Fail(400, 'Temporada inválida.');
	return episodeRatings(params.imdb, Number(params.s));
}, { cdn: 86400, browser: 3600 });
