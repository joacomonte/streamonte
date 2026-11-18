// Torrents de los mismos addons que Streamonte, unidos por hash, y solo los que TorBox tiene en caché.
// Parseo portado de crates/core/src/catalog/normalize.rs y audio.rs (versión corta).
import { get } from './http.js';
import { cached } from './torbox.js';

const ADDONS = [
	['Torrentio', 'https://torrentio.strem.fun/providers=yts,eztv,rarbg,1337x,thepiratebay,kickasstorrents,torrentgalaxy,magnetdl,uindex,knaben,ext,mejortorrent,wolfmax4k,cinecalidad|language=latino,spanish|sort=qualityseeders'],
	['Peerflix', 'https://addon.peerflix.mov'],
	['Comet', 'https://comet.feels.legal'],
	['TorrentsDB', 'https://torrentsdb.com']
];
const RES_RANK = { '2160p': 5, '1440p': 4, '1080p': 3, '720p': 2, '480p': 1 };
const LAT_FLAGS = ['🇲🇽', '🇦🇷', '🇨🇴', '🇨🇱', '🇵🇪', '🇻🇪', '🇺🇾'];

/** @param {string} text @param {string} emoji */
const after = (text, emoji) => text.split(emoji)[1]?.trim().split(/\s{2,}|[\n⚙🌐🔎👤💾]/u)[0]?.trim();

/** "2.1 GB" → bytes. @param {string | undefined} s */
function size(s) {
	const m = s?.match(/([\d.,]+)\s*([KMGT])i?B/i);
	if (!m) return null;
	return Math.round(parseFloat(m[1].replace(',', '.')) * 1024 ** ' KMGT'.indexOf(m[2].toUpperCase()));
}

/** @param {any} s @param {string} addon */
function parse(s, addon) {
	const hash = s.infoHash?.trim().toLowerCase();
	if (!/^[0-9a-f]{40}$/.test(hash ?? '')) return null;
	const body = s.title ?? s.description ?? '';
	const hints = s.behaviorHints ?? {};
	const lines = body.split('\n').map((/** @type {string} */ l) => l.trim()).filter(Boolean);
	const release =
		lines.find((/** @type {string} */ l) => l.startsWith('📄'))?.slice(2).trim() ||
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
	const cam = has(['cam', 'camrip', 'hdcam', 'ts', 'telesync', 'hdts']);
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
		lat: has(['latino', 'lat', 'latam']) || lower.includes('es-la') || lower.includes('es-419') || LAT_FLAGS.some((f) => text.includes(f)),
		multi: has(['multi', 'multiaudio', 'dual']),
		size: hints.videoSize > 0 ? hints.videoSize : size(after(body, '💾')),
		seeds,
		addons: [addon]
	};
}

/** @typedef {NonNullable<ReturnType<typeof parse>>} Torrent */

/** Más pesado primero (a igual tamaño, más resolución). @param {Torrent} a @param {Torrent} b */
const bySize = (a, b) =>
	(b.size ?? 0) - (a.size ?? 0) ||
	(RES_RANK[/** @type {keyof RES_RANK} */ (b.res)] ?? 0) - (RES_RANK[/** @type {keyof RES_RANK} */ (a.res)] ?? 0);

/** @param {string} imdb @param {string | null} s @param {string | null} e */
export async function torrents(imdb, s, e) {
	const type = s ? 'series' : 'movie';
	const vid = s ? `${imdb}:${s}:${e}` : imdb;
	const lists = await Promise.allSettled(
		ADDONS.map(async ([name, base]) => {
			const r = await get(`${base}/stream/${type}/${vid}.json`, { headers: { 'user-agent': 'Mozilla/5.0' } }, 15_000);
			return r.ok ? (await r.json()).streams?.map((/** @type {any} */ x) => parse(x, name)) ?? [] : [];
		})
	);
	/** @type {Map<string, Torrent>} */
	const byHash = new Map();
	for (const l of lists) {
		if (l.status !== 'fulfilled') continue;
		for (const t of l.value) {
			if (!t || t.cam) continue;
			const old = byHash.get(t.hash);
			if (!old) byHash.set(t.hash, t);
			else {
				old.seeds = Math.max(old.seeds, t.seeds);
				old.size ??= t.size;
				old.file ??= t.file;
				old.lat ||= t.lat;
				if (!old.addons.includes(t.addons[0])) old.addons.push(t.addons[0]);
			}
		}
	}
	const found = byHash.size;
	const inTorbox = await cached([...byHash.keys()], s, e);
	const list = [...byHash.values()].filter((t) => inTorbox.has(t.hash)).sort(bySize);
	return { list, found, sources: lists.filter((l) => l.status === 'fulfilled').length };
}
