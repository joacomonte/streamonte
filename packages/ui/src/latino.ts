// "Es latino": la única regla de la web y el desktop (la de Rust: `crates/core/src/audio.rs spanish_variant`; golden
// `packages/golden/spanish_variant.json`). Audio, subs, nombre del torrent y web de origen. Sin imports salvo tipos.
import type { LatHint, LatState } from './types.ts';

/** Variante del español por texto libre (título de una pista, nombre de un sub, idioma). */
export type SpanishVariant = 'lat' | 'spain' | 'unknown';

/** Por palabra entera (letras y números): "Collation" o "Platinum" no son latino. Igual que `spanish_variant` de Rust. */
export function spanishVariant(text: string): SpanishVariant {
	const lower = text.toLowerCase();
	const words = lower.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
	const word = (ws: string[]) => words.some((w) => ws.includes(w));
	const prefix = (ps: string[]) => words.some((w) => ps.some((p) => w.startsWith(p)));
	const pair = (a: string, b: string) => words.some((w, i) => w === a && words[i + 1] === b);
	if (word(['lat', 'latam', 'latino', '419', 'méxico']) || prefix(['latinoam', 'mex', 'argentin']) || pair('latin', 'america') || pair('es', 'mx') || pair('es', 'ar')) return 'lat';
	if (word(['castellano', 'castilian', 'españa', 'espana', 'spain', 'europe', 'european']) || pair('es', 'es') || lower.includes('(eu)')) return 'spain';
	return 'unknown';
}

/** Variante de una pista: lo que dicen su código de idioma y su título (latino gana a España). */
export function trackVariant(language: string, title: string): SpanishVariant {
	const v = [spanishVariant(language), spanishVariant(title)];
	return v.includes('lat') ? 'lat' : v.includes('spain') ? 'spain' : 'unknown';
}

/** Lo leído de un torrent: cuántos subs en español trae y su mejor audio en español.
 * `audio`: 'lat' confirmado · 'es' español sin decir cuál · 'spain' castellano · 'none' sin español · null sin leer.
 * `audios`: las pistas tal como vienen (para mostrar qué dicen); falta en lo guardado antes de tenerlas. */
export type Tracks = { subs: number; audio: 'lat' | 'es' | 'spain' | 'none' | null; audios?: { language: string; title: string }[] };

const SPANISH = /^(spa|es)(\b|-|_)/i;

/** El mejor audio en español de las pistas (`language` ISO, `title` libre). */
export function audioOf(audios: { language: string; title: string }[]): Tracks['audio'] {
	const kinds = audios
		.filter((a) => SPANISH.test(a.language))
		.map((a) => {
			const v = trackVariant(a.language, a.title);
			return v === 'lat' ? 'lat' : v === 'spain' ? 'spain' : 'es';
		});
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

// Webs de origen dentro del nombre: solo orientan, no confirman.
export const LAT_SITES = ['cinecalidad', 'verpeliculasonline', 'pelisplus', 'cuevana', 'pelispanda', 'pelismart'];
export const SPAIN_SITES = ['mejortorrent', 'wolfmax4k', 'dontorrent', 'divxtotal', 'elitetorrent'];
/** Qué tan fuerte es cada pista al unir el mismo torrent de varios addons. */
export const HINT_RANK: Record<string, number> = { lat: 3, spain: 2, likely: 1 };

export type LatInput = { release: string; file?: string | null; audio: string[] };
/** Lo leído de un torrent en la biblioteca (desktop): si ya se leyeron las pistas de audio y qué idiomas dieron. */
export type ReadTracks = { audioRead: boolean; languages: string[] };

/** Lo que sugiere el nombre sobre el audio latino: idiomas dichos, o la web de origen. */
export function hintOf(c: LatInput): LatHint | null {
	if (c.audio.includes('lat')) return 'lat';
	if (c.audio.includes('cast')) return 'spain';
	const name = `${c.release} ${c.file ?? ''}`.toLowerCase();
	if (LAT_SITES.some((w) => name.includes(w))) return 'likely';
	if (SPAIN_SITES.some((w) => name.includes(w))) return 'spain';
	return null;
}

/** Estado del audio latino (única regla, igual que `latStatus`): las pistas leídas ganan cuando dicen cuál
 * español es (latino, castellano) o que no hay español; español sin variante no decide: decide el nombre y la web. */
export function latOf(c: LatInput, rows: ReadTracks[]): LatState {
	const read = rows.find((e) => e.audioRead);
	if (read?.languages.includes('lat')) return 'lat';
	if (read?.languages.includes('cast')) return 'spain';
	if (read && !read.languages.includes('es')) return 'none';
	return hintOf(c) ?? 'check';
}
