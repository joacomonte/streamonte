import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isSpanish, parseTracks } from './mkv.ts';

/** Elemento EBML: id (bytes) + tamaño de 2 bytes + cuerpo. */
const el = (id: number[], ...body: (Buffer | number[])[]) => {
	const data = Buffer.concat(body.map((b) => Buffer.from(b)));
	return Buffer.concat([Buffer.from(id), Buffer.from([0x40 | (data.length >> 8), data.length & 0xff]), data]);
};
const TRACK_ENTRY = [0xae], TYPE = [0x83], HI = [0x55, 0xab], DEFAULT = [0x88], FORCED = [0x55, 0xaa], NAME = [0x53, 0x6e], LANG = [0x22, 0xb5, 0x9c], BCP47 = [0x22, 0xb5, 0x9d];
const SEGMENT = [0x18, 0x53, 0x80, 0x67], TRACKS = [0x16, 0x54, 0xae, 0x6b], EBML = [0x1a, 0x45, 0xdf, 0xa3];

const audio = el(TRACK_ENTRY, el(TYPE, [2]), el(LANG, Buffer.from('spa\0')), el(NAME, Buffer.from('Latino')));
const sub = el(TRACK_ENTRY, el(TYPE, [17]), el(LANG, Buffer.from('eng')), el(BCP47, Buffer.from('es-419')), el(FORCED, [1]));
const tracks = el(TRACKS, audio, sub);
const mkv = Buffer.concat([el(EBML, [0x42, 0x82, 0x84, 0x77, 0x65, 0x62, 0x6d]), el(SEGMENT, tracks)]);

test('parseTracks: lee tipo, idioma (BCP47 pisa al ISO), nombre y forzado', () => {
	assert.deepEqual(parseTracks(mkv), [
		{ type: 2, lang: 'spa', name: 'Latino', forced: false, sdh: false, default: true, codec: '' },
		{ type: 17, lang: 'es-419', name: '', forced: true, sdh: false, default: true, codec: '' }
	]);
});

test('parseTracks: FlagHearingImpaired y FlagDefault (default vale true si falta)', () => {
	const entry = (...x: Buffer[]) => el(TRACK_ENTRY, el(TYPE, [17]), ...x);
	const b = Buffer.concat([el(EBML, [0]), el(SEGMENT, el(TRACKS, entry(), entry(el(HI, [1]), el(DEFAULT, [0]))))]);
	const t = parseTracks(b)!;
	assert.deepEqual([t[0].sdh, t[0].default, t[1].sdh, t[1].default], [false, true, true, false]);
});

test('parseTracks: pista sin idioma queda en eng', () => {
	const bare = Buffer.concat([el(EBML, [0]), el(SEGMENT, el(TRACKS, el(TRACK_ENTRY, el(TYPE, [1]))))]);
	assert.deepEqual(parseTracks(bare), [{ type: 1, lang: 'eng', name: '', forced: false, sdh: false, default: true, codec: '' }]);
});

test('parseTracks: no es MKV, vacío o cortado antes de Tracks -> null', () => {
	assert.equal(parseTracks(Buffer.from('esto no es un mkv, ni cerca')), null);
	assert.equal(parseTracks(Buffer.alloc(0)), null);
	// Corte justo después del encabezado del Segment: no hay Tracks que leer.
	const cut = mkv.subarray(0, mkv.indexOf(Buffer.from(SEGMENT)) + 4 + 2);
	assert.equal(parseTracks(cut), null);
});

test('parseTracks: Segment de tamaño desconocido (0x01FFFFFFFFFFFFFF)', () => {
	const unknown = Buffer.concat([Buffer.from(SEGMENT), Buffer.from([0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]), tracks]);
	assert.equal(parseTracks(unknown)?.length, 2);
});

test('isSpanish: spa, es, es-419, es-ES; no eng ni "esp"', () => {
	const t = (lang: string) => ({ type: 2, lang, name: '', forced: false, sdh: false, default: true, codec: '' });
	for (const l of ['spa', 'es', 'es-419', 'ES-es']) assert.equal(isSpanish(t(l)), true, l);
	for (const l of ['eng', 'est', 'esp']) assert.equal(isSpanish(t(l)), false, l);
});
