// "Novedades": arma y guarda las listas (tabla `novedades` de Neon, web/db/schema.sql) y las lee para /api/novedades.
// Globales (estrenos en streaming, tendencias) bajo alcance 'global'; los capítulos nuevos bajo el apodo (de sus Vistos).
// Región ancla US (spike mem2 #161); reestrenos fuera por año; subgéneros = interests de IMDb (máx. 2).
// Un título entra solo con un release WEB-DL/WEBRip/BluRay/REMUX sin CAM en caché de TorBox. Pocos pedidos:
// - cada título se verifica UNA vez (tabla `novedades_verif`: los 3–5 mejores hashes + en_cache); no vuelve a los addons;
// - cada refresco revalida los hashes guardados de TODOS en 1 POST /torrents/checkcached (TorBox: cientos por pedido);
// - solo lo nuevo pasa por addons: Torrentio + Comet; Peerflix/TorrentsDB solo si los dos vuelven vacíos (vacío ≠ no hay);
// - tope ~12 candidatos por lista, concurrencia 2–3 (~3 s por título); /api/torrents también graba lo que verificó.
// TorBox no tiene búsqueda por IMDb id en su API (api.torbox.app/openapi.json; search-api.torbox.app no resuelve, 2026-11-26).
import type { NewsItemWire, NewsListWire, NewsWhat } from '../../../../packages/ui/src/catalog/news.ts';
import { NEWS_STALE_MS, NEWS_WINDOW_DAYS, TRENDING_MIN_VOTES } from '../../../../packages/ui/src/catalog/news.ts';
import { categories } from '../../../../packages/ui/src/catalog/subgenres.ts';
import { get } from './http.ts';
import { sql } from './track.ts';
import { ratings, imdbOf } from './imdb.ts';
import { tmdb, IMG } from './tmdb/client.ts';
import type { Kind, TmdbItem, TmdbPage, TmdbTitle } from './tmdb/client.ts';
import { namesOf, tmdbOf } from './tmdb.ts';
import { ADDONS, parse, merge } from './torrents.ts';
import type { Torrent } from './torrents.ts';
import { tbRoot } from './torbox/client.ts';
import type { TbCached, TbRes } from './torbox/client.ts';
import { list as seenList } from './vistos.ts';

const DAY = 24 * 3600 * 1000;
const REGION = 'US';
/** Tope de candidatos por lista y de hashes que se guardan por título. */
const MAX_CANDIDATES = 12;
const MAX_HASHES = 5;
const CONCURRENCY = 3;
const BUDGET_MS = 50_000;
const LOCK_MS = 2 * 60 * 1000;
/** Los globales no se recalculan si son de hace menos de esto (un apodo que pide refresco solo suma sus capítulos). */
const GLOBAL_FRESH_MS = 60 * 60 * 1000;
const CHECK_BATCH = 80;
const GOOD_SOURCES = new Set(['WEB-DL', 'WEBRip', 'BluRay', 'REMUX']);
const RES_RANK: Record<string, number> = { '2160p': 5, '1440p': 4, '1080p': 3, '720p': 2, '480p': 1 };
/** Addons que se consultan siempre para lo nuevo, y los que solo si esos dos vuelven vacíos. */
const PRIMARY = ['Torrentio', 'Comet'];

// ---- Lógica pura (con test) ----

/** Reestreno: la película salió hace más de un año calendario (año de estreno < año actual − 1). */
export function isRerelease(releaseDate: string | null | undefined, now: Date): boolean {
	const year = Number(String(releaseDate ?? '').slice(0, 4));
	return !year || year < now.getUTCFullYear() - 1;
}

type Quality = Pick<Torrent, 'hash' | 'source' | 'cam' | 'res' | 'seeds'>;
/** Los mejores hashes (máx. 5): solo WEB-DL/WEBRip/BluRay/REMUX sin CAM; más resolución y más seeds primero. */
export function bestHashes(list: Quality[], max = MAX_HASHES): string[] {
	const good = list.filter((t) => !t.cam && t.source && GOOD_SOURCES.has(t.source));
	good.sort((a, b) => (RES_RANK[b.res ?? ''] ?? 0) - (RES_RANK[a.res ?? ''] ?? 0) || b.seeds - a.seeds);
	return [...new Set(good.map((t) => t.hash))].slice(0, max);
}

/** Peerflix y TorrentsDB solo si Torrentio y Comet no trajeron nada (vacío ≠ no disponible). */
export const needsBackup = (primaryFound: number): boolean => primaryFound === 0;

/** Parte la lista en lotes de a `size` (sin repetir). */
export function hashBatches(hashes: string[], size = CHECK_BATCH): string[][] {
	const uniq = [...new Set(hashes)];
	const out: string[][] = [];
	for (let i = 0; i < uniq.length; i += size) out.push(uniq.slice(i, i + size));
	return out;
}

/** Hasta 2 subgéneros: ids de interest de IMDb que sean subgéneros del picker (nunca los de "todo el género"). */
export function pickSubgenres(interests: string[], valid: Set<string>): string[] {
	return [...new Set(interests.filter((i) => valid.has(i)))].slice(0, 2);
}

/** Lo que /api/torrents ya encontró en caché, como verificación (null si no hay un release bueno: no se guarda nada). */
export function verificationFrom(imdb: string, s: string | null, e: string | null, inCache: Quality[]): Verification | null {
	const hashes = bestHashes(inCache);
	return hashes.length ? { imdb, s: s && e ? Number(s) : 0, e: s && e ? Number(e) : 0, hashes, enCache: true } : null;
}

async function pool<T>(items: T[], n: number, fn: (x: T) => Promise<void>): Promise<void> {
	const queue = [...items];
	await Promise.all(Array.from({ length: n }, async () => { for (let x: T | undefined; (x = queue.shift()) !== undefined; ) await fn(x); }));
}

// ---- Neon ----

let ready: Promise<unknown> | null = null;
function db() {
	const q = sql();
	if (!q) return null;
	ready ??= (async () => {
		await q`CREATE TABLE IF NOT EXISTS novedades (alcance text NOT NULL, lista text NOT NULL, datos jsonb NOT NULL DEFAULT '[]', actualizado timestamptz, refrescando_desde timestamptz, PRIMARY KEY (alcance, lista))`;
		await q`CREATE TABLE IF NOT EXISTS novedades_verif (imdb text NOT NULL, s integer NOT NULL DEFAULT 0, e integer NOT NULL DEFAULT 0, hashes text[] NOT NULL DEFAULT '{}', en_cache boolean NOT NULL, verificado_en timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (imdb, s, e))`;
		await q`CREATE TABLE IF NOT EXISTS novedades_vistas (apodo text PRIMARY KEY, visto timestamptz NOT NULL DEFAULT now())`;
	})().catch((e) => ((ready = null), Promise.reject(e)));
	return { q, ready };
}

type ListRow = { alcance: string; lista: string; datos: NewsItemWire[]; actualizado: string | Date | null; refrescando_desde: string | Date | null };
const ms = (d: string | Date | null): number | null => (d ? new Date(d).getTime() : null);

export async function listNews(apodo: string | null): Promise<NewsListWire> {
	const d = db();
	const empty: NewsListWire = { fresh: [], trending: [], seenAt: null, updatedAt: null, stale: true, refreshing: false };
	if (!d) return empty;
	await d.ready;
	const rows = (await d.q`SELECT alcance, lista, datos, actualizado, refrescando_desde FROM novedades WHERE alcance = 'global' OR alcance = ${apodo ?? ''}`) as ListRow[];
	const seen = apodo ? ((await d.q`SELECT visto FROM novedades_vistas WHERE apodo = ${apodo}`) as { visto: string | Date }[])[0] : undefined;
	const find = (alcance: string, lista: string) => rows.find((r) => r.alcance === alcance && r.lista === lista);
	const estrenos = find('global', 'estrenos');
	const tendencias = find('global', 'tendencias');
	const capitulos = apodo ? find(apodo, 'capitulos') : undefined;
	const stamps = [estrenos, tendencias, ...(apodo ? [capitulos] : [])].map((r) => ms(r?.actualizado ?? null));
	const oldest = stamps.some((x) => x == null) ? null : Math.min(...(stamps as number[]));
	const lock = ms(estrenos?.refrescando_desde ?? null);
	const dateOf = (i: NewsItemWire) => (i.date ? Date.parse(i.date) : 0);
	return {
		fresh: [...(estrenos?.datos ?? []), ...(capitulos?.datos ?? [])].sort((a, b) => dateOf(b) - dateOf(a)),
		trending: tendencias?.datos ?? [],
		seenAt: seen ? new Date(seen.visto).toISOString() : null,
		updatedAt: oldest == null ? null : new Date(oldest).toISOString(),
		stale: oldest == null || Date.now() - oldest > NEWS_STALE_MS,
		refreshing: lock != null && Date.now() - lock < LOCK_MS
	};
}

export async function markSeen(apodo: string | null): Promise<void> {
	const d = db();
	if (!d || !apodo) return;
	await d.ready;
	await d.q`INSERT INTO novedades_vistas (apodo, visto) VALUES (${apodo}, now()) ON CONFLICT (apodo) DO UPDATE SET visto = now()`;
}

type VerifRow = { imdb: string; s: number; e: number; hashes: string[]; en_cache: boolean };
const keyOf = (c: { imdb: string; s: number; e: number }) => `${c.imdb}:${c.s}:${c.e}`;
const toVerification = (r: VerifRow): Verification => ({ imdb: r.imdb, s: r.s, e: r.e, hashes: r.hashes, enCache: r.en_cache });

async function saveVerification(v: Verification): Promise<void> {
	const d = db();
	if (!d) return;
	await d.ready;
	await d.q`INSERT INTO novedades_verif (imdb, s, e, hashes, en_cache, verificado_en) VALUES (${v.imdb}, ${v.s}, ${v.e}, ${v.hashes}, ${v.enCache}, now())
		ON CONFLICT (imdb, s, e) DO UPDATE SET hashes = EXCLUDED.hashes, en_cache = EXCLUDED.en_cache, verificado_en = now()`;
}

async function savedVerifications(cands: { imdb: string; s: number; e: number }[]): Promise<Verification[]> {
	const d = db();
	if (!d || !cands.length) return [];
	await d.ready;
	const rows = (await d.q`SELECT imdb, s, e, hashes, en_cache FROM novedades_verif WHERE imdb = ANY(${[...new Set(cands.map((c) => c.imdb))]})`) as VerifRow[];
	const want = new Set(cands.map(keyOf));
	return rows.filter((r) => want.has(keyOf(r))).map(toVerification);
}

// ---- TorBox ----

/** Cuáles de `hashes` tiene TorBox en caché: 1 POST por lote (acepta cientos por pedido). El Blob fija el content-type
 * porque `tbRoot` pisa los headers. */
async function cachedSet(hashes: string[]): Promise<Set<string>> {
	const out = new Set<string>();
	for (const batch of hashBatches(hashes)) {
		const j = (await tbRoot('/v1/api/torrents/checkcached?format=object&list_files=false', {
			method: 'POST',
			body: new Blob([JSON.stringify({ hashes: batch })], { type: 'application/json' })
		})) as TbRes<TbCached[] | Record<string, TbCached> | false>;
		const d = j.data;
		if (Array.isArray(d)) for (const x of d) out.add(String(x.hash).toLowerCase());
		else if (d && typeof d === 'object') for (const [k, x] of Object.entries(d)) out.add(String(x?.hash ?? k).toLowerCase());
	}
	return out;
}

// ---- Verificación ----

type Stream = Parameters<typeof parse>[0];
async function fromAddon([name, base]: string[], type: string, vid: string): Promise<(Torrent | null)[]> {
	try {
		const r = await get(`${base}/stream/${type}/${vid}.json`, { headers: { 'user-agent': 'Mozilla/5.0' } }, 15_000);
		return r.ok ? ((await r.json()) as { streams?: Stream[] }).streams?.map((x) => parse(x, name)) ?? [] : [];
	} catch {
		return [];
	}
}

/** Los torrents de lo nuevo: Torrentio + Comet; Peerflix y TorrentsDB solo si los dos vuelven vacíos. */
async function findTorrents(c: { imdb: string; s: number; e: number }): Promise<Torrent[]> {
	const type = c.s ? 'series' : 'movie';
	const vid = c.s ? `${c.imdb}:${c.s}:${c.e}` : c.imdb;
	const names = c.s ? null : await namesOf(c.imdb).catch(() => null);
	const ask = (wanted: string[]) => Promise.all(ADDONS.filter(([n]) => wanted.includes(n)).map((a) => fromAddon(a, type, vid)));
	let lists = await ask(PRIMARY);
	if (needsBackup(merge(lists, names).size)) lists = [...lists, ...(await ask(ADDONS.map(([n]) => n).filter((n) => !PRIMARY.includes(n))))];
	return [...merge(lists, names).values()];
}

export type Verification = { imdb: string; s: number; e: number; hashes: string[]; enCache: boolean };

/** `until`: hora (ms) tope; pasada, deja de verificar y devuelve lo que llegó. */
export async function verifyNew(candidates: { imdb: string; s: number; e: number }[], until = Infinity): Promise<Verification[]> {
	const found: Verification[] = [];
	await pool(candidates, CONCURRENCY - 1, async (c) => {
		if (Date.now() > until) return;
		const hashes = bestHashes(await findTorrents(c));
		// Vacío o sin un release bueno todavía ≠ no disponible: no se guarda (se vuelve a mirar en el próximo refresco).
		if (hashes.length) found.push({ imdb: c.imdb, s: c.s, e: c.e, hashes, enCache: false });
	});
	if (!found.length) return [];
	const inCache = await cachedSet(found.flatMap((v) => v.hashes)).catch(() => new Set<string>());
	const out = found.map((v) => ({ ...v, enCache: v.hashes.some((h) => inCache.has(h)) }));
	await Promise.all(out.map((v) => saveVerification(v).catch(() => {})));
	return out;
}

/** Junta los hashes de todos, 1 POST a checkcached (en lotes si hace falta) y actualiza `en_cache` (también en la base). */
export async function revalidate(rows: Verification[]): Promise<Verification[]> {
	if (!rows.length) return rows;
	const inCache = await cachedSet(rows.flatMap((r) => r.hashes));
	const out = rows.map((r) => ({ ...r, enCache: r.hashes.some((h) => inCache.has(h)) }));
	await Promise.all(out.filter((r, i) => r.enCache !== rows[i].enCache).map((r) => saveVerification(r).catch(() => {})));
	return out;
}

export async function recordVerification(v: Verification): Promise<void> {
	try {
		await saveVerification(v);
	} catch {
		// Nunca rompe /api/torrents.
	}
}

// ---- Armado de las listas ----

type MovieDetail = TmdbTitle & { release_dates?: { results?: { iso_3166_1: string; release_dates: { type: number; release_date: string }[] }[] } };
type TvDetail = TmdbTitle & { last_episode_to_air?: { air_date?: string; season_number: number; episode_number: number; episode_type?: string } | null };
/** Un título con lo necesario para armar su ítem; `s`/`e` = lo que se verifica (películas 0/0, series nuevas 1×1). */
type Cand = { kind: Kind; tmdb: number; imdb: string; s: number; e: number; item: NewsItemWire };

const iso = (d: string): string => new Date(d).toISOString();
const dayStr = (t: number): string => new Date(t).toISOString().slice(0, 10);

/** Fecha de estreno digital (tipo 4 o 5) en la región ancla: la última ya salida. */
function digitalDate(r: MovieDetail, now: number): string | null {
	const dates = (r.release_dates?.results ?? []).find((x) => x.iso_3166_1 === REGION)?.release_dates ?? [];
	const out = dates.filter((x) => (x.type === 4 || x.type === 5) && Date.parse(x.release_date) <= now).map((x) => x.release_date).sort();
	return out.at(-1) ?? null;
}

function baseItem(kind: Kind, r: TmdbTitle, imdb: string, what: NewsWhat | null, date: string | null, table: Map<number, number> | null): NewsItemWire {
	const real = table ? imdbOf(imdb, table) : null;
	return {
		kind, imdb, tmdb: r.id, title: String(r.title ?? r.name ?? ''),
		year: Number(String(r.release_date ?? r.first_air_date ?? '').slice(0, 4)) || null,
		poster: r.poster_path ? `${IMG}w342${r.poster_path}` : null,
		backdrop: r.backdrop_path ? `${IMG}w1280${r.backdrop_path}` : null,
		subgenres: [], overview: r.overview?.trim() || null,
		imdbRating: real?.rating ?? null, imdbVotes: real?.votes ?? null, what, date
	};
}

const tmdbId = (r: TmdbTitle): string | null => {
	const tt = r.imdb_id ?? r.external_ids?.imdb_id ?? '';
	return /^tt\d+$/.test(tt) ? tt : null;
};

async function discoverCands(now: number, table: Map<number, number> | null): Promise<Cand[]> {
	const from = dayStr(now - NEWS_WINDOW_DAYS * DAY);
	const to = dayStr(now);
	const nowDate = new Date(now);
	const [movies, shows] = await Promise.all([
		tmdb('/discover/movie', { region: REGION, with_release_type: '4|5', 'release_date.gte': from, 'release_date.lte': to, sort_by: 'popularity.desc' }) as Promise<TmdbPage>,
		tmdb('/discover/tv', { watch_region: REGION, with_watch_monetization_types: 'flatrate', 'first_air_date.gte': from, 'first_air_date.lte': to, sort_by: 'popularity.desc' }) as Promise<TmdbPage>
	]);
	const keep = (items: TmdbItem[], n: number) => items.filter((r) => !isRerelease(r.release_date ?? r.first_air_date, nowDate)).slice(0, n);
	const out: Cand[] = [];
	await pool([...keep(movies.results, 8).map((r) => ['movie', r] as const), ...keep(shows.results, 4).map((r) => ['tv', r] as const)], CONCURRENCY, async ([kind, r]) => {
		try {
			const d = (await tmdb(`/${kind}/${r.id}`, { append_to_response: kind === 'movie' ? 'external_ids,release_dates' : 'external_ids' })) as MovieDetail;
			const imdb = tmdbId(d);
			if (!imdb) return;
			const date = kind === 'movie' ? digitalDate(d, now) : (d.first_air_date ?? null);
			if (!date) return;
			out.push({ kind, tmdb: r.id, imdb, s: kind === 'tv' ? 1 : 0, e: kind === 'tv' ? 1 : 0, item: baseItem(kind, d, imdb, { type: 'title' }, iso(date), table) });
		} catch {
			// Un título que falla no frena a los demás.
		}
	});
	return out.slice(0, MAX_CANDIDATES);
}

async function trendingCands(table: Map<number, number> | null): Promise<Cand[]> {
	const [movies, shows] = await Promise.all([tmdb('/trending/movie/week') as Promise<TmdbPage>, tmdb('/trending/tv/week') as Promise<TmdbPage>]);
	const picked = [...movies.results.slice(0, 8).map((r) => ['movie', r] as const), ...shows.results.slice(0, 8).map((r) => ['tv', r] as const)];
	const out: (Cand & { pop: number })[] = [];
	await pool(picked, CONCURRENCY, async ([kind, r]) => {
		try {
			const d = (await tmdb(`/${kind}/${r.id}`, { append_to_response: 'external_ids' })) as TmdbTitle;
			const imdb = tmdbId(d);
			const item = imdb ? baseItem(kind, d, imdb, null, null, table) : null;
			if (!imdb || !item || (item.imdbVotes ?? 0) < TRENDING_MIN_VOTES) return;
			out.push({ kind, tmdb: r.id, imdb, s: kind === 'tv' ? 1 : 0, e: kind === 'tv' ? 1 : 0, item, pop: r.popularity ?? 0 });
		} catch {
			// Idem.
		}
	});
	return out.sort((a, b) => b.pop - a.pop);
}

/** Capítulos ya salidos (hoy o antes) de las series de sus Vistos, posteriores al último que vio y de los últimos 30 días. */
async function episodeCands(apodo: string, now: number, table: Map<number, number> | null): Promise<Cand[]> {
	const shows = (await seenList(apodo)).filter((x) => x.kind === 'tv');
	const out: Cand[] = [];
	await pool(shows, CONCURRENCY, async (sv) => {
		try {
			const id = sv.tmdb ?? (await tmdbOf(sv.imdb, 'tv'));
			if (!id) return;
			const d = (await tmdb(`/tv/${id}`)) as TvDetail;
			const nxt = d.next_episode_to_air;
			const aired = nxt?.air_date && Date.parse(nxt.air_date) <= now ? nxt : d.last_episode_to_air;
			if (!aired?.air_date || Date.parse(aired.air_date) > now || now - Date.parse(aired.air_date) > NEWS_WINDOW_DAYS * DAY) return;
			const s = aired.season_number;
			const e = aired.episode_number;
			if (!s || !e) return;
			// Ya lo vio (o uno posterior): no es novedad.
			if (sv.season != null && sv.episode != null && (sv.season > s || (sv.season === s && sv.episode >= e))) return;
			const total = d.seasons?.find((x) => x.season_number === s)?.episode_count ?? 0;
			const finale = e === total || ('episode_type' in aired && aired.episode_type === 'finale');
			out.push({ kind: 'tv', tmdb: id, imdb: sv.imdb, s, e, item: baseItem('tv', d, sv.imdb, { type: 'episode', season: s, episode: e, finale }, iso(aired.air_date), table) });
		} catch {
			// Idem.
		}
	});
	return out.slice(0, MAX_CANDIDATES);
}

const GQL = 'https://caching.graphql.imdb.com/';
/** Interests de IMDb de cada título, en un pedido por tandas de 20 (un alias por id). Si falla: sin subgéneros. */
async function interestsOf(imdbs: string[]): Promise<Map<string, string[]>> {
	const out = new Map<string, string[]>();
	const uniq = [...new Set(imdbs)];
	for (let i = 0; i < uniq.length; i += 20) {
		const chunk = uniq.slice(i, i + 20);
		const q = `{ ${chunk.map((tt, n) => `a${n}: title(id: "${tt}") { interests(first: 12) { edges { node { id } } } }`).join(' ')} }`;
		try {
			const r = await get(GQL, { method: 'POST', headers: { 'content-type': 'application/json', 'x-imdb-client-name': 'imdb-web-next' }, body: JSON.stringify({ query: q }) });
			if (!r.ok) continue;
			const j = (await r.json()) as { data?: Record<string, { interests?: { edges: { node: { id: string } }[] } | null } | null> };
			chunk.forEach((tt, n) => out.set(tt, (j.data?.[`a${n}`]?.interests?.edges ?? []).map((x) => x.node.id)));
		} catch {
			// Sin subgéneros.
		}
	}
	return out;
}

async function saveList(alcance: string, lista: string, items: NewsItemWire[]): Promise<void> {
	const d = db();
	if (!d) return;
	await d.ready;
	await d.q`INSERT INTO novedades (alcance, lista, datos, actualizado) VALUES (${alcance}, ${lista}, ${JSON.stringify(items)}::jsonb, now())
		ON CONFLICT (alcance, lista) DO UPDATE SET datos = EXCLUDED.datos, actualizado = now()`;
}

export async function refreshNews(apodo: string | null): Promise<void> {
	const d = db();
	if (!d) return;
	await d.ready;
	// Traba: otro refresco de hace menos de 2 min → no hace nada.
	const got = (await d.q`INSERT INTO novedades (alcance, lista, refrescando_desde) VALUES ('global', 'estrenos', now())
		ON CONFLICT (alcance, lista) DO UPDATE SET refrescando_desde = now()
		WHERE novedades.refrescando_desde IS NULL OR novedades.refrescando_desde < now() - make_interval(secs => ${LOCK_MS / 1000})
		RETURNING 1 AS ok`) as unknown[];
	if (!got.length) return;
	const until = Date.now() + BUDGET_MS;
	try {
		const now = Date.now();
		const table = await ratings().catch(() => null);
		const stamps = (await d.q`SELECT lista, actualizado FROM novedades WHERE alcance = 'global'`) as { lista: string; actualizado: string | Date | null }[];
		const globalFresh = ['estrenos', 'tendencias'].every((l) => { const t = ms(stamps.find((x) => x.lista === l)?.actualizado ?? null); return t != null && now - t < GLOBAL_FRESH_MS; });
		const lists: { alcance: string; lista: string; cands: Cand[] }[] = [];
		if (!globalFresh) {
			lists.push({ alcance: 'global', lista: 'estrenos', cands: await discoverCands(now, table) });
			lists.push({ alcance: 'global', lista: 'tendencias', cands: await trendingCands(table) });
		}
		if (apodo) lists.push({ alcance: apodo, lista: 'capitulos', cands: await episodeCands(apodo, now, table) });
		const all = lists.flatMap((l) => l.cands);
		// Lo ya verificado no vuelve a los addons: solo lo nuevo; después 1 revalidación de todos los hashes.
		const saved = await savedVerifications(all);
		const have = new Set(saved.map(keyOf));
		const todo = [...new Map(all.filter((c) => !have.has(keyOf(c))).map((c) => [keyOf(c), c])).values()];
		const fresh = await verifyNew(todo, until);
		const checked = new Map((await revalidate(saved).catch(() => saved)).map((v) => [keyOf(v), v]));
		for (const v of fresh) checked.set(keyOf(v), v);
		const subs = await interestsOf(all.filter((c) => checked.get(keyOf(c))?.enCache).map((c) => c.imdb));
		const valid = new Set(categories().flatMap((c) => c.subs.map((s) => s.id)));
		for (const l of lists) {
			const items = l.cands.filter((c) => checked.get(keyOf(c))?.enCache).slice(0, MAX_CANDIDATES).map((c) => ({ ...c.item, subgenres: pickSubgenres(subs.get(c.imdb) ?? [], valid) }));
			await saveList(l.alcance, l.lista, items);
		}
	} finally {
		await d.q`UPDATE novedades SET refrescando_desde = NULL WHERE alcance = 'global' AND lista = 'estrenos'`.catch(() => {});
	}
}
