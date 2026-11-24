// Listas de TMDB cruzadas con IMDb: explorar (discover), búsqueda, personas y páginas de subgéneros.
import { Fail } from '../http-route.ts';
import { imdbOf, ratings } from '../imdb.ts';
import { titlesLang } from '../lang.ts';
import { capped, fillDetails } from './cache.ts';
import { card, keep, scored, tmdb, IMG } from './client.ts';
import type { Kind, TmdbItem, TmdbPage } from './client.ts';

/** TMDB tiene ~100 veces menos votos que IMDb: se piden candidatas con un piso 2,5 veces más bajo para no perder ninguna. */
const TMDB_VOTE_RATIO = 250;
/** Páginas de 20 de discover (600 candidatas, de más a menos votadas en TMDB). */
const MAX_PAGES = 30;
const PAGE = 20;
/** Listas armadas, por filtros: el scroll infinito pide de a 20 sin rehacer el cruce. */
const LIST_TTL = 10 * 60 * 1000;
/** Tope de listas y de títulos en memoria por instancia: se va la más vieja. */
const MAX_LISTS = 40;
/** Pisos de votos de IMDb que ofrece la web (como `VOTES` de catalog.svelte.js); `/api/catalog` acepta solo estos. */
export const VOTES = [0, 1000, 5000, 10000, 25000, 50000, 100000, 250000, 500000];

const lists = new Map<string, { at: number; list: Promise<ReturnType<typeof scored>[]> }>();

/** Títulos del rango, de más a menos votados en TMDB, hasta el piso proporcional o 30 páginas. */
async function candidates(f: Filters): Promise<TmdbItem[]> {
	const date = f.kind === 'movie' ? 'primary_release_date' : 'first_air_date';
	const page = async (page: number) =>
		(await tmdb(`/discover/${f.kind}`, {
			sort_by: 'vote_count.desc',
			include_adult: false,
			include_video: false,
			[`${date}.gte`]: f.from,
			[`${date}.lte`]: f.to,
			'vote_count.gte': Math.max(Math.floor(f.votes / TMDB_VOTE_RATIO), 20),
			with_original_language: f.lang.split(',').filter(Boolean).join('|'),
			page
		})) as TmdbPage;
	const first = await page(1);
	const out = [...first.results];
	const rest = Array.from({ length: Math.min(first.total_pages, MAX_PAGES) - 1 }, (_, i) => i + 2);
	for (let i = 0; i < rest.length; i += 5) {
		for (const p of await Promise.all(rest.slice(i, i + 5).map(page))) out.push(...p.results);
	}
	return out;
}

/** Cruce y orden: como IMDb, por puntaje y a igual puntaje por votos (o por popularidad de TMDB). */
async function build(f: Filters) {
	const [table, cands] = await Promise.all([ratings(), candidates(f)]);
	const all = await fillDetails(f.kind, cands.map((c) => c.id));
	const langs = f.lang.split(',').filter(Boolean);
	const seen = new Set<number>();
	const hits: (ReturnType<typeof scored> & { votes: number; pop: number })[] = [];
	for (const c of cands) {
		const d = all[`${f.kind}:${c.id}`];
		const r = d?.imdb ? imdbOf(d.imdb, table) : null;
		if (!d || !r || d.excluded || r.votes < f.votes || (langs.length && !langs.includes(d.lang ?? '')) || seen.has(d.imdb as number)) continue;
		seen.add(d.imdb as number);
		hits.push({ ...scored(c, f.kind, r), votes: r.votes, pop: c.popularity ?? 0 });
	}
	hits.sort(f.sort === 'rating' ? (a, b) => Number(b.rating) - Number(a.rating) || b.votes - a.votes : (a, b) => b.pop - a.pop);
	return hits.map(({ votes, pop, ...h }) => h);
}

export type Filters = { kind: Kind; sort: string; from: string; to: string; votes: number; lang: string; page: number };

export async function discover(f: Filters) {
	const { page, ...rest } = f;
	const key = JSON.stringify({ ...rest, titles: titlesLang() }); // los títulos vienen en ese idioma
	let hit = lists.get(key);
	if (!hit || hit.at < Date.now() - LIST_TTL) {
		hit = { at: Date.now(), list: build(f) };
		capped(lists, key, hit, MAX_LISTS);
		hit.list.catch(() => lists.delete(key));
	}
	const list = await hit.list;
	return { items: list.slice((page - 1) * PAGE, page * PAGE), page, pages: Math.max(1, Math.ceil(list.length / PAGE)) };
}

export async function search(q: string, page: number) {
	const j = (await tmdb('/search/multi', { query: q, page, include_adult: false })) as TmdbPage;
	const found = j.results.filter((r) => (r.media_type === 'movie' || r.media_type === 'tv') && keep(r)) as (TmdbItem & { media_type: Kind })[];
	const [table, movies, shows] = await Promise.all([
		ratings(),
		fillDetails('movie', found.filter((r) => r.media_type === 'movie').map((r) => r.id)),
		fillDetails('tv', found.filter((r) => r.media_type === 'tv').map((r) => r.id))
	]);
	// Sin piso de votos: quien busca quiere ver el título; si IMDb no lo tiene, queda sin puntaje.
	// Más votados en IMDb primero (sin puntaje = 0 votos, al final).
	// shortcut: ordena dentro de cada página de TMDB, no entre páginas; alcanza porque la 1ª trae lo relevante.
	const hits = found.map((r) => {
		const d = (r.media_type === 'movie' ? movies : shows)[`${r.media_type}:${r.id}`];
		const imdb = d?.imdb ? imdbOf(d.imdb, table) : null;
		return { item: scored(r, r.media_type, imdb), votes: imdb?.votes ?? 0 };
	});
	const items = hits.sort((a, b) => b.votes - a.votes).map((h) => h.item);
	return { items, page: j.page, pages: j.total_pages };
}

/** Sugerencias de actores y directores para el buscador: hasta 3 (los demás oficios no), con foto, rol y por qué se
 * lo conoce. */
export async function people(q: string): Promise<{ id: number; name: string; photo: string | null; known: string; role: 'cast' | 'director' }[]> {
	const j = (await tmdb('/search/person', { query: q, include_adult: false })) as { results: { id: number; name: string; profile_path?: string | null; known_for?: TmdbItem[]; known_for_department?: string }[] };
	return j.results
		.filter((r) => r.known_for?.length && (r.known_for_department === 'Acting' || r.known_for_department === 'Directing'))
		.slice(0, 3)
		.map((r) => ({
			id: r.id,
			name: r.name,
			photo: r.profile_path ? `${IMG}w185${r.profile_path}` : null,
			known: (r.known_for ?? []).slice(0, 2).map((k) => k.title ?? k.name).filter(Boolean).join(', '),
			role: r.known_for_department === 'Directing' ? ('director' as const) : ('cast' as const)
		}));
}

/** Géneros de TV que no son actuar (talk shows, noticias, realities): ahí aparece como sí mismo. */
const NOT_ACTING = [10767, 10763, 10764];
/** Series donde actuó menos episodios que esto: invitado o cameo (Friends para Brad Pitt), no se muestran. */
const MIN_EPISODES = 3;
/** Hasta cuántos títulos de un actor (los más populares): cada uno sin ficha guardada es un pedido a TMDB. */
const MAX_CREDITS = 80;

/** Lo que actuó (`cast`) o dirigió (`director`) una persona, películas y series, de más a menos popular, sin filtros:
 * una sola página. */
export async function personTitles(id: number, role: 'cast' | 'director') {
	const j = (await tmdb(`/person/${id}/combined_credits`)) as { cast: TmdbItem[]; crew: TmdbItem[] };
	const seen = new Set<string>();
	const credits = role === 'director' ? j.crew.filter((r) => r.job === 'Director') : j.cast;
	const cast = credits
		.filter((r) => (r.media_type === 'movie' || r.media_type === 'tv') && keep(r) && !r.genre_ids?.some((g) => NOT_ACTING.includes(g)) && (r.media_type === 'movie' || role === 'director' || (r.episode_count ?? 0) >= MIN_EPISODES))
		.filter((r) => !seen.has(`${r.media_type}${r.id}`) && seen.add(`${r.media_type}${r.id}`))
		.sort((a, b) => (b.popularity as number) - (a.popularity as number))
		.slice(0, MAX_CREDITS) as (TmdbItem & { media_type: Kind })[];
	const [table, movies, shows] = await Promise.all([
		ratings(),
		fillDetails('movie', cast.filter((r) => r.media_type === 'movie').map((r) => r.id)),
		fillDetails('tv', cast.filter((r) => r.media_type === 'tv').map((r) => r.id))
	]);
	const items = cast.map((r) => {
		const d = (r.media_type === 'movie' ? movies : shows)[`${r.media_type}:${r.id}`];
		return scored(r, r.media_type, d?.imdb ? imdbOf(d.imdb, table) : null);
	});
	return { items, page: 1, pages: 1 };
}

/** Tarjeta de un título de IMDb (los de la búsqueda por subgéneros): la web navega por id de TMDB, así que se busca con
 * `/find`. null si TMDB no lo tiene o es de los excluidos. Queda en memoria, por idioma de títulos. */
const found = new Map<string, Promise<ReturnType<typeof scored> | null>>();
const MAX_FOUND = 3000;
function cardOfImdb(kind: Kind, tt: string, rating: string | null) {
	const key = `${titlesLang()}:${kind}:${tt}`;
	let hit = found.get(key);
	if (!hit) {
		hit = (tmdb(`/find/${tt}`, { external_source: 'imdb_id' }) as Promise<{ movie_results?: TmdbItem[]; tv_results?: TmdbItem[] }>).then((r) => {
			const m = (kind === 'movie' ? r.movie_results : r.tv_results)?.[0];
			return m && keep(m) ? { ...card(m, kind), rating } : null;
		});
		hit.catch(() => found.delete(key));
		capped(found, key, hit, MAX_FOUND);
	}
	return hit;
}

/** Una página de 20 de una lista de IMDb ya ordenada, como tarjetas (de a 20 pedidos a `/find` a la vez). */
export async function imdbPage(kind: Kind, list: { tt: string; rating: string | null }[], page: number) {
	const slice = list.slice((page - 1) * PAGE, page * PAGE);
	const cards = await Promise.all(slice.map((h) => cardOfImdb(kind, h.tt, h.rating).catch((e) => {
		if (e instanceof Fail && (e.status === 401 || e.status === 428)) throw e;
		return null;
	})));
	return { items: cards.filter((c) => c !== null), page, pages: Math.max(1, Math.ceil(list.length / PAGE)) };
}
