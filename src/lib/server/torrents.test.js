import { test } from 'node:test';
import assert from 'node:assert/strict';
import { merge, otherFilm, parse, size, words } from './torrents.js';

const H1 = 'a'.repeat(40);
const H2 = 'b'.repeat(40);
/** @param {string} title @param {Record<string, unknown>} [extra] */
const stream = (title, extra = {}) => ({ infoHash: H1.toUpperCase(), title, ...extra });
/** @param {Parameters<typeof parse>[0]} s */
const must = (s) => /** @type {NonNullable<ReturnType<typeof parse>>} */ (parse(s, 'Test'));

test('size: "2.1 GB", coma decimal, MB y basura', () => {
	assert.equal(size('2.1 GB'), Math.round(2.1 * 1024 ** 3));
	assert.equal(size('1,5 GiB'), Math.round(1.5 * 1024 ** 3));
	assert.equal(size('700 MB'), 700 * 1024 ** 2);
	assert.equal(size('nada'), null);
	assert.equal(size(undefined), null);
});

test('parse: hash inválido -> null, válido en minúscula', () => {
	assert.equal(parse({ infoHash: 'xyz', title: 'a' }, 'T'), null);
	assert.equal(parse({ title: 'a' }, 'T'), null);
	assert.equal(must(stream('a')).hash, H1);
});

test('parse: resolución, HDR/DV, fuente, códec, seeds y tamaño', () => {
	const t = must(stream('Movie.2024.2160p.UHD.BluRay.REMUX.HDR10.DV.HEVC.Atmos-GRP\n👤 120 💾 2.1 GB ⚙️ Site'));
	assert.equal(t.res, '2160p');
	assert.deepEqual(t.hdr, ['HDR', 'DV']);
	assert.equal(t.source, 'REMUX');
	assert.equal(t.codec, 'HEVC');
	assert.equal(t.atmos, true);
	assert.equal(t.cam, false);
	assert.equal(t.seeds, 120);
	assert.equal(t.size, Math.round(2.1 * 1024 ** 3));
	assert.deepEqual(t.addons, ['Test']);
});

test('parse: otras resoluciones y fuentes', () => {
	assert.equal(must(stream('x 1080p WEB-DL x264')).res, '1080p');
	assert.equal(must(stream('x 1080p WEB-DL x264')).source, 'WEB-DL');
	assert.equal(must(stream('x 720p WEBRip')).source, 'WEBRip');
	assert.equal(must(stream('x 480p DVDRip')).source, 'DVDRip');
	assert.equal(must(stream('x 1080p HDTV')).source, 'HDTV');
	assert.equal(must(stream('x Blu-ray 4k')).source, 'BluRay');
	assert.equal(must(stream('x 4k')).res, '2160p');
	assert.equal(must(stream('x')).res, null);
	assert.equal(must(stream('x HDR10+ DoVi')).hdr.join(), 'HDR,DV');
});

test('parse: copias de cine son cam y su fuente es CAM', () => {
	for (const n of ['x HDCAM', 'x 1080p TS', 'x HD-Pre', 'x HDTSCR', 'x TELESYNC']) {
		const t = must(stream(n));
		assert.equal(t.cam, true, n);
		assert.equal(t.source, 'CAM', n);
	}
	assert.equal(must(stream('Camino.a.casa 1080p')).cam, false);
});

test('parse: pista de idioma lat / spain / likely', () => {
	assert.equal(must(stream('x Latino 1080p')).hint, 'lat');
	assert.equal(must(stream('x ES-419')).hint, 'lat');
	assert.equal(must(stream('x', { name: '🇲🇽' })).hint, 'lat');
	assert.equal(must(stream('x Castellano')).hint, 'spain');
	assert.equal(must(stream('x 🇪🇸')).hint, 'spain');
	assert.equal(must(stream('x mejortorrent')).hint, 'spain');
	assert.equal(must(stream('x cinecalidad')).hint, 'likely');
	assert.equal(must(stream('x English')).hint, null);
});

test('parse: spa (trae español) y multi', () => {
	assert.equal(must(stream('x MULTI')).spa, true);
	assert.equal(must(stream('x MULTI')).multi, true);
	assert.equal(must(stream('x Dual')).spa, true);
	assert.equal(must(stream('x Spanish')).spa, true);
	assert.equal(must(stream('x Spanish')).multi, false);
	assert.equal(must(stream('x English')).spa, false);
});

test('parse: behaviorHints (filename, videoSize) y release 📄', () => {
	const t = must(stream('📄 Real.Name.1080p\n💾 1 GB', { behaviorHints: { filename: 'f.mkv', videoSize: 5000 } }));
	assert.equal(t.release, 'Real.Name.1080p');
	assert.equal(t.file, 'f.mkv');
	assert.equal(t.size, 5000);
	assert.equal(must(stream('x\n💾 1 GB', { behaviorHints: { videoSize: 0 } })).size, 1024 ** 3);
	assert.equal(must({ infoHash: H1, name: 'N' }).release, 'N');
});

test('words: sin tildes, mayúsculas ni conectores', () => {
	assert.deepEqual(words('El Señor de los Anillos: The Return'), ['senor', 'anillos', 'return']);
});

test('otherFilm: año distinto o pocas palabras del título', () => {
	const want = { titles: ['The Matrix', 'Matrix'], year: 1999 };
	assert.equal(otherFilm('The.Matrix.1999.1080p', want), false);
	assert.equal(otherFilm('The.Matrix.2000.1080p', want), false); // ±1
	assert.equal(otherFilm('The.Matrix.Resurrections.2021.1080p', want), true);
	assert.equal(otherFilm('Other.Film.1999.1080p', want), true);
	assert.equal(otherFilm('The.Matrix.1080p', want), false); // sin año y mismo título
	assert.equal(otherFilm('Whatever', { titles: [], year: null }), false);
});

test('merge: une por hash, suma lo mejor y filtra cam / otra película / null', () => {
	const a = must({ infoHash: H1, title: 'Peli 2020 1080p\n👤 10', name: 'A' });
	const b = { ...must({ infoHash: H1, title: 'Peli 2020 1080p\n👤 50 💾 1 GB MULTI Latino', behaviorHints: { filename: 'p.mkv' } }), addons: ['B'] };
	const c = { ...b, addons: ['A'] };
	const cam = must({ infoHash: H2, title: 'Peli 2020 HDCAM' });
	const other = must({ infoHash: 'c'.repeat(40), title: 'Otra.Cosa.2020' });
	const out = merge([[a, null, cam], [b, c], [other]], { titles: ['Peli'], year: 2020 });
	assert.deepEqual([...out.keys()], [H1]);
	const m = /** @type {NonNullable<ReturnType<typeof out.get>>} */ (out.get(H1));
	assert.equal(m.seeds, 50);
	assert.equal(m.size, 1024 ** 3);
	assert.equal(m.file, 'p.mkv');
	assert.equal(m.hint, 'lat');
	assert.equal(m.spa, true);
	assert.deepEqual(m.addons, ['Test', 'B', 'A']);
});

test('merge: la pista más fuerte gana, nunca baja', () => {
	const lat = must({ infoHash: H1, title: 'x Latino' });
	const spain = must({ infoHash: H1, title: 'x Castellano' });
	assert.equal(/** @type {{hint: string | null}} */ (merge([[spain], [lat]]).get(H1)).hint, 'lat');
	const first = must({ infoHash: H1, title: 'x Latino' });
	const second = must({ infoHash: H1, title: 'x Castellano' });
	assert.equal(/** @type {{hint: string | null}} */ (merge([[first], [second]]).get(H1)).hint, 'lat');
});
