// @ts-check
// cd ui && npm test  (el resto del ranking se prueba en packages/ui/src/rank.test.ts)
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { healthOf } from './options-rank.js';

test('healthOf: lo que baja ahora manda; sin trackers calibrados no hay veredicto', () => {
  const ok = healthOf({ resolution: '1080p', bps: 125000, cal: {}, ev: null, now: { n: 20, avg: 500000 }, trackerMin: 5 });
  assert.equal(ok?.basis, 'now');
  assert.equal(ok?.level, 0);
  assert.equal(ok?.need, 1);
  assert.equal(healthOf({ resolution: '1080p', bps: null, cal: {}, ev: null, now: { n: 2, avg: 1 }, trackerMin: 5 }), null);
});
