import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groupOf, level, rank, sourceOf, type MatchableSub } from './sub-match.ts';

const sub: MatchableSub = { release: '', latino: false, downloads: 0 };

test('sourceOf / groupOf', () => {
	assert.equal(sourceOf('X.1080p.WEB-DL.x264-NTb'), 'WEB-DL');
	assert.equal(sourceOf('X.BluRay.REMUX.x264-FGT'), 'BluRay');
	assert.equal(sourceOf('X.HDTV.x264-LOL'), 'HDTV');
	assert.equal(sourceOf('X.DVDRip'), 'DVDRip');
	assert.equal(sourceOf('X.1080p'), null);
	assert.equal(groupOf('X.1080p.WEB-DL-NTb'), 'NTb');
	assert.equal(groupOf('Show.S01E01-KILLERS.mkv'), 'KILLERS');
	assert.equal(groupOf('sin grupo'), '');
});

test('level / rank: calce del subtítulo con el video copiado', () => {
	const match = { release: 'X.WEB-DL.x264-NTb.mkv', video: { fps: 23.976, duration: 3000 } };
	assert.equal(level({ ...sub, release: 'X.1080p.WEB-DL.x264-NTb' }, match), 2);
	assert.equal(level({ ...sub, release: 'X.BluRay.x264-NTb' }, match), 0);
	assert.equal(level({ ...sub, release: 'X.BluRay.x264-DEMAND', fps: 23.976, last: 2900 }, match), 1);
	assert.equal(level({ ...sub, release: 'otro', exact: true }, null), 3);
	assert.equal(level({ ...sub, release: 'X.BluRay.x264-NTb' }, null), 0);
	const ranked = rank(
		[{ ...sub, id: 'a', release: 'X.BluRay.x264-NTb', downloads: 99 }, { ...sub, id: 'b', release: 'X.1080p.WEB-DL.x264-NTb', downloads: 1 }, { ...sub, id: 'c', release: 'X.BluRay.x264-OTRO', latino: true, downloads: 5 }],
		match
	);
	assert.deepEqual(ranked.map((s) => s.id), ['b', 'c', 'a']);
});

test("level: el grupo que dice OpenSubtitles.org (solo web, Rust no lo tiene) sube a 2", () => {
	const match = { release: "X.1080p.WEB-DL.x264-NTb.mkv" };
	assert.equal(level({ ...sub, release: "otro nombre", group: "ntb" }, match), 2);
	assert.equal(level({ ...sub, release: "otro nombre", group: "OTRO" }, match), 0);
});
