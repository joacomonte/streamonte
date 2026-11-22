import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Torrent } from './types.ts';
import { byQuality, groupOf, level, mbpsOf, rank, resOf, sourceOf, TYPICAL } from './torrent-rank.ts';

const tor = (o: Partial<Torrent>): Torrent => ({ hash: '', release: '', file: null, res: null, hdr: [], source: null, hint: null, multi: false, spa: false, size: null, seeds: 0, addons: [], subFile: false, ...o });
const sub = { id: '', latino: false, format: '', downloads: 0 };
const GB = 1024 ** 3;

test('resOf: 2160p, 1440p (2K), 1080p y 720p propias; el resto cae en other', () => {
	assert.equal(resOf(tor({ res: '2160p' })), '2160p');
	assert.equal(resOf(tor({ res: '720p' })), '720p');
	assert.equal(resOf(tor({ res: '1440p' })), '1440p');
	assert.equal(resOf(tor({ res: '480p' })), 'other');
	assert.equal(resOf(tor({ res: null })), 'other');
});

test('mbpsOf: peso ÷ duración; sin alguno de los dos, lo típico por resolución', () => {
	assert.equal(mbpsOf(tor({ size: 75e6, res: '1080p' }), 10), 1); // 75 MB en 10 min = 1 Mbps
	assert.equal(mbpsOf(tor({ size: 10 * GB, res: '1080p' }), null), TYPICAL['1080p']);
	assert.equal(mbpsOf(tor({ size: null, res: '2160p' }), 120), TYPICAL['2160p']);
	assert.equal(mbpsOf(tor({ size: null, res: '1440p' }), null), 14);
	assert.equal(TYPICAL['1440p'], 14);
});

test('byQuality: sin peso al final, más bitrate primero, desempata la fuente', () => {
	const noSize = tor({ hash: 'n', res: '2160p' });
	const big = tor({ hash: 'big', size: 20 * GB });
	const small = tor({ hash: 'small', size: 5 * GB });
	assert.deepEqual([noSize, small, big].sort((a, b) => byQuality(a, b, 120)).map((t) => t.hash), ['big', 'small', 'n']);
	// mismo bitrate: gana la mejor fuente
	const a = tor({ size: 8 * GB, source: 'HDTV' });
	const b = tor({ size: 8 * GB, source: 'REMUX' });
	assert.ok(byQuality(a, b, 100) > 0);
});

test('sourceOf / groupOf', () => {
	assert.equal(sourceOf('X.1080p.WEB-DL-NTb'), 'WEB');
	assert.equal(sourceOf('X.BluRay.REMUX-FGT'), 'BluRay');
	assert.equal(sourceOf('X.HDTV-LOL'), 'HDTV');
	assert.equal(sourceOf('X.DVDRip'), 'DVD');
	assert.equal(sourceOf('X.1080p'), null);
	assert.equal(groupOf('X.1080p.WEB-DL-NTb'), 'NTb');
	assert.equal(groupOf('Show.S01E01-KILLERS.mkv'), 'KILLERS');
	assert.equal(groupOf('sin grupo'), '');
});

test('level / rank: calce del subtítulo con el video copiado', () => {
	const match = { release: 'X.WEB-DL-NTb', video: { fps: 23.976, duration: 3000 } };
	assert.equal(level({ ...sub, release: 'X.1080p.WEB-DL-NTb' }, match), 2);
	assert.equal(level({ ...sub, release: 'X.BluRay-NTb' }, match), 0);
	assert.equal(level({ ...sub, release: 'X.BluRay-DEMAND', fps: 23.976, last: 2900 }, match), 1);
	assert.equal(level({ ...sub, release: 'otro', exact: true }, null), 3);
	assert.equal(level({ ...sub, release: 'X.BluRay-NTb' }, null), 0);
	const ranked = rank(
		[{ ...sub, id: 'a', release: 'X.BluRay-NTb', downloads: 99 }, { ...sub, id: 'b', release: 'X.1080p.WEB-DL-NTb', downloads: 1 }, { ...sub, id: 'c', release: 'X.BluRay-OTRO', latino: true, downloads: 5 }],
		match
	);
	assert.deepEqual(ranked.map((s) => s.id), ['b', 'c', 'a']);
});
