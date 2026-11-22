// TorBox, como crates/core/src/catalog/torbox.rs: qué hashes están en caché y el link https de uno.
import { Fail, get } from './http.ts';
import { keys } from './keys.ts';
import { lang, tx } from './lang.ts';
import { isSpanish, tracksOf } from './mkv.ts';

const ROOT = 'https://api.torbox.app';
const VIDEO = /\.(mkv|mp4|avi|m4v|mov|webm)$/i;
const SUB = /\.(srt|ass|ssa|vtt)$/i;
const SPANISH = new Set(['es', 'spa', 'spanish', 'español', 'espanol', 'esp', 'castellano', 'latino']);

/** ¿Es un archivo de subtítulo en español por el nombre? (`x.spa.srt`, `2_Spanish.srt`, `x.es-419.srt`; como `lang_from_name` del desktop). */
export const isSpanishSub = (path: string): boolean =>
	SUB.test(path) && (path.split('/').pop() ?? '').toLowerCase().replace(SUB, '').split(/[^a-z0-9ñ]+/).some((w) => SPANISH.has(w));

/** Respuestas de TorBox: solo los campos que se leen. `data` cambia según el endpoint (`T`). */
type TbRes<T> = { data?: T; detail?: string; error?: string };
type TbFile = { id: number; name: string; short_name?: string; size: number };
type TbCached = { hash?: string; name?: string; files?: TbFile[] };
type TbTorrent = { hash: string; name?: string; files?: TbFile[]; download_finished?: boolean; download_state?: string; progress?: number; download_speed?: number; seeds?: number; eta?: number };
type TbSub = { language?: string; title?: string };
type TbAudio = { language: string; title?: string };
type TbStream = { metadata?: { audios?: TbAudio[]; subtitles?: TbSub[]; video?: { duration?: string; frame_rate?: string | number } }; hls_url?: string; open_subtitles_hash?: string; size?: number };
/** El torrent y qué video elegir de él (lo que piden `link`, `tracks` y `added`). */
type Pick = { hash: string; name: string; file: string | null; s: string | null; e: string | null };

async function key(): Promise<string> {
	const k = (await keys()).torbox;
	if (!k) throw new Fail(428, 'Falta la key de TorBox: cargala en Ajustes.');
	return k;
}

const tb = (path: string, init: RequestInit = {}) => tbRoot(`/v1/api/torrents${path}`, init);

/** `path`: ruta desde `/v1/api` (incluida). */
async function tbRoot(path: string, init: RequestInit = {}): Promise<TbRes<unknown>> {
	const r = await get(ROOT + path, { ...init, headers: { authorization: `Bearer ${await key()}` } }, 20_000);
	const j = (await r.json().catch(() => ({}))) as TbRes<unknown>;
	// 403 también es "tu plan no incluye esto" (el streaming): no es la key.
	if (j.error === 'PLAN_RESTRICTED_FEATURE') throw new Fail(403, 'Tu plan de TorBox no incluye streaming: no se pueden leer las pistas del video.');
	if (r.status === 401 || r.status === 403) throw new Fail(401, 'TorBox rechazó la key: revisala en Ajustes.');
	if (!r.ok) throw new Fail(502, 'TorBox: {d}', { d: j.detail ?? r.status });
	return j;
}

/** Nombre de archivo del capítulo `s`×`e` (S01E02, 1x02). */
export const episodeRe = (s: string, e: string): RegExp => new RegExp(`(s0*${s}[ ._-]?e0*${e}|\\b0*${s}x0*${e})(?!\\d)`, 'i');

/** Hashes (en minúscula) que TorBox tiene en caché con un video suelto; en series, con el del capítulo.
 * Los que solo traen .rar/.iso/extras o un pack sin ese capítulo quedan afuera: TorBox no daría link.
 * Valor: si trae un archivo de subtítulo en español. Solo dice "sí": false no descarta subs adentro del video. */
export async function cached(hashes: string[], s: string | null = null, e: string | null = null): Promise<Map<string, boolean>> {
	const ep = s && e ? episodeRe(s, e) : null;
	const out = new Map<string, boolean>();
	const batches = [];
	for (let i = 0; i < hashes.length; i += 80) batches.push(hashes.slice(i, i + 80));
	const pages = (await Promise.all(batches.map((b) => tb(`/checkcached?hash=${b.join(',')}&format=object&list_files=true`)))) as TbRes<TbCached[] | Record<string, TbCached>>[];
	for (const j of pages) {
		const d = j.data;
		for (const x of Array.isArray(d) ? d : Object.values(d ?? {})) {
			// Sin lista de archivos (formato distinto): se deja, como antes.
			const files: string[] | null = Array.isArray(x.files) ? x.files.map((f) => String(f.name ?? '')) : null;
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
 * `t.orig`: idioma original (ISO 639-1 de TMDB).
 * `file`: hash de OpenSubtitles y tamaño del archivo, para buscar subtítulos hechos para ese archivo.
 * `natives`: subtítulos en español que trae el video; cada uno con su link: el mismo stream (audio en inglés) con ese
 * subtítulo puesto (TorBox lo pone en la imagen). Vacío = no trae.
 * `video`: cuadros por segundo y duración en segundos, para ordenar los subtítulos por cuál calza.
 * `subsEs`: cuántos subtítulos en español trae el video adentro (sin dato si no hubo stream HLS).
 * `ids`: torrent y archivo en TorBox cuando el link es de descarga (plan sin streaming): con eso `tracks` lee las
 * pistas pidiendo un solo link nuevo, sin volver a agregar el torrent. (El link no se reusa: lleva la key adentro.)
 */
export async function link(t: Pick & { orig?: string | null }): Promise<{
	url: string;
	choices?: { key: string; label: string; url: string }[];
	file?: { hash: string; size: string };
	natives?: Native[];
	video?: { fps: number | null; duration: number | null };
	subsEs?: number;
	ids?: { tid: number; fid: number };
}> {
	const { id, file } = await added(t);
	return (await hls(id, file.id, t.name, t.orig ?? null)) ?? { url: await download(id, file), ids: { tid: id, fid: file.id } };
}

/** Subtítulos en español y audios que trae el video adentro, leyendo el encabezado del archivo (primer MB) por el
 * link de descarga: anda en cualquier plan de TorBox. Con `ids` (de un link ya copiado) es un solo pedido a TorBox;
 * sin ellos, agrega el torrent primero. El dato es del torrent y no cambia. */
export async function tracks(t: Pick, ids: { tid: number; fid: number } | null = null): Promise<{ subs: { label: string; kind: string; track: number }[]; audios: { language: string; title: string }[] }> {
	const { id, file } = ids ? { id: ids.tid, file: { id: ids.fid, name: '', size: 0 } } : await added(t);
	const all = await tracksOf(await download(id, file));
	if (!all) throw new Fail(422, 'No pude leer las pistas de este video.');
	const subs = all.filter((x) => x.type === 17);
	return {
		subs: subs
			.map((x, i) => ({ x, i }))
			.filter(({ x }) => isSpanish(x))
			.sort((a, b) => Number(a.x.forced) - Number(b.x.forced))
			.map(({ x, i }) => ({ label: spanishVariant(x.name, x.lang), kind: x.forced ? 'forzados' : 'del video', track: i + 1 })),
		audios: all.filter((x) => x.type === 2).map((x) => ({ language: x.lang, title: x.name }))
	};
}

/** Latinoamérica, España o Español, por el nombre o el código de la pista. */
export const spanishVariant = (name: string, lang: string): string =>
	/lat|419/i.test(name) || /^es-419/i.test(lang) ? 'Latinoamérica' : /spain|españa|castellano|es-es/i.test(name) || /^es-ES/.test(lang) ? 'España' : 'Español';

/** Subtítulos en español de la metadata de createstream, los forzados al final; `i` es su posición entre todos.
 */
export function spanishSubs(subtitles: TbSub[] | undefined) {
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

/** Para "Pegar magnet": el torrent en la caché de TorBox con su nombre y archivos, o null. */
export async function checkFiles(hash: string): Promise<{ name: string; files: { name: string; size: number }[] } | null> {
	const j = (await tb(`/checkcached?hash=${hash}&format=object&list_files=true`)) as TbRes<TbCached[] | Record<string, TbCached>>;
	const d = j.data;
	const x = (Array.isArray(d) ? d : Object.values(d ?? {}))[0];
	return x ? { name: String(x.name ?? ''), files: (x.files ?? []).map((f) => ({ name: String(f.name ?? ''), size: Number(f.size) || 0 })) } : null;
}
/** Para "Pegar magnet": ese torrent en la cuenta (bajándose o bajado), con su avance, o null. */
export async function mine(hash: string) {
	const j = (await tb('/mylist?bypass_cache=true')) as TbRes<TbTorrent[]>;
	const x = (j.data ?? []).find((t) => String(t.hash).toLowerCase() === hash);
	if (!x) return null;
	return {
		name: String(x.name ?? ''),
		finished: !!x.download_finished || x.download_state === 'cached' || x.download_state === 'completed' || x.download_state === 'uploading',
		progress: Number(x.progress) || 0,
		speed: Number(x.download_speed) || 0,
		seeds: Number(x.seeds) || 0,
		eta: Number(x.eta) || 0,
		files: (x.files ?? []).map((f) => ({ name: String(f.name ?? ''), size: Number(f.size) || 0 }))
	};
}
/** Para "Pegar magnet": lo agrega a la cuenta aunque no esté en caché (TorBox lo baja). */
export async function addMagnet(magnet: string): Promise<void> {
	const fd = new FormData();
	fd.set('magnet', magnet);
	const created = (await tb('/createtorrent', { method: 'POST', body: fd })) as TbRes<{ torrent_id?: number; hash?: string }>;
	if (!created.data?.torrent_id && !created.data?.hash) throw new Fail(409, 'TorBox no lo agregó: {d}', { d: created.detail ?? 'sin id' });
}

/** Agrega el torrent a TorBox (solo si está en caché) y elige el archivo de video. */
async function added(t: Pick): Promise<{ id: number; file: TbFile }> {
	const fd = new FormData();
	fd.set('magnet', `magnet:?xt=urn:btih:${t.hash}&dn=${encodeURIComponent(t.name)}`);
	fd.set('add_only_if_cached', 'true');
	const created = (await tb('/createtorrent', { method: 'POST', body: fd })) as TbRes<{ torrent_id?: number }>;
	const id = created.data?.torrent_id;
	if (!id) throw new Fail(409, 'TorBox no lo agregó: {d}', { d: created.detail ?? 'sin id' });
	// Recién agregado, TorBox a veces todavía no lista los archivos: hasta 3 intentos, 1 s entre cada uno.
	let files: TbFile[] = [];
	for (let i = 0; i < 3 && !files.length; i++) {
		if (i) await new Promise((ok) => setTimeout(ok, 1000));
		const list = (await tb(`/mylist?id=${id}&bypass_cache=true`)) as TbRes<{ files?: TbFile[] }>;
		files = (list.data?.files ?? []).filter((f) => VIDEO.test(f.name ?? ''));
	}
	const file = pick(files, t);
	if (!file) throw new Fail(409, 'TorBox todavía no tiene el archivo de video.');
	return { id, file };
}

type Native = { label: string; kind: string; track: number; url: string };

/** ISO 639-1 (TMDB) → códigos de 3 letras que traen las pistas de audio (bibliográfico y terminológico). */
const ISO3: Record<string, string[]> = {
	en: ['eng'], es: ['spa'], fr: ['fre', 'fra'], de: ['ger', 'deu'], it: ['ita'], ja: ['jpn'], ko: ['kor'], pt: ['por'],
	ru: ['rus'], zh: ['chi', 'zho'], hi: ['hin'], tr: ['tur'], pl: ['pol'], nl: ['dut', 'nld'], sv: ['swe'], da: ['dan'],
	no: ['nor', 'nob'], fi: ['fin'], ar: ['ara'], he: ['heb'], th: ['tha'], cs: ['cze', 'ces'], hu: ['hun'], el: ['gre', 'ell'],
	id: ['ind'], uk: ['ukr'], fa: ['per', 'fas'], cn: ['chi', 'zho'], is: ['ice', 'isl'], ro: ['rum', 'ron']
};

/** Stream HLS de TorBox (`.m3u8`): Web Video Caster lo detecta como video (el link de descarga va como
 * `application/octet-stream` y lo abría como texto) y llega en segmentos que la tele reproduce.
 * Audio: el idioma original por defecto (muchos releases traen primero un doblaje ruso); si no está, inglés; si además
 * hay latino, los dos para elegir. null si no se pudo. `orig`: ISO 639-1. */
async function hls(id: number, fileId: number, release: string, orig: string | null) {
	try {
		const base = `/v1/api/stream/createstream?id=${id}&file_id=${fileId}&type=torrent`;
		const stream = async (q: string) => (await tbRoot(q)) as TbRes<TbStream>;
		const first = await stream(base);
		const audios = first.data?.metadata?.audios ?? [];
		// `chosen_audio_index` es la posición entre los audios (el que viene por defecto es 0).
		/** `sub`: posición del subtítulo a poner en el video. */
		const at = async (i: number, sub?: number) =>
			String((i > 0 || sub != null ? await stream(`${base}&chosen_audio_index=${Math.max(i, 0)}${sub != null ? `&chosen_subtitle_index=${sub}` : ''}`) : first).data?.hls_url ?? '');
		// Subtítulos en español del propio video (siempre en sync), los forzados al final.
		const spaSubs = spanishSubs(first.data?.metadata?.subtitles);
		const subsEs = spaSubs.length;
		const d = first.data ?? {};
		const osHash = d.open_subtitles_hash ?? '';
		const file = /^[0-9a-f]{16}$/.test(osHash) && d.size ? { hash: osHash, size: String(d.size) } : undefined;
		const v = d.metadata?.video ?? {};
		const dur = String(v.duration ?? '').match(/^(\d+):(\d+):(\d+)/);
		const video = { fps: Number(v.frame_rate) || null, duration: dur ? Number(dur[1]) * 3600 + Number(dur[2]) * 60 + Number(dur[3]) : null };
		const codes = ISO3[orig ?? ''] ?? [];
		const byOrig = audios.findIndex((a) => codes.includes(a.language));
		const main = byOrig >= 0 ? byOrig : audios.findIndex((a) => a.language === 'eng');
		// shortcut: hasta 4 (un stream por subtítulo, todos se piden ya); si un video trae más, sumar un pedido a demanda.
		const natives: Native[] = (await Promise.all(spaSubs.slice(0, 4).map(async ({ i, label, kind }) => ({
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
 */
export function latinoByName<T>(spa: T[], release: string): T | null {
	const lat = release.search(/latino|\blat\b|latam|dual-lat/i);
	if (lat < 0 || !spa.length) return null;
	if (spa.length === 1) return spa[0];
	const cas = release.search(/castellano|\bcast\b|españa|spain/i);
	return cas >= 0 && cas < lat ? spa[1] : spa[0];
}

/** Link de descarga (respaldo): termina en la extensión para ayudar a los reproductores que miran la URL.
 */
async function download(id: number, file: TbFile): Promise<string> {
	const dl = await tb(`/requestdl?token=${await key()}&torrent_id=${id}&file_id=${file.id}&zip_link=false`);
	if (!String(dl.data ?? '').startsWith('https://')) throw new Fail(502, 'TorBox no dio el link.');
	const ext = String(file.name).match(/\.(mkv|mp4|avi|m4v|mov|webm)$/i)?.[0].toLowerCase() ?? '.mkv';
	return `${dl.data}${String(dl.data).includes('?') ? '&' : '?'}f=video${ext}`;
}

/** El archivo del addon; si no, el del episodio (packs de temporada); si no, el más grande.
 */
export function pick(files: TbFile[], t: { file: string | null; s: string | null; e: string | null }): TbFile | null {
	const name = (f: TbFile) => String(f.short_name ?? f.name).toLowerCase();
	if (t.file) {
		const f = files.find((x) => name(x).endsWith(t.file?.toLowerCase() ?? ''));
		if (f) return f;
	}
	if (t.s && t.e) {
		const re = episodeRe(t.s, t.e);
		const f = files.find((x) => re.test(name(x)));
		if (f) return f;
	}
	return files.reduce<TbFile | null>((a, b) => (!a || b.size > a.size ? b : a), null);
}
