// Filtros del catálogo: constantes, etiquetas y conversiones puras (sin DOM ni Svelte).
import { t } from '../i18n/runtime.ts';
import type { BrowseFilters, Kind } from '../types.ts';
import type { IconName } from '../components/icons.ts';
import { categoryOf, interestsOf } from './subgenres.ts';

export type Sort = BrowseFilters['sort'];
/** `from`/`to`: meses hacia atrás (la escala de la ruedita); `votes`: uno de `VOTE_LEVELS`; `genre`: clave de `subgenres.ts`
 * (null = sin género) y `subs`: los subgéneros elegidos ([] = todos). */
export type Filters = { kind: Kind; sort: Sort; from: number; to: number; votes: number; genre: string | null; subs: string[] };

export const KINDS: { v: Kind; label: string; icon: IconName }[] = [
	{ v: 'movie', label: 'Películas', icon: 'film' },
	{ v: 'tv', label: 'Series', icon: 'tv' }
];
export const SORTS: { v: Sort; label: string; icon: IconName }[] = [
	{ v: 'rating', label: 'Mejor puntaje', icon: 'star' },
	{ v: 'popular', label: 'Más populares', icon: 'flame' }
];
/** Idioma original del catálogo: fijo en inglés o español (2026-11-23, al sacar la hoja de filtros avanzados). */
export const LANGUAGES = ['en', 'es'];
/** Votos de IMDb: los 3 niveles (pastilla de votos del catálogo). */
export const VOTE_LEVELS: { v: number; label: string }[] = [
	{ v: 1000, label: 'De nicho' },
	{ v: 10000, label: 'Conocidas' },
	{ v: 100000, label: 'Muy populares' }
];
/** Nivel más cercano (en escala logarítmica) a una cantidad de votos: lo guardado con valores viejos (0, 5k, 25k…) cae en uno. */
export const nearestLevel = (votes: number): number => {
	const lv = Math.log10(Math.max(1, votes));
	const gap = (i: number) => Math.abs(Math.log10(VOTE_LEVELS[i].v) - lv);
	return VOTE_LEVELS.reduce((best, _, i) => (gap(i) < gap(best) ? i : best), 0);
};
export const MIN_YEAR = 1950;
/** Meses hacia atrás: hoy, 1–11 meses y de a un año hasta 1950. */
export const backSteps = (now: Date = new Date()): number[] => [
	...Array.from({ length: 12 }, (_, i) => i),
	...Array.from({ length: now.getFullYear() - MIN_YEAR }, (_, i) => (i + 1) * 12)
];
export const BACK = backSteps();

export const DEFAULTS: Filters = { kind: 'movie', sort: 'rating', from: 12, to: 0, votes: 10000, genre: null, subs: [] };

export const backLabel = (m: number): string =>
	m === 0 ? t('hoy') : m < 12 ? t(m === 1 ? 'hace {n} mes' : 'hace {n} meses', { n: m }) : t(m === 12 ? 'hace {n} año' : 'hace {n} años', { n: m / 12 });
export const votesLabel = (v: number): string => t('{n}+ votos', { n: v.toLocaleString('es-AR') });

/** AAAA-MM-DD de hace `m` meses (en hora local). */
export function isoMonthsAgo(m: number, now: Date = new Date()): string {
	const d = new Date(now);
	d.setMonth(d.getMonth() - m);
	return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

/** Filtros de la pantalla → los de `Api.catalog.browse` (fechas ISO; `to` vacío = hasta hoy). */
export const toBrowse = (f: Filters, now: Date = new Date()): BrowseFilters => ({
	kind: f.kind,
	sort: f.sort,
	from: isoMonthsAgo(f.from, now),
	to: f.to ? isoMonthsAgo(f.to, now) : '',
	minVotes: f.votes,
	languages: LANGUAGES,
	interests: interestsOf(f.genre, f.subs)
});

/** Filtros que achican la lista y no están en su valor por defecto (votos y género): sin resultados, se ofrece restablecerlos. */
export const changedCount = (f: Filters): number => Number(f.votes !== DEFAULTS.votes) + Number(f.genre !== null);

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

/** Lo guardado en el almacenamiento (borde externo): cada campo se valida; lo viejo o roto queda en su valor por defecto. */
export function parseSaved(raw: string | null, back: number[] = BACK): Filters {
	const f: Filters = { ...DEFAULTS, subs: [] };
	if (!raw) return f;
	let v: unknown;
	try {
		v = JSON.parse(raw);
	} catch {
		return f;
	}
	if (!isRecord(v)) return f;
	if (v.kind === 'movie' || v.kind === 'tv') f.kind = v.kind;
	if (v.sort === 'rating' || v.sort === 'popular') f.sort = v.sort;
	if (typeof v.from === 'number' && back.indexOf(v.from) >= 1) f.from = v.from;
	if (typeof v.to === 'number' && back.includes(v.to)) f.to = v.to;
	if (f.to >= f.from) f.to = 0;
	if (typeof v.votes === 'number') f.votes = VOTE_LEVELS[nearestLevel(v.votes)].v;
	// Lo guardado antes de los subgéneros (`genres`, ids de TMDB) se descarta: queda sin género.
	const cat = typeof v.genre === 'string' ? categoryOf(v.genre) : null;
	if (cat && (!cat.only || cat.only === f.kind)) {
		f.genre = cat.key;
		if (Array.isArray(v.subs)) f.subs = v.subs.filter((id): id is string => typeof id === 'string' && cat.subs.some((x) => x.id === id));
	}
	return f;
}
