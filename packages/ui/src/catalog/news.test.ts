import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newsFromWire, unseenCount } from './news.ts';
import type { NewsItem, NewsItemWire, NewsListWire } from './news.ts';

const wire = (imdb: string, tmdb: number | null, date: string | null = null): NewsItemWire => ({
	kind: 'movie', imdb, tmdb, title: imdb, year: 2026, poster: null, backdrop: null, subgenres: [], overview: null,
	imdbRating: null, imdbVotes: null, what: null, date
});
const list = (fresh: NewsItemWire[], trending: NewsItemWire[]): NewsListWire => ({ fresh, trending, seenAt: null, updatedAt: null, stale: true, refreshing: false });

test('newsFromWire pone el id de cada app y descarta los que no tienen', () => {
	const out = newsFromWire(list([wire('tt1', 10), wire('tt2', null)], [wire('tt3', 30)]), (i) => (i.tmdb == null ? null : String(i.tmdb)));
	assert.deepEqual(out.fresh.map((i) => i.id), ['10']);
	assert.deepEqual(out.trending.map((i) => i.id), ['30']);
	assert.equal('tmdb' in out.fresh[0], false);
	assert.equal(out.stale, true);
});

test('unseenCount: sin seenAt cuentan todos; con seenAt, los posteriores', () => {
	const item = (date: string | null): NewsItem => ({ ...(wire('tt1', 1, date) as unknown as NewsItem), id: '1' });
	const fresh = [item('2026-11-20T00:00:00Z'), item('2026-11-10T00:00:00Z'), item(null)];
	assert.equal(unseenCount({ fresh, seenAt: null }), 3);
	assert.equal(unseenCount({ fresh, seenAt: '2026-11-15T00:00:00Z' }), 1);
	assert.equal(unseenCount({ fresh, seenAt: '2026-12-01T00:00:00Z' }), 0);
});
