// "Vistos recientemente": reglas puras (sin DOM) de la fila del catálogo (`RecentRow.svelte`).
import type { Kind, Season } from '../types.ts';

/** Un título de la fila. `imdb` es el id común (lo que guarda el servidor); `id`, el que usa cada app para abrirlo
 * (web: el de TMDB; desktop: el tt). `season`/`episode`: el último capítulo visto (solo series). */
export type RecentItem = {
	kind: Kind;
	imdb: string;
	id: string;
	title: string;
	poster: string | null;
	backdrop: string | null;
	season: number | null;
	episode: number | null;
	/** ISO: cuándo lo vio ("Deshacer" lo devuelve a su lugar). */
	at: string;
};

export type EpisodeRef = { season: number; episode: number };

/** El capítulo que sigue a `s`×`e`: el próximo de la temporada o el 1 de la siguiente con capítulos. null si era el
 * último de todo (o si no se sabe cuántos tiene la temporada). */
export function nextEpisode(seasons: Season[], s: number, e: number): EpisodeRef | null {
	const real = seasons.filter((x) => x.number > 0 && x.episodeCount > 0).sort((a, b) => a.number - b.number);
	const cur = real.find((x) => x.number === s);
	if (cur && e < cur.episodeCount) return { season: s, episode: e + 1 };
	const after = real.find((x) => x.number > s);
	return after ? { season: after.number, episode: 1 } : null;
}

