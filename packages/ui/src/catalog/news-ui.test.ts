import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compactVotes, newsAgo, newsTag, newsWhen, toCatalogItem, toRecentItem, watchLabel } from './news-ui.ts';
import type { NewsItem } from './news.ts';

const NOW = Date.parse('2026-11-26T12:00:00Z');
const base: NewsItem = { kind: 'tv', imdb: 'tt1', id: 'tt1', title: 'X', year: 2025, poster: null, backdrop: null, subgenres: [], overview: null, imdbRating: 7.44, imdbVotes: 270000, what: null, date: '2026-11-24T10:00:00Z' };

test('newsAgo: por día', () => {
	assert.equal(newsAgo('2026-11-26T08:00:00Z', NOW), 'hoy');
	assert.equal(newsAgo('2026-11-25T08:00:00Z', NOW), 'hace 1 día');
	assert.equal(newsAgo('2026-11-23T08:00:00Z', NOW), 'hace 3 días');
});

test('compactVotes', () => {
	assert.equal(compactVotes(850), '850');
	assert.equal(compactVotes(73400), '73k');
	assert.equal(compactVotes(2400000), '2,4M');
});

test('estreno de serie: Nuevo · Serie · hace 2 días, Ver, abre la ficha', () => {
	const i: NewsItem = { ...base, what: { type: 'title' } };
	assert.equal(newsTag(i), 'Nuevo');
	assert.equal(newsWhen(i, NOW), 'Serie · hace 2 días');
	assert.equal(watchLabel(i), 'Ver');
	assert.deepEqual(toCatalogItem(i), { id: 'tt1', kind: 'tv', title: 'X', year: '2025', poster: null, rating: '7.4', released: null, documentary: false });
});

test('final de temporada: T1 · E8, Ver T1·E8, abre el capítulo', () => {
	const i: NewsItem = { ...base, what: { type: 'episode', season: 1, episode: 8, finale: true } };
	assert.equal(newsTag(i), 'T1 · E8');
	assert.equal(newsWhen(i, NOW), 'Final de temporada · hace 2 días');
	assert.equal(watchLabel(i), 'Ver T1·E8');
	assert.equal(toRecentItem(i).season, 1);
	assert.equal(toRecentItem(i).episode, 8);
});
