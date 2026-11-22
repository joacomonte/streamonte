// Lógica pura de Torrents.svelte: calidad de cada opción y calce de los subtítulos con el video copiado.

import type { Torrent, Sub } from './types.ts';

/** El video copiado: su release y lo que se leyó de él. */
export type Match = { release: string; video?: { fps: number | null; duration: number | null } };

export const resOf = (t: Torrent) => (t.res === '2160p' || t.res === '1440p' || t.res === '1080p' || t.res === '720p' ? t.res : 'other');

/** Calidad de imagen por la fuente del release, como el desktop (streamonte/ui/src/catalog-options.js): [nombre, estrellas de 4]. */
export const QUALITY: Record<string, [string, number]> = {
	REMUX: ['Máster', 4],
	BluRay: ['Blu-ray', 3],
	'WEB-DL': ['Streaming', 2],
	WEBRip: ['Streaming', 2],
	WEB: ['Streaming', 2],
	HDTV: ['TV', 1],
	DVDRip: ['DVD', 1]
};

/** Mbps típicos por resolución cuando no se sabe la duración (como el desktop, catalog-options.js `TYPICAL_MBPS`). */
export const TYPICAL: Record<string, number> = { '2160p': 25, '1440p': 14, '1080p': 8, '720p': 4, other: 3 };

/** Bitrate que pide el video, en Mbps: peso ÷ duración (la de la ficha, en minutos); sin alguno de los dos, lo típico.
 */
export const mbpsOf = (t: Torrent, runtime: number | null | undefined) => (t.size && runtime ? (t.size * 8) / (runtime * 60) / 1e6 : TYPICAL[resOf(t)]);

const qualityRank = (t: Torrent) => (t.source ? QUALITY[t.source]?.[1] : null) ?? 2.5;

/** De mejor a peor: más bitrate (más imagen por segundo; la resolución sola no dice cuánto se comprimió), y a igual
 * bitrate la de mejor calidad de imagen. */
export const byQuality = (a: Torrent, b: Torrent, runtime: number | null | undefined) => Number(!a.size) - Number(!b.size) || mbpsOf(b, runtime) - mbpsOf(a, runtime) || qualityRank(b) - qualityRank(a);

/** Fuente del release: HDTV, web y Blu-ray del mismo capítulo pueden tener otro corte. */
export const sourceOf = (x: string) =>
	/web[ ._-]?dl|web[ ._-]?rip|\bweb\b|amzn|\bnf\b|hmax|dsnp/i.test(x) ? 'WEB' : /blu-?ray|bdrip|brrip|remux/i.test(x) ? 'BluRay' : /hdtv/i.test(x) ? 'HDTV' : /dvd/i.test(x) ? 'DVD' : null;

/** Grupo del release (`…-KILLERS`). */
export const groupOf = (x: string) => x.match(/-([a-z0-9]+)(?:\.[a-z0-9]{2,4})?$/i)?.[1] ?? '';

/** Cuánto calza con el video copiado, como el desktop (crates/core/src/subtitles.rs): 3 hecho para ese archivo,
 * 2 mismo release (grupo y, si se sabe, fuente), 1 mismos fps y termina dentro del video, 0 nada. */
export function level(sub: Sub, match: Match | null): number {
	if (sub.exact) return 3;
	const rel = match?.release ?? '';
	const g = groupOf(rel).toLowerCase();
	const [a, b] = [sourceOf(rel), sourceOf(sub.release)];
	if (g && ((sub.group ?? '').toLowerCase() === g || groupOf(sub.release).toLowerCase() === g) && (!a || !b || a === b)) return 2;
	const v = match?.video;
	const ends = !v?.duration || !sub.last || (sub.last >= v.duration * 0.8 && sub.last <= v.duration + 5);
	return v?.fps && sub.fps && Math.abs(v.fps - sub.fps) < 0.05 && ends ? 1 : 0;
}

/** Exacto → mismo release → mismos fps y duración → resto; adentro, latinos y más bajados.
 */
export const rank = (list: Sub[], match: Match | null) => list.map((sub) => ({ ...sub, level: level(sub, match) }))
	.sort((a, b) => b.level - a.level || Number(b.latino) - Number(a.latino) || b.downloads - a.downloads);
