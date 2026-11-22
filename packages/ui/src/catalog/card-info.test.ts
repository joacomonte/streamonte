// Detalles de la tarjeta con las respuestas REALES del desktop (ui/mock/*.json) pasadas por su adaptador.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as adapt from '../../../../ui/src/tauri-adapt.ts';
import type * as Raw from '../../../../ui/src/types.js';
import { cardMeta, cardSeasons, ratingTier } from './card-info.ts';

const fixture = <T>(name: string): T => JSON.parse(readFileSync(new URL(`../../../../ui/mock/${name}.json`, import.meta.url), 'utf8')) as T;
const fight = adapt.titleDetails(fixture<Raw.Meta>('catalog_meta__movie_tt0137523'), fixture<Raw.DetailsView>('catalog_details__movie_tt0137523'), 'es');
const bad = adapt.titleDetails(fixture<Raw.Meta>('catalog_meta__series_tt0903747'), fixture<Raw.DetailsView>('catalog_details__series_tt0903747'), 'es');

test('ratingTier: cortes distintos para película y serie', () => {
	assert.equal(ratingTier('movie', '8.8')?.name, 'Clásico eterno');
	assert.equal(ratingTier('tv', '8.8')?.name, 'De Óscar');
	assert.equal(ratingTier('movie', '8.0')?.name, 'De Óscar');
	assert.equal(ratingTier('movie', '3.1')?.name, 'De culto entre amigos');
	assert.equal(ratingTier('movie', null), null);
	assert.equal(ratingTier('movie', '0'), null);
});

test('cardMeta: duración solo en películas', () => {
	assert.equal(cardMeta(fight), `${fight.year} · ★ ${fight.rating} · 139 min`);
	assert.ok(!cardMeta(bad).includes('min'));
	assert.equal(cardMeta({ kind: 'movie', year: null, rating: null, runtimeMin: null }), '');
});

test('fichas reales: géneros y premios para el hover', () => {
	assert.ok(fight.genres.some((g) => /Drama/.test(g)));
	assert.ok(/premios/.test(fight.awards ?? ''));
	assert.ok(/Emmy/.test(bad.awards ?? ''));
});

test('cardSeasons: una barra por temporada y la serie terminada', () => {
	const seasons = [1, 2, 3].map((season) => ({ season, rating: 8 + season / 2, episodes: 10 }));
	const { chart, outlook } = cardSeasons({ status: null, seasons: bad.seasons }, { seasons, status: { state: 'ended', next: null } });
	assert.equal(chart?.bars.length, 3);
	assert.equal(chart?.end, 'done');
	assert.equal(outlook?.tone, 'done');
	assert.equal(cardSeasons(bad, { seasons: [], status: null }).chart, null);
});
