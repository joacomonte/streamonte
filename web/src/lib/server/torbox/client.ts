// Cliente de TorBox: los pedidos con la key, los tipos de sus respuestas, "en caché", "mi cuenta" y agregar un torrent.
import { Fail } from '../http-route.ts';
import { get } from '../fetch.ts';
import { key as configKey } from '../config.ts';

const ROOT = 'https://api.torbox.app';
export const VIDEO = /\.(mkv|mp4|avi|m4v|mov|webm)$/i;
const SUB = /\.(srt|ass|ssa|vtt)$/i;
const SPANISH = new Set(['es', 'spa', 'spanish', 'español', 'espanol', 'esp', 'castellano', 'latino']);

/** ¿Es un archivo de subtítulo en español por el nombre? (`x.spa.srt`, `2_Spanish.srt`, `x.es-419.srt`; como `lang_from_name` del desktop). */
export const isSpanishSub = (path: string): boolean =>
	SUB.test(path) && (path.split('/').pop() ?? '').toLowerCase().replace(SUB, '').split(/[^a-z0-9ñ]+/).some((w) => SPANISH.has(w));

/** Respuestas de TorBox: solo los campos que se leen. `data` cambia según el endpoint (`T`). */
export type TbRes<T> = { data?: T; detail?: string; error?: string };
export type TbFile = { id: number; name: string; short_name?: string; size: number };
export type TbCached = { hash?: string; name?: string; files?: TbFile[] };
export type TbTorrent = { hash: string; name?: string; files?: TbFile[]; download_finished?: boolean; download_state?: string; progress?: number; download_speed?: number; seeds?: number; eta?: number };
export type TbSub = { language?: string; title?: string };
export type TbAudio = { language: string; title?: string };
export type TbStream = { metadata?: { audios?: TbAudio[]; subtitles?: TbSub[]; video?: { duration?: string; frame_rate?: string | number } }; hls_url?: string; open_subtitles_hash?: string; size?: number };
/** El torrent y qué video elegir de él (lo que piden `link`, `tracks` y `added`). */
export type Pick = { hash: string; name: string; file: string | null; s: string | null; e: string | null };

export async function key(): Promise<string> {
	const k = await configKey('torbox');
	if (!k) throw new Fail(428, 'Falta la key de TorBox: cargala en Ajustes.');
	return k;
}

export const tb = (path: string, init: RequestInit = {}) => tbRoot(`/v1/api/torrents${path}`, init);

/** `path`: ruta desde `/v1/api` (incluida). */
export async function tbRoot(path: string, init: RequestInit = {}): Promise<TbRes<unknown>> {
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
export async function added(t: Pick): Promise<{ id: number; file: TbFile }> {
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

/** Link de descarga (respaldo): termina en la extensión para ayudar a los reproductores que miran la URL.
 */
export async function download(id: number, file: TbFile): Promise<string> {
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

