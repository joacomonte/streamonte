import { discover, personTitles, search, VOTES } from '#lib/server/tmdb.ts';
import { route } from '#lib/server/http.ts';

/** Solo valores que puede mandar la web: cada combinación nueva arma una lista con hasta 30 pedidos de discover y
 * 600 fichas de TMDB, así que lo que no se reconoce cae al valor por defecto en vez de abrir otra combinación. */
const date = (v: string | null) => (/^\d{4}-\d{2}-\d{2}$/.test(v ?? '') ? (v as string) : '');
/** Hasta `max` valores únicos y ordenados (`es,en` y `en,es` son la misma lista). */
const set = (v: string | null, re: RegExp, max: number) => [...new Set((v ?? '').split(',').filter((x) => re.test(x)))].sort().slice(0, max);

export const GET = route(async ({ url }) => {
	const p = url.searchParams;
	const page = Math.min(Math.max(Math.trunc(Number(p.get('page'))) || 1, 1), 30);
	// Lo que actuó o dirigió una persona (sugerencia del buscador): ignora los filtros.
	const person = Number(p.get('person'));
	if (Number.isInteger(person) && person > 0) return personTitles(person, p.get('role') === 'director' ? 'director' : 'cast');
	const q = p.get('q')?.trim().slice(0, 100);
	if (q) return search(q, page);
	const votes = Number(p.get('votes'));
	return discover({
		kind: p.get('kind') === 'tv' ? 'tv' : 'movie',
		sort: p.get('sort') === 'popular' ? 'popular' : 'rating',
		from: date(p.get('from')),
		to: date(p.get('to')),
		votes: VOTES.includes(votes) ? votes : 0,
		lang: set(p.get('lang'), /^[a-z]{2}$/, 6).join(','),
		genres: set(p.get('genres'), /^\d{1,6}$/, 5),
		page
	});
}, { cdn: 3600, perLang: true });
