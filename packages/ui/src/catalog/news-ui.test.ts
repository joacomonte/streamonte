import { test } from 'node:test';
import assert from 'node:assert/strict';
import { castLine, compactVotes, newsAgo, newsDay, newsKicker, newsWhy, toCatalogItem, toRecentItem, watchLabel } from './news-ui.ts';
import type { NewsItem } from './news.ts';

const NOW = Date.parse('2026-11-26T12:00:00Z');
const base: NewsItem = { kind: 'tv', imdb: 'tt1', id: 'tt1', title: 'X', year: 2025, poster: null, backdrop: null, subgenres: [], overview: null, imdbRating: 7.44, imdbVotes: 270000, what: null, date: '2026-11-24T10:00:00Z' };
const ep = (finale: boolean): NewsItem['what'] => ({ type: 'episode', season: 2, episode: 10, finale });

test('newsAgo: por día', () => {
	assert.equal(newsAgo('2026-11-26T08:00:00Z', NOW), 'hoy');
	assert.equal(newsAgo('2026-11-25T08:00:00Z', NOW), 'ayer');
	assert.equal(newsAgo('2026-11-23T08:00:00Z', NOW), 'hace 3 días');
});

test('newsDay: día y mes corto en el idioma', () => {
	assert.equal(newsDay('2026-11-24', 'es-AR'), '24 nov');
	assert.equal(newsDay('2026-11-24T10:00:00Z', 'en-US'), 'Nov 24');
});

test('compactVotes', () => {
	assert.equal(compactVotes(850), '850');
	assert.equal(compactVotes(73400), '73k');
	assert.equal(compactVotes(2400000), '2,4M');
});

test('película con estreno digital: kicker, sinopsis, Ver, abre la ficha', () => {
	const i: NewsItem = { ...base, kind: 'movie', what: { type: 'title' }, reason: { type: 'digital', date: '2026-11-24' } };
	assert.deepEqual(newsKicker(i, 'es-AR', NOW), { type: 'Película', tone: 'new', motive: 'Estreno digital en EE.UU. · 24 nov', finale: false });
	assert.equal(newsWhy(i), null);
	assert.equal(watchLabel(i), 'Ver');
	assert.deepEqual(toCatalogItem(i), { id: 'tt1', kind: 'movie', title: 'X', year: '2025', poster: null, rating: '7.4', released: null, documentary: false });
});

test('serie nueva: tendencia y estreno (relativo hasta 7 días, después la fecha)', () => {
	const i: NewsItem = { ...base, what: { type: 'title' } };
	assert.equal(newsKicker({ ...i, reason: { type: 'trending', rank: 3 } }, 'es-AR', NOW).motive, 'Tendencia #3 esta semana');
	assert.equal(newsKicker({ ...i, reason: { type: 'premiere', date: '2026-11-25T08:00:00Z' } }, 'es-AR', NOW).motive, 'Se estrenó ayer');
	assert.equal(newsKicker({ ...i, reason: { type: 'premiere', date: '2026-11-13' } }, 'es-AR', NOW).motive, 'Se estrenó el 13 nov');
	assert.equal(newsKicker(i, 'es-AR', NOW).type, 'Serie nueva');
});

test('capítulo nuevo con el último visto y final de temporada', () => {
	const i: NewsItem = { ...base, title: 'Severance', what: ep(true), date: '2026-11-25T08:00:00Z', reason: { type: 'episode', lastSeen: { season: 2, episode: 9 } } };
	assert.deepEqual(newsKicker(i, 'es-AR', NOW), { type: 'Capítulo nuevo', tone: 'ep', motive: 'T2·E10 salió ayer', finale: true });
	assert.equal(newsWhy(i), 'Seguís Severance: el último que viste fue T2·E9. Este cierra la temporada.');
	assert.equal(newsWhy({ ...i, what: ep(false), reason: { type: 'episode', lastSeen: null } }), 'Seguís Severance.');
	assert.equal(watchLabel(i), 'Ver T2·E10');
	assert.equal(toRecentItem(i).season, 2);
	assert.equal(toRecentItem(i).episode, 10);
});

test('temporada nueva: completa o recién empezada', () => {
	const i: NewsItem = { ...base, what: { type: 'episode', season: 4, episode: 1, finale: false }, reason: { type: 'season', season: 4, full: true, episodes: 10 } };
	assert.deepEqual(newsKicker(i, 'es-AR', NOW), { type: 'Temporada nueva', tone: 'season', motive: 'Temporada 4 completa disponible', finale: false });
	assert.equal(newsWhy(i), 'Salieron los 10 capítulos de la temporada 4 el mismo día.');
	assert.equal(watchLabel(i), 'Ver T4');
	const started: NewsItem = { ...i, reason: { type: 'season', season: 4, full: false, episodes: 10 } };
	assert.equal(newsKicker(started, 'es-AR', NOW).motive, 'Temporada 4 · E1 salió hace 2 días');
	assert.equal(newsWhy(started), 'Empezó la temporada 4.');
});

test('sin reason (desktop actual): tipo por kind/what y motivo = cuándo salió', () => {
	assert.deepEqual(newsKicker({ ...base, kind: 'movie', what: { type: 'title' } }, 'es-AR', NOW), { type: 'Película', tone: 'new', motive: 'hace 2 días', finale: false });
	assert.equal(newsKicker({ ...base, what: { type: 'title' } }, 'es-AR', NOW).type, 'Serie nueva');
	const e: NewsItem = { ...base, title: 'Severance', what: ep(false) };
	assert.deepEqual(newsKicker(e, 'es-AR', NOW), { type: 'Capítulo nuevo', tone: 'ep', motive: 'hace 2 días', finale: false });
	assert.equal(newsWhy(e), 'Seguís Severance.');
});

test('castLine', () => {
	assert.equal(castLine(['Adam Scott', 'Britt Lower', 'Otro']), 'Con Adam Scott y Britt Lower');
	assert.equal(castLine(['Adam Scott']), 'Con Adam Scott');
	assert.equal(castLine([]), null);
	assert.equal(castLine(undefined), null);
});
