// Catálogo como "Explorar" del desktop (streamonte/crates/core/src/catalog/top.rs): TMDB discover da los títulos
// del rango (y su ficha: IMDb id, idioma, país) y el dataset de IMDb da el puntaje y los votos reales. Se cruzan por IMDb id.
import { Fail, get } from './http.ts';
import { keys } from './keys.ts';
import { imdbOf, ratings } from './imdb.ts';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { lang, titlesLang } from './lang.ts';
import { translate } from '../i18n/translate.ts';
import type { Lang } from '../i18n/translate.ts';

const API = 'https://api.themoviedb.org/3';
const IMG = 'https://image.tmdb.org/t/p/';

// Respuestas de TMDB: solo los campos que se leen.
type TmdbItem = { id: number; title?: string; name?: string; release_date?: string; first_air_date?: string; poster_path?: string | null; original_language?: string; media_type?: 'movie' | 'tv' | 'person'; popularity?: number; genre_ids?: number[]; job?: string; episode_count?: number };
type TmdbPage = { results: TmdbItem[]; page: number; total_pages: number };
type TmdbPerson = { id: number; name: string; profile_path?: string | null; character?: string; job?: string };
type TmdbProvider = { provider_id: number; provider_name: string; logo_path?: string | null; display_priority: number };
type TmdbVideo = { key: string; site: string; type: string; official?: boolean; published_at?: string };
type TmdbSeason = { season_number: number; episode_count: number; name: string; air_date?: string | null };
type TmdbTitle = TmdbItem & {
	imdb_id?: string | null;
	external_ids?: { imdb_id?: string | null };
	origin_country?: string[];
	production_countries?: { iso_3166_1: string }[];
	genres?: { id: number; name: string }[];
	backdrop_path?: string | null;
	overview: string;
	runtime?: number | null;
	episode_run_time?: number[];
	status?: string;
	production_companies?: { name: string }[];
	credits?: { cast?: TmdbPerson[]; crew?: TmdbPerson[] };
	videos?: { results?: TmdbVideo[] };
	'watch/providers'?: { results?: Record<string, { flatrate?: TmdbProvider[]; ads?: TmdbProvider[]; free?: TmdbProvider[] }> };
	next_episode_to_air?: { air_date?: string; season_number: number; episode_number: number } | null;
	seasons?: TmdbSeason[];
};
type Kind = 'movie' | 'tv';

/** `language`: por defecto, el de los títulos. Devuelve `unknown`: cada llamada lo acota al tipo de su endpoint. */
async function tmdb(path: string, params: Record<string, unknown> = {}, language: Lang = titlesLang()): Promise<unknown> {
	const key = (await keys()).tmdb;
	if (!key) throw new Fail(428, 'Falta la key de TMDB: cargala en Ajustes.');
	const url = new URL(API + path);
	url.searchParams.set('api_key', key);
	url.searchParams.set('language', language === 'en' ? 'en-US' : 'es-MX');
	for (const [k, v] of Object.entries(params)) if (v != null && v !== '') url.searchParams.set(k, String(v));
	const r = await get(url);
	if (r.status === 401) throw new Fail(401, 'TMDB rechazó la key: revisala en Ajustes.');
	if (!r.ok) throw new Fail(502, 'TMDB respondió {s}.', { s: r.status });
	return r.json();
}

/** Id de TMDB del género Documental (el mismo en películas y series; en el desktop, `DOCUMENTARY` de `top.rs`). */
const DOCUMENTARY = 99;

const card = (r: TmdbItem, kind: Kind) => ({
	id: r.id,
	kind,
	title: r.title ?? r.name,
	year: (r.release_date ?? r.first_air_date ?? '').slice(0, 4),
	// Fecha de estreno de las películas (AAAA-MM-DD): recién estrenada = probablemente solo copias de cine (ver cinema.js).
	released: kind === 'movie' ? r.release_date || null : null,
	poster: r.poster_path ? `${IMG}w342${r.poster_path}` : null,
	rating: null,
	documentary: r.genre_ids?.includes(DOCUMENTARY) ?? false
});

/** Card con el puntaje de IMDb (mismo criterio en explorar y búsqueda). `r` es null si IMDb no lo tiene. */
const scored = (c: TmdbItem, kind: Kind, r: { rating: number } | null) => ({ ...card(c, kind), rating: r ? r.rating.toFixed(1) : null });
/** Géneros de series de TMDB que juntan dos, como `GENRES` del desktop (streamonte/crates/core/src/catalog/top.rs). */
const TV_GENRES: Record<number, string[]> = { 10759: ['Acción', 'Aventura'], 10765: ['Ciencia ficción', 'Fantasía'], 10768: ['Bélica'] };

/** Como el desktop: sin anime/japonés. */
export const keep = (r: TmdbItem): boolean => r.original_language !== 'ja';

/** TMDB tiene ~100 veces menos votos que IMDb: se piden candidatas con un piso 2,5 veces más bajo para no perder ninguna. */
const TMDB_VOTE_RATIO = 250;
/** Páginas de 20 de discover (600 candidatas, de más a menos votadas en TMDB). */
const MAX_PAGES = 30;
const PAGE = 20;
// TODO optimizar: en Vercel /tmp es efímero, las fichas se vuelven a pedir tras cada cold start.
const DIR = process.env.VERCEL ? '/tmp/.data' : '.data';
const DETAILS_FILE = `${DIR}/tmdb-fichas.json`;
/** Las fichas casi no cambian. */
const DETAILS_TTL = 90 * 24 * 3600 * 1000;
/** Listas armadas, por filtros: el scroll infinito pide de a 20 sin rehacer el cruce. */
const LIST_TTL = 10 * 60 * 1000;
/** Tope de listas y de títulos en memoria por instancia: se va la más vieja. */
const MAX_LISTS = 40;
const MAX_NAMES = 500;
/** Pisos de votos de IMDb que ofrece la web (como `VOTES` de catalog.svelte.js); `/api/catalog` acepta solo estos. */
export const VOTES = [0, 1000, 5000, 10000, 25000, 50000, 100000, 250000, 500000];
/** Guarda en un Map con tope: al pasarse, borra la entrada más vieja (los Map recorren en orden de inserción).
 */
export function capped<K, V>(map: Map<K, V>, key: K, value: V, max: number): void {
	map.delete(key);
	map.set(key, value);
	if (map.size > max) map.delete(map.keys().next().value as K);
}

type Detail = { imdb: number | null; lang: string | null; excluded: boolean; at: number };
/** "movie:123" → ficha. */
let details: Record<string, Detail> | null = null;
const lists = new Map<string, { at: number; list: Promise<ReturnType<typeof scored>[]> }>();

export function detail(raw: Partial<TmdbTitle>): Detail {
	const tt = raw.imdb_id ?? raw.external_ids?.imdb_id ?? '';
	const countries = raw.origin_country ?? raw.production_countries?.map((c) => c.iso_3166_1) ?? [];
	const anim = (raw.genres ?? []).some((g) => g.id === 16);
	return {
		imdb: /^tt\d+$/.test(tt) ? Number(tt.slice(2)) : null,
		// Idioma original, no los hablados.
		lang: raw.original_language ?? null,
		// Como `is_excluded` del desktop: de Japón, o con Japón y animación.
		excluded: countries[0] === 'JP' || (countries.includes('JP') && anim),
		at: Date.now()
	};
}

/** Fichas que faltan, de a 8 pedidos a la vez; quedan en `.data/` (una que falla se reintenta la próxima). */
async function fillDetails(kind: Kind, ids: number[]): Promise<Record<string, Detail>> {
	details ??= JSON.parse(await readFile(DETAILS_FILE, 'utf8').catch(() => '{}'));
	const all = details ?? {};
	const missing = ids.filter((id) => !(all[`${kind}:${id}`]?.at > Date.now() - DETAILS_TTL));
	if (!missing.length) return all;
	const queue = [...missing];
	const worker = async () => {
		for (let id: number | undefined; (id = queue.shift()) != null; ) {
			try {
				all[`${kind}:${id}`] = detail((await tmdb(`/${kind}/${id}`, kind === 'tv' ? { append_to_response: 'external_ids' } : {})) as TmdbTitle);
			} catch (e) {
				if (e instanceof Fail && e.status === 401) throw e;
			}
		}
	};
	await Promise.all(Array.from({ length: 8 }, worker));
	await mkdir(DIR, { recursive: true });
	await writeFile(DETAILS_FILE, JSON.stringify(all));
	return all;
}

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

/** Persona de los créditos de la ficha. `note`: personaje (actores). */
const person = (c: TmdbPerson, role: 'cast' | 'director', note: string | null) => ({ id: c.id, name: c.name, photo: c.profile_path ? `${IMG}w185${c.profile_path}` : null, role, note });

/** Dónde verla en Argentina (`providers_ar` del desktop): suscripción, avisos, gratis; sin repetir, por prioridad. */
export function providersAr(wp: TmdbTitle['watch/providers']) {
	const ar = wp?.results?.AR ?? {};
	const seen = new Set<number>();
	return [...(ar.flatrate ?? []), ...(ar.ads ?? []), ...(ar.free ?? [])]
		.filter((p) => !seen.has(p.provider_id) && seen.add(p.provider_id))
		.sort((a, b) => a.display_priority - b.display_priority)
		.map((p) => ({ name: p.provider_name, logo: p.logo_path ? `${IMG}w92${p.logo_path}` : null }));
}

/** Director (solo películas) y 3 actores (`people` del desktop). */
export function peopleOf(kind: Kind, credits: TmdbTitle['credits']) {
	return [
		...(kind === 'movie' ? (credits?.crew ?? []).filter((c) => c.job === 'Director').slice(0, 1) : []).map((c) => person(c, 'director', null)),
		...(credits?.cast ?? []).slice(0, 3).map((c) => person(c, 'cast', c.character || null))
	];
}

/** Estado de la serie y próximo episodio, como `tmdb_status` del desktop. */
export function showStatus(r: Pick<TmdbTitle, 'status' | 'next_episode_to_air'>) {
	const map: Record<string, string> = { 'Returning Series': 'returning', 'In Production': 'in-production', Pilot: 'in-production', Planned: 'planned', Ended: 'ended', Canceled: 'canceled', Cancelled: 'canceled' };
	const n = r.next_episode_to_air;
	return { status: map[r.status as string] ?? null, next: n?.air_date ? { season: n.season_number, episode: n.episode_number, date: n.air_date } : null };
}

/** Tráiler de YouTube: oficial primero, el más viejo (`first_trailer` del desktop). */
export function firstTrailer(videos: TmdbVideo[] | undefined): string | null {
	return (
		(videos ?? [])
			.filter((v) => v.site === 'YouTube' && v.type === 'Trailer')
			.sort((a, b) => Number(b.official) - Number(a.official) || String(a.published_at).localeCompare(String(b.published_at)))[0]?.key ?? null
	);
}

/** Ficha: datos, IMDb id (para los torrents) y temporadas. */
export async function title(kind: Kind, id: string | number) {
	// Sinopsis y géneros siempre en el idioma de la app: un pedido más (si difiere de los títulos), en paralelo.
	// El dataset de IMDb se espera junto con TMDB: en una instancia recién creada todavía no está cargado y el puntaje
	// salía vacío. Si no se puede bajar, la ficha sale igual, sin puntaje.
	const [r, info, table] = await Promise.all([
		tmdb(`/${kind}/${id}`, { append_to_response: 'external_ids,watch/providers,credits,videos', include_video_language: 'es,en,null' }) as Promise<TmdbTitle>,
		lang() !== titlesLang() ? (tmdb(`/${kind}/${id}`, {}, lang()) as Promise<TmdbTitle>) : null,
		ratings().catch(() => null)
	]);
	const about = info ?? r;
	// Dónde verla en Argentina (TMDB/JustWatch): suscripción primero, después con avisos o gratis.
	const providers = providersAr(r['watch/providers']);
	const langName = r.original_language ? new Intl.DisplayNames([lang()], { type: 'language' }).of(r.original_language) : null;
	const imdb = r.imdb_id ?? r.external_ids?.imdb_id ?? null;
	const real = table ? imdbOf(imdb, table) : null;
	return {
		...card(r, kind),
		...(real ? { rating: real.rating.toFixed(1) } : {}),
		backdrop: r.backdrop_path ? `${IMG}w1280${r.backdrop_path}` : null,
		overview: about.overview,
		runtime: r.runtime ?? r.episode_run_time?.[0] ?? null,
		// Los de series que juntan dos (y TMDB devuelve en inglés) se parten como en el desktop.
		genres: [...new Set((about.genres ?? []).flatMap((g) => TV_GENRES[g.id]?.map((x) => translate(lang(), x)) ?? [g.name]))],
		providers,
		// Quién la hizo: en películas el director primero; después los 3 actores principales con su personaje.
		people: peopleOf(kind, r.credits),
		companies: (r.production_companies ?? []).slice(0, 2).map((c) => c.name),
		lang: langName ? langName[0].toUpperCase() + langName.slice(1) : null,
		// Código ISO 639-1 del idioma original (`en`, `ja`…): el audio por defecto del video.
		origLang: r.original_language ?? null,
		// Estado de la serie, como `tmdb_status` del desktop.
		...showStatus(r),
		imdb,
		// Tráiler de YouTube: el más viejo (en series, el de la temporada 1), oficial primero; como en el desktop.
		trailer: firstTrailer(r.videos?.results),
		seasons: (r.seasons ?? [])
			.filter((s) => s.season_number > 0 && s.episode_count > 0)
			.map((s) => ({ n: s.season_number, name: s.name, count: s.episode_count, year: String(s.air_date ?? '').slice(0, 4) || null }))
	};
}

/** Títulos de una película por su IMDb id (original, inglés y español) y su año, para descartar torrents de otra
 * película con nombre parecido. Queda en memoria. */
/** `es`: título en español; `tmdb`: id de TMDB (para fuentes que buscan por nombre, como Hacktorrent). */
export type Names = { titles: string[]; year: number | null; es: string | null; tmdb: number };
const names = new Map<string, Promise<Names | null>>();
export function namesOf(imdb: string): Promise<Names | null> {
	if (!names.has(imdb)) {
		const find = (l: Lang) => (tmdb(`/find/${imdb}`, { external_source: 'imdb_id' }, l) as Promise<{ movie_results?: (TmdbItem & { original_title?: string })[] }>).then((r) => r.movie_results?.[0] ?? null);
		const p = Promise.all([find('en'), find('es')]).then(([en, es]) => {
			const m = en ?? es;
			if (!m) return null;
			return { titles: [...new Set([m.original_title, en?.title, es?.title].filter(Boolean))] as string[], year: Number(String(m.release_date ?? '').slice(0, 4)) || null, es: es?.title ?? null, tmdb: m.id };
		});
		// Si falla no se guarda: se reintenta la próxima.
		p.catch(() => names.delete(imdb));
		capped(names, imdb, p, MAX_NAMES);
	}
	return names.get(imdb) as Promise<Names | null>;
}

export async function season(id: string, n: string) {
	const r = (await tmdb(`/tv/${id}/season/${n}`)) as { episodes: { episode_number: number; name: string; air_date: string | null; still_path?: string | null }[] };
	return r.episodes.map((e) => ({
		n: e.episode_number,
		name: e.name,
		date: e.air_date,
		still: e.still_path ? `${IMG}w300${e.still_path}` : null
	}));
}
