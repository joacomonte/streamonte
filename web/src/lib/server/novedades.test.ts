import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bestHashes, castOf, episodeNews, trendingRanks, hashBatches, isRerelease, needsBackup, pickSubgenres, verificationFrom } from './novedades.ts';

const h = (n: number) => n.toString(16).padStart(40, '0');
const t = (n: number, source: string | null, res: string | null, seeds: number, cam = false) => ({ hash: h(n), source, res, seeds, cam });

test('isRerelease: año de estreno < año actual − 1', () => {
	const now = new Date('2026-11-26T00:00:00Z');
	assert.equal(isRerelease('2026-10-01', now), false);
	assert.equal(isRerelease('2025-03-01', now), false);
	assert.equal(isRerelease('2024-12-31', now), true);
	assert.equal(isRerelease(null, now), true);
});

test('bestHashes: solo calidad buena sin CAM, mejor resolución y seeds, máx. 5', () => {
	const list = [t(1, 'CAM', '1080p', 999, true), t(2, 'HDTV', '1080p', 50), t(3, 'WEB-DL', '720p', 10), t(4, 'WEB-DL', '1080p', 5), t(5, 'REMUX', '2160p', 1), t(6, 'WEBRip', '1080p', 40), t(7, 'BluRay', '1080p', 3), t(8, 'WEB-DL', '1080p', 1)];
	assert.deepEqual(bestHashes(list), [h(5), h(6), h(4), h(7), h(8)]);
	assert.deepEqual(bestHashes([t(1, 'CAM', null, 9, true), t(2, null, '1080p', 9)]), []);
});

test('needsBackup: solo si Torrentio y Comet vuelven vacíos', () => {
	assert.equal(needsBackup(0), true);
	assert.equal(needsBackup(3), false);
});

test('hashBatches: sin repetidos, lotes de a size', () => {
	const all = [h(1), h(2), h(2), h(3), h(4), h(5)];
	assert.deepEqual(hashBatches(all, 2).map((b) => b.length), [2, 2, 1]);
	assert.equal(hashBatches([], 80).length, 0);
});

test('pickSubgenres: máx. 2, solo subgéneros válidos (no "todo el género")', () => {
	const valid = new Set(['in0000008', 'in0000010', 'in0000006']);
	assert.deepEqual(pickSubgenres(['in0000001', 'in0000010', 'in0000008', 'in0000006'], valid), ['in0000010', 'in0000008']);
	assert.deepEqual(pickSubgenres(['in0000001'], valid), []);
});

test('verificationFrom: película 0/0, serie con s/e; sin release bueno no hay fila', () => {
	assert.deepEqual(verificationFrom('tt1', null, null, [t(1, 'WEB-DL', '1080p', 1)]), { imdb: 'tt1', s: 0, e: 0, hashes: [h(1)], enCache: true });
	assert.equal(verificationFrom('tt1', '2', '3', [t(1, 'WEB-DL', '1080p', 1)])?.e, 3);
	assert.equal(verificationFrom('tt1', null, null, [t(1, 'HDTV', '1080p', 1)]), null);
});

test('castOf: máx. 2 nombres, en orden, sin vacíos', () => {
	assert.deepEqual(castOf({ cast: [{ name: 'A' }, { name: ' ' }, { name: 'B' }, { name: 'C' }] }), ['A', 'B']);
	assert.deepEqual(castOf(null), []);
});

test('trendingRanks: 1-based en el orden dado', () => {
	assert.equal(trendingRanks(['tt1', 'tt2']).get('tt2'), 2);
	assert.equal(trendingRanks(['tt1']).get('tt9'), undefined);
});

test('episodeNews: temporada completa el mismo día → E1 full; E1 suelto; capítulo con último visto', () => {
	const d = { last_episode_to_air: { air_date: '2026-11-20', season_number: 2, episode_number: 8 }, seasons: [{ season_number: 2, episode_count: 8, air_date: '2026-11-20' }] };
	assert.deepEqual(episodeNews(d, d.last_episode_to_air, { season: 1, episode: 4 }), { e: 1, reason: { type: 'season', season: 2, full: true, episodes: 8 } });
	const weekly = { last_episode_to_air: { air_date: '2026-11-20', season_number: 2, episode_number: 3 }, seasons: [{ season_number: 2, episode_count: 8, air_date: '2026-11-06' }] };
	assert.deepEqual(episodeNews(weekly, weekly.last_episode_to_air, { season: 2, episode: 1 }), { e: 3, reason: { type: 'episode', lastSeen: { season: 2, episode: 1 } } });
	assert.deepEqual(episodeNews(weekly, weekly.last_episode_to_air, { season: null, episode: null }).reason, { type: 'episode', lastSeen: null });
	const first = { last_episode_to_air: { air_date: '2026-11-20', season_number: 2, episode_number: 1 }, seasons: [{ season_number: 2, episode_count: 8, air_date: '2026-11-20' }] };
	assert.deepEqual(episodeNews(first, first.last_episode_to_air, { season: 1, episode: 9 }), { e: 1, reason: { type: 'season', season: 2, full: false, episodes: 8 } });
});
