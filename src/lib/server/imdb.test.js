import { test } from 'node:test';
import assert from 'node:assert/strict';
import { imdbOf } from './imdb.js';

test('imdbOf: desempaqueta votos*1000 + puntaje*10, por número o por "tt…"', () => {
	const map = new Map([[1, 5000 * 1000 + 84]]);
	assert.deepEqual(imdbOf(1, map), { rating: 8.4, votes: 5000 });
	assert.deepEqual(imdbOf('tt1', map), { rating: 8.4, votes: 5000 });
	assert.equal(imdbOf('tt2', map), null);
	assert.equal(imdbOf(null, map), null);
});
