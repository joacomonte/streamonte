// Estado del catálogo a nivel módulo: al volver de una ficha la lista y el scroll siguen ahí.
import * as cache from './saved.js';
import { t, loc } from './i18n.svelte.js';
import { invalidateAll } from '$app/navigation';

export const KINDS = [
	{ v: 'movie', label: 'Películas', kind: 'movie', icon: /** @type {const} */ ('film') },
	{ v: 'tv', label: 'Series', kind: 'tv', icon: /** @type {const} */ ('tv') }
];
export const SORTS = [
	['rating', 'Mejor puntaje'],
	['popular', 'Más populares']
];
/** Meses hacia atrás (como la ruedita del desktop): hoy, 1–11 meses y de a un año hasta 1950. */
export const BACK = [...Array.from({ length: 12 }, (_, i) => i), ...Array.from({ length: new Date().getFullYear() - 1950 }, (_, i) => (i + 1) * 12)];
/** @param {number} m */
export const backLabel = (m) => (m === 0 ? t('hoy') : m < 12 ? t(m === 1 ? 'hace {n} mes' : 'hace {n} meses', { n: m }) : t(m === 12 ? 'hace {n} año' : 'hace {n} años', { n: m / 12 }));
/** Votos de IMDb (los del desktop). */
export const VOTES = [0, 1000, 5000, 10000, 25000, 50000, 100000, 250000, 500000];
/** @param {number} v */
export const votesLabel = (v) => (v ? t('{n}+ votos', { n: v.toLocaleString(loc()) }) : t('Cualquier cantidad de votos'));
export const LANGS = [
	['en,es', 'Inglés o español'],
	['', 'Cualquier idioma']
];

const SAVED = 'sw.filters';
export const DEFAULTS = { kind: 'movie', sort: 'rating', from: 12, to: 0, votes: 10000, lang: 'en,es', genres: /** @type {string[]} */ ([]) };

function saved() {
	try {
		const f = { ...DEFAULTS, ...JSON.parse(localStorage.getItem(SAVED) ?? '{}') };
		// Guardado con la escala vieja (votos de TMDB): vuelve al de por defecto.
		if (!VOTES.includes(f.votes)) f.votes = DEFAULTS.votes;
		// Tipo que ya no existe (p. ej. 'doc'): vuelve a películas.
		if (!KINDS.some((k) => k.v === f.kind)) f.kind = DEFAULTS.kind;
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

/** Cambió un idioma (app o títulos): catálogo, géneros y la página abierta se vuelven a pedir (la caché
 * es por idioma, así que lo ya visto en ese idioma sale al instante). */
export function relang() {
	cat.genreList = {};
	loadGenres((KINDS.find((k) => k.v === cat.f.kind) ?? KINDS[0]).kind);
	reset();
	invalidateAll();
}

/** @param {string} kind */
export async function loadGenres(kind) {
	if (cat.genreList[kind]) return;
	const r = await cache.json(fetch, `/api/genres?kind=${kind}`, cache.DAY);
	if (r.ok) cat.genreList[kind] = r.data;
}
