// TorBox, como crates/core/src/catalog/torbox.rs: qué hashes están en caché y el link https de uno.
import { Fail, get } from './http.js';
import { keys } from './keys.js';
import { lang, tx } from './lang.js';

const ROOT = 'https://api.torbox.app';
const VIDEO = /\.(mkv|mp4|avi|m4v|mov|webm)$/i;
const SUB = /\.(srt|ass|ssa|vtt)$/i;
const SPANISH = new Set(['es', 'spa', 'spanish', 'español', 'espanol', 'esp', 'castellano', 'latino']);

/** ¿Es un archivo de subtítulo en español por el nombre? (`x.spa.srt`, `2_Spanish.srt`, `x.es-419.srt`; como `lang_from_name` del desktop).
 * @param {string} path */
export const isSpanishSub = (path) =>
	SUB.test(path) && (path.split('/').pop() ?? '').toLowerCase().replace(SUB, '').split(/[^a-z0-9ñ]+/).some((w) => SPANISH.has(w));
console.assert(
	isSpanishSub('Subs/2_Spanish.srt') && isSpanishSub('x.es-419.srt') && isSpanishSub('Show.S01E02.spa.ass') && !isSpanishSub('Les.Miserables.eng.srt') && !isSpanishSub('x.spa.mkv'),
	'isSpanishSub'
);

async function key() {
	const k = (await keys()).torbox;
	if (!k) throw new Fail(428, 'Falta la key de TorBox: cargala en Ajustes.');
	return k;
}

/** @param {string} path @param {RequestInit} [init] */
const tb = (path, init = {}) => tbRoot(`/v1/api/torrents${path}`, init);

/** @param {string} path ruta desde `/v1/api` (incluida) @param {RequestInit} [init] */
async function tbRoot(path, init = {}) {
	const r = await get(ROOT + path, { ...init, headers: { authorization: `Bearer ${await key()}` } }, 20_000);
	const j = await r.json().catch(() => ({}));
	// 403 también es "tu plan no incluye esto" (el streaming): no es la key.
	if (j.error === 'PLAN_RESTRICTED_FEATURE') throw new Fail(403, 'Tu plan de TorBox no incluye streaming: no se pueden leer las pistas del video.');
	if (r.status === 401 || r.status === 403) throw new Fail(401, 'TorBox rechazó la key: revisala en Ajustes.');
	if (!r.ok) throw new Fail(502, 'TorBox: {d}', { d: j.detail ?? r.status });
	return j;
}

/** Nombre de archivo del capítulo `s`×`e` (S01E02, 1x02). @param {string} s @param {string} e */
const episodeRe = (s, e) => new RegExp(`(s0*${s}[ ._-]?e0*${e}|\\b0*${s}x0*${e})(?!\\d)`, 'i');

/** Hashes (en minúscula) que TorBox tiene en caché con un video suelto; en series, con el del capítulo.
 * Los que solo traen .rar/.iso/extras o un pack sin ese capítulo quedan afuera: TorBox no daría link.
 * Valor: si trae un archivo de subtítulo en español. Solo dice "sí": false no descarta subs adentro del video.
 * @param {string[]} hashes @param {string | null} s @param {string | null} e @returns {Promise<Map<string, boolean>>} */
export async function cached(hashes, s = null, e = null) {
	const ep = s && e ? episodeRe(s, e) : null;
	/** @type {Map<string, boolean>} */
	const out = new Map();
	const batches = [];
	for (let i = 0; i < hashes.length; i += 80) batches.push(hashes.slice(i, i + 80));
	const pages = await Promise.all(batches.map((b) => tb(`/checkcached?hash=${b.join(',')}&format=object&list_files=true`)));
	for (const j of pages) {
		const d = j.data;
		for (const x of Array.isArray(d) ? d : Object.values(d ?? {})) {
			// Sin lista de archivos (formato distinto): se deja, como antes.
			/** @type {string[] | null} */
			const files = Array.isArray(x.files) ? x.files.map((/** @type {any} */ f) => String(f.name ?? '')) : null;
			const videos = files?.filter((f) => VIDEO.test(f));
			// Un solo video sirve aunque no diga S01E02: el addon ya lo dio para ese capítulo.
			const ok = !videos || (ep ? videos.length === 1 || videos.some((f) => ep.test(f.split('/').pop() ?? '')) : videos.length > 0);
			if (!ok) continue;
			out.set(String(x.hash).toLowerCase(), files?.some(isSpanishSub) ?? false);
		}
	}
	return out;
}

/** Link https del video: agrega el torrent (solo si está en caché) y pide el link del archivo. Audio por defecto: el
 * idioma original del título (`orig`, ISO 639-1 de TMDB); si no está, inglés. Si además trae latino, `choices` trae
 * los dos (Original y Latino) para que el usuario elija.
 * @param {{hash: string, name: string, file: string | null, s: string | null, e: string | null, orig?: string | null}} t
 * `file`: hash de OpenSubtitles y tamaño del archivo, para buscar subtítulos hechos para ese archivo.
 * `natives`: subtítulos en español que trae el video; cada uno con su link: el mismo stream (audio en inglés) con ese
 * subtítulo puesto (TorBox lo pone en la imagen). Vacío = no trae.
 * `video`: cuadros por segundo y duración en segundos, para ordenar los subtítulos por cuál calza.
 * `subsEs`: cuántos subtítulos en español trae el video adentro (sin dato si no hubo stream HLS).
 * @returns {Promise<{url: string, choices?: {key: string, label: string, url: string}[], file?: {hash: string, size: string}, natives?: Native[], video?: {fps: number | null, duration: number | null}, subsEs?: number}>} */
export async function link(t) {
	const { id, file } = await added(t);
	return (await hls(id, file.id, t.name, t.orig ?? null)) ?? { url: await download(id, file) };
}

/** Subtítulos en español y audios que trae el video adentro, con un solo createstream (sin pedir un stream por
 * subtítulo: eso queda para cuando se copia el link). El dato es del torrent y no cambia.
 * @param {{hash: string, name: string, file: string | null, s: string | null, e: string | null}} t
 * @returns {Promise<{subs: {label: string, kind: string, track: number}[], audios: {language: string, title: string}[]}>} */
export async function tracks(t) {
	const { id, file } = await added(t);
	const meta = (await tbRoot(`/v1/api/stream/createstream?id=${id}&file_id=${file.id}&type=torrent`)).data?.metadata ?? {};
	return {
		subs: spanishSubs(meta.subtitles).map(({ label, kind, i }) => ({ label, kind, track: i + 1 })),
		audios: (/** @type {any[]} */ (meta.audios ?? [])).map((a) => ({ language: String(a.language ?? ''), title: String(a.title ?? '') }))
	};
}

/** Subtítulos en español de la metadata de createstream, los forzados al final; `i` es su posición entre todos.
 * @param {any[] | undefined} subtitles */
function spanishSubs(subtitles) {
	return (subtitles ?? [])
		.map((x, i) => ({ x, i, forced: /forced|forzad/i.test(x.title ?? '') }))
		.filter(({ x }) => x.language === 'spa')
		.sort((a, b) => Number(a.forced) - Number(b.forced))
		.map(({ x, i, forced }) => ({
			i,
			forced,
			label: /lat|419/i.test(x.title ?? '') ? 'Latinoamérica' : /spain|españa|castellano|es-es/i.test(x.title ?? '') ? 'España' : 'Español',
			kind: forced ? 'forzados' : 'del video'
		}));
}

/** Agrega el torrent a TorBox (solo si está en caché) y elige el archivo de video. @param {{hash: string, name: string, file: string | null, s: string | null, e: string | null}} t */
async function added(t) {
	const fd = new FormData();
	fd.set('magnet', `magnet:?xt=urn:btih:${t.hash}&dn=${encodeURIComponent(t.name)}`);
	fd.set('add_only_if_cached', 'true');
	const created = await tb('/createtorrent', { method: 'POST', body: fd });
	const id = created.data?.torrent_id;
	if (!id) throw new Fail(409, 'TorBox no lo agregó: {d}', { d: created.detail ?? 'sin id' });
	// Recién agregado, TorBox a veces todavía no lista los archivos: hasta 3 intentos, 1 s entre cada uno.
	/** @type {any[]} */
	let files = [];
	for (let i = 0; i < 3 && !files.length; i++) {
		if (i) await new Promise((ok) => setTimeout(ok, 1000));
		const list = await tb(`/mylist?id=${id}&bypass_cache=true`);
		files = (list.data?.files ?? []).filter((/** @type {any} */ f) => VIDEO.test(f.name ?? ''));
	}
	const file = pick(files, t);
	if (!file) throw new Fail(409, 'TorBox todavía no tiene el archivo de video.');
	return { id, file };
}

/** @typedef {{label: string, kind: string, track: number, url: string}} Native */

/** ISO 639-1 (TMDB) → códigos de 3 letras que traen las pistas de audio (bibliográfico y terminológico). */
const ISO3 = /** @type {Record<string, string[]>} */ ({
	en: ['eng'], es: ['spa'], fr: ['fre', 'fra'], de: ['ger', 'deu'], it: ['ita'], ja: ['jpn'], ko: ['kor'], pt: ['por'],
	ru: ['rus'], zh: ['chi', 'zho'], hi: ['hin'], tr: ['tur'], pl: ['pol'], nl: ['dut', 'nld'], sv: ['swe'], da: ['dan'],
	no: ['nor', 'nob'], fi: ['fin'], ar: ['ara'], he: ['heb'], th: ['tha'], cs: ['cze', 'ces'], hu: ['hun'], el: ['gre', 'ell'],
	id: ['ind'], uk: ['ukr'], fa: ['per', 'fas'], cn: ['chi', 'zho'], is: ['ice', 'isl'], ro: ['rum', 'ron']
});

/** Stream HLS de TorBox (`.m3u8`): Web Video Caster lo detecta como video (el link de descarga va como
 * `application/octet-stream` y lo abría como texto) y llega en segmentos que la tele reproduce.
 * Audio: el idioma original por defecto (muchos releases traen primero un doblaje ruso); si no está, inglés; si además
 * hay latino, los dos para elegir. null si no se pudo.
 * @param {number} id @param {number} fileId @param {string} release @param {string | null} orig ISO 639-1 */
async function hls(id, fileId, release, orig) {
	try {
		const base = `/v1/api/stream/createstream?id=${id}&file_id=${fileId}&type=torrent`;
		const first = await tbRoot(base);
		const audios = /** @type {any[]} */ (first.data?.metadata?.audios ?? []);
		// `chosen_audio_index` es la posición entre los audios (el que viene por defecto es 0).
		/** @param {number} i @param {number} [sub] posición del subtítulo a poner en el video */
		const at = async (i, sub) =>
			String((i > 0 || sub != null ? await tbRoot(`${base}&chosen_audio_index=${Math.max(i, 0)}${sub != null ? `&chosen_subtitle_index=${sub}` : ''}`) : first).data?.hls_url ?? '');
		// Subtítulos en español del propio video (siempre en sync), los forzados al final.
		const spaSubs = spanishSubs(first.data?.metadata?.subtitles);
		const subsEs = spaSubs.length;
		const d = first.data ?? {};
		const file = /^[0-9a-f]{16}$/.test(d.open_subtitles_hash ?? '') && d.size ? { hash: d.open_subtitles_hash, size: String(d.size) } : undefined;
		const v = d.metadata?.video ?? {};
		const dur = String(v.duration ?? '').match(/^(\d+):(\d+):(\d+)/);
		const video = { fps: Number(v.frame_rate) || null, duration: dur ? Number(dur[1]) * 3600 + Number(dur[2]) * 60 + Number(dur[3]) : null };
		const codes = ISO3[orig ?? ''] ?? [];
		const byOrig = audios.findIndex((a) => codes.includes(a.language));
		const main = byOrig >= 0 ? byOrig : audios.findIndex((a) => a.language === 'eng');
		// shortcut: hasta 4 (un stream por subtítulo, todos se piden ya); si un video trae más, sumar un pedido a demanda.
		/** @type {Native[]} */
		const natives = (await Promise.all(spaSubs.slice(0, 4).map(async ({ i, label, kind }) => ({
			label,
			kind,
			track: i + 1,
			url: await at(main, i).catch(() => '')
		})))).filter((n) => n.url.startsWith('https://'));
		const spa = audios.map((a, i) => ({ a, i })).filter(({ a }) => a.language === 'spa');
		const lat = spa.find(({ a }) => /lat|419|mex/i.test(a.title ?? '')) ?? latinoByName(spa, release);
		if (main >= 0 && lat && lat.i !== main) {
			const [o, la] = await Promise.all([at(main), at(lat.i)]);
			const name = new Intl.DisplayNames([lang()], { type: 'language' }).of(byOrig >= 0 && orig ? orig : 'en') ?? '';
			const choices = [
				{ key: 'orig', label: tx('Original ({l})', { l: name[0]?.toUpperCase() + name.slice(1) }), url: o },
				{ key: 'lat', label: tx('Latino'), url: la }
			];
			if (o.startsWith('https://') && la.startsWith('https://')) return { url: o, choices, file, natives, video, subsEs };
		}
		const url = await at(Math.max(main, 0));
		return url.startsWith('https://') ? { url, file, natives, video, subsEs } : null;
	} catch (e) {
		// La key mal sí corta; sin streaming en el plan (403), queda el link de descarga.
		if (e instanceof Fail && e.status === 401) throw e;
		return null;
	}
}

/** Audio latino cuando los títulos no lo dicen: con un solo audio en español en un release latino, ese; si trae
 * latino y castellano, el orden en que el nombre los nombra (`ENG.LATINO.CASTELLANO` → el primero).
 * shortcut: supone que los audios siguen el orden del nombre; si falla, mirar la pista en el reproductor.
 * @template T @param {T[]} spa @param {string} release @returns {T | null} */
function latinoByName(spa, release) {
	const lat = release.search(/latino|\blat\b|latam|dual-lat/i);
	if (lat < 0 || !spa.length) return null;
	if (spa.length === 1) return spa[0];
	const cas = release.search(/castellano|\bcast\b|españa|spain/i);
	return cas >= 0 && cas < lat ? spa[1] : spa[0];
}

/** Link de descarga (respaldo): termina en la extensión para ayudar a los reproductores que miran la URL.
 * @param {number} id @param {any} file */
async function download(id, file) {
	const dl = await tb(`/requestdl?token=${await key()}&torrent_id=${id}&file_id=${file.id}&zip_link=false`);
	if (!String(dl.data ?? '').startsWith('https://')) throw new Fail(502, 'TorBox no dio el link.');
	const ext = String(file.name).match(/\.(mkv|mp4|avi|m4v|mov|webm)$/i)?.[0].toLowerCase() ?? '.mkv';
	return `${dl.data}${String(dl.data).includes('?') ? '&' : '?'}f=video${ext}`;
}

/** El archivo del addon; si no, el del episodio (packs de temporada); si no, el más grande.
 * @param {any[]} files @param {{file: string | null, s: string | null, e: string | null}} t */
function pick(files, t) {
	const name = (/** @type {any} */ f) => String(f.short_name ?? f.name).toLowerCase();
	if (t.file) {
		const f = files.find((x) => name(x).endsWith(t.file?.toLowerCase() ?? ''));
		if (f) return f;
	}
	if (t.s && t.e) {
		const re = episodeRe(t.s, t.e);
		const f = files.find((x) => re.test(name(x)));
		if (f) return f;
	}
	return files.reduce((a, b) => (!a || b.size > a.size ? b : a), null);
}
