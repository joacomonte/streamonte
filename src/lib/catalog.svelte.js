// Estado del catálogo a nivel módulo: al volver de una ficha la lista y el scroll siguen ahí.
import * as cache from './saved.js';

export const KINDS = [
	{ v: 'movie', label: 'Películas', kind: 'movie', doc: false },
	{ v: 'tv', label: 'Series', kind: 'tv', doc: false },
	{ v: 'doc', label: 'Documentales', kind: 'movie', doc: true }
];
export const SORTS = [
	['popular', 'Más populares'],
	['rating', 'Mejor puntaje']
];
/** Meses hacia atrás (como la ruedita del desktop): hoy, 1–11 meses y de a un año hasta 1950. */
export const BACK = [...Array.from({ length: 12 }, (_, i) => i), ...Array.from({ length: new Date().getFullYear() - 1950 }, (_, i) => (i + 1) * 12)];
/** @param {number} m */
export const backLabel = (m) => (m === 0 ? 'hoy' : m < 12 ? `hace ${m} ${m === 1 ? 'mes' : 'meses'}` : `hace ${m / 12} ${m === 12 ? 'año' : 'años'}`);
/** Votos de IMDb (los del desktop). */
export const VOTES = [0, 1000, 5000, 10000, 25000, 50000, 100000, 250000, 500000];
/** @param {number} v */
export const votesLabel = (v) => (v ? `${v.toLocaleString('es-AR')}+ votos` : 'Cualquier cantidad de votos');
export const LANGS = [
	['en,es', 'Inglés o español'],
	['', 'Cualquier idioma']
];

const SAVED = 'sw.filters';
export const DEFAULTS = { kind: 'movie', sort: 'popular', from: 12, to: 0, votes: 50000, lang: 'en,es', genres: /** @type {string[]} */ ([]) };

function saved() {
	try {
		const f = { ...DEFAULTS, ...JSON.parse(localStorage.getItem(SAVED) ?? '{}') };
		// Guardado con la escala vieja (votos de TMDB): vuelve al de por defecto.
		if (!VOTES.includes(f.votes)) f.votes = DEFAULTS.votes;
		return f;
	} catch {
		return { ...DEFAULTS };
	}
}

export const cat = $state({
	f: typeof window !== 'undefined' ? saved() : { ...DEFAULTS },
	q: '',
	/** @type {{id: number, kind: 'movie' | 'tv', title: string, year: string, poster: string | null, rating: string | null}[]} */
	items: [],
	page: 0,
	done: false,
	loading: false,
	/** @type {string | null} */
	error: null,
	gen: 0,
	/** Géneros de TMDB por tipo (`movie`/`tv`), en español. @type {Record<string, {id: string, name: string}[]>} */
	genreList: {}
});

/** @param {number} m */
const isoMonthsAgo = (m) => {
	const d = new Date();
	d.setMonth(d.getMonth() - m);
	return d.toISOString().slice(0, 10);
};

export async function loadMore() {
	if (cat.loading || cat.done) return;
	const gen = cat.gen;
	cat.loading = true;
	const k = KINDS.find((x) => x.v === cat.f.kind) ?? KINDS[0];
	const p = new URLSearchParams({ page: String(cat.page + 1) });
	if (cat.q.trim()) p.set('q', cat.q.trim());
	else {
		p.set('kind', k.kind);
		if (k.doc) p.set('doc', '1');
		p.set('sort', cat.f.sort);
		p.set('from', isoMonthsAgo(cat.f.from));
		if (cat.f.to) p.set('to', isoMonthsAgo(cat.f.to));
		p.set('votes', String(cat.f.votes));
		p.set('lang', cat.f.lang);
		p.set('genres', cat.f.genres.join(','));
	}
	try {
		// Cada página queda guardada un día: al volver a entrar se ve al instante.
		const { ok, data: j } = await cache.json(fetch, `/api/catalog?${p}`, cache.DAY);
		if (gen !== cat.gen) return;
		if (!ok) throw new Error(j.message);
		const seen = new Set(cat.items.map((i) => `${i.kind}${i.id}`));
		cat.items.push(...j.items.filter((/** @type {any} */ i) => !seen.has(`${i.kind}${i.id}`)));
		cat.page = j.page;
		cat.done = j.page >= j.pages;
	} catch (e) {
		if (gen !== cat.gen) return;
		cat.error = /** @type {Error} */ (e).message;
		cat.done = true;
	} finally {
		if (gen === cat.gen) cat.loading = false;
	}
}

/** Filtros o búsqueda cambiaron: empieza de cero. */
export function reset() {
	try {
		localStorage.setItem(SAVED, JSON.stringify(cat.f));
	} catch {
		/* sin almacenamiento */
	}
	Object.assign(cat, { items: [], page: 0, done: false, error: null, loading: false, gen: cat.gen + 1 });
	loadMore();
}

/** @param {string} kind */
export async function loadGenres(kind) {
	if (cat.genreList[kind]) return;
	const r = await cache.json(fetch, `/api/genres?kind=${kind}`, cache.DAY);
	if (r.ok) cat.genreList[kind] = r.data;
}
