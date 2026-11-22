// Lógica pura de Torrents.svelte: calidad de cada opción y calce de los subtítulos con el video copiado.

/** @typedef {import('./types.js').Torrent} Torrent */
/** @typedef {import('./types.js').Sub} Sub */
/** El video copiado: su release y lo que se leyó de él. @typedef {{release: string, video?: {fps: number | null, duration: number | null}}} Match */

/** @param {Torrent} t */
export const resOf = (t) => (t.res === '2160p' || t.res === '1440p' || t.res === '1080p' || t.res === '720p' ? t.res : 'other');

/** Calidad de imagen por la fuente del release, como el desktop (streamonte/ui/src/catalog-options.js): [nombre, estrellas de 4]. */
export const QUALITY = /** @type {Record<string, [string, number]>} */ ({
	REMUX: ['Máster', 4],
	BluRay: ['Blu-ray', 3],
	'WEB-DL': ['Streaming', 2],
	WEBRip: ['Streaming', 2],
	WEB: ['Streaming', 2],
	HDTV: ['TV', 1],
	DVDRip: ['DVD', 1]
});

/** Mbps típicos por resolución cuando no se sabe la duración (como el desktop, catalog-options.js `TYPICAL_MBPS`). */
export const TYPICAL = /** @type {Record<string, number>} */ ({ '2160p': 25, '1440p': 14, '1080p': 8, '720p': 4, other: 3 });

/** Bitrate que pide el video, en Mbps: peso ÷ duración (la de la ficha, en minutos); sin alguno de los dos, lo típico.
 * @param {Torrent} t @param {number | null | undefined} runtime */
export const mbpsOf = (t, runtime) => (t.size && runtime ? (t.size * 8) / (runtime * 60) / 1e6 : TYPICAL[resOf(t)]);

/** @param {Torrent} t */
const qualityRank = (t) => (t.source ? QUALITY[t.source]?.[1] : null) ?? 2.5;

/** De mejor a peor: más bitrate (más imagen por segundo; la resolución sola no dice cuánto se comprimió), y a igual
 * bitrate la de mejor calidad de imagen. @param {Torrent} a @param {Torrent} b @param {number | null | undefined} runtime */
export const byQuality = (a, b, runtime) => Number(!a.size) - Number(!b.size) || mbpsOf(b, runtime) - mbpsOf(a, runtime) || qualityRank(b) - qualityRank(a);

/** Fuente del release: HDTV, web y Blu-ray del mismo capítulo pueden tener otro corte. @param {string} x */
export const sourceOf = (x) =>
	/web[ ._-]?dl|web[ ._-]?rip|\bweb\b|amzn|\bnf\b|hmax|dsnp/i.test(x) ? 'WEB' : /blu-?ray|bdrip|brrip|remux/i.test(x) ? 'BluRay' : /hdtv/i.test(x) ? 'HDTV' : /dvd/i.test(x) ? 'DVD' : null;

/** Grupo del release (`…-KILLERS`). @param {string} x */
export const groupOf = (x) => x.match(/-([a-z0-9]+)(?:\.[a-z0-9]{2,4})?$/i)?.[1] ?? '';

/** Cuánto calza con el video copiado, como el desktop (crates/core/src/subtitles.rs): 3 hecho para ese archivo,
 * 2 mismo release (grupo y, si se sabe, fuente), 1 mismos fps y termina dentro del video, 0 nada.
 * @param {Sub} sub @param {Match | null} match */
export function level(sub, match) {
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
 * @param {Sub[]} list @param {Match | null} match */
export const rank = (list, match) => list.map((sub) => ({ ...sub, level: level(sub, match) }))
	.sort((a, b) => b.level - a.level || Number(b.latino) - Number(a.latino) || b.downloads - a.downloads);
