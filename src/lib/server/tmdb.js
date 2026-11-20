// Catálogo como "Explorar" del desktop (streamonte/crates/core/src/catalog/top.rs): TMDB discover da los títulos
// del rango (y su ficha: IMDb id, idioma, país) y el dataset de IMDb da el puntaje y los votos reales. Se cruzan por IMDb id.
import { Fail, get } from './http.js';
import { keys } from './keys.js';
import { imdbOf, ratings } from './imdb.js';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { lang, titlesLang } from './lang.js';
import { translate } from '../i18n/translate.js';

const API = 'https://api.themoviedb.org/3';
const IMG = 'https://image.tmdb.org/t/p/';

/** @param {string} path @param {Record<string, unknown>} [params] @param {'es' | 'en'} [language] por defecto, el de los títulos */
async function tmdb(path, params = {}, language = titlesLang()) {
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

/** @param {any} r @param {'movie' | 'tv'} kind */
const card = (r, kind) => ({
	id: r.id,
	kind,
	title: r.title ?? r.name,
	year: (r.release_date ?? r.first_air_date ?? '').slice(0, 4),
	// Fecha de estreno de las películas (AAAA-MM-DD): recién estrenada = probablemente solo copias de cine (ver cinema.js).
	released: kind === 'movie' ? r.release_date || null : null,
	poster: r.poster_path ? `${IMG}w342${r.poster_path}` : null,
	rating: null
});

/** Card con el puntaje de IMDb (mismo criterio en explorar y búsqueda). `r` es null si IMDb no lo tiene. @param {any} c @param {'movie' | 'tv'} kind @param {{rating: number} | null} r */
const scored = (c, kind, r) => ({ ...card(c, kind), rating: r ? r.rating.toFixed(1) : null });
/** Géneros de series de TMDB que juntan dos, como `GENRES` del desktop (streamonte/crates/core/src/catalog/top.rs). @type {Record<number, string[]>} */
const TV_GENRES = { 10759: ['Acción', 'Aventura'], 10765: ['Ciencia ficción', 'Fantasía'], 10768: ['Bélica'] };

/** Como el desktop: sin anime/japonés. @param {any} r */
const keep = (r) => r.original_language !== 'ja';

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
 * @template K, V @param {Map<K, V>} map @param {K} key @param {V} value @param {number} max */
function capped(map, key, value, max) {
	map.delete(key);
	map.set(key, value);
	if (map.size > max) map.delete(/** @type {K} */ (map.keys().next().value));
}

/** @typedef {{imdb: number | null, lang: string | null, excluded: boolean, at: number}} Detail */
/** "movie:123" → ficha. @type {Record<string, Detail> | null} */
let details = null;
/** @type {Map<string, {at: number, list: Promise<any[]>}>} */
const lists = new Map();

/** @param {any} raw @returns {Detail} */
function detail(raw) {
	const tt = raw.imdb_id ?? raw.external_ids?.imdb_id;
	const countries = raw.origin_country ?? raw.production_countries?.map((/** @type {any} */ c) => c.iso_3166_1) ?? [];
	const anim = (raw.genres ?? []).some((/** @type {any} */ g) => g.id === 16);
	return {
		imdb: /^tt\d+$/.test(tt ?? '') ? Number(tt.slice(2)) : null,
		// Idioma original, no los hablados.
		lang: raw.original_language ?? null,
		// Como `is_excluded` del desktop: de Japón, o con Japón y animación.
		excluded: countries[0] === 'JP' || (countries.includes('JP') && anim),
		at: Date.now()
	};
}

/** Fichas que faltan, de a 8 pedidos a la vez; quedan en `.data/` (una que falla se reintenta la próxima). @param {'movie' | 'tv'} kind @param {number[]} ids */
async function fillDetails(kind, ids) {
	details ??= JSON.parse(await readFile(DETAILS_FILE, 'utf8').catch(() => '{}'));
	const all = /** @type {Record<string, Detail>} */ (details);
	const missing = ids.filter((id) => !(all[`${kind}:${id}`]?.at > Date.now() - DETAILS_TTL));
	if (!missing.length) return all;
	const queue = [...missing];
	const worker = async () => {
		for (let id; (id = queue.shift()) != null; ) {
			try {
				all[`${kind}:${id}`] = detail(await tmdb(`/${kind}/${id}`, kind === 'tv' ? { append_to_response: 'external_ids' } : {}));
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

/** Títulos del rango, de más a menos votados en TMDB, hasta el piso proporcional o 30 páginas. @param {Filters} f */
async function candidates(f) {
	const date = f.kind === 'movie' ? 'primary_release_date' : 'first_air_date';
	const genres = f.genres.join('|');
	/** @param {number} page */
	const page = (page) =>
		tmdb(`/discover/${f.kind}`, {
			sort_by: 'vote_count.desc',
			include_adult: false,
			include_video: false,
			[`${date}.gte`]: f.from,
			[`${date}.lte`]: f.to,
			'vote_count.gte': Math.max(Math.floor(f.votes / TMDB_VOTE_RATIO), 20),
			with_original_language: f.lang.split(',').filter(Boolean).join('|'),
			with_genres: genres,
			page
		});
	const first = await page(1);
	const out = [...first.results];
	const rest = Array.from({ length: Math.min(first.total_pages, MAX_PAGES) - 1 }, (_, i) => i + 2);
	for (let i = 0; i < rest.length; i += 5) {
		for (const p of await Promise.all(rest.slice(i, i + 5).map(page))) out.push(...p.results);
	}
	return out;
}

/** Cruce y orden: como IMDb, por puntaje y a igual puntaje por votos (o por popularidad de TMDB). @param {Filters} f */
async function build(f) {
	const [table, cands] = await Promise.all([ratings(), candidates(f)]);
	const all = await fillDetails(f.kind, cands.map((c) => c.id));
	const langs = f.lang.split(',').filter(Boolean);
	const seen = new Set();
	const hits = [];
	for (const c of cands) {
		const d = all[`${f.kind}:${c.id}`];
		const r = d?.imdb ? imdbOf(d.imdb, table) : null;
		if (!d || !r || d.excluded || r.votes < f.votes || (langs.length && !langs.includes(d.lang ?? '')) || seen.has(d.imdb)) continue;
		seen.add(d.imdb);
		hits.push({ ...scored(c, f.kind, r), votes: r.votes, pop: c.popularity ?? 0 });
	}
	hits.sort(f.sort === 'rating' ? (a, b) => Number(b.rating) - Number(a.rating) || b.votes - a.votes : (a, b) => b.pop - a.pop);
	return hits.map(({ votes, pop, ...h }) => h);
}

/** @typedef {{kind: 'movie' | 'tv', sort: string, from: string, to: string, votes: number, lang: string, genres: string[], page: number}} Filters */

/** @param {Filters} f */
export async function discover(f) {
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

/** @param {string} q @param {number} page */
export async function search(q, page) {
	const j = await tmdb('/search/multi', { query: q, page, include_adult: false });
	/** @type {any[]} */
	const found = j.results.filter((/** @type {any} */ r) => (r.media_type === 'movie' || r.media_type === 'tv') && keep(r));
	const [table, movies, shows] = await Promise.all([
		ratings(),
		fillDetails('movie', found.filter((r) => r.media_type === 'movie').map((r) => r.id)),
		fillDetails('tv', found.filter((r) => r.media_type === 'tv').map((r) => r.id))
	]);
	// Sin piso de votos: quien busca quiere ver el título; si IMDb no lo tiene, queda sin puntaje.
	const items = found.map((r) => {
		const d = (r.media_type === 'movie' ? movies : shows)[`${r.media_type}:${r.id}`];
		return scored(r, r.media_type, d?.imdb ? imdbOf(d.imdb, table) : null);
	});
	return { items, page: j.page, pages: j.total_pages };
}

/** @param {'movie' | 'tv'} kind */
export async function genres(kind) {
	const j = await tmdb(`/genre/${kind}/list`, {}, lang());
	return j.genres.map((/** @type {any} */ g) => ({ id: String(g.id), name: g.name }));
}

/** Ficha: datos, IMDb id (para los torrents) y temporadas. @param {'movie' | 'tv'} kind @param {string} id */
export async function title(kind, id) {
	// Sinopsis y géneros siempre en el idioma de la app: un pedido más (si difiere de los títulos), en paralelo.
	// El dataset de IMDb se espera junto con TMDB: en una instancia recién creada todavía no está cargado y el puntaje
	// salía vacío. Si no se puede bajar, la ficha sale igual, sin puntaje.
	const [r, info, table] = await Promise.all([
		tmdb(`/${kind}/${id}`, { append_to_response: 'external_ids,watch/providers,credits,videos', include_video_language: 'es,en,null' }),
		lang() !== titlesLang() ? tmdb(`/${kind}/${id}`, {}, lang()) : null,
		ratings().catch(() => null)
	]);
	const about = info ?? r;
	// Dónde verla en Argentina (TMDB/JustWatch): suscripción primero, después con avisos o gratis.
	const ar = r['watch/providers']?.results?.AR ?? {};
	const seen = new Set();
	const providers = [...(ar.flatrate ?? []), ...(ar.ads ?? []), ...(ar.free ?? [])]
		.filter((/** @type {any} */ p) => !seen.has(p.provider_id) && seen.add(p.provider_id))
		.sort((/** @type {any} */ a, /** @type {any} */ b) => a.display_priority - b.display_priority)
		.map((/** @type {any} */ p) => ({ name: p.provider_name, logo: p.logo_path ? `${IMG}w92${p.logo_path}` : null }));
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
		genres: [...new Set((about.genres ?? []).flatMap((/** @type {any} */ g) => TV_GENRES[g.id]?.map((x) => translate(lang(), x)) ?? [g.name]))],
		providers,
		cast: (r.credits?.cast ?? []).slice(0, 3).map((/** @type {any} */ c) => c.name),
		lang: langName ? langName[0].toUpperCase() + langName.slice(1) : null,
		// Código ISO 639-1 del idioma original (`en`, `ja`…): el audio por defecto del video.
		origLang: r.original_language ?? null,
		// Estado de la serie, como `tmdb_status` del desktop.
		status: { 'Returning Series': 'returning', 'In Production': 'in-production', Pilot: 'in-production', Planned: 'planned', Ended: 'ended', Canceled: 'canceled', Cancelled: 'canceled' }[/** @type {string} */ (r.status)] ?? null,
		next: r.next_episode_to_air?.air_date ? { season: r.next_episode_to_air.season_number, episode: r.next_episode_to_air.episode_number, date: r.next_episode_to_air.air_date } : null,
		imdb,
		// Tráiler de YouTube: el más viejo (en series, el de la temporada 1), oficial primero; como en el desktop.
		trailer:
			(r.videos?.results ?? [])
				.filter((/** @type {any} */ v) => v.site === 'YouTube' && v.type === 'Trailer')
				.sort((/** @type {any} */ a, /** @type {any} */ b) => Number(b.official) - Number(a.official) || String(a.published_at).localeCompare(String(b.published_at)))[0]?.key ?? null,
		seasons: (r.seasons ?? [])
			.filter((/** @type {any} */ s) => s.season_number > 0 && s.episode_count > 0)
			.map((/** @type {any} */ s) => ({ n: s.season_number, name: s.name, count: s.episode_count, year: String(s.air_date ?? '').slice(0, 4) || null }))
	};
}

/** Títulos de una película por su IMDb id (original, inglés y español) y su año, para descartar torrents de otra
 * película con nombre parecido. Queda en memoria. @type {Map<string, Promise<{titles: string[], year: number | null} | null>>} */
const names = new Map();
/** @param {string} imdb */
export function namesOf(imdb) {
	if (!names.has(imdb)) {
		const find = (/** @type {'es' | 'en'} */ l) => tmdb(`/find/${imdb}`, { external_source: 'imdb_id' }, l).then((r) => r.movie_results?.[0] ?? null);
		const p = Promise.all([find('en'), find('es')]).then(([en, es]) => {
			const m = en ?? es;
			if (!m) return null;
			return { titles: [...new Set([m.original_title, en?.title, es?.title].filter(Boolean))], year: Number(String(m.release_date ?? '').slice(0, 4)) || null };
		});
		// Si falla no se guarda: se reintenta la próxima.
		p.catch(() => names.delete(imdb));
		capped(names, imdb, p, MAX_NAMES);
	}
	return /** @type {Promise<{titles: string[], year: number | null} | null>} */ (names.get(imdb));
}

/** @param {string} id @param {string} n */
export async function season(id, n) {
	const r = await tmdb(`/tv/${id}/season/${n}`);
	return r.episodes.map((/** @type {any} */ e) => ({
		n: e.episode_number,
		name: e.name,
		date: e.air_date,
		still: e.still_path ? `${IMG}w300${e.still_path}` : null
	}));
}
