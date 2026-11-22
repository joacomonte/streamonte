import { test } from 'node:test';
import assert from 'node:assert/strict';
import { magnetHash } from './magnet-hash.ts';

const HEX = 'c12fe1c06bba254a9dc9f519b335aa7c1367a88a';

test('magnetHash: hex en minúsculas', () => {
	assert.deepStrictEqual(magnetHash('magnet:?xt=urn:btih:C12FE1C06BBA254A9DC9F519B335AA7C1367A88A&dn=x'), HEX);
});
test('magnetHash: base32 pasa a hex', () => {
	assert.deepStrictEqual(magnetHash('magnet:?xt=urn:btih:YEX6DQDLXISUVHOJ6UM3GNNKPQJWPKEK'), HEX);
});
test('magnetHash: no magnet o hash inválido', () => {
	assert.deepStrictEqual(magnetHash('hola'), null);
	assert.deepStrictEqual(magnetHash('magnet:?xt=urn:btih:xyz'), null);
});
