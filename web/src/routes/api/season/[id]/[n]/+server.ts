import { season } from '#lib/server/tmdb.ts';
import { Fail, route } from '#lib/server/http.ts';

export const GET = route(({ params }) => {
	if (!/^\d+$/.test(params.id) || !/^\d+$/.test(params.n)) throw new Fail(400, 'Temporada inválida.');
	return season(params.id, params.n);
}, { cdn: 21600, browser: 600, perLang: true });
