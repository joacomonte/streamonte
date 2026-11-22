import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ago, clock, humanBytes, mb, onlyCinema } from './format.ts';

/** Corre `fn` con `Date.now()` fijo. */
function atDate(iso: string, fn: () => void): void {
	const real = Date.now;
	Date.now = () => Date.parse(iso);
	try {
		fn();
	} finally {
		Date.now = real;
	}
}

test('humanBytes', () => {
	assert.equal(humanBytes(null), '—');
	assert.equal(humanBytes(undefined), '—');
	assert.equal(humanBytes(734 * 1024 ** 2), '734 MB');
	assert.equal(humanBytes(1.5 * 1024 ** 3), '1,5 GB');
});

test('mb: bytes/s → Mbps sin unidad, coma decimal', () => {
	assert.equal(mb(78e6 / 8), '78');
	assert.equal(mb(7.2e6 / 8), '7,2');
	assert.equal(mb(0), '0');
});

test('clock', () => {
	assert.equal(clock(3725), '1:02:05');
	assert.equal(clock(125), '0:02:05');
	assert.equal(clock(125, true), '2:05');
	assert.equal(clock(3725, true), '1:02:05');
});

test('ago (idioma es)', () => {
	atDate('2026-11-22T12:00:00Z', () => {
		assert.equal(ago('2026-11-22T11:59:40Z'), 'recién');
		assert.equal(ago('2026-11-22T11:55:00Z'), 'hace 5 min');
		assert.equal(ago('2026-11-22T09:00:00Z'), 'hace 3 h');
		assert.equal(ago('2026-11-19T12:00:00Z'), 'hace 3 días');
	});
});

test('onlyCinema: sin fecha no', () => {
	assert.equal(onlyCinema(null), false);
	assert.equal(onlyCinema(undefined), false);
	assert.equal(onlyCinema(''), false);
});

test('onlyCinema: solo dentro de los 21 días desde el estreno', () => {
	const today = new Date('2026-11-20T00:00').getTime();
	const real = Date.now;
	Date.now = () => today;
	try {
		assert.equal(onlyCinema('2026-11-20'), true); // día del estreno
		assert.equal(onlyCinema('2026-10-31'), true); // 20 días
		assert.equal(onlyCinema('2026-10-30'), false); // 21 días
		assert.equal(onlyCinema('2026-11-21'), false); // todavía no se estrenó
	} finally {
		Date.now = real;
	}
});
