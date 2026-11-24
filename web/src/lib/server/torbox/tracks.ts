// Pistas del video: subtítulos y audios que trae adentro, y cuáles son en español (Latinoamérica, España o Español).
import { Fail } from '../http-route.ts';
import { isSpanish, tracksOf } from '../mkv.ts';
import { added, download } from './client.ts';
import type { Pick, TbSub } from './client.ts';
import { trackVariant } from '../../../../../packages/ui/src/latino.ts';

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
export const spanishVariant = (name: string, lang: string): string => {
	const v = trackVariant(lang, name);
	return v === 'lat' ? 'Latinoamérica' : v === 'spain' ? 'España' : 'Español';
};

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
			label: spanishVariant(x.title ?? '', ''),
			kind: forced ? 'forzados' : 'del video'
		}));
}

