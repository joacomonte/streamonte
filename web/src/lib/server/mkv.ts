// Pistas de un MKV leyendo solo su principio (Range 0–1 MB): el bloque Tracks va al comienzo del archivo.
// Sirve con el link de descarga (plan Essential de TorBox), sin el stream que solo da Pro.
import { get } from './http.ts';

const HEAD = 1024 * 1024;
const SEGMENT = 0x18538067, TRACKS = 0x1654ae6b, ENTRY = 0xae, TYPE = 0x83, CODEC = 0x86, FORCED = 0x55aa, NAME = 0x536e, LANG = 0x22b59c, BCP47 = 0x22b59d;

/** Entero de largo variable de EBML (id con el marcador, tamaño sin él). */
function vint(b: Buffer, at: number, keepMarker: boolean): { v: number; len: number; unknown: boolean } | null {
	const first = b[at];
	if (first === undefined) return null;
	let len = 1;
	while (len <= 8 && !(first & (0x80 >> (len - 1)))) len++;
	if (len > 8 || at + len > b.length) return null;
	let v = keepMarker ? first : first & (0xff >> len);
	let unknown = v === (0xff >> len);
	for (let i = 1; i < len; i++) {
		v = v * 256 + b[at + i];
		if (b[at + i] !== 0xff) unknown = false;
	}
	return { v, len, unknown: !keepMarker && unknown };
}

/** Hijos directos de [start, end). */
function* children(b: Buffer, start: number, end: number): Generator<{ id: number; body: number; end: number }> {
	let at = start;
	while (at < end) {
		const id = vint(b, at, true);
		const size = id && vint(b, at + id.len, false);
		if (!id || !size) return;
		const body = at + id.len + size.len;
		const stop = size.unknown ? end : Math.min(body + size.v, end);
		yield { id: id.v, body, end: stop };
		if (size.unknown) return;
		at = body + size.v;
	}
}

export type Track = { type: number; lang: string; name: string; forced: boolean; codec: string };
/** Pistas del encabezado, o null si no es MKV o el bloque Tracks no está en el primer MB. */
export function parseTracks(b: Buffer): Track[] | null {
	const seg = [...children(b, 0, b.length)].find((e) => e.id === SEGMENT);
	const tracks = seg && [...children(b, seg.body, seg.end)].find((e) => e.id === TRACKS);
	if (!tracks || tracks.end > b.length) return null;
	return [...children(b, tracks.body, tracks.end)]
		.filter((e) => e.id === ENTRY)
		.map((e) => {
			const t: Track = { type: 0, lang: 'eng', name: '', forced: false, codec: '' };
			let bcp = '';
			for (const f of children(b, e.body, e.end)) {
				const raw = b.subarray(f.body, f.end);
				if (f.id === TYPE) t.type = raw.readUIntBE(0, raw.length || 1);
				else if (f.id === FORCED) t.forced = raw.length > 0 && raw.readUIntBE(0, raw.length) === 1;
				else if (f.id === NAME) t.name = raw.toString('utf8');
				else if (f.id === CODEC) t.codec = raw.toString('latin1').replace(/\0+$/, '');
				else if (f.id === LANG) t.lang = raw.toString('latin1').replace(/\0+$/, '');
				else if (f.id === BCP47) bcp = raw.toString('latin1').replace(/\0+$/, '');
			}
			if (bcp) t.lang = bcp;
			return t;
		});
}

/** Pistas de un video por su link (pide solo el primer MB). null si no se pudo leer. */
export async function tracksOf(url: string): Promise<Track[] | null> {
	const r = await get(url, { headers: { range: `bytes=0-${HEAD - 1}` } }, 15_000).catch(() => null);
	if (!r || (r.status !== 206 && r.status !== 200)) return null;
	const reader = r.body?.getReader();
	if (!reader) return null;
	const parts: Uint8Array[] = [];
	let n = 0;
	// Si el servidor ignora el Range (200), se corta en 1 MB igual.
	while (n < HEAD) {
		const { done, value } = await reader.read();
		if (done) break;
		parts.push(value);
		n += value.length;
	}
	reader.cancel().catch(() => {});
	return parseTracks(Buffer.concat(parts).subarray(0, HEAD));
}

/** ¿Pista en español? (`spa`, `es`, `es-419`, `es-ES`…). */
export const isSpanish = (t: Track): boolean => t.lang === 'spa' || /^es(\b|-)/i.test(t.lang);
