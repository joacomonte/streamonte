import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseName } from './magnet.ts';

test('parseName: serie SxxEyy', () => {
	assert.deepEqual(parseName('The.Bear.S03E02.1080p.WEB-DL.mkv'), { q: 'The Bear', year: null, s: '3', e: '2' });
});

test('parseName: formato 3x04', () => {
	assert.deepEqual(parseName('Los Simpson 3x04 HDTV.avi'), { q: 'Los Simpson', year: null, s: '3', e: '4' });
});

test('parseName: temporada sola (pack)', () => {
	const p = parseName('Breaking.Bad.S02.1080p.BluRay');
	assert.equal(p.q, 'Breaking Bad');
	assert.equal(p.s, '2');
	assert.equal(p.e, null);
});

test('parseName: película con año en puntos o entre paréntesis', () => {
	const a = parseName('Spider-Man.Brand.New.Day.2026.2160p.WEB-DL.DV.mkv');
	assert.equal(a.q, 'Spider-Man Brand New Day');
	assert.equal(a.year, '2026');
	assert.equal(a.s, null);
	const b = parseName('Oppenheimer (2023) [1080p] [YTS]');
	assert.equal(b.q, 'Oppenheimer');
	assert.equal(b.year, '2023');
});

test('parseName: anime con [grupo] adelante', () => {
	assert.deepEqual(parseName('[SubsPlease] Frieren - 05 (1080p) [ABCD1234].mkv'), { q: 'Frieren - 05', year: null, s: null, e: null });
});

test('parseName: sin año ni marcas', () => {
	assert.deepEqual(parseName('Interstellar'), { q: 'Interstellar', year: null, s: null, e: null });
});
