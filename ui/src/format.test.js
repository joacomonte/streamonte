import './test-stub.js';
import assert from 'node:assert/strict';
import { ago, clock, humanBytes, mb, onlyCinema } from './format.js';

/** Corre `fn` con `Date.now()` fijo. @param {string} iso @param {() => void} fn */
function atDate(iso, fn) {
  const real = Date.now;
  Date.now = () => Date.parse(iso);
  try { fn(); } finally { Date.now = real; }
}

Deno.test('humanBytes', () => {
  assert.equal(humanBytes(null), '—');
  assert.equal(humanBytes(undefined), '—');
  assert.equal(humanBytes(734 * 1024 ** 2), '734 MB');
  assert.equal(humanBytes(1.5 * 1024 ** 3), '1,5 GB');
});

Deno.test('mb: bytes/s → Mbps sin unidad, coma decimal', () => {
  assert.equal(mb(78e6 / 8), '78');
  assert.equal(mb(7.2e6 / 8), '7,2');
  assert.equal(mb(0), '0');
});

Deno.test('clock', () => {
  assert.equal(clock(3725), '1:02:05');
  assert.equal(clock(125), '0:02:05');
  assert.equal(clock(125, true), '2:05');
  assert.equal(clock(3725, true), '1:02:05');
});

Deno.test('ago (idioma es)', () => {
  atDate('2026-11-22T12:00:00Z', () => {
    assert.equal(ago('2026-11-22T11:59:40Z'), 'recién');
    assert.equal(ago('2026-11-22T11:55:00Z'), 'hace 5 min');
    assert.equal(ago('2026-11-22T09:00:00Z'), 'hace 3 h');
    assert.equal(ago('2026-11-19T12:00:00Z'), 'hace 3 días');
  });
});

Deno.test('onlyCinema: estrenada hace menos de 3 semanas', () => {
  atDate('2026-11-22T12:00:00Z', () => {
    assert.equal(onlyCinema('2026-11-10'), true);
    assert.equal(onlyCinema('2026-10-01'), false);
    assert.equal(onlyCinema('2027-01-01'), false); // todavía no se estrenó
  });
});
