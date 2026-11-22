// Ranking de opciones de torrents: una sola regla para la web y el desktop (antes `torrent-rank.ts` y `options-rank.js`).
// Puro: sin DOM ni estado global; lo que dependía del estado de cada app llega por parámetro.
import type { LatHint, LatState } from './types.ts';

// ---------- Calidad y bitrate ----------
/** Calidad de imagen por la fuente del release: [nombre, estrellas de 4]. */
export const QUALITY: Record<string, [string, number]> = {
	REMUX: ['Máster', 4],
	BluRay: ['Blu-ray', 3],
	'WEB-DL': ['Streaming', 2],
	WEBRip: ['Streaming', 2],
	WEB: ['Streaming', 2],
	HDTV: ['TV', 1],
	DVDRip: ['DVD', 1]
};
/** Estrellas por fuente (QUALITY + la de cine, que el desktop muestra aparte). */
export const QUALITY_STARS: Record<string, number> = { ...Object.fromEntries(Object.entries(QUALITY).map(([k, v]) => [k, v[1]])), CAM: 1 };

/** Mbps típicos por resolución cuando no se sabe cuánto pide (pack sin analizar): un 4K web anda en 15–25, un 1080p en 5–10. */
export const TYPICAL_MBPS: Record<string, number> = { '2160p': 25, '1440p': 14, '1080p': 8, '720p': 4 };
export const toMbps = (bytesPerSec: number): number => (bytesPerSec * 8) / 1e6;
/** Mbps típicos de una resolución (3 si no se conoce). */
export const typicalMbps = (resolution: string | null | undefined): number => (resolution ? TYPICAL_MBPS[resolution] : undefined) ?? 3;
/** Mbps que pide una opción para verse sin cortes: `bps` (peso ÷ duración); sin dato, lo típico de su resolución. */
export const mbpsOf = (resolution: string | null | undefined, bps: number | null): number => (bps ? toMbps(bps) : typicalMbps(resolution));

/** Bytes/s que hay que bajar sostenidos para verlo sin cortes = archivo ÷ duración (la real si se analizó, si no la de la
 * ficha en minutos). `null` sin alguno de los dos. */
export function neededBps(bytes: number | null, durationSecs: number | null | undefined, runtimeMin: number | null | undefined): number | null {
	const secs = durationSecs ?? (runtimeMin ? runtimeMin * 60 : undefined);
	return bytes && secs ? bytes / secs : null;
}

/** Lo mínimo de una opción para ordenarla por calidad. */
export type QualityInput = { resolution: string | null; sizeBytes: number | null; source: string | null };
/** Bitrate que pide la opción en Mbps: peso ÷ duración de la ficha (minutos); sin alguno de los dos, lo típico. */
export const optionMbps = (o: QualityInput, runtimeMin: number | null | undefined): number => mbpsOf(o.resolution, neededBps(o.sizeBytes, null, runtimeMin));

/** Para "Mejor imagen": las estrellas; sin dato, entre Streaming y Blu-ray; la de cine, la última. */
export const qualityRank = (c: { source?: string | null }): number => (c.source === 'CAM' ? 0 : (c.source ? QUALITY_STARS[c.source] : undefined) ?? 2.5);

/** De mejor a peor (web): sin peso al final, más bitrate (más imagen por segundo; la resolución sola no dice cuánto se
 * comprimió) y, a igual bitrate, la de mejor calidad de imagen. */
export const byQuality = (a: QualityInput, b: QualityInput, runtimeMin: number | null | undefined): number =>
	Number(!a.sizeBytes) - Number(!b.sizeBytes) || optionMbps(b, runtimeMin) - optionMbps(a, runtimeMin) || qualityRank(b) - qualityRank(a);

/** Resolución con nombre propio (2160p, 1440p = "2K", 1080p, 720p) o 'other'. */
export const resOf = (resolution: string | null): string => (resolution === '2160p' || resolution === '1440p' || resolution === '1080p' || resolution === '720p' ? resolution : 'other');

// ---------- Audio latino por nombre y pistas leídas ----------
// Webs de origen dentro del nombre: solo orientan, no confirman.
const LAT_SITES = ['cinecalidad', 'verpeliculasonline', 'pelisplus', 'cuevana', 'pelispanda', 'pelismart'];
const SPAIN_SITES = ['mejortorrent', 'wolfmax4k', 'dontorrent', 'divxtotal', 'elitetorrent'];

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

/** Estado del audio latino (única regla, igual que `latStatus` de audio.ts): las pistas leídas ganan cuando dicen cuál
 * español es (latino, castellano) o que no hay español; español sin variante no decide: decide el nombre y la web. */
export function latOf(c: LatInput, rows: ReadTracks[]): LatState {
	const read = rows.find((e) => e.audioRead);
	if (read?.languages.includes('lat')) return 'lat';
	if (read?.languages.includes('cast')) return 'spain';
	if (read && !read.languages.includes('es')) return 'none';
	return hintOf(c) ?? 'check';
}

// ---------- Orden de las opciones del desktop ----------
export type CountedEntry = { reached?: boolean; peers?: number };

/** Grupo para ordenar: 2 = analizado a fondo (arriba), 1 = el resto, 0,5 = sin respuesta pero con peers conocidos, 0 = nadie
 * lo comparte. `n` = lo contado de ese torrent (undefined si no se contó). */
export const tierOf = (n: CountedEntry | undefined): number => (!n ? 1 : n.reached !== false ? 2 : n.peers ? 0.5 : 0);

/** Lo que `rankOptions` lee de la salud de una opción. */
export type HealthLevel = { shown: number; probable: boolean };

/** Lo que `rankOptions` lee del mundo (todo por función, para no tocar estado global). */
export type RankEnv<C> = {
	torbox: boolean;
	mode: 'quality' | 'fast';
	health: (c: C) => HealthLevel | null;
	fits: (c: C) => boolean;
	tierOf: (c: C) => number;
	reached: (c: C) => boolean | undefined;
	knownSeeds: (c: C) => number | null;
	leechersOf: (c: C) => number | null;
	quickGroup: (c: C) => number;
	advancing: (c: C) => { seeds: number } | null;
	mbpsOf: (c: C) => number;
	isMatch: (c: C) => boolean;
	pinPlaying: (list: C[]) => C[];
	sizeOf: (c: C) => number | null;
	sourceOf: (c: C) => string | null;
};

/** Orden de las opciones, recalculado en cada redibujo. Antes del test manda la conexión: el veredicto de salud y, sin
 * veredicto, la gente que comparte (seeds, después leechers). "Mejor imagen": arriba las testeadas que andan fluidas, por
 * calidad de imagen; después todo por conexión. "Arranca más rápido": todo por conexión. Al final, siempre: las que no
 * entran en el disco y las que nadie respondió. El peso nunca ordena. Arriba de todo va lo que se reproduce o baja. `best`
 * = la primera que entra, no es de cine y anda fluida. Con TorBox (se ve desde sus servidores) todo va por bitrate. */
export function rankOptions<C>(cands: C[], env: RankEnv<C>): { list: C[]; best: C | null } {
	const { health, fits, tierOf: tier, reached, knownSeeds, leechersOf, quickGroup, advancing, mode, sizeOf, sourceOf } = env;
	if (env.torbox) {
		// Sin peso (o de cine) no se sabe cuánto pide: al final. A igual bitrate, la de mejor calidad de imagen.
		const unknown = (c: C): number => Number(sizeOf(c) == null || sourceOf(c) === 'CAM');
		const list = [...cands].sort((a, b) => unknown(a) - unknown(b) || env.mbpsOf(b) - env.mbpsOf(a) || qualityRank({ source: sourceOf(b) }) - qualityRank({ source: sourceOf(a) }));
		return { list: env.pinPlaying(list), best: list.find(env.isMatch) ?? null };
	}
	const lvl = new Map<C, number>(cands.map((c) => { const h = health(c); return [c, h ? h.shown + (h.probable ? 0.5 : 0) : 1.75]; }));
	const level = (c: C): number => lvl.get(c) ?? 1.75;
	const byConnection = (a: C, b: C): number => level(a) - level(b) || (knownSeeds(b) ?? -1) - (knownSeeds(a) ?? -1) || (leechersOf(b) ?? -1) - (leechersOf(a) ?? -1);
	const tail = (c: C): number => (tier(c) < 1 ? 3 : !fits(c) ? 2 : 0);
	const proven = (c: C): boolean => !!reached(c) && level(c) === 0;
	const q = (c: C): number => qualityRank({ source: sourceOf(c) });
	// Prueba en curso que ya pasó a contar seeds reales: arriba de todo mientras dura, con más seeds primero.
	const group = (c: C): number => (advancing(c) ? -1 : tail(c) ? 10 + tail(c) : mode === 'quality' && proven(c) ? 0 : 1 + quickGroup(c));
	const list = [...cands].sort((a, b) => group(a) - group(b)
		|| (group(a) === -1 ? (advancing(b)?.seeds ?? 0) - (advancing(a)?.seeds ?? 0) : 0)
		|| (mode === 'quality' && group(a) === 0 ? q(b) - q(a) : 0)
		|| byConnection(a, b));
	const best = list.find((c) => fits(c) && sourceOf(c) !== 'CAM' && level(c) === 0) ?? null;
	return { list: env.pinPlaying(list), best };
}
