// Torrents de los mismos addons que Streamonte, unidos por hash, y solo los que TorBox tiene en caché.
// Parseo portado de crates/core/src/catalog/normalize.rs y audio.rs (versión corta).
import { get } from './http.js';
import { cached } from './torbox.js';
import { namesOf } from './tmdb.js';

const ADDONS = [
	['Torrentio', 'https://torrentio.strem.fun/providers=yts,eztv,rarbg,1337x,thepiratebay,kickasstorrents,torrentgalaxy,magnetdl,uindex,knaben,ext,mejortorrent,wolfmax4k,cinecalidad|language=latino,spanish|sort=qualityseeders'],
	['Peerflix', 'https://addon.peerflix.mov'],
	['Comet', 'https://comet.feels.legal'],
	['TorrentsDB', 'https://torrentsdb.com']
];
const RES_RANK = { '2160p': 5, '1440p': 4, '1080p': 3, '720p': 2, '480p': 1 };
const LAT_FLAGS = ['🇲🇽', '🇦🇷', '🇨🇴', '🇨🇱', '🇵🇪', '🇻🇪', '🇺🇾'];
// Webs de origen (proveedor del addon o dominio dentro del nombre): solo orientan, no confirman.
const LAT_SITES = ['cinecalidad', 'verpeliculasonline', 'pelisplus', 'cuevana', 'pelispanda', 'pelismart'];
const SPAIN_SITES = ['mejortorrent', 'wolfmax4k', 'dontorrent', 'divxtotal', 'elitetorrent'];
/** Qué tan fuerte es cada pista al unir el mismo torrent de varios addons. */
/** @type {Record<string, number>} */
const HINT_RANK = { lat: 3, spain: 2, likely: 1 };

/** @param {string} text @param {string} emoji */
const after = (text, emoji) => text.split(emoji)[1]?.trim().split(/\s{2,}|[\n⚙🌐🔎👤💾]/u)[0]?.trim();

/** "2.1 GB" → bytes. @param {string | undefined} s */
export function size(s) {
	const m = s?.match(/([\d.,]+)\s*([KMGT])i?B/i);
	if (!m) return null;
	return Math.round(parseFloat(m[1].replace(',', '.')) * 1024 ** ' KMGT'.indexOf(m[2].toUpperCase()));
}

/** Un stream de un addon de Stremio: solo lo que se lee.
 * @typedef {{infoHash?: string, title?: string, description?: string, name?: string, behaviorHints?: {filename?: string, videoSize?: number}}} Stream */

/** @param {Stream} s @param {string} addon */
export function parse(s, addon) {
	const hash = s.infoHash?.trim().toLowerCase() ?? '';
	if (!/^[0-9a-f]{40}$/.test(hash)) return null;
	const body = s.title ?? s.description ?? '';
	/** @type {NonNullable<Stream['behaviorHints']>} */
	const hints = s.behaviorHints ?? {};
	const lines = body.split('\n').map((l) => l.trim()).filter(Boolean);
	const release =
		lines.find((l) => l.startsWith('📄'))?.slice(2).trim() ||
		lines[0]?.split(' | ')[0] ||
		hints.filename ||
		s.name ||
		'';
	const text = `${s.name ?? ''}\n${body}\n${hints.filename ?? ''}`;
	const lower = text.toLowerCase();
	const tok = new Set(lower.split(/[^\p{L}\p{N}]+/u));
	/** @param {string[]} w */
	const has = (w) => w.some((x) => tok.has(x));
	const res = has(['2160p', '4k', 'uhd']) ? '2160p' : has(['1440p']) ? '1440p' : has(['1080p', '1080i']) ? '1080p' : has(['720p']) ? '720p' : has(['576p', '480p', '360p', 'sd']) ? '480p' : null;
	const hdr = [];
	if (has(['hdr', 'hdr10', 'hdr10plus']) || lower.includes('hdr10+')) hdr.push('HDR');
	if (has(['dv', 'dovi']) || lower.includes('dolby vision')) hdr.push('DV');
	// Copias de cine: cámara, telesync, telecine y screeners (como `is_cam` del desktop, más HdTScr y "HD Pre").
	const cam = has(['cam', 'camrip', 'hdcam', 'ts', 'telesync', 'hdts', 'tsrip', 'tc', 'hdtc', 'telecine', 'scr', 'screener', 'dvdscr', 'hdscr', 'hdtscr']) || /\bhd[ ._-]?pre\b/.test(lower);
	// Fuente del release, como `source_of` del desktop (streamonte/crates/core/src/release.rs).
	const source = cam ? 'CAM' : has(['remux', 'bdremux']) ? 'REMUX' : /web-?dl/.test(lower) ? 'WEB-DL' : /web-?rip/.test(lower) ? 'WEBRip'
		: has(['bluray', 'bdrip', 'brrip']) || lower.includes('blu-ray') ? 'BluRay' : has(['hdtv']) ? 'HDTV' : has(['dvdrip', 'dvd']) ? 'DVDRip' : has(['web']) ? 'WEB' : null;
	const seeds = Number(after(body, '👤')?.split(/\s/)[0]) || 0;
	return {
		hash,
		release,
		file: hints.filename ?? null,
		res,
		hdr,
		source,
		cam,
		codec: has(['x265', 'h265', 'hevc']) ? 'HEVC' : has(['x264', 'h264', 'avc']) ? 'H.264' : has(['av1']) ? 'AV1' : null,
		atmos: has(['atmos']),
		// Audio según el nombre y la web de origen (lo leído en las pistas gana; ver latStatus en audio.js).
		hint: has(['latino', 'lat', 'latam']) || lower.includes('es-la') || lower.includes('es-419') || LAT_FLAGS.some((f) => text.includes(f))
			? 'lat'
			: has(['cast', 'castellano', 'spain', 'españa']) || text.includes('🇪🇸')
				? 'spain'
				: LAT_SITES.some((w) => lower.includes(w))
					? 'likely'
					: SPAIN_SITES.some((w) => lower.includes(w))
						? 'spain'
						: null,
		multi: has(['multi', 'multiaudio', 'dual']),
		// Dice que trae español (MULTI / Dual / español sin aclarar cuál): vale la pena leer sus pistas.
		spa: has(['multi', 'multiaudio', 'dual', 'spanish', 'español', 'espanol', 'spa', 'esp']),
		size: hints.videoSize && hints.videoSize > 0 ? hints.videoSize : size(after(body, '💾')),
		seeds,
		addons: [addon]
	};
}

/** @typedef {NonNullable<ReturnType<typeof parse>>} Torrent */

const STOP = new Set(['the', 'and', 'los', 'las', 'del', 'una', 'uno', 'con', 'por', 'para']);
/** Palabras de 3+ letras sin tildes ni conectores. @param {string} s */
export const words = (s) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 3 && !STOP.has(w));
/** Torrent de otra película con nombre parecido (algunas fuentes buscan por nombre, no por IMDb id): trae un año que
 * no es el de la película (±1), o no tiene al menos la mitad de las palabras de alguno de sus títulos (original,
 * inglés o español). Sin año en el nombre y con el mismo título no se distingue (p. ej. una homónima vieja).
 * @param {string} release @param {{titles: string[], year: number | null}} want */
export function otherFilm(release, want) {
	const years = [...release.matchAll(/\b(19\d{2}|20\d{2})\b/g)].map((m) => Number(m[1]));
	const year = want.year;
	if (year && years.length && !years.some((y) => Math.abs(y - year) <= 1)) return true;
	const rel = new Set(words(release));
	const titles = want.titles.map(words).filter((w) => w.length);
	return titles.length > 0 && !titles.some((w) => w.filter((x) => rel.has(x)).length >= Math.ceil(w.length / 2));
}

/** Un archivo de video de un torrent pegado ("Pegar magnet", 2026-11-18) como una opción más: el nombre del archivo
 * da resolución, fuente, HDR e idioma con las mismas reglas que las de los addons. @param {string} hash
 * @param {string} name ruta del archivo en el torrent @param {number | null} bytes */
export const fileTorrent = (hash, name, bytes) =>
	/** @type {Torrent} */ (parse({ infoHash: hash, title: name.split('/').pop(), behaviorHints: { filename: name.split('/').pop(), videoSize: bytes ?? 0 } }, 'Magnet'));

/** Más pesado primero (a igual tamaño, más resolución). @param {Torrent} a @param {Torrent} b */
const bySize = (a, b) =>
	(b.size ?? 0) - (a.size ?? 0) ||
	(RES_RANK[/** @type {keyof RES_RANK} */ (b.res)] ?? 0) - (RES_RANK[/** @type {keyof RES_RANK} */ (a.res)] ?? 0);

/** Une por hash los torrents de las fuentes (descarta cámaras y películas con nombre parecido): se queda con el
 * primero y le suma lo mejor de los demás (seeds, tamaño, archivo, pista de idioma, español, addons).
 * @param {(Torrent | null)[][]} lists @param {{titles: string[], year: number | null} | null} [names] @returns {Map<string, Torrent>} */
export function merge(lists, names = null) {
	/** @type {Map<string, Torrent>} */
	const byHash = new Map();
	for (const l of lists) {
		for (const t of l) {
			if (!t || t.cam || (names && otherFilm(t.release, names))) continue;
			const old = byHash.get(t.hash);
			if (!old) byHash.set(t.hash, t);
			else {
				old.seeds = Math.max(old.seeds, t.seeds);
				old.size ??= t.size;
				old.file ??= t.file;
				if ((HINT_RANK[t.hint ?? ''] ?? 0) > (HINT_RANK[old.hint ?? ''] ?? 0)) old.hint = t.hint;
				old.spa ||= t.spa;
				if (!old.addons.includes(t.addons[0])) old.addons.push(t.addons[0]);
			}
		}
	}
	return byHash;
}

/** @typedef {{stage: 'sources', done: number, total: number} | {stage: 'torbox'}} Progress */

/** Torrents de todas las fuentes que TorBox tiene en caché. `onProgress` avisa cada fuente que termina y el chequeo
 * de TorBox (para el "Buscando torrents… 2 de 4 fuentes" de la web).
 * @param {string} imdb @param {string | null} s @param {string | null} e @param {(p: Progress) => void} [onProgress] */
export async function torrents(imdb, s, e, onProgress = () => {}) {
	const type = s ? 'series' : 'movie';
	const vid = s ? `${imdb}:${s}:${e}` : imdb;
	let done = 0;
	onProgress({ stage: 'sources', done, total: ADDONS.length });
	// Películas: sus títulos y año, para descartar las de otra con nombre parecido (en series el id ya trae el episodio).
	const want = s ? null : namesOf(imdb).catch(() => null);
	const lists = await Promise.allSettled(
		ADDONS.map(async ([name, base]) => {
			try {
				const r = await get(`${base}/stream/${type}/${vid}.json`, { headers: { 'user-agent': 'Mozilla/5.0' } }, 15_000);
				return r.ok ? /** @type {{streams?: Stream[]}} */ (await r.json()).streams?.map((x) => parse(x, name)) ?? [] : [];
			} finally {
				onProgress({ stage: 'sources', done: ++done, total: ADDONS.length });
			}
		})
	);
	const names = await want;
	const byHash = merge(
		lists.flatMap((l) => (l.status === 'fulfilled' ? [l.value] : [])),
		names
	);
	const found = byHash.size;
	onProgress({ stage: 'torbox' });
	const inTorbox = await cached([...byHash.keys()], s, e);
	// subFile: trae un archivo de subtítulo en español (sale del mismo checkcached, sin pedidos nuevos).
	const list = [...byHash.values()].filter((t) => inTorbox.has(t.hash)).map((t) => ({ ...t, subFile: inTorbox.get(t.hash) ?? false })).sort(bySize);
	return { list, found, sources: lists.filter((l) => l.status === 'fulfilled').length };
}
