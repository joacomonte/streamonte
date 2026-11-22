// @ts-check
// deno test --no-check ui/src/options-rank.test.js
import assert from 'node:assert/strict';
import { healthOf, latOf, mbpsOf, neededBps, qualityRank, rankOptions, tierOf, TYPICAL_MBPS } from './options-rank.js';

/** @typedef {import('./options-rank.js').RankCandidate} Cand */
/** @param {Partial<Cand>} [o] @returns {Cand} */
const cand = (o = {}) => ({ info_hash: 'h', release_name: 'Peli 1080p', audio: [], ...o });

Deno.test('latOf: pistas leídas ganan, después el nombre y la web', () => {
  assert.equal(latOf(cand(), [{ live: { audio: [1] }, languages: [{ code: 'lat' }] }]), 'lat');
  assert.equal(latOf(cand({ audio: ['lat'] }), [{ live: { audio: [1] }, languages: [{ code: 'cast' }] }]), 'spain');
  assert.equal(latOf(cand(), [{ live: { audio: [1] }, languages: [{ code: 'en' }] }]), 'none');
  assert.equal(latOf(cand({ audio: ['lat'] }), []), 'lat');
  assert.equal(latOf(cand({ release_name: 'x www.CUEVANA.com' }), []), 'likely');
  assert.equal(latOf(cand({ file_name: 'dontorrent.mkv' }), []), 'spain');
  assert.equal(latOf(cand(), []), 'check');
});

Deno.test('tierOf', () => {
  assert.equal(tierOf(undefined), 1);
  assert.equal(tierOf({ reached: true }), 2);
  assert.equal(tierOf({ reached: false, peers: 3 }), 0.5);
  assert.equal(tierOf({ reached: false, peers: 0 }), 0);
});

Deno.test('neededBps y mbpsOf', () => {
  assert.equal(neededBps(6000, { live: { duration_secs: 60 } }, 90), 100);
  assert.equal(neededBps(5400, undefined, 90), 1);
  assert.equal(neededBps(null, undefined, 90), null);
  assert.equal(neededBps(100, undefined, undefined), null);
  assert.equal(mbpsOf('1080p', null), TYPICAL_MBPS['1080p']);
  assert.equal(mbpsOf('1440p', null), 14);
  assert.equal(mbpsOf('raro', null), 3);
  assert.equal(mbpsOf('1080p', 125000), 1);
});

Deno.test('qualityRank', () => {
  assert.equal(qualityRank({ source: 'CAM' }), 0);
  assert.equal(qualityRank({ source: 'REMUX' }), 4);
  assert.equal(qualityRank({ source: null }), 2.5);
});

Deno.test('healthOf: lo que baja ahora manda; sin trackers calibrados no hay veredicto', () => {
  const ok = healthOf({ resolution: '1080p', bps: 125000, cal: {}, ev: null, now: { n: 20, avg: 500000 }, trackerMin: 5 });
  assert.equal(ok?.basis, 'now');
  assert.equal(ok?.level, 0);
  assert.equal(ok?.need, 1);
  assert.equal(healthOf({ resolution: '1080p', bps: null, cal: {}, ev: null, now: { n: 2, avg: 1 }, trackerMin: 5 }), null);
});

Deno.test('rankOptions: fluidas primero, sin disco y muertas al final; torbox por Mbps', () => {
  const a = cand({ info_hash: 'a' }), b = cand({ info_hash: 'b' }), dead = cand({ info_hash: 'dead' }), big = cand({ info_hash: 'big' });
  /** @type {Record<string, number>} */
  const shown = { a: 0, b: 1 };
  /** @type {import('./options-rank.js').RankEnv<Cand>} */
  const env = {
    torbox: false, mode: 'fast',
    health: (c) => (c.info_hash in shown ? /** @type {import('./options-rank.js').Health} */ ({ shown: shown[c.info_hash], probable: false }) : null),
    fits: (c) => c.info_hash !== 'big',
    tierOf: (c) => (c.info_hash === 'dead' ? 0 : 1),
    reached: (c) => c.info_hash === 'a',
    knownSeeds: () => 1, leechersOf: () => 1, quickGroup: () => 0, advancing: () => null,
    mbpsOf: (c) => (c.info_hash === 'a' ? 5 : 20), isMatch: () => true, pinPlaying: (l) => l,
  };
  const r = rankOptions([dead, big, b, a], env);
  assert.deepEqual(r.list.map((c) => c.info_hash), ['a', 'b', 'big', 'dead']);
  assert.equal(r.best?.info_hash, 'a');
  const tb = rankOptions([a, b], { ...env, torbox: true });
  assert.deepEqual(tb.list.map((c) => c.info_hash), ['b', 'a']);
});
