// "Novedades": reglas de vista (sin DOM) del diálogo (`NewsDialog.svelte`) y de la fila Tendencias (con la card de Novedades). Datos y
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

/** Contador de la card de Novedades: "N nuevas esta semana" (`date` en los últimos 7 días); si ninguna es de esta
 * semana, "N nuevas" con todas las de la lista (no se inventa un recorte que no existe). */
export function newsCountText(items: NewsItem[], now: number = Date.now()): string {
	const week = items.filter((i) => i.date != null && now - Date.parse(i.date) < 7 * 864e5).length;
	if (week) return week === 1 ? t('1 nueva esta semana') : t('{n} nuevas esta semana', { n: week });
	return items.length === 1 ? t('1 nueva') : t('{n} nuevas', { n: items.length });
}

/** "hoy", "ayer", "hace 3 días" (por día: lo nuevo no necesita horas). */
export function newsAgo(iso: string, now: number = Date.now()): string {
	const days = Math.floor((now - Date.parse(iso)) / 864e5);
	if (days < 1) return t('hoy');
	return days === 1 ? t('ayer') : t('hace {a} días', { a: days });
}

/** "24 nov" (es) / "Nov 24" (en): el día de la fecha ISO, sin hora. */
export const newsDay = (iso: string, locale: string): string =>
	new Date(Date.parse(iso)).toLocaleDateString(locale, { day: 'numeric', month: 'short', timeZone: 'UTC' }).replace('.', '');

/** Votos de IMDb compactos: "850", "73k", "2,4M". */
export function compactVotes(n: number): string {
	if (n >= 1e6) return `${nf(Math.round(n / 1e5) / 10)}M`;
	if (n >= 1e3) return `${Math.round(n / 1e3)}k`;
	return String(n);
}

/** El capítulo nuevo; null si es un estreno. */
export const episodeOf = (i: NewsItem): EpisodeRef | null => (i.what?.type === 'episode' ? { season: i.what.season, episode: i.what.episode } : null);

/** Color del tipo en el kicker: `new` película o serie nueva, `season` temporada nueva, `ep` capítulo nuevo. */
export type NewsTone = 'new' | 'season' | 'ep';
/** Arriba del título (diseño A2, docs/mockups/novedades/info.html): TIPO en su color + motivo; `finale` suma la pastilla. */
export type NewsKicker = { type: string; tone: NewsTone; motive: string; finale: boolean };

/** Tipo y motivo desde `reason`; sin `reason` (desktop actual), el tipo sale de `kind`/`what` y el motivo es cuándo salió. */
export function newsKicker(i: NewsItem, locale: string, now: number = Date.now()): NewsKicker {
	const finale = i.what?.type === 'episode' && i.what.finale;
	const r = i.reason;
	const ago = i.date ? newsAgo(i.date, now) : '';
	if (r?.type === 'season') {
		const motive = r.full ? t('Temporada {s} completa disponible', { s: r.season }) : t('Temporada {s} · E1 salió {d}', { s: r.season, d: ago });
		return { type: t('Temporada nueva'), tone: 'season', motive, finale };
	}
	if (i.what?.type === 'episode') {
		const motive = r?.type === 'episode' ? t('T{s}·E{e} salió {d}', { s: i.what.season, e: i.what.episode, d: ago }) : ago;
		return { type: t('Capítulo nuevo'), tone: 'ep', motive, finale };
	}
	const type = i.kind === 'movie' ? t('Película') : t('Serie nueva');
	if (r?.type === 'digital') return { type, tone: 'new', motive: t('Estreno digital en EE.UU. · {d}', { d: newsDay(r.date, locale) }), finale };
	if (r?.type === 'premiere') {
		const recent = now - Date.parse(r.date) < 7 * 864e5;
		const motive = recent ? t('Se estrenó {d}', { d: newsAgo(r.date, now) }) : t('Se estrenó el {d}', { d: newsDay(r.date, locale) });
		return { type, tone: 'new', motive, finale };
	}
	if (r?.type === 'trending') return { type, tone: 'new', motive: t('Tendencia #{n} esta semana', { n: r.rank }), finale };
	return { type, tone: 'new', motive: ago, finale };
}

/** Por qué aparece (capítulo o temporada), en lugar de la sinopsis; null: va la sinopsis. */
export function newsWhy(i: NewsItem): string | null {
	const r = i.reason;
	if (r?.type === 'season') return r.full ? t('Salieron los {n} capítulos de la temporada {s} el mismo día.', { n: r.episodes, s: r.season }) : t('Empezó la temporada {s}.', { s: r.season });
	if (i.what?.type !== 'episode') return null;
	const last = r?.type === 'episode' ? r.lastSeen : null;
	const follow = last ? t('Seguís {t}: el último que viste fue T{s}·E{e}.', { t: i.title, s: last.season, e: last.episode }) : t('Seguís {t}.', { t: i.title });
	return i.what.finale ? `${follow} ${t('Este cierra la temporada.')}` : follow;
}

/** "Con A y B" / "Con A"; null sin reparto. */
export function castLine(cast: string[] | undefined): string | null {
	const [a, b] = cast ?? [];
	if (!a) return null;
	return b ? t('Con {a} y {b}', { a, b }) : t('Con {name}', { name: a });
}

/** Texto del botón: "Ver", "Ver T2·E5" o, temporada nueva, "Ver T4". */
export function watchLabel(i: NewsItem): string {
	if (i.reason?.type === 'season') return t('Ver T{s}', { s: i.reason.season });
	return i.what?.type === 'episode' ? t('Ver T{s}·E{e}', { s: i.what.season, e: i.what.episode }) : t('Ver');
}

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
