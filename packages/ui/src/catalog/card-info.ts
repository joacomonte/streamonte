// Lógica pura de los detalles que se ven al pasar el mouse por una tarjeta del catálogo (sin DOM; el traductor llega por parámetro).
import { seasonOutlook, type Outlook } from '../season.ts';
import { chartModel, type Chart } from '../title/title-state.ts';
import type { SeasonRatings, TitleDetails } from '../types.ts';

/** Mini gráfico de temporadas de una serie y qué pasa con la próxima. `lastSeason`: última numerada (de `details.seasons`). */
export function cardSeasons(d: Pick<TitleDetails, 'status' | 'seasons'>, ratings: SeasonRatings): { chart: Chart | null; outlook: Outlook | null } {
	const lastSeason = Math.max(0, ...d.seasons.map((s) => s.number));
	const outlook = seasonOutlook(ratings.status ?? d.status, lastSeason);
	return { chart: chartModel(ratings, outlook), outlook };
}
