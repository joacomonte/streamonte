// El link https del video: agrega el torrent a TorBox y pide el stream HLS (con audios y subtítulos) o, sin streaming
// en el plan, el link de descarga.
import { Fail } from '../http-route.ts';
import { lang, tx } from '../lang.ts';
import { added, download, tbRoot } from './client.ts';
import type { Pick, TbRes, TbStream } from './client.ts';
import { spanishSubs } from './tracks.ts';
import { trackVariant } from '../../../../../packages/ui/src/latino.ts';

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
		const lat = spa.find(({ a }) => trackVariant('', a.title ?? '') === 'lat') ?? latinoByName(spa, release);
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

