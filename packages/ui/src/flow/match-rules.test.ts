import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fitsNet, NET } from './net.ts';
import { isMatch, latFirst, latPotential, needsReading, type MatchFacts } from './match-rules.ts';

const facts = (o: Partial<MatchFacts>): MatchFacts => ({ latState: 'none', saysSpanish: false, subsEs: null, audioRead: false, ...o });

test('potencial y candidata a leer de latino', () => {
	assert.equal(latPotential(facts({ latState: 'lat' })), true);
	assert.equal(latPotential(facts({ latState: 'check' })), false);
	assert.equal(latPotential(facts({ latState: 'check', saysSpanish: true })), true);
	assert.equal(needsReading(true, facts({ latState: 'likely' })), true);
	assert.equal(needsReading(true, facts({ latState: 'likely', audioRead: true })), false);
	assert.equal(needsReading(false, facts({ subsEs: null })), true);
	assert.equal(needsReading(false, facts({ subsEs: false })), false);
});

test('buen match: latino o sub ES; `excluded` lo descarta', () => {
	assert.equal(isMatch(true, facts({ latState: 'lat' })), true);
	assert.equal(isMatch(true, facts({ latState: 'lat' }), true), false);
	assert.equal(isMatch(false, facts({ subsEs: true })), true);
	assert.equal(isMatch(false, facts({ subsEs: null })), false);
});

test('latFirst ordena por señal solo pidiendo latino; la conexión pone el tope', () => {
	const items = [{ s: 'likely' as const }, { s: 'lat' as const }];
	assert.deepEqual(latFirst(items, true, (i) => i.s).map((i) => i.s), ['lat', 'likely']);
	assert.deepEqual(latFirst(items, false, (i) => i.s), items);
	assert.equal(fitsNet(1, 11, NET[1]), false);
	assert.equal(fitsNet(null, 1, null), false);
	assert.equal(fitsNet(1, 999, null), true);
});
