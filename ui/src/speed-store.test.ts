// Medidor de velocidad: estados desde muestras de eventos `speed-test` y de la respuesta del núcleo.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { angle, failedView, fmtMbps, gaugeArc, viewAfterEvent } from './speed-model.ts';
import { createSpeedStore } from './speed-store.ts';
import type * as Raw from './types.js';

const result: Raw.SpeedResult = { mbps: 312.4, measured_at: '2026-11-22T10:00:00Z', network: 'net-1' };

test('aguja: escala log de 1 a 1000 Mbps sobre media vuelta', () => {
	assert.equal(angle(1), -90);
	assert.equal(angle(0), -90);
	assert.ok(Math.abs(angle(10) - -30) < 1e-9);
	assert.equal(angle(1000), 90);
	assert.equal(angle(1e6), 90);
	assert.equal(gaugeArc(1).fill, 0);
	assert.ok(Math.abs(gaugeArc(1000).fill - gaugeArc(1000).len) < 1e-9);
});

test('fmtMbps: sin decimales desde 100', () => {
	assert.equal(fmtMbps(312.4), '312');
	assert.equal(fmtMbps(9.46), '9,5');
});

test('viewAfterEvent: solo mueve la aguja mientras mide', () => {
	const samples: Raw.SpeedState[] = [{ kind: 'measuring', mbps: 40 }, { kind: 'measuring', mbps: 180 }];
	let v = { kind: 'measuring', mbps: 0 } as ReturnType<typeof failedView>;
	for (const s of samples) v = viewAfterEvent(v, s);
	assert.deepEqual(v, { kind: 'measuring', mbps: 180 });
	const idle = { kind: 'idle' } as const;
	assert.equal(viewAfterEvent(idle, samples[0]!), idle);
	const done = { kind: 'done', mbps: 5, at: 'x' } as const;
	assert.equal(viewAfterEvent(done, { kind: 'done', result }), done);
});

test('store: mide → eventos → done y avisa la red al calibrador', async () => {
	const links: [number, string][] = [];
	let finish: (r: Raw.SpeedResult) => void = () => {};
	const forced: boolean[] = [];
	const store = createSpeedStore({
		speedTest: (force) => (forced.push(force), new Promise((ok) => (finish = ok))),
		setLinkMbps: (m, n) => links.push([m, n])
	});
	const seen: string[] = [];
	store.subscribe(() => seen.push(store.snapshot().view.kind));
	const run = store.measure(false);
	assert.deepEqual(store.snapshot().view, { kind: 'measuring', mbps: 0 });
	store.onEvent({ kind: 'measuring', mbps: 55 });
	assert.deepEqual(store.snapshot().view, { kind: 'measuring', mbps: 55 });
	finish(result);
	await run;
	assert.deepEqual(store.snapshot().view, { kind: 'done', mbps: 312.4, at: result.measured_at });
	assert.deepEqual(links, [[312.4, 'net-1']]);
	assert.deepEqual(forced, [false]);
	assert.deepEqual(seen, ['measuring', 'measuring', 'done']);
	store.onEvent({ kind: 'measuring', mbps: 1 }); // ya terminó: se ignora
	assert.equal(store.snapshot().view.kind, 'done');
});

test('store: si falla queda "failed" con el mensaje y no calibra', async () => {
	const links: number[] = [];
	const store = createSpeedStore({ speedTest: () => Promise.reject({ message: 'sin red' }), setLinkMbps: (m) => links.push(m) });
	await store.measure(true);
	assert.deepEqual(store.snapshot().view, { kind: 'failed', mbps: 0, message: 'sin red' });
	assert.deepEqual(links, []);
	store.setEditing(true);
	assert.equal(store.snapshot().editing, true);
});
