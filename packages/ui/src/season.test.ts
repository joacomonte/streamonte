import { test } from 'node:test';
import assert from 'node:assert/strict';
import { barHeight, seasonOutlook, seasonTone, seasonTrend } from './season.ts';
import type { SeasonRatings } from './types.ts';

const rated = (...v: number[]): SeasonRatings => ({ seasons: v.map((rating, i) => ({ season: i + 1, rating, episodes: 8 })), status: null });

test('seasonTone: cortes 8.5 / 7.5 / 6.5', () => {
	assert.deepStrictEqual([9, 8.5, 8, 7.5, 7, 6.5, 6].map(seasonTone), ['great', 'great', 'good', 'good', 'meh', 'meh', 'bad']);
});
test('seasonTrend', () => {
	assert.deepStrictEqual(seasonTrend(rated(8)), null);
	assert.deepStrictEqual(seasonTrend(rated(8, 8.2))?.tone, 'flat');
	assert.deepStrictEqual(seasonTrend(rated(7, 8, 8.5))?.tone, 'up');
	assert.deepStrictEqual(seasonTrend(rated(9, 8))?.icon, 'trend-down');
});
test('barHeight: la mejor llena, la peor mínimo 12', () => {
	const v = [1, 10];
	assert.deepStrictEqual(barHeight(v, 10), 100);
	assert.deepStrictEqual(barHeight(v, 1), 12);
	assert.deepStrictEqual(Math.round(barHeight([7, 9], 7)), 33);
	assert.deepStrictEqual(barHeight([8, 8], 8), 100);
});
test('seasonOutlook', () => {
	const now = new Date('2026-01-10T20:00:00');
	assert.deepStrictEqual(seasonOutlook(null, 3), null);
	assert.deepStrictEqual(seasonOutlook({ state: 'ended', next: null }, 3), { tone: 'done', label: 'Terminada' });
	assert.deepStrictEqual(seasonOutlook({ state: 'canceled', next: null }, 3)?.tone, 'stop');
	assert.deepStrictEqual(seasonOutlook({ state: 'returning', next: null }, 3, now), { tone: 'wait', label: 'Renovada', season: 4 });
	assert.deepStrictEqual(seasonOutlook({ state: 'returning', next: { season: 4, episode: 1, date: '2026-01-05' } }, 3, now)?.tone, 'wait');
	assert.deepStrictEqual(seasonOutlook({ state: 'returning', next: { season: 4, episode: 1, date: '2026-01-13' } }, 3, now),
		{ tone: 'go', label: 'En emisión', season: 4, episode: 1, date: '2026-01-13', days: 3 });
});
