// Audio latino de una opción: lo que dicen sus pistas (si se leyeron) y, si no, lo que dice el nombre.
// Una regla, un lugar: lo usan los badges y la búsqueda del primer buen match.
import type { LatHint, LatState } from './types.ts';

/** Lo leído de un torrent: cuántos subs en español trae y su mejor audio en español.
 * `audio`: 'lat' confirmado · 'es' español sin decir cuál · 'spain' castellano · 'none' sin español · null sin leer.
 * `audios`: las pistas tal como vienen (para mostrar qué dicen); falta en lo guardado antes de tenerlas. */
export type Tracks = { subs: number; audio: 'lat' | 'es' | 'spain' | 'none' | null; audios?: { language: string; title: string }[] };

const SPANISH = /^(spa|es)(\b|-|_)/i;

/** El mejor audio en español de las pistas (`language` ISO, `title` libre). */
export function audioOf(audios: { language: string; title: string }[]): Tracks['audio'] {
	const kinds = audios
		.filter((a) => SPANISH.test(a.language))
		.map((a) => (/^es-419/i.test(a.language) || /lat|latino|latam|419|mex/i.test(a.title) ? 'lat' : /^es-es/i.test(a.language) || /cast|españa|espana|spain|europe/i.test(a.title) ? 'spain' : 'es'));
	return kinds.includes('lat') ? 'lat' : kinds.includes('es') ? 'es' : kinds.includes('spain') ? 'spain' : 'none';
}

/** Estado del audio latino de una opción: la única regla (la usan los badges, el buen match y las listas).
 * - Las pistas leídas ganan cuando dicen cuál español es (latino, de España) o que no hay español.
 * - "spa" sin variante no decide: decide el nombre (o la web de origen) del torrent. */
export function latStatus(t: { hint: LatHint | null }, info: Tracks | null | undefined): LatState {
	const read = info?.audio;
	if (read === 'lat' || read === 'spain' || read === 'none') return read;
	return t.hint ?? 'check';
}

/** Texto, explicación corta (globito) y larga (title) de cada estado. */
export const LAT_BADGE: Record<LatState, { text: string; tip: string; title: string }> = {
	lat: { text: 'LAT', tip: 'Tiene audio latino', title: 'Audio latino: lo dicen las pistas del video o el nombre del torrent' },
	likely: { text: 'LAT?', tip: 'Probablemente latino', title: 'Probablemente latino: viene de una web latina, pero no lo pudimos confirmar. Abrilo y probá el audio.' },
	spain: { text: 'Gallego', tip: 'Español de España', title: 'Gallego: español de España, no latino' },
	check: { text: 'Probar manualmente', tip: 'Abrilo y probá el audio', title: 'No pudimos confirmar si es español latino o de España. Abrilo y probá el audio.' },
	none: { text: 'LAT', tip: 'No trae audio latino', title: 'Leído: no trae audio latino' }
};
