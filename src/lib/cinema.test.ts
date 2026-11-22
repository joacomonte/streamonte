import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { onlyCinema } from './cinema.ts';

const realNow = Date.now;
afterEach(() => (Date.now = realNow));
const today = (iso: string) => (Date.now = () => new Date(`${iso}T00:00`).getTime());

test('onlyCinema: sin fecha no', () => {
	assert.equal(onlyCinema(null), false);
	assert.equal(onlyCinema(undefined), false);
	assert.equal(onlyCinema(''), false);
});

test('onlyCinema: solo dentro de los 21 días desde el estreno', () => {
	today('2026-11-20');
	assert.equal(onlyCinema('2026-11-20'), true); // día del estreno
	assert.equal(onlyCinema('2026-10-31'), true); // 20 días
	assert.equal(onlyCinema('2026-10-30'), false); // 21 días
	assert.equal(onlyCinema('2026-11-21'), false); // todavía no se estrenó
});
