// "Novedades": reglas de vista (sin DOM) del diálogo (`NewsDialog.svelte`), la pastilla y la fila Tendencias. Datos y
// contrato: `news.ts`. Abrir: un título va a la ficha (como una tarjeta); un capítulo, a ese capítulo (como "Vistos").
import { nf } from '../format.ts';
import { t } from '../i18n/runtime.ts';
import type { CatalogItem } from '../types.ts';
import type { NewsItem } from './news.ts';
import type { EpisodeRef, RecentItem } from './recent.ts';

/** Lo que pasa una sola vez por sesión de la app: el diálogo abierto solo y el pedido de refresco. */
export const newsSession = { autoOpened: false, refreshed: false };

/** Tiempo de un cuadro del rollo antes de pasar solo al siguiente. */
export const NEWS_SLIDE_MS = 8000;

/** "hoy", "hace 1 día", "hace 3 días" (por día: lo nuevo no necesita horas). */
export function newsAgo(iso: string, now: number = Date.now()): string {
	const days = Math.floor((now - Date.parse(iso)) / 864e5);
	if (days < 1) return t('hoy');
	return days === 1 ? t('hace 1 día') : t('hace {a} días', { a: days });
}

/** Votos de IMDb compactos: "850", "73k", "2,4M". */
export function compactVotes(n: number): string {
	if (n >= 1e6) return `${nf(Math.round(n / 1e5) / 10)}M`;
	if (n >= 1e3) return `${Math.round(n / 1e3)}k`;
	return String(n);
}

/** El capítulo nuevo; null si es un estreno. */
export const episodeOf = (i: NewsItem): EpisodeRef | null => (i.what?.type === 'episode' ? { season: i.what.season, episode: i.what.episode } : null);

/** Etiqueta de lo nuevo: "T2 · E5" o "Nuevo". */
export const newsTag = (i: NewsItem): string => (i.what?.type === 'episode' ? t('T{s} · E{e}', { s: i.what.season, e: i.what.episode }) : t('Nuevo'));

/** Al lado de la etiqueta: "Final de temporada · hace 1 día", "Serie · hace 2 días" o "hace 2 días". */
export function newsWhen(i: NewsItem, now: number = Date.now()): string {
	const when = i.date ? newsAgo(i.date, now) : '';
	const pre = i.what?.type === 'episode' ? (i.what.finale ? t('Final de temporada') : '') : i.kind === 'tv' ? t('Serie') : '';
	return [pre, when].filter(Boolean).join(' · ');
}

/** Texto del botón: "Ver" o "Ver T2·E5". */
export const watchLabel = (i: NewsItem): string => (i.what?.type === 'episode' ? t('Ver T{s}·E{e}', { s: i.what.season, e: i.what.episode }) : t('Ver'));

/** Puntaje como en la grilla ("8.4"); null si no hay. */
export const ratingText = (i: NewsItem): string | null => (i.imdbRating == null ? null : i.imdbRating.toFixed(1));

/** Para abrir la ficha por el mismo camino que una tarjeta del catálogo. */
export const toCatalogItem = (i: NewsItem): CatalogItem => ({
	id: i.id,
	kind: i.kind,
	title: i.title,
	year: i.year == null ? null : String(i.year),
	poster: i.poster,
	rating: ratingText(i),
	released: null,
	documentary: false
});

/** Para abrir un capítulo por el mismo camino que "Vistos recientemente". */
export const toRecentItem = (i: NewsItem): RecentItem => {
	const ep = episodeOf(i);
	return { kind: i.kind, imdb: i.imdb, id: i.id, title: i.title, poster: i.poster, backdrop: i.backdrop, season: ep?.season ?? null, episode: ep?.episode ?? null, at: i.date ?? '' };
};
