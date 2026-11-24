// Ficha de un título de TMDB y lo que se arma con ella: reparto, dónde verla, estado, temporadas y nombres.
import { lang, titlesLang } from '../lang.ts';
import { translate } from '../../i18n/translate.ts';
import type { Lang } from '../../i18n/translate.ts';
import { imdbOf, ratings } from '../imdb.ts';
import { capped } from './cache.ts';
import { card, tmdb, IMG } from './client.ts';
import type { Kind, TmdbItem, TmdbPerson, TmdbTitle } from './client.ts';

/** Géneros de series de TMDB que juntan dos, como `GENRES` del desktop (streamonte/crates/core/src/catalog/top.rs). */
const TV_GENRES: Record<number, string[]> = { 10759: ['Acción', 'Aventura'], 10765: ['Ciencia ficción', 'Fantasía'], 10768: ['Bélica'] };
const MAX_NAMES = 500;

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

/** Hasta cuántos actores trae la ficha (`MAX_CAST` del desktop): la UI muestra los primeros y despliega el resto. */
const MAX_CAST = 18;

/** Quien la hizo (película: el director; serie: el primer creador, 2026-11-24) y el reparto (`people` del desktop). */
export function peopleOf(kind: Kind, credits: TmdbTitle['credits'], createdBy: TmdbTitle['created_by'] = []) {
	const maker = kind === 'movie' ? credits?.crew?.find((c) => c.job === 'Director') : createdBy[0];
	return [
		...(maker ? [person(maker, 'director', null)] : []),
		...(credits?.cast ?? []).slice(0, MAX_CAST).map((c) => person(c, 'cast', c.character || null))
	];
}

/** Estado de la serie y próximo episodio, como `tmdb_status` del desktop. */
export function showStatus(r: Pick<TmdbTitle, 'status' | 'next_episode_to_air'>) {
	const map: Record<string, string> = { 'Returning Series': 'returning', 'In Production': 'in-production', Pilot: 'in-production', Planned: 'planned', Ended: 'ended', Canceled: 'canceled', Cancelled: 'canceled' };
	const n = r.next_episode_to_air;
	return { status: map[r.status as string] ?? null, next: n?.air_date ? { season: n.season_number, episode: n.episode_number, date: n.air_date } : null };
}

/** Ficha: datos, IMDb id (para los torrents) y temporadas. */
export async function title(kind: Kind, id: string | number) {
	// Sinopsis y géneros siempre en el idioma de la app: un pedido más (si difiere de los títulos), en paralelo.
	// El dataset de IMDb se espera junto con TMDB: en una instancia recién creada todavía no está cargado y el puntaje
	// salía vacío. Si no se puede bajar, la ficha sale igual, sin puntaje.
	const [r, info, table] = await Promise.all([
		tmdb(`/${kind}/${id}`, { append_to_response: 'external_ids,watch/providers,credits' }) as Promise<TmdbTitle>,
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
		// Quién la hizo (película: director; serie: creador) primero; después el reparto (hasta 18) con su personaje.
		people: peopleOf(kind, r.credits, r.created_by),
		companies: (r.production_companies ?? []).slice(0, 2).map((c) => c.name),
		lang: langName ? langName[0].toUpperCase() + langName.slice(1) : null,
		// Código ISO 639-1 del idioma original (`en`, `ja`…): el audio por defecto del video.
		origLang: r.original_language ?? null,
		// Estado de la serie, como `tmdb_status` del desktop.
		...showStatus(r),
		imdb,
		// Tráiler de YouTube: el más viejo (en series, el de la temporada 1), oficial primero; como en el desktop.
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

/** El id de TMDB (el de la ruta `/t/[kind]/[id]`) de un IMDb id, para los vistos que marcó el desktop (solo guarda el tt).
 * null si TMDB no lo conoce. */
export async function tmdbOf(imdb: string, kind: Kind): Promise<number | null> {
	const r = (await tmdb(`/find/${imdb}`, { external_source: 'imdb_id' })) as { movie_results?: { id: number }[]; tv_results?: { id: number }[] };
	return (kind === 'tv' ? r.tv_results : r.movie_results)?.[0]?.id ?? null;
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

