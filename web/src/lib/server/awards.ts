// Premios de un título con la API GraphQL pública de IMDb (la de su sitio, como `interests.ts`): totales y el detalle de los
// grandes (Óscar, Globos de Oro, BAFTA, Emmy, SAG, Goya y los premios principales de Cannes, Venecia y Berlín). Uso personal
// (la app es privada). La misma regla vive en el desktop (`crates/core/src/catalog/awards.rs`), golden
// `packages/golden/awards.json`; la UI agrupa y traduce (`packages/ui/src/title/awards.ts`). En la misma consulta vienen los
// subgéneros de IMDb del título (`interests`, ids `in…`; 2026-11-24) para el hover de la tarjeta.
import type { AwardEntry, AwardEvent, TitleAwards } from '../../../../packages/ui/src/types.ts';
import { Fail, get } from './http.ts';
import { capped } from './tmdb.ts';

const GQL = 'https://caching.graphql.imdb.com/';
/** Sin este header IMDb responde 403. */
const HEADERS = { 'content-type': 'application/json', 'x-imdb-client-name': 'imdb-web-next' };
/** Eventos que se detallan: id de IMDb → clave corta que entiende la UI. */
const EVENTS: Record<string, AwardEvent> = {
	ev0000003: 'oscar', ev0000292: 'globe', ev0000123: 'bafta', ev0000223: 'emmy', ev0000598: 'sag', ev0000299: 'goya',
	ev0000147: 'cannes', ev0000681: 'venice', ev0000091: 'berlin'
};
/** De los festivales solo los premios principales (el resto son jurados paralelos, prensa, etc.). */
const FESTIVAL_PRIZES = ["Palme d'Or", 'Grand Prize', 'Jury Prize', 'Best Director', 'Best Actor', 'Best Actress', 'Best Screenplay', 'Golden Lion', 'Silver Lion', 'Volpi Cup', 'Berlin Bear'];
const FESTIVALS = new Set<AwardEvent>(['cannes', 'venice', 'berlin']);
/** Alcanza para todo lo de los eventos grandes aun en series largas (Breaking Bad: ~90). */
const MAX_ENTRIES = 150;
/** Subgéneros de IMDb que se piden por título (IMDb rara vez da más de 10). */
const MAX_INTERESTS = 12;
const TTL = 24 * 60 * 60 * 1000;
const MAX_TITLES = 500;

type Node = { isWinner?: boolean; award?: { text?: string | null; year?: number | null; event?: { id: string } | null } | null; category?: { text: string } | null };
/** Lo que está dentro de `data` de la respuesta (también es la entrada del golden). */
export type AwardsData = { title?: { all?: { total: number } | null; won?: { total: number } | null; top?: { edges: { node: Node }[] } | null; interests?: { edges: { node: { id: string } }[] } | null; ratingsSummary?: { aggregateRating?: number | null } | null } | null };

const query = (tt: string) =>
	`{ title(id: "${tt}") { all: awardNominations(first: 0) { total } won: awardNominations(first: 0, filter: { wins: WINS_ONLY }) { total } top: awardNominations(first: ${MAX_ENTRIES}, filter: { events: ${JSON.stringify(Object.keys(EVENTS))} }, sort: { by: PRESTIGIOUS, order: DESC }) { edges { node { isWinner award { text year event { id } } category { text } } } } interests(first: ${MAX_INTERESTS}) { edges { node { id } } } ratingsSummary { aggregateRating } } }`;

/** De la respuesta de IMDb a `TitleAwards`: solo eventos conocidos y, de los festivales, los premios principales; textos
 * recortados (vacío = sin categoría); de los subgéneros, solo ids `in…`; puntaje solo si es > 0. Igual que `normalize` del desktop. */
export function normalize(data: AwardsData): TitleAwards {
	const t = data.title;
	if (!t) return { wins: 0, nominations: 0, entries: [], interests: [], rating: null };
	const wins = t.won?.total ?? 0;
	const entries: AwardEntry[] = [];
	for (const { node } of t.top?.edges ?? []) {
		const event = node.award?.event ? EVENTS[node.award.event.id] : undefined;
		const award = (node.award?.text ?? '').trim();
		if (!event || !award || (FESTIVALS.has(event) && !FESTIVAL_PRIZES.some((p) => award.includes(p)))) continue;
		entries.push({ event, won: node.isWinner ?? false, award, category: node.category?.text.trim() || null, year: node.award?.year ?? null });
	}
	const interests = (t.interests?.edges ?? []).map((e) => e.node.id).filter((id) => id.startsWith('in'));
	const r = t.ratingsSummary?.aggregateRating;
	return { wins, nominations: Math.max(0, (t.all?.total ?? 0) - wins), entries, interests, rating: r && r > 0 ? r : null };
}

const cache = new Map<string, { at: number; awards: Promise<TitleAwards> }>();
/** Premios de `tt` (ya validado). Quedan en memoria un día por instancia. */
export function awards(tt: string): Promise<TitleAwards> {
	let hit = cache.get(tt);
	if (!hit || hit.at < Date.now() - TTL) {
		const p = (async () => {
			const r = await get(GQL, { method: 'POST', headers: HEADERS, body: JSON.stringify({ query: query(tt) }) });
			if (!r.ok) throw new Fail(502, 'IMDb respondió {s}.', { s: r.status });
			const j = (await r.json()) as { data?: AwardsData | null; errors?: { message: string }[] };
			if (!j.data && j.errors?.length) throw new Fail(502, 'IMDb respondió {s}.', { s: j.errors[0].message });
			return normalize(j.data ?? {});
		})();
		hit = { at: Date.now(), awards: p };
		capped(cache, tt, hit, MAX_TITLES);
		p.catch(() => cache.delete(tt));
	}
	return hit.awards;
}
