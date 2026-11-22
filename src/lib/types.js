// Tipos compartidos del cliente (solo typedefs; no hay código acá).

/** Una opción de video de un torrent, como la arma el servidor (`/api/torrents`, `/api/magnet`).
 * @typedef {{hash: string, release: string, file: string | null, res: string | null, hdr: string[], source: string | null, hint: 'lat' | 'likely' | 'spain' | null, multi: boolean, spa: boolean, size: number | null, seeds: number, addons: string[], subFile: boolean}} Torrent */

/** Un subtítulo encontrado afuera.
 * @typedef {{id: string, release: string, latino: boolean, format: string, downloads: number, exact?: boolean, fps?: number | null, last?: number | null, group?: string, premium?: boolean}} Sub */

/** La película o serie que se reconoce del nombre de un torrent pegado (`identify` en lib/server/magnet.js).
 * @typedef {{kind: 'movie' | 'tv', id: number, imdb: string, title: string, year: string, poster: string | null, rating: string | null, runtime: number | null, origLang: string | null, s: number | null, e: number | null}} Ident */

/** Lo que devuelven las rutas de la API de títulos (el tipo sale del servidor: no se repite a mano).
 * @typedef {Awaited<ReturnType<typeof import('./server/tmdb.js').title>>} Title
 * @typedef {Awaited<ReturnType<typeof import('./server/tmdb.js').season>>} Episodes
 * @typedef {Awaited<ReturnType<typeof import('./server/tmdb.js').genres>>} Genres */

/** IMDb de cada temporada (`/api/scores/:imdb`). @typedef {{season: number, rating: number, episodes: number}} SeasonScore */

/** Cuerpo de error de la API. @typedef {{message: string}} ApiError */

export {};
