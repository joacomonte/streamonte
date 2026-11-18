import { season } from '#lib/server/tmdb.js';
import { Fail, route } from '#lib/server/http.js';

export const GET = route(({ params }) => {
	if (!/^\d+$/.test(params.id) || !/^\d+$/.test(params.n)) throw new Fail(400, 'Temporada inválida.');
	return season(params.id, params.n);
});
