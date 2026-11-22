import { test } from 'node:test';
import assert from 'node:assert/strict';
import { byQuality, hintOf, latOf, mbpsOf, neededBps, optionMbps, qualityRank, rankOptions, resOf, tierOf, TYPICAL_MBPS, type LatInput, type QualityInput, type RankEnv } from './rank.ts';

const GB = 1024 ** 3;
const cand = (o: Partial<LatInput> = {}): LatInput => ({ release: 'Peli 1080p', audio: [], ...o });
const opt = (o: Partial<QualityInput>): QualityInput => ({ resolution: null, sizeBytes: null, source: null, ...o });

test('resOf: 2160p, 1440p (2K), 1080p y 720p propias; el resto cae en other', () => {
	assert.equal(resOf('2160p'), '2160p');
	assert.equal(resOf('720p'), '720p');
	assert.equal(resOf('1440p'), '1440p');
	assert.equal(resOf('480p'), 'other');
	assert.equal(resOf(null), 'other');
});

test('optionMbps (web): peso ÷ duración; sin alguno de los dos, lo típico por resolución', () => {
	assert.equal(optionMbps(opt({ sizeBytes: 75e6, resolution: '1080p' }), 10), 1); // 75 MB en 10 min = 1 Mbps
	assert.equal(optionMbps(opt({ sizeBytes: 10 * GB, resolution: '1080p' }), null), TYPICAL_MBPS['1080p']);
	assert.equal(optionMbps(opt({ resolution: '2160p' }), 120), TYPICAL_MBPS['2160p']);
	assert.equal(optionMbps(opt({ resolution: '1440p' }), null), 14);
	assert.equal(optionMbps(opt({ resolution: '480p' }), null), 3);
});

test('byQuality: sin peso al final, más bitrate primero, desempata la fuente', () => {
	const noSize = { ...opt({ resolution: '2160p' }), h: 'n' };
	const big = { ...opt({ sizeBytes: 20 * GB }), h: 'big' };
	const small = { ...opt({ sizeBytes: 5 * GB }), h: 'small' };
	assert.deepEqual([noSize, small, big].sort((a, b) => byQuality(a, b, 120)).map((t) => t.h), ['big', 'small', 'n']);
	// mismo bitrate: gana la mejor fuente
	const a = opt({ sizeBytes: 8 * GB, source: 'HDTV' });
	const b = opt({ sizeBytes: 8 * GB, source: 'REMUX' });
	assert.ok(byQuality(a, b, 100) > 0);
});

test('hintOf / latOf: pistas leídas ganan, después el nombre y la web', () => {
	assert.equal(latOf(cand(), [{ audioRead: true, languages: ['lat'] }]), 'lat');
	assert.equal(latOf(cand({ audio: ['lat'] }), [{ audioRead: true, languages: ['cast'] }]), 'spain');
	assert.equal(latOf(cand(), [{ audioRead: true, languages: ['en'] }]), 'none');
	assert.equal(latOf(cand({ audio: ['lat'] }), []), 'lat');
	assert.equal(latOf(cand({ release: 'x www.CUEVANA.com' }), []), 'likely');
	assert.equal(latOf(cand({ file: 'dontorrent.mkv' }), []), 'spain');
	assert.equal(latOf(cand(), []), 'check');
	assert.equal(hintOf(cand({ audio: ['cast'] })), 'spain');
	assert.equal(hintOf(cand()), null);
});

test('tierOf', () => {
	assert.equal(tierOf(undefined), 1);
	assert.equal(tierOf({ reached: true }), 2);
	assert.equal(tierOf({ reached: false, peers: 3 }), 0.5);
	assert.equal(tierOf({ reached: false, peers: 0 }), 0);
});

test('neededBps y mbpsOf (desktop)', () => {
	assert.equal(neededBps(6000, 60, 90), 100);
	assert.equal(neededBps(5400, undefined, 90), 1);
	assert.equal(neededBps(null, undefined, 90), null);
	assert.equal(neededBps(100, undefined, undefined), null);
	assert.equal(mbpsOf('1080p', null), TYPICAL_MBPS['1080p']);
	assert.equal(mbpsOf('1440p', null), 14);
	assert.equal(mbpsOf('raro', null), 3);
	assert.equal(mbpsOf('1080p', 125000), 1);
});

test('qualityRank', () => {
	assert.equal(qualityRank({ source: 'CAM' }), 0);
	assert.equal(qualityRank({ source: 'REMUX' }), 4);
	assert.equal(qualityRank({ source: 'WEB' }), 2);
	assert.equal(qualityRank({ source: null }), 2.5);
});

test('rankOptions: fluidas primero, sin disco y muertas al final; torbox por Mbps', () => {
	type C = { hash: string };
	const [a, b, dead, big]: C[] = [{ hash: 'a' }, { hash: 'b' }, { hash: 'dead' }, { hash: 'big' }];
	const shown: Record<string, number> = { a: 0, b: 1 };
	const env: RankEnv<C> = {
		torbox: false, mode: 'fast',
		health: (c) => (c.hash in shown ? { shown: shown[c.hash] ?? 0, probable: false } : null),
		fits: (c) => c.hash !== 'big',
		tierOf: (c) => (c.hash === 'dead' ? 0 : 1),
		reached: (c) => c.hash === 'a',
		knownSeeds: () => 1, leechersOf: () => 1, quickGroup: () => 0, advancing: () => null,
		mbpsOf: (c) => (c.hash === 'a' ? 5 : 20), isMatch: () => true, pinPlaying: (l) => l,
		sizeOf: () => 1, sourceOf: () => null
	};
	const r = rankOptions([dead, big, b, a] as C[], env);
	assert.deepEqual(r.list.map((c) => c.hash), ['a', 'b', 'big', 'dead']);
	assert.equal(r.best?.hash, 'a');
	const tb = rankOptions([a, b] as C[], { ...env, torbox: true });
	assert.deepEqual(tb.list.map((c) => c.hash), ['b', 'a']);
});
