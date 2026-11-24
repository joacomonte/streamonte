// Búsqueda por subgéneros de IMDb ("interests", ids `in…`) con su API GraphQL pública (la de su sitio): el catálogo con un
// género elegido y los ejemplos de las tarjetas de géneros. Uso personal (la app es privada). La misma consulta vive en el
// desktop: streamonte/crates/core/src/catalog/interests.rs.
import { Fail, get } from './http.ts';
import { capped } from './tmdb.ts';

const GQL = 'https://caching.graphql.imdb.com/';
/** Sin este header IMDb responde 403. */
const HEADERS = { 'content-type': 'application/json', 'x-imdb-client-name': 'imdb-web-next' };
/** Lo más que se pide de una búsqueda: alcanza para el scroll (de a 20) sin cursores. */
const MAX = 250;
const LIST_TTL = 30 * 60 * 1000;
const MAX_LISTS = 40;
const TYPES = { movie: ['movie'], tv: ['tvSeries', 'tvMiniSeries'] } as const;

type Kind = 'movie' | 'tv';
type Node = { title: { id: string; ratingsSummary?: { aggregateRating?: number | null } | null; titleText?: { text: string } | null; primaryImage?: { url: string } | null } };
type Search = { data?: Record<string, { edges: { node: Node }[] } | null>; errors?: { message: string }[] };

async function query(q: string): Promise<Search> {
	const r = await get(GQL, { method: 'POST', headers: HEADERS, body: JSON.stringify({ query: q }) });
	if (!r.ok) throw new Fail(502, 'IMDb respondió {s}.', { s: r.status });
	const j = (await r.json()) as Search;
	if (!j.data && j.errors?.length) throw new Fail(502, 'IMDb respondió {s}.', { s: j.errors[0].message });
	return j;
}

const ids = (list: string[]) => JSON.stringify(list);
/** Póster de IMDb achicado (el original pesa varios MB). */
export const smallPoster = (url: string | undefined | null, w = 342): string | null => (url ? url.replace(/\._V1_.*\.jpg$/, `._V1_QL75_UX${w}_.jpg`) : null);

export type InterestFilters = { kind: Kind; sort: string; from: string; to: string; votes: number; lang: string; interests: string[] };
export type Hit = { tt: string; rating: string | null };

/** Constraints de la búsqueda: subgéneros (alcanza con uno), tipo, fechas, votos e idioma original. */
export function constraints(f: InterestFilters): string {
	const c = [
		`interestConstraint: { anyInterestIds: ${ids(f.interests)} }`,
		`titleTypeConstraint: { anyTitleTypeIds: ${ids([...TYPES[f.kind]])} }`
	];
	if (f.from || f.to) c.push(`releaseDateConstraint: { releaseDateRange: { ${f.from ? `start: "${f.from}"` : ''} ${f.to ? `end: "${f.to}"` : ''} } }`);
	if (f.votes) c.push(`userRatingsConstraint: { ratingsCountRange: { min: ${Math.trunc(f.votes)} } }`);
	const langs = f.lang.split(',').filter((l) => /^[a-z]{2}$/.test(l));
	if (langs.length) c.push(`languageConstraint: { anyPrimaryLanguages: ${ids(langs)} }`);
	return c.join(', ');
}

const lists = new Map<string, { at: number; list: Promise<Hit[]> }>();
/** Toda la lista (hasta 250) ya ordenada: por puntaje de IMDb o por popularidad. Queda en memoria un rato. */
export function interestList(f: InterestFilters): Promise<Hit[]> {
	const key = JSON.stringify(f);
	let hit = lists.get(key);
	if (!hit || hit.at < Date.now() - LIST_TTL) {
		const sort = f.sort === 'popular' ? 'sortBy: POPULARITY, sortOrder: ASC' : 'sortBy: USER_RATING, sortOrder: DESC';
		const q = `{ s: advancedTitleSearch(first: ${MAX}, constraints: { ${constraints(f)} }, sort: { ${sort} }) { edges { node { title { id ratingsSummary { aggregateRating } } } } } }`;
		const list = query(q).then((j) => (j.data?.s?.edges ?? []).map(({ node }) => {
			const r = node.title.ratingsSummary?.aggregateRating;
			return { tt: node.title.id, rating: r ? r.toFixed(1) : null };
		}));
		hit = { at: Date.now(), list };
		capped(lists, key, hit, MAX_LISTS);
		list.catch(() => lists.delete(key));
	}
	return hit.list;
}

export type Example = { title: string; poster: string | null };
/** Ejemplos populares de cada interest, en un solo pedido (un alias por id). Títulos como los da IMDb. */
export async function examples(kind: Kind, list: string[]): Promise<Record<string, Example[]>> {
	const votes = kind === 'tv' ? 20_000 : 50_000;
	const parts = list.map((id, i) =>
		`a${i}: advancedTitleSearch(first: 8, constraints: { interestConstraint: { allInterestIds: ["${id}"] }, titleTypeConstraint: { anyTitleTypeIds: ${ids([...TYPES[kind]])} }, userRatingsConstraint: { ratingsCountRange: { min: ${votes} } } }, sort: { sortBy: POPULARITY, sortOrder: ASC }) { edges { node { title { id titleText { text } primaryImage { url } } } } }`
	);
	const j = await query(`{ ${parts.join(' ')} }`);
	return Object.fromEntries(list.map((id, i) => [id, (j.data?.[`a${i}`]?.edges ?? []).map(({ node }) => ({ title: node.title.titleText?.text ?? '', poster: smallPoster(node.title.primaryImage?.url, 220) }))]));
}
