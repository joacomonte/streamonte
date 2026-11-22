// Estado del catálogo a nivel módulo: al volver de una ficha la lista y el scroll siguen ahí.
import * as cache from './saved.ts';
import { t, loc } from './i18n.svelte.ts';
import type { Genres } from './types.ts';
import { invalidateAll } from '$app/navigation';

export const KINDS = [
	{ v: 'movie', label: 'Películas', kind: 'movie', icon: 'film' as const },
	{ v: 'tv', label: 'Series', kind: 'tv', icon: 'tv' as const }
];
export const SORTS = [
	['rating', 'Mejor puntaje'],
	['popular', 'Más populares']
];
/** Meses hacia atrás (como la ruedita del desktop): hoy, 1–11 meses y de a un año hasta 1950. */
export const BACK = [...Array.from({ length: 12 }, (_, i) => i), ...Array.from({ length: new Date().getFullYear() - 1950 }, (_, i) => (i + 1) * 12)];
export const backLabel = (m: number) => (m === 0 ? t('hoy') : m < 12 ? t(m === 1 ? 'hace {n} mes' : 'hace {n} meses', { n: m }) : t(m === 12 ? 'hace {n} año' : 'hace {n} años', { n: m / 12 }));
/** Votos de IMDb (los del desktop). */
export const VOTES = [0, 1000, 5000, 10000, 25000, 50000, 100000, 250000, 500000];
export const votesLabel = (v: number) => (v ? t('{n}+ votos', { n: v.toLocaleString(loc()) }) : t('Cualquier cantidad de votos'));
export const LANGS = [
	['en,es', 'Inglés o español'],
	['', 'Cualquier idioma']
];

const SAVED = 'sw.filters';
export type Filters = { kind: string; sort: string; from: number; to: number; votes: number; lang: string; genres: string[] };
export const DEFAULTS: Filters = { kind: 'movie', sort: 'rating', from: 12, to: 0, votes: 10000, lang: 'en,es', genres: [] };

function saved(): Filters {
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

export type Person = { id: number; name: string; photo: string | null; role: 'cast' | 'director' };
export type Item = { id: number; kind: 'movie' | 'tv'; title: string; year: string; released?: string | null; poster: string | null; rating: string | null };

export const cat = $state<{
	f: Filters;
	q: string;
	/** Actor o director elegido en las sugerencias del buscador: muestra lo que actuó o dirigió, sin filtros. */
	person: Person | null;
	items: Item[];
	page: number;
	done: boolean;
	loading: boolean;
	error: string | null;
	gen: number;
	/** Géneros de TMDB por tipo (`movie`/`tv`), en español. */
	genreList: Record<string, { id: string; name: string }[]>;
}>({
	f: typeof window !== 'undefined' ? saved() : { ...DEFAULTS },
	q: '',
	person: null,
	items: [],
	page: 0,
	done: false,
	loading: false,
	error: null,
	gen: 0,
	genreList: {}
});

const isoMonthsAgo = (m: number) => {
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
	if (cat.person) {
		p.set('person', String(cat.person.id));
		p.set('role', cat.person.role);
	}
	else if (cat.q.trim()) p.set('q', cat.q.trim());
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
		const { ok, data } = await cache.json(fetch, `/api/catalog?${p}`, cache.DAY);
		if (gen !== cat.gen) return;
		if (!ok) throw new Error((data as { message: string }).message);
		const j = data as { items: Item[]; page: number; pages: number };
		const seen = new Set(cat.items.map((i) => `${i.kind}${i.id}`));
		cat.items.push(...j.items.filter((i) => !seen.has(`${i.kind}${i.id}`)));
		cat.page = j.page;
		cat.done = j.page >= j.pages;
	} catch (e) {
		if (gen !== cat.gen) return;
		cat.error = (e as Error).message;
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

export async function loadGenres(kind: string) {
	if (cat.genreList[kind]) return;
	const r = await cache.json(fetch, `/api/genres?kind=${kind}`, cache.DAY);
	if (r.ok) cat.genreList[kind] = r.data as Genres;
}
