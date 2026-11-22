// Lógica pura del puntaje por temporada (sin DOM ni i18n). Los textos y el armado de la vista quedan en cada pantalla.
import type { SeasonRatings, ShowState, ShowStatus } from './types.ts';

/** Qué viene: terminada/cancelada, sin fecha (`wait`) o con fecha (`go`; `days` = días que faltan). */
export type Outlook =
	| { tone: 'done'; label: string }
	| { tone: 'stop'; label: string }
	| { tone: 'wait'; label: string; season: number }
	| { tone: 'go'; label: string; season: number; episode: number; date: string; days: number };
export type Trend = { tone: 'up' | 'down' | 'flat'; icon: 'trend-up' | 'trend-down' | 'trend-flat'; delta: number };
export type SeasonTone = 'great' | 'good' | 'meh' | 'bad';

/** Color por nota de la temporada. */
export const seasonTone = (x: number): SeasonTone => (x >= 8.5 ? 'great' : x >= 7.5 ? 'good' : x >= 6.5 ? 'meh' : 'bad');

/** Primera contra última temporada: sube, baja o estable (menos de 0,3). null con menos de 2 temporadas. */
export function seasonTrend(r: SeasonRatings): Trend | null {
	const v = r.seasons.map((x) => x.rating);
	const first = v[0];
	const last = v[v.length - 1];
	if (first === undefined || last === undefined || v.length < 2) return null;
	const delta = last - first;
	if (Math.abs(delta) < 0.3) return { tone: 'flat', icon: 'trend-flat', delta };
	return { tone: delta > 0 ? 'up' : 'down', icon: delta > 0 ? 'trend-up' : 'trend-down', delta };
}

/** Alto (%) de cada barra: la mejor llena la barra y la base es un punto debajo de la peor.
 * `values` = notas de las temporadas; `x` = la nota de la barra a dibujar. */
export function barHeight(values: number[], x: number): number {
	const top = Math.max(...values);
	const floor = Math.min(...values) - 1;
	return Math.max(12, ((x - floor) / (top - floor || 1)) * 100);
}

export const SHOW_STATES: Record<ShowState, string> = { returning: 'Renovada', 'in-production': 'En producción', planned: 'Planeada', ended: 'Terminada', canceled: 'Cancelada' };

/** Qué viene después de la última temporada. `last`: última temporada numerada. null = la fuente no lo sabe. */
export function seasonOutlook(st: ShowStatus | null | undefined, last: number, now: Date = new Date()): Outlook | null {
	const label = st ? SHOW_STATES[st.state] : undefined;
	if (!st || !label) return null;
	if (st.state === 'ended' || st.state === 'canceled') return { tone: st.state === 'ended' ? 'done' : 'stop', label };
	const next = st.next && new Date(`${st.next.date}T12:00:00`) > now ? st.next : null;
	if (!next) return { tone: 'wait', label, season: last + 1 };
	const today = new Date(now);
	today.setHours(12, 0, 0, 0);
	const days = Math.round((new Date(`${next.date}T12:00:00`).getTime() - today.getTime()) / 864e5);
	return { tone: 'go', label: 'En emisión', season: next.season, episode: next.episode, date: next.date, days };
}
