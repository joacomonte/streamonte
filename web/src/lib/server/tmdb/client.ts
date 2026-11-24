// Cliente de TMDB: el pedido con la key, los tipos de sus respuestas y las tarjetas que arman las listas.
import { Fail } from '../http-route.ts';
import { get } from '../fetch.ts';
import { key } from '../config.ts';
import { titlesLang } from '../lang.ts';
import type { Lang } from '../../i18n/translate.ts';

const API = 'https://api.themoviedb.org/3';
export const IMG = 'https://image.tmdb.org/t/p/';

// Respuestas de TMDB: solo los campos que se leen.
export type TmdbItem = { id: number; title?: string; name?: string; release_date?: string; first_air_date?: string; poster_path?: string | null; original_language?: string; media_type?: 'movie' | 'tv' | 'person'; popularity?: number; genre_ids?: number[]; job?: string; episode_count?: number };
export type TmdbPage = { results: TmdbItem[]; page: number; total_pages: number };
export type TmdbPerson = { id: number; name: string; profile_path?: string | null; character?: string; job?: string };
export type TmdbProvider = { provider_id: number; provider_name: string; logo_path?: string | null; display_priority: number };
export type TmdbSeason = { season_number: number; episode_count: number; name: string; air_date?: string | null };
export type TmdbTitle = TmdbItem & {
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
	/** Series: sus creadores. */
	created_by?: TmdbPerson[];
	'watch/providers'?: { results?: Record<string, { flatrate?: TmdbProvider[]; ads?: TmdbProvider[]; free?: TmdbProvider[] }> };
	next_episode_to_air?: { air_date?: string; season_number: number; episode_number: number } | null;
	seasons?: TmdbSeason[];
};
export type Kind = 'movie' | 'tv';

/** `language`: por defecto, el de los títulos. Devuelve `unknown`: cada llamada lo acota al tipo de su endpoint. */
export async function tmdb(path: string, params: Record<string, unknown> = {}, language: Lang = titlesLang()): Promise<unknown> {
	const apiKey = await key('tmdb');
	if (!apiKey) throw new Fail(428, 'Falta la key de TMDB: cargala en Ajustes.');
	const url = new URL(API + path);
	url.searchParams.set('api_key', apiKey);
	url.searchParams.set('language', language === 'en' ? 'en-US' : 'es-MX');
	for (const [k, v] of Object.entries(params)) if (v != null && v !== '') url.searchParams.set(k, String(v));
	const r = await get(url);
	if (r.status === 401) throw new Fail(401, 'TMDB rechazó la key: revisala en Ajustes.');
	if (!r.ok) throw new Fail(502, 'TMDB respondió {s}.', { s: r.status });
	return r.json();
}

/** Id de TMDB del género Documental (el mismo en películas y series; en el desktop, `DOCUMENTARY` de `top.rs`). */
const DOCUMENTARY = 99;

export const card = (r: TmdbItem, kind: Kind) => ({
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
export const scored = (c: TmdbItem, kind: Kind, r: { rating: number } | null) => ({ ...card(c, kind), rating: r ? r.rating.toFixed(1) : null });

/** Como el desktop: sin anime/japonés. */
export const keep = (r: TmdbItem): boolean => r.original_language !== 'ja';
