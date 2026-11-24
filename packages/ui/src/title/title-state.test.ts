// Estado derivado de la ficha con las respuestas REALES del desktop (ui/mock/*.json) pasadas por su adaptador.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as adapt from '../../../../ui/src/tauri-adapt.ts';
import type * as Raw from '../../../../ui/src/types.ts';
import { chartModel, episodeRows, outlookOf, pickPeople, providerView, seasonTiles, showCineNote } from './title-state.ts';
import type { SeasonRatings } from '../types.ts';

const fixture = <T>(name: string): T => JSON.parse(readFileSync(new URL(`../../../../ui/mock/${name}.json`, import.meta.url), 'utf8')) as T;
const fight = adapt.titleDetails(fixture<Raw.Meta>('catalog_meta__movie_tt0137523'), fixture<Raw.DetailsView>('catalog_details__movie_tt0137523'), 'es');
const bad = adapt.titleDetails(fixture<Raw.Meta>('catalog_meta__series_tt0903747'), fixture<Raw.DetailsView>('catalog_details__series_tt0903747'), 'es');
const bare = adapt.titleDetails(fixture<Raw.Meta>('catalog_meta__movie_tt45368240'), fixture<Raw.DetailsView>('catalog_details__movie_tt45368240'), 'es');

test('pickPeople: director primero y a lo sumo 6 actores', () => {
	const people = pickPeople(fight.people);
	assert.ok(people.length <= 7);
	assert.equal(people.filter((p) => p.role === 'director').length <= 1, true);
	if (fight.people.some((p) => p.role === 'director')) assert.equal(people[0]?.role, 'director');
	const many = Array.from({ length: 9 }, (_, i) => ({ id: i, name: `a${i}`, photo: null, role: 'cast' as const, note: null }));
	assert.deepEqual(pickPeople([...many, { id: 99, name: 'd', photo: null, role: 'director', note: null }]).map((p) => p.id), [99, 0, 1, 2, 3, 4, 5]);
});

test('providerView: 3 apiladas + "+n"; abierta, todas', () => {
	const five = Array.from({ length: 5 }, (_, i) => ({ name: `p${i}`, logo: null }));
	assert.deepEqual([providerView(five, false).shown.length, providerView(five, false).more], [3, 2]);
	assert.deepEqual([providerView(five, true).shown.length, providerView(five, true).more], [5, 0]);
	assert.deepEqual(providerView(bare.providers, false), { shown: [], more: 0 });
});

test('seasonTiles: orden, Especiales al final y puntaje', () => {
	assert.ok(bad.seasons.length >= 5);
	const ratings: SeasonRatings = { seasons: [{ season: 2, rating: 8.7, episodes: 13 }], status: null };
	const tiles = seasonTiles([{ number: 0, name: null, episodeCount: 3, year: null }, ...[...bad.seasons].reverse()], ratings);
	assert.deepEqual(tiles.map((x) => x.number), [1, 2, 3, 4, 5, 0]);
	assert.equal(tiles.find((x) => x.number === 2)?.score, 8.7);
	assert.equal(tiles.find((x) => x.number === 1)?.score, null);
});

test('outlookOf: la serie terminada; el estado del puntaje gana al de la ficha', () => {
	const r = adapt.seasonRatings(fixture<Raw.SeasonRatings>('catalog_season_ratings__tt0903747_true'));
	assert.equal(outlookOf(bad, r)?.tone, 'done');
	assert.equal(outlookOf(bad, { seasons: [], status: { state: 'canceled', next: null } })?.tone, 'stop');
	assert.equal(outlookOf(bad, undefined)?.tone, 'done');
});

test('chartModel: nada con una temporada; barras, tendencia y "lo que viene"', () => {
	const one: SeasonRatings = { seasons: [{ season: 1, rating: 8, episodes: 8 }], status: null };
	assert.equal(chartModel(one, null), null);
	const ret = { tone: 'wait', label: 'Renovada', season: 2 } as const;
	assert.equal(chartModel(one, ret)?.ghost?.season, 2);
	const r: SeasonRatings = { seasons: [{ season: 1, rating: 7.4, episodes: 8 }, { season: 2, rating: 8.9, episodes: 10 }], status: null };
	const m = chartModel(r, { tone: 'done', label: 'Terminada' });
	assert.deepEqual(m?.bars.map((b) => [b.tone, b.best]), [['meh', false], ['great', true]]);
	assert.equal(m?.trend?.tone, 'up');
	assert.equal(m?.end, 'done');
	assert.equal(m?.ghost, null);
});

test('episodeRows: futuros atenuados', () => {
	const eps = adapt.episodes(fixture<Raw.Meta>('catalog_meta__series_tt0903747').episodes, fixture<Raw.EpisodeText[]>('catalog_episodes__tt0903747_1'), 1);
	assert.ok(eps.length >= 7);
	assert.equal(episodeRows(eps, '2099-01-01').some((x) => x.future), false);
	assert.equal(episodeRows(eps, '1900-01-01').every((x) => x.future === !!x.ep.date), true);
});

test('showCineNote: solo películas', () => {
	// Hace dos días en fecha local (`onlyCinema` lee la fecha a la medianoche local; la de UTC puede ser mañana).
	const recent = new Date(Date.now() - 2 * 864e5).toLocaleDateString('sv');
	assert.equal(showCineNote(fight), false);
	assert.equal(showCineNote({ ...fight, released: recent }), true);
	assert.equal(showCineNote({ ...bad, released: recent }), false);
});
