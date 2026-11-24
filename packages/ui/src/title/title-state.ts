// Estado derivado puro de la ficha (sin DOM ni i18n): lo que `TitleView.svelte` y `SeasonChart.svelte` dibujan. Se prueba con las
// fixtures del desktop (`title-state.test.ts`). Imports relativos: `node --test` no resuelve `$ui`.
import { barHeight, seasonOutlook, seasonTone, seasonTrend } from '../season.ts';
import type { Outlook, SeasonTone, Trend } from '../season.ts';
import { onlyCinema } from '../format.ts';
import type { Episode, Person, Provider, Season, SeasonRatings, TitleDetails } from '../types.ts';

/** Actores a la vista en la ficha; el resto (hasta 18, `MAX_CAST` de web y desktop) con "y N más". */
export const MAX_ACTORS = 6;
export const MAX_PROVIDERS = 3;

/** Director primero y los actores principales (`MAX_ACTORS`). */
export function pickPeople(people: Person[]): Person[] {
	const director = people.find((p) => p.role === 'director');
	const cast = people.filter((p) => p.role === 'cast').slice(0, MAX_ACTORS);
	return director ? [director, ...cast] : cast;
}

/** Plataformas: apiladas (las primeras) o, abierta la pastilla, todas con nombre. `more`: las que no entran apiladas. */
export function providerView(providers: Provider[], open: boolean): { shown: Provider[]; more: number } {
	return open ? { shown: providers, more: 0 } : { shown: providers.slice(0, MAX_PROVIDERS), more: Math.max(0, providers.length - MAX_PROVIDERS) };
}

export type SeasonTile = { number: number; name: string | null; episodeCount: number; year: string | null; score: number | null };

/** Lista de temporadas con su puntaje de IMDb; Especiales (0) al final. */
export function seasonTiles(seasons: Season[], ratings: SeasonRatings | null | undefined): SeasonTile[] {
	const score = new Map((ratings?.seasons ?? []).map((x) => [x.season, x.rating]));
	return [...seasons]
		.sort((a, b) => (a.number || 999) - (b.number || 999))
		.map((s) => ({ number: s.number, name: s.name, episodeCount: s.episodeCount, year: s.year, score: score.get(s.number) ?? null }));
}

/** Qué viene después de la última temporada. El puntaje por temporada del desktop trae el estado; el de la web, la ficha. */
export function outlookOf(d: TitleDetails, ratings: SeasonRatings | null | undefined): Outlook | null {
	return seasonOutlook(ratings?.status ?? d.status, Math.max(0, ...d.seasons.map((s) => s.number)));
}

export type ChartBar = { season: number; rating: number; tone: SeasonTone; height: number; best: boolean };
export type ChartGhost = { season: number; go: boolean; date: string | null; height: number };
export type Chart = { bars: ChartBar[]; ghost: ChartGhost | null; trend: Trend | null; end: 'done' | 'stop' | null };

/** Barras del gráfico de puntaje por temporada; null = no hay nada que mostrar (menos de 2 temporadas y sin "lo que viene"). */
export function chartModel(r: SeasonRatings, o: Outlook | null): Chart | null {
	const v = r.seasons.map((x) => x.rating);
	const last = r.seasons[r.seasons.length - 1];
	const upcoming = last && o && (o.tone === 'wait' || o.tone === 'go') && o.season > last.season ? o : null;
	if (v.length < 2 && !(v.length && upcoming)) return null;
	const top = Math.max(...v);
	return {
		bars: r.seasons.map((x) => ({ season: x.season, rating: x.rating, tone: seasonTone(x.rating), height: barHeight(v, x.rating), best: x.rating === top })),
		ghost: upcoming ? { season: upcoming.season, go: upcoming.tone === 'go', date: upcoming.tone === 'go' ? upcoming.date : null, height: barHeight(v, v[v.length - 1] ?? top) } : null,
		trend: seasonTrend(r),
		end: o?.tone === 'done' || o?.tone === 'stop' ? o.tone : null
	};
}

export type EpisodeRow = { ep: Episode; future: boolean };
/** `today`: AAAA-MM-DD. Los que salen después de hoy van atenuados. */
export const episodeRows = (eps: Episode[], today: string): EpisodeRow[] => eps.map((ep) => ({ ep, future: !!ep.date && ep.date > today }));

/** Aviso de "todavía no hay buenos torrents" (solo películas recién estrenadas). */
export const showCineNote = (d: TitleDetails): boolean => d.kind === 'movie' && !!d.released && onlyCinema(d.released);

/** Ids de los elementos interactivos: cada app conserva los suyos (los usan `scripts/shot.mjs` y los tests). */
export type TitleIds = {
	poster: string;
	imdb: string;
	providers: string;
	cast: string;
	genres: string;
	provider: (i: number) => string;
	person: (p: Person) => string;
	about: string;
	aboutBody: string;
	awards: string;
	awardsBody: string;
	cine: string;
	similarToggle: string;
	similar: (id: string) => string;
	crumbSeasons: string;
	season: (n: number) => string;
	bar: (n: number) => string;
	nextSeason: string;
	episode: (season: number, episode: number) => string;
};
export const WEB_IDS: TitleIds = {
	poster: 'poster', imdb: 'imdb-link', providers: 'providers-toggle', cast: 'cast-toggle', genres: 'genres-toggle', provider: (i) => `provider-${i}`,
	person: (p) => `person-${p.id}`, about: 'about-toggle', aboutBody: 'about-body', awards: 'awards-toggle', awardsBody: 'awards-body', cine: 'cine-note', similarToggle: 'similar-toggle', similar: (id) => `similar-${id}`,
	crumbSeasons: 'crumb-seasons', season: (n) => `season-${n}`, bar: (n) => `score-s${n}`, nextSeason: 'season-next', episode: (_s, e) => `ep-${e}`
};
export const DESKTOP_IDS: TitleIds = {
	poster: 'cat-poster', imdb: 'cat-open-imdb', providers: 'cat-providers', cast: 'cat-cast', genres: 'cat-genres', provider: (i) => `cat-provider-${i}`,
	person: (p) => `cat-who-${p.role}-${p.id}`, about: 'cat-about-toggle', aboutBody: 'cat-about-body', awards: 'cat-awards-toggle', awardsBody: 'cat-awards-body', cine: 'cat-cine-note', similarToggle: 'cat-similar-toggle',
	similar: (id) => `cat-similar-${id}`, crumbSeasons: 'cat-crumb-seasons', season: (n) => `cat-season-${n}`, bar: (n) => `cat-season-bar-${n}`,
	nextSeason: 'cat-season-next', episode: (s, e) => `cat-ep-${s}-${e}`
};
