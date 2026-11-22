import './test-stub.js';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fidelity, learnBias, levelOf, predict, rawPrediction, shownLevel } from './health-calib.js';

/** @param {number} a @param {number} b */
const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} ≉ ${b}`);

test('levelOf: 0 sobra el doble, 1 alcanza, 2 no alcanza', () => {
  assert.equal(levelOf(2), 0);
  assert.equal(levelOf(1.5), 1);
  assert.equal(levelOf(1), 1);
  assert.equal(levelOf(0.99), 2);
});

test('rawPrediction: medición, seeders contados y de trackers', () => {
  assert.equal(rawPrediction(null, 'measured'), null);
  assert.equal(rawPrediction({ analysis_mbps: 20 }, 'measured'), 20);
  assert.equal(rawPrediction({ analysis_mbps: 0 }, 'measured'), null);
  near(/** @type {number} */ (rawPrediction({ counted_seeds: 10, counted_leech: 6 }, 'counted')), (10 + 1) * 3);
  assert.equal(rawPrediction({ counted_seeds: 0 }, 'counted'), 0.5); // piso MIN_PRED_MBPS
  assert.equal(rawPrediction({ tracker_seeds: 0 }, 'tracker'), null); // 0 de tracker no es confiable
  assert.equal(rawPrediction({ tracker_seeds: 4 }, 'tracker'), 12);
});

test('learnBias: sin muestras no corrige; con muestras se contrae hacia 0', () => {
  const none = learnBias([], Date.now(), null);
  assert.equal(none.counted.factor, 1);
  assert.equal(none.counted.n, 0);
  const now = new Date().toISOString();
  const sample = { ev: { counted_seeds: 10 }, real_mbps: 60, measured_at: now, avg_speed_bps: 0, max_speed_bps: 0, measured_secs: 200 };
  const b = learnBias([sample, sample, sample], Date.now(), null);
  assert.equal(b.counted.n, 3);
  near(b.counted.bias, (3 * Math.log(2)) / (3 + 2), 1e-6); // ln(60 ÷ 30), nEff 3, PRIOR_N 2
  assert.equal(b.measured.n, 0); // sin analysis_mbps no enseña a esa evidencia
});

test('predict: la medición manda; sin evidencia, null', () => {
  assert.equal(predict(null, { bias: {} }), null);
  const r = /** @type {import('./types.js').HealthRange} */ (predict({ analysis_mbps: 20 }, { bias: {} }));
  assert.equal(r.kind, 'measured');
  assert.equal(r.p50, 20);
  assert.equal(r.conf, 'baja');
  near(r.lo, 16);
  near(r.hi, 50);
  const capped = /** @type {import('./types.js').HealthRange} */ (predict({ counted_seeds: 100 }, { bias: {}, capMbps: 50 }));
  assert.equal(capped.p50, 50); // el techo de la conexión
});

test('shownLevel: sube un nivel si el p75 alcanza el de arriba', () => {
  assert.deepEqual(shownLevel({ kind: 'counted', lo: 0, p50: 30, p75: 40, hi: 50, conf: 'baja' }, 10), { level: 0, shown: 0, probable: false });
  assert.deepEqual(shownLevel({ kind: 'counted', lo: 0, p50: 15, p75: 25, hi: 50, conf: 'baja' }, 10), { level: 1, shown: 0, probable: true });
  assert.equal(shownLevel({ kind: 'counted', lo: 0, p50: 15, p75: 25, hi: 50, conf: 'alta' }, 10).probable, false);
});

test('fidelity: sin muestras, null; con una, la cuenta', () => {
  assert.equal(fidelity([], null), null);
  const s = { ev: { analysis_mbps: 20, need_mbps: 10 }, real_mbps: 20, measured_at: '2026-11-01T00:00:00Z', avg_speed_bps: 0, max_speed_bps: 0, measured_secs: 200 };
  const f = /** @type {import('./types.js').HealthFidelity} */ (fidelity([s], null));
  assert.equal(f.n, 1);
  assert.equal(f.hits, 1); // predijo 20 de 10 → nivel 0 y real 20 → nivel 0
  assert.equal(f.inBand, 1);
  near(f.biasBefore, 0);
});
