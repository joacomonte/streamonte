// "Novedades", contrato de datos (web y desktop). Diseño elegido: docs/mockups/novedades/dialog-a.html (Marquesina).
// - Lo nuevo (estrenos en streaming + capítulos nuevos de las series que sigue el apodo) sale en un diálogo a pantalla
//   completa; se abre solo si hay algo desde la última vez que lo vio, y vuelve con la pastilla "Novedades · N".
// - Tendencias es la única fila de la home (debajo de "Vistos recientemente").
// La web lo arma en el servidor (web/src/lib/server/novedades.ts) y lo guarda en Neon; el desktop lo pide a la web
// (crates/core/src/web.rs). Solo entra un título con un release WEB-DL/WEBRip/BluRay/REMUX sin CAM en caché de TorBox:
// la calidad filtra en el servidor y no se muestra. Decisiones: mem2 #154–#160 y el spike #161 (región ancla US).
import type { Kind } from '../types.ts';

/** Pasado esto, la lista está vieja: el cliente pide `refresh()` en segundo plano (una vez por sesión). */
export const NEWS_STALE_MS = 6 * 60 * 60 * 1000;
/** Piso de votos de IMDb (dataset oficial) para Tendencias. */
export const TRENDING_MIN_VOTES = 1000;
/** Estrenos digitales de los últimos días que entran como "nuevos". */
export const NEWS_WINDOW_DAYS = 30;

/** Qué tiene de nuevo. `title`: estreno en streaming (peli o serie nueva); `episode`: capítulo nuevo de una serie que sigue. */
export type NewsWhat =
	| { type: 'title' }
	| { type: 'episode'; season: number; episode: number; /** Último de la temporada ("Final de temporada"). */ finale: boolean };

/** Por qué está en Novedades (kicker + motivo del diálogo A2, docs/mockups/novedades/info.html). Lo arma el servidor web;
 * el desktop actual no lo recibe (lo descarta `crates/core/src/web.rs`) y la UI cae al texto viejo con `what`/`date`.
 * - `digital`: película con estreno digital en EE.UU. (`date`, ISO).
 * - `premiere`: serie nueva, estreno del primer capítulo (`date`).
 * - `trending`: título nuevo que además está en Tendencias de la semana, puesto `rank` (1 = primero).
 * - `episode`: capítulo nuevo de una serie que sigue (temporada/capítulo en `what`); `lastSeen`: el último que vio, si se sabe.
 * - `season`: temporada `season` nueva de una serie que sigue; `full`: salieron sus `episodes` capítulos el mismo día. */
export type NewsReason =
	| { type: 'digital'; date: string }
	| { type: 'premiere'; date: string }
	| { type: 'trending'; rank: number }
	| { type: 'episode'; lastSeen: { season: number; episode: number } | null }
	| { type: 'season'; season: number; full: boolean; episodes: number };

/** Un título. `imdb` es el id común; `id`, el que usa cada app para abrirlo (web: TMDB; desktop: tt). */
export type NewsItem = {
	kind: Kind;
	imdb: string;
	id: string;
	title: string;
	year: number | null;
	poster: string | null;
	backdrop: string | null;
	/** Hasta 2 subgéneros: ids de interest de IMDb (`in…`); el nombre sale de `subgenres.ts`. Nunca géneros generales. */
	subgenres: string[];
	/** Sinopsis en el idioma de los títulos; null si no hay. */
	overview: string | null;
	imdbRating: number | null;
	imdbVotes: number | null;
	/** Novedades: qué tiene de nuevo; Tendencias: null. */
	what: NewsWhat | null;
	/** ISO: estreno digital o salida del capítulo (Novedades); null en Tendencias. */
	date: string | null;
	/** Hasta 2 actores principales (TMDB credits, orden de billing). Opcional: el desktop actual no lo manda. */
	cast?: string[];
	/** Solo en `fresh`. Opcional: el desktop actual no lo manda (la UI usa `what`/`date`). */
	reason?: NewsReason | null;
};

/** Lo que devuelve `Api.news.list()`. */
export type NewsList = {
	/** Para el diálogo, de lo más fresco a lo más viejo (pelis, series y capítulos mezclados). Sin apodo: sin capítulos. */
	fresh: NewsItem[];
	/** Fila de la home, en orden de la semana. Vacía: la fila no sale. */
	trending: NewsItem[];
	/** ISO de la última vez que el apodo abrió el diálogo (web sin apodo: la de este navegador); null si nunca. El
	 * diálogo se abre solo si hay alguno en `fresh` con `date` posterior; la pastilla cuenta esos. */
	seenAt: string | null;
	/** ISO del último refresco completo; null si nunca se armó. */
	updatedAt: string | null;
	/** Más vieja que `NEWS_STALE_MS` (o nunca armada): la UI pide `refresh()`. */
	stale: boolean;
	/** Hay un refresco corriendo (la UI no lo muestra en el diálogo; el contenido queda). */
	refreshing: boolean;
};

/** Forma en el cable (`GET /api/novedades`, la misma que reenvía el desktop): `tmdb` en vez de `id`. */
export type NewsItemWire = Omit<NewsItem, 'id'> & { tmdb: number | null };
export type NewsListWire = Omit<NewsList, 'fresh' | 'trending'> & { fresh: NewsItemWire[]; trending: NewsItemWire[] };

/** Cable → modelo, con el `id` de cada app; descarta los que no tienen id (la web, sin `tmdb`). */
export function newsFromWire(w: NewsListWire, idOf: (i: NewsItemWire) => string | null): NewsList {
	const convert = (items: NewsItemWire[]): NewsItem[] =>
		items.flatMap((i) => {
			const id = idOf(i);
			if (id == null) return [];
			const { tmdb: _tmdb, ...item } = i;
			return [{ ...item, id }];
		});
	return { ...w, fresh: convert(w.fresh), trending: convert(w.trending) };
}

/** Cuántos de `fresh` son posteriores a `seenAt` (la pastilla y si el diálogo se abre solo). */
export function unseenCount(list: Pick<NewsList, 'fresh' | 'seenAt'>): number {
	const seen = list.seenAt ? Date.parse(list.seenAt) : null;
	return list.fresh.filter((i) => {
		if (seen == null || Number.isNaN(seen)) return true;
		return i.date != null && Date.parse(i.date) > seen;
	}).length;
}
