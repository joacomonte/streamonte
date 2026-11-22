// Filtros del catálogo: constantes, etiquetas y conversiones puras (sin DOM ni Svelte).
import { t } from '../i18n/runtime.ts';
import type { BrowseFilters, Kind } from '../types.ts';
import type { IconName } from '../components/icons.ts';

export type Sort = BrowseFilters['sort'];
/** `from`/`to`: meses hacia atrás (la escala de la ruedita); `lang`: códigos ISO separados por coma ('' = cualquiera). */
export type Filters = { kind: Kind; sort: Sort; from: number; to: number; votes: number; lang: string; genres: string[] };

export const KINDS: { v: Kind; label: string; icon: IconName }[] = [
	{ v: 'movie', label: 'Películas', icon: 'film' },
	{ v: 'tv', label: 'Series', icon: 'tv' }
];
export const SORTS: { v: Sort; label: string; icon: IconName }[] = [
	{ v: 'rating', label: 'Mejor puntaje', icon: 'star' },
	{ v: 'popular', label: 'Más populares', icon: 'flame' }
];
export const LANGS: { v: string; label: string }[] = [
	{ v: 'en,es', label: 'Inglés o español' },
	{ v: '', label: 'Cualquier idioma' }
];
/** Votos de IMDb. */
export const VOTES = [0, 1000, 5000, 10000, 25000, 50000, 100000, 250000, 500000];
export const MIN_YEAR = 1950;
/** Meses hacia atrás: hoy, 1–11 meses y de a un año hasta 1950. */
export const backSteps = (now: Date = new Date()): number[] => [
	...Array.from({ length: 12 }, (_, i) => i),
	...Array.from({ length: now.getFullYear() - MIN_YEAR }, (_, i) => (i + 1) * 12)
];
export const BACK = backSteps();

export const DEFAULTS: Filters = { kind: 'movie', sort: 'rating', from: 12, to: 0, votes: 10000, lang: 'en,es', genres: [] };

export const backLabel = (m: number): string =>
	m === 0 ? t('hoy') : m < 12 ? t(m === 1 ? 'hace {n} mes' : 'hace {n} meses', { n: m }) : t(m === 12 ? 'hace {n} año' : 'hace {n} años', { n: m / 12 });
export const votesLabel = (v: number): string => (v ? t('{n}+ votos', { n: v.toLocaleString('es-AR') }) : t('Cualquier cantidad de votos'));

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
	languages: f.lang.split(',').filter(Boolean),
	genres: f.genres
});

/** Filtros avanzados (los de la hoja) que no están en su valor por defecto: el número del botón "Filtros". */
export const changedCount = (f: Filters): number => Number(f.votes !== DEFAULTS.votes) + Number(f.lang !== DEFAULTS.lang) + f.genres.length;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

/** Lo guardado en el almacenamiento (borde externo): cada campo se valida; lo viejo o roto queda en su valor por defecto. */
export function parseSaved(raw: string | null, back: number[] = BACK): Filters {
	const f: Filters = { ...DEFAULTS, genres: [] };
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
	if (typeof v.votes === 'number' && VOTES.includes(v.votes)) f.votes = v.votes;
	if (typeof v.lang === 'string' && LANGS.some((l) => l.v === v.lang)) f.lang = v.lang;
	if (Array.isArray(v.genres)) f.genres = v.genres.filter((g): g is string => typeof g === 'string');
	return f;
}
