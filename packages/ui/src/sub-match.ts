// Calce de un subtítulo con el video copiado. Rust manda: crates/core/src/subtitles/providers.rs `release_match`,
// subtitles.rs `fit_by_timing` / `rank_order` y release.rs `source_of` / `parse_release_name`. Golden: packages/golden/sub_match.json.

/** El video copiado: su release y lo que se leyó de él. */
export type Match = { release: string; video?: { fps: number | null; duration: number | null } };
/** Lo que se lee de un subtítulo para calzarlo. `native`: viene con el video; `com`: es de OpenSubtitles.com (Premium). */
export type MatchableSub = { release: string; exact?: boolean; fps?: number | null; last?: number | null; latino: boolean; downloads: number; native?: boolean; com?: boolean };

const EXTENSIONS = ['mkv', 'mp4', 'm4v', 'mov', 'avi', 'webm', 'ts', 'm2ts', 'wmv', 'srt', 'ass', 'ssa', 'vtt'];

/** Nombre sin carpetas ni extensión (solo las de video y subtítulo, como `release::strip_extension`). */
function stemOf(name: string): string {
	const file = name.split(/[\\/]/).pop() ?? name;
	const dot = file.lastIndexOf('.');
	return dot >= 0 && EXTENSIONS.includes(file.slice(dot + 1).toLowerCase()) ? file.slice(0, dot) : file;
}

const SOURCES: Record<string, string> = {
	'web-dl': 'WEB-DL', webdl: 'WEB-DL', webrip: 'WEBRip', 'web-rip': 'WEBRip', web: 'WEB',
	bluray: 'BluRay', 'blu-ray': 'BluRay', bdrip: 'BluRay', brrip: 'BluRay', bdremux: 'BluRay',
	hdtv: 'HDTV', dvdrip: 'DVDRip', dvd: 'DVDRip', hdrip: 'HDRip', cam: 'CAM', hdcam: 'CAM', ts: 'CAM', telesync: 'CAM'
};
const MARKERS = new Set(['4k', 'uhd', 'x264', 'x265', 'h264', 'h265', 'hevc', 'avc', 'xvid', '10bit', 'hdr', 'hdr10', 'dv', 'remux', 'proper', 'repack', 'extended', 'unrated', 'multi', 'dual', 'latino', 'castellano', 'aac', 'ac3', 'dts', 'ddp5', 'dd5', 'atmos', 'complete']);

const tokensOf = (stem: string): string[] => stem.split(/[._ [\](){}]/).filter(Boolean);

/** Fuente del release (`WEB-DL`, `BluRay`, `CAM`…): la primera palabra del nombre que lo diga. */
export const sourceOf = (x: string): string | null => {
	for (const token of tokensOf(stemOf(x))) {
		// La palabra entera (`web-dl` lleva guion propio) y, si no, sin el último `-GRUPO` pegado (`web-dl-ntb`).
		const t = token.toLowerCase();
		const s = SOURCES[t] ?? SOURCES[t.slice(0, Math.max(t.lastIndexOf('-'), 0))];
		if (s) return s;
	}
	return null;
};

function isMarker(token: string): boolean {
	const t = token.toLowerCase().split('-')[0];
	return t in SOURCES || /^\d{3,}p$/.test(t) || MARKERS.has(t);
}

/** Grupo del release (`…x264-GRUPO`), '' si no hay: lo que sigue al último '-' si parece un grupo y no un marcador. */
export function groupOf(x: string): string {
	const stem = stemOf(x);
	const dash = stem.lastIndexOf('-');
	const g = dash >= 0 ? stem.slice(dash + 1).trim() : '';
	return g && g.length <= 20 && /^[a-z0-9]+$/i.test(g) && !isMarker(g) && !/^\d+$/.test(g) ? g : '';
}

const words = (text: string): string[] => text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
const flat = (s: string | null): string | null => (s ? words(s).join('') : null);

/** 3 hecho para ese archivo (hash, o su nombre dentro del release), 2 mismo grupo y, si se sabe, misma fuente,
 * 1 mismos fps y termina dentro del video (80 % a +5 s; sin último diálogo alcanza con los fps), 0 nada. */
export function level(sub: MatchableSub, match: Match | null): number {
	if (sub.exact) return 3;
	const rel = match?.release ?? '';
	const stem = stemOf(rel).toLowerCase();
	if (stem && sub.release.toLowerCase().includes(stem)) return 3;
	const g = groupOf(rel).toLowerCase();
	const [a, b] = [flat(sourceOf(rel)), flat(sourceOf(sub.release))];
	if (g.length >= 2 && words(sub.release).includes(g) && (!a || !b || a === b)) return 2;
	const v = match?.video;
	const ends = !v?.duration || !sub.last || (sub.last >= v.duration * 0.8 && sub.last <= v.duration + 5);
	return v?.fps && sub.fps && Math.abs(v.fps - sub.fps) < 0.05 && ends ? 1 : 0;
}

/** Los que vienen con el video primero; después exacto → mismo release → mismos fps y duración → resto; adentro,
 * latinos, OpenSubtitles.com y más bajados. */
export const rank = <S extends MatchableSub>(list: S[], match: Match | null): (S & { level: number })[] =>
	list
		.map((sub) => ({ ...sub, level: level(sub, match) }))
		.sort(
			(a, b) =>
				Number(!a.native) - Number(!b.native) ||
				b.level - a.level ||
				Number(b.latino) - Number(a.latino) ||
				Number(!a.com) - Number(!b.com) ||
				b.downloads - a.downloads
		);
