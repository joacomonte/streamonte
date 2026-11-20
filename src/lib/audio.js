// Audio latino de una opción: lo que dicen sus pistas (si se leyeron) y, si no, lo que dice el nombre.
// Una regla, un lugar: lo usan los badges y la búsqueda del primer buen match (Torrents.svelte).

/** Lo leído de un torrent: cuántos subs en español trae y su mejor audio en español.
 * `audio`: 'lat' confirmado · 'es' español sin decir cuál · 'spain' castellano · 'none' sin español · null sin leer.
 * `audios`: las pistas tal como vienen (para mostrar qué dicen); falta en lo guardado antes de tenerlas.
 * @typedef {{subs: number, audio: 'lat' | 'es' | 'spain' | 'none' | null, audios?: {language: string, title: string}[]}} Tracks */

const SPANISH = /^(spa|es)(\b|-|_)/i;

/** El mejor audio en español de las pistas (`language` ISO, `title` libre). @param {{language: string, title: string}[]} audios @returns {Tracks['audio']} */
export function audioOf(audios) {
	const kinds = audios
		.filter((a) => SPANISH.test(a.language))
		.map((a) => (/^es-419/i.test(a.language) || /lat|latino|latam|419|mex/i.test(a.title) ? 'lat' : /^es-es/i.test(a.language) || /cast|españa|espana|spain|europe/i.test(a.title) ? 'spain' : 'es'));
	return kinds.includes('lat') ? 'lat' : kinds.includes('es') ? 'es' : kinds.includes('spain') ? 'spain' : 'none';
}
console.assert(
	audioOf([{ language: 'spa', title: 'Latino DD 5.1' }]) === 'lat' &&
		audioOf([{ language: 'es-419', title: '' }]) === 'lat' &&
		audioOf([{ language: 'spa', title: 'Castellano' }]) === 'spain' &&
		audioOf([{ language: 'spa', title: 'AC3 5.1' }]) === 'es' &&
		audioOf([{ language: 'eng', title: '' }]) === 'none',
	'audioOf'
);


/** Badge de audio: LAT confirmado (verde) y LAT según el nombre (gris punteado) informan; "ES" (español de España:
 * al tocarlo dice "Gallego") y "¿Trae latino? Revisar" (MULTI / Dual sin leer).
 * null si no hay nada que decir.
 * @param {{lat: boolean, doubt?: boolean}} t @param {Tracks | null | undefined} info
 * @returns {{kind: 'lat' | 'name' | 'es' | 'doubt', text: string, title: string} | null} */
export function latBadge(t, info) {
	if (info?.audio === 'lat') return { kind: 'lat', text: 'LAT', title: 'Audio latino confirmado en las pistas del video' };
	if (info?.audio === 'es' || info?.audio === 'spain') return { kind: 'es', text: 'ES', title: 'Gallego: español de España, no latino' };
	if (info?.audio) return null;
	if (t.lat) return { kind: 'name', text: 'LAT', title: 'Latino según el nombre del torrent: si el nombre miente, no lo trae' };
	if (t.doubt) return { kind: 'doubt', text: '¿Trae latino? Revisar', title: 'MULTI / Dual sin aclarar: validar audio latino' };
	return null;
}
