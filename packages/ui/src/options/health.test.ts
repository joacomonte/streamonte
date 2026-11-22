import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calibration, fidelity, healthOf, learnBias, levelOf, predict, rawPrediction, shownLevel, sustained, type HealthSample } from './health.ts';

const near = (a: number, b: number, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} ≉ ${b}`);
const sample = (o: Partial<HealthSample>): HealthSample => ({ ev: {}, real_mbps: 0, measured_at: new Date().toISOString(), avg_speed_bps: 0, max_speed_bps: 0, measured_secs: 200, ...o });

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
	near(rawPrediction({ counted_seeds: 10, counted_leech: 6 }, 'counted') ?? 0, (10 + 1) * 3);
	assert.equal(rawPrediction({ counted_seeds: 0 }, 'counted'), 0.5); // piso MIN_PRED_MBPS
	assert.equal(rawPrediction({ tracker_seeds: 0 }, 'tracker'), null); // 0 de tracker no es confiable
	assert.equal(rawPrediction({ tracker_seeds: 4 }, 'tracker'), 12);
});

test('learnBias: sin muestras no corrige; con muestras se contrae hacia 0', () => {
	const none = learnBias([], Date.now(), null);
	assert.equal(none.counted.factor, 1);
	assert.equal(none.counted.n, 0);
	const s = sample({ ev: { counted_seeds: 10 }, real_mbps: 60 });
	const b = learnBias([s, s, s], Date.now(), null);
	assert.equal(b.counted.n, 3);
	near(b.counted.bias, (3 * Math.log(2)) / (3 + 2), 1e-6); // ln(60 ÷ 30), nEff 3, PRIOR_N 2
	assert.equal(b.measured.n, 0); // sin analysis_mbps no enseña a esa evidencia
});

test('predict: la medición manda; sin evidencia, null; el techo de la conexión', () => {
	assert.equal(predict(null, { bias: {} }), null);
	const r = predict({ analysis_mbps: 20 }, { bias: {} });
	assert.equal(r?.kind, 'measured');
	assert.equal(r?.p50, 20);
	assert.equal(r?.conf, 'baja');
	near(r?.lo ?? 0, 16);
	near(r?.hi ?? 0, 50);
	assert.equal(predict({ counted_seeds: 100 }, { bias: {}, capMbps: 50 })?.p50, 50);
});

test('shownLevel: sube un nivel si el p75 alcanza el de arriba', () => {
	assert.deepEqual(shownLevel({ p50: 30, p75: 40, conf: 'baja' }, 10), { level: 0, shown: 0, probable: false });
	assert.deepEqual(shownLevel({ p50: 15, p75: 25, conf: 'baja' }, 10), { level: 1, shown: 0, probable: true });
	assert.equal(shownLevel({ p50: 15, p75: 25, conf: 'alta' }, 10).probable, false);
});

test('fidelity: sin muestras, null; con una, la cuenta', () => {
	assert.equal(fidelity([], null), null);
	const f = fidelity([sample({ ev: { analysis_mbps: 20, need_mbps: 10 }, real_mbps: 20, measured_at: '2026-11-01T00:00:00Z' })], null);
	assert.equal(f?.n, 1);
	assert.equal(f?.hits, 1); // predijo 20 de 10 → nivel 0 y real 20 → nivel 0
	assert.equal(f?.inBand, 1);
	near(f?.biasBefore ?? 1, 0);
});

test('healthOf: lo que baja ahora manda; sin trackers calibrados no hay veredicto', () => {
	const ok = healthOf({ resolution: '1080p', bps: 125000, cal: {}, ev: null, now: { n: 20, avg: 500000 }, trackerMin: 5 });
	assert.equal(ok?.basis, 'now');
	assert.equal(ok?.level, 0);
	assert.equal(ok?.need, 1);
	assert.equal(healthOf({ resolution: '1080p', bps: null, cal: {}, ev: null, now: { n: 2, avg: 1 }, trackerMin: 5 }), null);
	assert.equal(healthOf({ resolution: '1080p', bps: null, cal: {}, ev: { tracker_seeds: 30 }, now: null, trackerMin: 5 }), null);
	assert.equal(healthOf({ resolution: '1080p', bps: null, cal: {}, ev: { counted_seeds: 30 }, now: null, trackerMin: 5 })?.basis, 'counted');
});

test('calibration: mediciones de la biblioteca y guardadas; Restablecer, otra red y valor fijo', () => {
	const at = '2026-11-10T00:00:00Z';
	const row = { info_hash: 'a', name: 'A', live: { partial: false, seeds: 5, avg_speed_bps: 1e6, max_speed_bps: 4e6, measured_secs: 60, measured_at: at } };
	const bg = { b: { avg_speed_bps: 2e6, max_speed_bps: 5e6, measured_secs: 300, measured_at: at, network: 'otra' } };
	const c = calibration([row], { bg }, null, 'casa', Date.parse(at));
	assert.equal(c.samples.length, 1); // la de otra red no cuenta
	assert.equal(c.capMbps, null); // menos de MIN_SAMPLES: sin techo
	assert.equal(c.source, 'default');
	assert.equal(calibration([row], { since: Date.parse(at) + 1 }, null, null, 0).samples.length, 0);
	const fixed = calibration([], { seedMbps: 7 }, 100, null, 0);
	assert.equal(fixed.manual, 7);
	assert.equal(fixed.capMbps, 100);
	assert.equal(fixed.capFrom, 'test');
	assert.equal(fixed.source, 'manual');
});

test('sustained: percentil 25', () => {
	assert.equal(sustained([4, 1, 3, 2, 5]), 2);
	assert.equal(sustained([]), 0);
});
