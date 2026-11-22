// Calce de un subtítulo con el video copiado (web; el desktop lo hace en Rust: crates/core/src/subtitles.rs).

/** El video copiado: su release y lo que se leyó de él. */
export type Match = { release: string; video?: { fps: number | null; duration: number | null } };
/** Lo que se lee de un subtítulo para calzarlo. */
export type MatchableSub = { release: string; exact?: boolean; fps?: number | null; last?: number | null; group?: string | null; latino: boolean; downloads: number };

/** Fuente del release: HDTV, web y Blu-ray del mismo capítulo pueden tener otro corte. */
export const sourceOf = (x: string): string | null =>
	/web[ ._-]?dl|web[ ._-]?rip|\bweb\b|amzn|\bnf\b|hmax|dsnp/i.test(x) ? 'WEB' : /blu-?ray|bdrip|brrip|remux/i.test(x) ? 'BluRay' : /hdtv/i.test(x) ? 'HDTV' : /dvd/i.test(x) ? 'DVD' : null;

/** Grupo del release (`…-KILLERS`). */
export const groupOf = (x: string): string => x.match(/-([a-z0-9]+)(?:\.[a-z0-9]{2,4})?$/i)?.[1] ?? '';

/** 3 hecho para ese archivo, 2 mismo release (grupo y, si se sabe, fuente), 1 mismos fps y termina dentro del video, 0 nada. */
export function level(sub: MatchableSub, match: Match | null): number {
	if (sub.exact) return 3;
	const rel = match?.release ?? '';
	const g = groupOf(rel).toLowerCase();
	const [a, b] = [sourceOf(rel), sourceOf(sub.release)];
	if (g && ((sub.group ?? '').toLowerCase() === g || groupOf(sub.release).toLowerCase() === g) && (!a || !b || a === b)) return 2;
	const v = match?.video;
	const ends = !v?.duration || !sub.last || (sub.last >= v.duration * 0.8 && sub.last <= v.duration + 5);
	return v?.fps && sub.fps && Math.abs(v.fps - sub.fps) < 0.05 && ends ? 1 : 0;
}

/** Exacto → mismo release → mismos fps y duración → resto; adentro, latinos y más bajados. */
export const rank = <S extends MatchableSub>(list: S[], match: Match | null): (S & { level: number })[] =>
	list.map((sub) => ({ ...sub, level: level(sub, match) })).sort((a, b) => b.level - a.level || Number(b.latino) - Number(a.latino) || b.downloads - a.downloads);
