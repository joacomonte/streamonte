// Detalles de la tarjeta con las respuestas REALES del desktop (ui/mock/*.json) pasadas por su adaptador.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as adapt from '../../../../ui/src/tauri-adapt.ts';
import type * as Raw from '../../../../ui/src/types.js';
import { cardSeasons } from './card-info.ts';

const fixture = <T>(name: string): T => JSON.parse(readFileSync(new URL(`../../../../ui/mock/${name}.json`, import.meta.url), 'utf8')) as T;
const fight = adapt.titleDetails(fixture<Raw.Meta>('catalog_meta__movie_tt0137523'), fixture<Raw.DetailsView>('catalog_details__movie_tt0137523'), 'es');
const bad = adapt.titleDetails(fixture<Raw.Meta>('catalog_meta__series_tt0903747'), fixture<Raw.DetailsView>('catalog_details__series_tt0903747'), 'es');

test('fichas reales: géneros para el hover', () => {
	assert.ok(fight.genres.some((g) => /Drama/.test(g)));
});

test('cardSeasons: una barra por temporada y la serie terminada', () => {
	const seasons = [1, 2, 3].map((season) => ({ season, rating: 8 + season / 2, episodes: 10 }));
	const { chart, outlook } = cardSeasons({ status: null, seasons: bad.seasons }, { seasons, status: { state: 'ended', next: null } });
	assert.equal(chart?.bars.length, 3);
	assert.equal(chart?.end, 'done');
	assert.equal(outlook?.tone, 'done');
	assert.equal(cardSeasons(bad, { seasons: [], status: null }).chart, null);
});
