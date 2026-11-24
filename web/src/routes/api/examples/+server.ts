import { examples } from '#lib/server/interests.ts';
import { route } from '#lib/server/http.ts';

/** Ejemplos populares de cada subgénero de IMDb (`ids=in…,in…`, hasta 12): títulos como los da IMDb, sin idioma. */
export const GET = route(({ url }) => {
	const ids = [...new Set((url.searchParams.get('ids') ?? '').split(',').filter((x) => /^in\d{7}$/.test(x)))].slice(0, 12);
	return examples(url.searchParams.get('kind') === 'tv' ? 'tv' : 'movie', ids);
}, { cdn: 7 * 86400 });
