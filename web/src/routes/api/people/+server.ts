import { people } from '#lib/server/tmdb.ts';
import { route } from '#lib/server/http.ts';

/** Actores y directores que coinciden con lo escrito en el buscador (sugerencias). */
export const GET = route(async ({ url }) => {
	const q = url.searchParams.get('q')?.trim().slice(0, 60) ?? '';
	return q.length < 2 ? [] : people(q);
}, { cdn: 86400, perLang: true });
