import { title } from '#lib/server/tmdb.ts';
import { Fail, route } from '#lib/server/http.ts';

export const GET = route(({ params }) => {
	if (!/^\d+$/.test(params.id)) throw new Fail(400, 'Id inválido.');
	return title(params.kind === 'tv' ? 'tv' : 'movie', params.id);
});
