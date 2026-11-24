// Tipos compartidos del cliente (solo tipos; no hay código acá).

/** Una opción de video de un torrent, como la arma el servidor (`/api/torrents`, `/api/magnet`). */
export type Torrent = {
	hash: string;
	release: string;
	file: string | null;
	res: string | null;
	hdr: string[];
	source: string | null;
	hint: 'lat' | 'likely' | 'spain' | null;
	multi: boolean;
	spa: boolean;
	size: number | null;
	seeds: number;
	addons: string[];
	subFile: boolean;
};

/** Un subtítulo encontrado afuera. */
export type Sub = {
	id: string;
	release: string;
	latino: boolean;
	format: string;
	downloads: number;
	exact?: boolean;
	fps?: number | null;
	last?: number | null;
	group?: string;
	premium?: boolean;
};

/** La película o serie que se reconoce del nombre de un torrent pegado (`identify` en lib/server/magnet.ts). */
export type Ident = {
	kind: 'movie' | 'tv';
	id: number;
	imdb: string;
	title: string;
	year: string;
	poster: string | null;
	rating: string | null;
	runtime: number | null;
	origLang: string | null;
	s: number | null;
	e: number | null;
};

// Lo que devuelven las rutas de la API de títulos (el tipo sale del servidor: no se repite a mano).
export type Title = Awaited<ReturnType<typeof import('./server/tmdb.ts').title>>;
export type Episodes = Awaited<ReturnType<typeof import('./server/tmdb.ts').season>>;
export type Examples = Awaited<ReturnType<typeof import('./server/interests.ts').examples>>;

/** IMDb de cada temporada (`/api/scores/:imdb`). */
export type SeasonScore = { season: number; rating: number; episodes: number };

/** Cuerpo de error de la API. */
export type ApiError = { message: string };

// Respuestas crudas de la API que lee `webApi.ts` (salen del servidor: no se repiten a mano).
export type CatalogPageRaw = Awaited<ReturnType<typeof import('./server/tmdb.ts').search>>;
export type PeopleRaw = Awaited<ReturnType<typeof import('./server/tmdb.ts').people>>;
export type LinkRaw = Awaited<ReturnType<typeof import('./server/torbox.ts').link>>;
export type TracksRaw = Awaited<ReturnType<typeof import('./server/torbox.ts').tracks>>;
export type SubsRaw = Awaited<ReturnType<typeof import('./server/subs.ts').search>>;
/** `/api/premium` (GET): resultados gratis de buscar + cuota. */
export type PremiumRaw = { results: Sub[]; quota: QuotaRaw };
export type QuotaRaw = Awaited<ReturnType<typeof import('./server/subs.ts').premiumQuota>>;
export type MagnetRaw = Awaited<ReturnType<typeof import('./server/magnet.ts').status>> & { ident?: Ident | null };
