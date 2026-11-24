import { awards } from '#lib/server/awards.ts';
import { Fail, route } from '#lib/server/http.ts';

export const GET = route(({ params }) => {
	if (!/^tt\d+$/.test(params.imdb)) throw new Fail(400, 'IMDb id inválido.');
	return awards(params.imdb);
}, { cdn: 86400, browser: 3600 });
