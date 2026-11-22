import { test } from 'node:test';
import assert from 'node:assert/strict';
import { episodeRe, isSpanishSub, latinoByName, pick, spanishSubs, spanishVariant } from './torbox.js';

test('episodeRe: S01E02, s1e2, 1x02, 01x02; no confunde S01E022 ni S01E20', () => {
	const re = episodeRe('1', '2');
	for (const n of ['Show.S01E02.mkv', 'show s1e2 720p', 'Show 1x02', 'Show 01x02', 'show_S01.E02']) assert.equal(re.test(n), true, n);
	for (const n of ['Show.S01E022.mkv', 'Show.S01E20.mkv', 'Show.S02E02.mkv', 'Show 11x02', 'Show.S01E03']) assert.equal(re.test(n), false, n);
});

test('isSpanishSub: por palabra del nombre y solo extensiones de subtítulo', () => {
	assert.equal(isSpanishSub('Subs/2_Spanish.srt'), true);
	assert.equal(isSpanishSub('x.es-419.srt'), true);
	assert.equal(isSpanishSub('Show.S01E02.spa.ass'), true);
	assert.equal(isSpanishSub('Les.Miserables.eng.srt'), false);
	assert.equal(isSpanishSub('x.spa.mkv'), false);
});

test('latinoByName: sin pista -> null; uno solo; orden latino/castellano', () => {
	const spa = ['a', 'b'];
	assert.equal(latinoByName(spa, 'Peli.1080p.ENG'), null);
	assert.equal(latinoByName([], 'Peli.LATINO'), null);
	assert.equal(latinoByName(['solo'], 'Peli.LATINO'), 'solo');
	assert.equal(latinoByName(spa, 'Peli.ENG.LATINO.CASTELLANO'), 'a');
	assert.equal(latinoByName(spa, 'Peli.ENG.CASTELLANO.LATINO'), 'b');
	assert.equal(latinoByName(spa, 'Peli.LATINO'), 'a');
});

/** @param {string} name @param {number} size @param {string} [short] */
const file = (name, size, short) => ({ id: size, name, size, ...(short ? { short_name: short } : {}) });

test('pick: el del addon, si no el del capítulo, si no el más grande', () => {
	const files = [file('Pack/Show.S01E01.mkv', 100), file('Pack/Show.S01E02.mkv', 50), file('Pack/extra.mkv', 900)];
	assert.equal(pick(files, { file: 'show.s01e01.MKV', s: null, e: null })?.size, 100);
	assert.equal(pick(files, { file: 'no-esta.mkv', s: '1', e: '2' })?.size, 50);
	assert.equal(pick(files, { file: null, s: '1', e: '2' })?.size, 50);
	assert.equal(pick(files, { file: null, s: null, e: null })?.size, 900);
	assert.equal(pick(files, { file: null, s: '1', e: '9' })?.size, 900);
	assert.equal(pick([], { file: null, s: null, e: null }), null);
});

test('pick: usa short_name si hay', () => {
	const files = [file('carpeta/larga/a.mkv', 1, 'Show.S01E03.mkv'), file('b.mkv', 2)];
	assert.equal(pick(files, { file: null, s: '1', e: '3' })?.id, 1);
});

test('spanishVariant: Latinoamérica, España o Español', () => {
	assert.equal(spanishVariant('Latino', 'spa'), 'Latinoamérica');
	assert.equal(spanishVariant('', 'es-419'), 'Latinoamérica');
	assert.equal(spanishVariant('Castellano', 'spa'), 'España');
	assert.equal(spanishVariant('', 'es-ES'), 'España');
	assert.equal(spanishVariant('', 'es'), 'Español');
});

test('spanishSubs: solo spa, forzados al final, `i` = posición entre todos', () => {
	const out = spanishSubs([
		{ language: 'eng', title: 'English' },
		{ language: 'spa', title: 'Spanish [Forced]' },
		{ language: 'spa', title: 'Latino' },
		{ language: 'spa', title: 'Castellano' }
	]);
	assert.deepEqual(out, [
		{ i: 2, forced: false, label: 'Latinoamérica', kind: 'del video' },
		{ i: 3, forced: false, label: 'España', kind: 'del video' },
		{ i: 1, forced: true, label: 'Español', kind: 'forzados' }
	]);
	assert.deepEqual(spanishSubs(undefined), []);
});
