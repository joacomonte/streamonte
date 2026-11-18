import { seasonScores } from '#lib/server/imdb.js';
import { Fail, route } from '#lib/server/http.js';

export const GET = route(({ params }) => {
	if (!/^tt\d+$/.test(params.imdb)) throw new Fail(400, 'IMDb id inválido.');
	return seasonScores(params.imdb);
});
