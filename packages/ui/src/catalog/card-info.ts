// Lógica pura de los detalles que se ven al pasar el mouse por una tarjeta del catálogo (sin DOM; el traductor llega por parámetro).
import { seasonOutlook, type Outlook } from '../season.ts';
import { chartModel, type Chart } from '../title/title-state.ts';
import type { Kind, SeasonRatings, TitleDetails } from '../types.ts';

export type Tier = { emoji: string; name: string };

/** Categoría por puntaje de IMDb. Las series puntúan más alto, por eso sus cortes son otros.
 * `[corte película, corte serie, emoji, nombre]`, de mayor a menor. */
const RATING_TIERS: [number, number, string, string][] = [
	[8.5, 9.0, '🎞️', 'Clásico eterno'],
	[8.0, 8.6, '🏆', 'De Óscar'],
	[7.5, 8.3, '👏', 'Ovación de pie'],
	[7.0, 8.0, '🎟️', 'Vale la entrada'],
	[6.5, 7.6, '🍿', 'Pochoclera'],
	[6.0, 7.2, '🛋️', 'Peli de domingo'],
	[5.0, 6.5, '🎲', 'Depende del gusto'],
	[4.0, 5.5, '🧩', 'Para fans del género'],
	[-Infinity, -Infinity, '🎉', 'De culto entre amigos']
];

export function ratingTier(kind: Kind, rating: string | number | null): Tier | null {
	const r = Number(rating);
	if (!(r > 0)) return null;
	const hit = RATING_TIERS.find(([movie, series]) => r >= (kind === 'tv' ? series : movie));
	return hit ? { emoji: hit[2], name: hit[3] } : null;
}

/** Mini gráfico de temporadas de una serie y qué pasa con la próxima. `lastSeason`: última numerada (de `details.seasons`). */
export function cardSeasons(d: Pick<TitleDetails, 'status' | 'seasons'>, ratings: SeasonRatings): { chart: Chart | null; outlook: Outlook | null } {
	const lastSeason = Math.max(0, ...d.seasons.map((s) => s.number));
	const outlook = seasonOutlook(ratings.status ?? d.status, lastSeason);
	return { chart: chartModel(ratings, outlook), outlook };
}
