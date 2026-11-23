// Detalles de la tarjeta con las respuestas REALES del desktop (ui/mock/*.json) pasadas por su adaptador.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as adapt from '../../../../ui/src/tauri-adapt.ts';
import type * as Raw from '../../../../ui/src/types.js';
import { awardsText, cardSeasons, ratingTier } from './card-info.ts';
import { translate } from '../i18n/translate.ts';

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

test('awardsText: los premios del núcleo (en español) salen en el idioma de la app', () => {
	const en = (s: string, v?: Record<string, string | number>) => translate('en', s, v);
	const es = (s: string, v?: Record<string, string | number>) => translate('es', s, v);
	assert.equal(awardsText('Ganó 2 Óscar · 164 premios', en), 'Won 2 Oscars · 164 awards');
	assert.equal(awardsText('1 nominación al Óscar · 1 premio', en), '1 Oscar nomination · 1 award');
	assert.equal(awardsText('Ganó 59 Emmy · 3 nominaciones', en), 'Won 59 Emmys · 3 nominations');
	assert.equal(awardsText('Ganó 1 Globo de Oro', es), 'Ganó 1 Globo de Oro');
	assert.equal(awardsText('algo que no se reconoce', en), 'algo que no se reconoce');
});
