/** IMDb id y episodio de la query (`imdb`, `s`, `e`), validados. */
export function episode(url: URL) {
	const p = url.searchParams;
	const imdb = /^tt\d+$/.test(p.get('imdb') ?? '') ? (p.get('imdb') as string) : null;
	const s = /^\d+$/.test(p.get('s') ?? '') ? p.get('s') : null;
	const e = /^\d+$/.test(p.get('e') ?? '') ? p.get('e') : null;
	return { imdb, s: s && e ? s : null, e: s && e ? e : null };
}
