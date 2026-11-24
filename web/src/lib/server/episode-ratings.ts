// Puntaje de IMDb de cada capítulo de una temporada (2026-11-24: la lista de capítulos lo muestra y el anti spoiler lo
// difumina en los no vistos). Con la API GraphQL pública de IMDb, como `awards.ts`. La misma regla vive en el desktop
// (`crates/core/src/catalog/episode_ratings.rs`), golden `packages/golden/episode_ratings.json`.
import type { EpisodeScore } from '../../../../packages/ui/src/types.ts';
import { Fail, get } from './http.ts';
import { capped } from './tmdb.ts';

const GQL = 'https://caching.graphql.imdb.com/';
/** Sin este header IMDb responde 403. */
const HEADERS = { 'content-type': 'application/json', 'x-imdb-client-name': 'imdb-web-next' };
/** Alcanza para las temporadas más largas (novelas, animé). */
const MAX_EPISODES = 250;
const TTL = 24 * 60 * 60 * 1000;
const MAX_SEASONS = 500;

type Node = { series?: { displayableEpisodeNumber?: { episodeNumber?: { text: string } | null; displayableSeason?: { text: string } | null } | null } | null; ratingsSummary?: { aggregateRating?: number | null } | null };
/** Lo que está dentro de `data` de la respuesta (también es la entrada del golden). */
export type EpisodeRatingsData = { title?: { episodes?: { episodes?: { edges: { node: Node }[] } | null } | null } | null };

const query = (tt: string, season: number) =>
	`{ title(id: "${tt}") { episodes { episodes(first: ${MAX_EPISODES}, filter: { includeSeasons: ["${season}"] }) { edges { node { series { displayableEpisodeNumber { episodeNumber { text } displayableSeason { text } } } ratingsSummary { aggregateRating } } } } } } }`;

const int = (s: string | undefined) => (s && /^\d+$/.test(s.trim()) ? Number(s.trim()) : null);

/** De la respuesta de IMDb a los puntajes: solo los de `season`, con número de capítulo y puntaje > 0, ordenados y sin
 * repetidos. Igual que `normalize` del desktop. */
export function normalize(data: EpisodeRatingsData, season: number): EpisodeScore[] {
	const out: EpisodeScore[] = [];
	for (const { node } of data.title?.episodes?.episodes?.edges ?? []) {
		const n = node.series?.displayableEpisodeNumber;
		const episode = int(n?.episodeNumber?.text);
		const rating = node.ratingsSummary?.aggregateRating;
		if (int(n?.displayableSeason?.text) !== season || episode == null || !rating || rating <= 0) continue;
		if (!out.some((x) => x.episode === episode)) out.push({ episode, rating });
	}
	return out.sort((a, b) => a.episode - b.episode);
}

const cache = new Map<string, { at: number; scores: Promise<EpisodeScore[]> }>();
/** Puntajes de la temporada `season` de `tt` (ya validados). Quedan en memoria un día por instancia. */
export function episodeRatings(tt: string, season: number): Promise<EpisodeScore[]> {
	const key = `${tt}-${season}`;
	let hit = cache.get(key);
	if (!hit || hit.at < Date.now() - TTL) {
		const p = (async () => {
			const r = await get(GQL, { method: 'POST', headers: HEADERS, body: JSON.stringify({ query: query(tt, season) }) });
			if (!r.ok) throw new Fail(502, 'IMDb respondió {s}.', { s: r.status });
			const j = (await r.json()) as { data?: EpisodeRatingsData | null; errors?: { message: string }[] };
			if (!j.data && j.errors?.length) throw new Fail(502, 'IMDb respondió {s}.', { s: j.errors[0].message });
			return normalize(j.data ?? {}, season);
		})();
		hit = { at: Date.now(), scores: p };
		capped(cache, key, hit, MAX_SEASONS);
		p.catch(() => cache.delete(key));
	}
	return hit.scores;
}
