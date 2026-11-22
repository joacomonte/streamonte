// @ts-check
// Lógica pura del puntaje por temporada (sin DOM ni i18n; se prueba en season.test.js).
// Los textos y el armado del DOM quedan en catalog-side.js.

/** @typedef {{ season: number, rating: number, episodes: number }} SeasonScore */
/** @typedef {{ state: 'returning' | 'in-production' | 'planned' | 'ended' | 'canceled', next: { season: number, episode: number, date: string } | null }} ShowStatus */
/** @typedef {{ seasons: SeasonScore[], status: ShowStatus | null }} SeasonRatings */
/** Qué viene: terminada/cancelada, sin fecha (`wait`) o con fecha (`go`; `days` = días que faltan).
 *  @typedef {{ tone: 'done', label: string } | { tone: 'stop', label: string }
 *   | { tone: 'wait', label: string, season: number }
 *   | { tone: 'go', label: string, season: number, episode: number, date: string, days: number }} Outlook */
/** @typedef {{ tone: 'up' | 'down' | 'flat', icon: 'trend-up' | 'trend-down' | 'trend-flat', delta: number }} Trend */

/** Color por nota de la temporada. */
export const seasonTone = (/** @type {number} */ x) => (x >= 8.5 ? 'great' : x >= 7.5 ? 'good' : x >= 6.5 ? 'meh' : 'bad');

/** Primera contra última temporada: sube, baja o estable (menos de 0,3). null con menos de 2 temporadas.
 *  @param {SeasonRatings} r
 *  @returns {Trend | null} */
export function seasonTrend(r) {
  const v = r.seasons.map((x) => x.rating);
  if (v.length < 2) return null;
  const delta = v[v.length - 1] - v[0];
  if (Math.abs(delta) < 0.3) return { tone: 'flat', icon: 'trend-flat', delta };
  return { tone: delta > 0 ? 'up' : 'down', icon: delta > 0 ? 'trend-up' : 'trend-down', delta };
}

/** Alto (%) de cada barra: la mejor llena la barra y la base es un punto debajo de la peor.
 *  `values` = notas de las temporadas; `x` = la nota de la barra a dibujar.
 *  @param {number[]} values @param {number} x */
export function barHeight(values, x) {
  const top = Math.max(...values), floor = Math.min(...values) - 1;
  return Math.max(12, ((x - floor) / (top - floor || 1)) * 100);
}

export const SHOW_STATES = { returning: 'Renovada', 'in-production': 'En producción', planned: 'Planeada', ended: 'Terminada', canceled: 'Cancelada' };

/** Qué viene después de la última temporada. `last`: última temporada numerada. null = la fuente no lo sabe.
 *  @param {ShowStatus | null | undefined} st @param {number} last @param {Date} [now]
 *  @returns {Outlook | null} */
export function seasonOutlook(st, last, now = new Date()) {
  const label = st && SHOW_STATES[st.state];
  if (!st || !label) return null;
  if (st.state === 'ended' || st.state === 'canceled') return { tone: st.state === 'ended' ? 'done' : 'stop', label };
  const next = st.next && new Date(`${st.next.date}T12:00:00`) > now ? st.next : null;
  if (!next) return { tone: 'wait', label, season: last + 1 };
  const today = new Date(now);
  today.setHours(12, 0, 0, 0);
  const days = Math.round((new Date(`${next.date}T12:00:00`).getTime() - today.getTime()) / 864e5);
  return { tone: 'go', label: 'En emisión', season: next.season, episode: next.episode, date: next.date, days };
}
