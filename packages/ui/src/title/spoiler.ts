// Anti spoiler de la lista de capítulos (2026-11-24): se difuminan imagen, título, sinopsis y puntaje de lo que todavía
// no viste. "Visto" = hasta el último capítulo guardado en Vistos (`api.recent`); sin registro, nada está visto.
import type { RecentItem } from '../catalog/recent.ts';

export type LastSeen = { season: number; episode: number } | null;

/** El último capítulo visto de la serie `imdb`, según Vistos. */
export const lastSeenOf = (recent: RecentItem[], imdb: string): LastSeen => {
	const r = recent.find((x) => x.kind === 'tv' && x.imdb === imdb);
	return r?.season != null && r.episode != null ? { season: r.season, episode: r.episode } : null;
};

/** El capítulo `season`×`episode` todavía no se vio (viene después del último visto). */
export const isSpoiler = (season: number, episode: number, last: LastSeen): boolean =>
	!last || season > last.season || (season === last.season && episode > last.episode);
