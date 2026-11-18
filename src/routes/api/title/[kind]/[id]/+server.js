import { title } from '#lib/server/tmdb.js';
import { Fail, route } from '#lib/server/http.js';

export const GET = route(({ params }) => {
	if (!/^\d+$/.test(params.id)) throw new Fail(400, 'Id inválido.');
	return title(params.kind === 'tv' ? 'tv' : 'movie', params.id);
});
