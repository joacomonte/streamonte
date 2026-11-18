import { discover, search } from '#lib/server/tmdb.js';
import { route } from '#lib/server/http.js';

export const GET = route(async ({ url }) => {
	const p = url.searchParams;
	const page = Number(p.get('page')) || 1;
	const q = p.get('q')?.trim();
	if (q) return search(q, page);
	return discover({
		kind: p.get('kind') === 'tv' ? 'tv' : 'movie',
		doc: p.get('doc') === '1',
		sort: p.get('sort') ?? 'popular',
		from: p.get('from') ?? '',
		to: p.get('to') ?? '',
		votes: Number(p.get('votes')) || 0,
		lang: p.get('lang') ?? '',
		genres: (p.get('genres') ?? '').split(',').filter((g) => /^\d+$/.test(g)),
		page
	});
});
