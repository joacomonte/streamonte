// Reglas puras de la lista de opciones del desktop (sin DOM, sin i18n, sin estado de módulo): las usan `catalog-options.ts`,
// `catalog-tests.ts` y `catalog-flow.ts` pasándoles su estado. Con test (`options-logic.test.ts`, fixtures `ui/mock/`).
import type { PlaybackRow, StreamCandidate as Candidate } from './types.ts';

/** Conteo de un enjambre (`SwarmCount` del núcleo; `known`/`incoming` faltan en el que arma la UI cuando nadie respondió). */
export type Count = { seeds: number; peers: number; reached: boolean; known?: number; incoming?: number };

/** Prueba rápida: con 8 seeds reales corta (techo "8+"); 3 o más ya es gente real. */
export const QUICK_ENOUGH = 8;
export const QUICK_WEAK = 3;

/** Grupo por la prueba rápida (menor = mejor): 0 = 8+ seeds reales o ya testeada a fondo, 1 = 3 a 7, 2 = sin probar todavía,
 *  3 = 1 o 2, o sin respuesta pero con gente conocida (poco confiable), 4 = nadie (muerta). */
export function quickGroupOf(tested: boolean, q: Count | undefined): number {
	if (tested) return 0;
	if (!q) return 2;
	if (!q.reached) return q.peers ? 3 : 4;
	return q.seeds >= QUICK_ENOUGH ? 0 : q.seeds >= QUICK_WEAK ? 1 : q.seeds > 0 ? 3 : 4;
}

/** Seeders sin análisis profundo: los de los trackers mandan; un 0 de tracker con la fuente diciendo más suele ser un tracker que
 *  no conoce el torrent, y ahí vale la fuente. */
export const trackersWin = (c: Candidate): boolean => (c.seeders ?? 0) > 0 || (c.seeders === 0 && !((c.seeders_declared ?? 0) > 0));
export const seedsOf = (c: Candidate): number | null => (trackersWin(c) ? c.seeders : (c.seeders_declared ?? null));

/** Casi seguro muerta: trackers 0/0 y la fuente sin seeders. Con censo > 0 la DHT ve peers que los trackers no (spec 07). */
export const isUnlikely = (c: Candidate, census: number | undefined): boolean =>
	c.seeders === 0 && c.leechers === 0 && !((c.seeders_declared ?? 0) > 0) && !((census ?? 0) > 0);

/** Las `max` con más seeds contados (y después peers), de las que tienen alguno. */
export function topFinalists(cands: Candidate[], counted: Map<string, Count>, max: number): string[] {
	const n = (c: Candidate): Count => counted.get(c.info_hash) ?? { seeds: 0, peers: 0, reached: false };
	return cands
		.filter((c) => n(c).seeds > 0)
		.sort((a, b) => n(b).seeds - n(a).seeds || n(b).peers - n(a).peers)
		.slice(0, max)
		.map((c) => c.info_hash);
}

/** Segundos que tarda analizar `n` opciones: primera tanda rápida + tandas del profundo (`batch` a la vez), con lo aprendido
 *  (`stats`, promedio móvil) o lo típico. */
export const etaSecs = (stats: Record<string, number>, n: number, top: number, batch: number): number =>
	(stats.quick ?? 35) + Math.ceil(Math.min(top, n || top) / batch) * (stats.deepBatch ?? 110);

/** Promedio móvil de lo que tardó (70 % lo viejo). */
export const learned = (old: number | undefined, secs: number): number => (old ? old * 0.7 + secs * 0.3 : secs);

/** De las líneas que aplican (las vacías no), la que toca en este tramo de `tickMs`. */
export function pickLine(lines: (string | number | boolean | null | undefined)[], now: number, tickMs: number): string | undefined {
	const ok = lines.filter((x): x is string => typeof x === 'string' && x !== '');
	return ok[Math.floor(now / tickMs) % ok.length];
}

/** Estados en que la opción muestra Detener en vez de ▶, y los de "cargando". */
export const PB_LIVE = new Set(['fetching-metadata', 'preparing', 'playing', 'download-paused', 'background', 'ask-after-close']);
export const PB_STARTING = new Set(['fetching-metadata', 'preparing']);
const PB_RANK = ['playing', 'preparing', 'fetching-metadata', 'download-paused', 'ask-after-close', 'background', 'paused', 'stopping', 'failed'];
/** La reproducción de ese torrent que importa ahora (varias: otro episodio del pack, una vieja cerrándose): gana la más viva. */
export function playbackFor(rows: Iterable<PlaybackRow>, hash: string): PlaybackRow | undefined {
	return [...rows].filter((r) => r.key.split(':')[0] === hash).sort((a, b) => PB_RANK.indexOf(a.state.kind) - PB_RANK.indexOf(b.state.kind))[0];
}
/** Hashes con una reproducción activa (no fallida): se fijan arriba de la lista. */
export function pinActive<T extends { info_hash: string }>(list: T[], rows: Iterable<PlaybackRow>): T[] {
	const active = new Set([...rows].filter((r) => r.state.kind !== 'failed').map((r) => r.key.split(':')[0]));
	return [...list.filter((c) => active.has(c.info_hash)), ...list.filter((c) => !active.has(c.info_hash))];
}

/** Bajar de fondo: promedio ÷ lo que pide el video. */
export const BG_GREEN = 1.5;
export const BG_YELLOW = 1;
export const bgTone = (x: number): 'green' | 'yellow' | 'red' => (x >= BG_GREEN ? 'green' : x >= BG_YELLOW ? 'yellow' : 'red');

/** Bytes del archivo que se ve. En un pack: el del episodio ya leído (`episodeBytes`), el de la fuente si señala el archivo, o
 *  el del pack ÷ episodios de la temporada; un pack de varias temporadas sin más datos: null. */
export function fileBytesOf(c: Candidate, episodeBytes: number | null | undefined, seasonEpisodes: number): number | null {
	if (!c.is_pack) return c.size_bytes ?? null;
	if (episodeBytes) return episodeBytes;
	if (!c.size_bytes) return null;
	if (c.file_name) return c.size_bytes;
	if (/\bS\d{1,2}\s*-\s*S?\d{1,2}\b|complete\s*series|integral/i.test(c.release_name)) return null;
	return seasonEpisodes ? c.size_bytes / seasonEpisodes : null;
}

/** Lectura de pistas: por el enjambre el núcleo lee 3 a la vez y cada una tarda ~1 min; por TorBox, de a una, ~8 s. */
export const SWARM_PARALLEL = 3;
export const SWARM_SECS = 60;
export const TORBOX_SECS = 8;
/** Segundos para leer las pistas de `n`. */
export const scanSecs = (n: number, torbox: boolean): number => (torbox ? n * TORBOX_SECS : Math.ceil(n / SWARM_PARALLEL) * SWARM_SECS);

/** Leechers de un conteo (conectados sin el archivo completo); null si nadie respondió. Sin conteo, los de la fuente. */
export function leechersFrom(n: { reached?: boolean; peers: number; seeds: number } | null | undefined, sourceLeechers: number | null): number | null {
	if (n?.reached === false) return null;
	return n ? Math.max(0, n.peers - n.seeds) : sourceLeechers;
}
