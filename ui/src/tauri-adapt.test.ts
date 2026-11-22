// Los adaptadores con las respuestas REALES grabadas del núcleo (ui/mock/*.json): `cargo run -p streamonte-core --example record_fixtures`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as adapt from './tauri-adapt.ts';
import type * as Raw from './types.js';

/** La fixture ya tiene la forma de `Raw.*` (la grabó el núcleo): se lee como tal. */
const fixture = <T>(name: string): T => JSON.parse(readFileSync(new URL(`../mock/${name}.json`, import.meta.url), 'utf8')) as T;

test('search: kind series → tv, name → title, imdb_rating → rating', () => {
	const items = adapt.catalogItems(fixture<Raw.CatalogItem[]>('catalog_search__fight-club'));
	assert.deepEqual(items[0], { id: 'tt0137523', kind: 'movie', title: 'Fight Club', year: '1999', poster: 'https://images.metahub.space/poster/small/tt0137523/img', rating: '8.8', released: null, excluded: false });
	assert.ok(items.some((i) => i.kind === 'tv'), 'una serie sale como tv');
});

test('trending: has_more → hasMore', () => {
	const page = adapt.catalogPage(fixture<Raw.BrowsePage>('catalog_trending__movie_0'));
	assert.equal(page.items[0]?.title, 'The Odyssey');
	assert.equal(page.items[0]?.rating, '8.4');
	assert.equal(page.items[0]?.released, '2026-07-17');
	assert.equal(typeof page.hasMore, 'boolean');
});

test('genres: id numérico → string', () => {
	assert.deepEqual(adapt.genres(fixture<Raw.GenreName[]>('catalog_genres__movie')).slice(0, 2), [{ id: '28', name: 'Action' }, { id: '12', name: 'Adventure' }]);
});

test('titleDetails de serie: Cinemeta + TMDB, estado, temporadas desde los episodios', () => {
	const d = adapt.titleDetails(fixture<Raw.Meta>('catalog_meta__series_tt0903747'), fixture<Raw.DetailsView>('catalog_details__series_tt0903747'), 'es');
	assert.equal(d.id, 'tt0903747');
	assert.equal(d.kind, 'tv');
	assert.equal(d.title, 'Breaking Bad');
	assert.equal(d.imdb, 'tt0903747');
	assert.equal(d.runtimeMin, 49);
	assert.equal(d.rating, '9.5');
	assert.equal(d.trailer, 'VFkjBy2b50Q');
	assert.deepEqual(d.status, { state: 'ended', next: null });
	assert.equal(d.originalLanguage, 'en');
	assert.equal(d.languageName, 'inglés');
	assert.deepEqual(d.networks, ['AMC']);
	assert.equal(d.providers[0]?.name, 'Netflix');
	assert.ok(d.people.length > 0 && d.people.every((p) => p.role === 'cast' || p.role === 'director'));
	assert.ok(d.seasons.length >= 5 && d.seasons[0]?.number === 1 && d.seasons[0].episodeCount > 0);
});

test('titleDetails de película, sin TMDB (sin key): cae a Cinemeta', () => {
	const d = adapt.titleDetails(fixture<Raw.Meta>('catalog_meta__movie_tt0137523'), { has_key: false, details: null });
	assert.equal(d.kind, 'movie');
	assert.equal(d.title, 'Fight Club');
	assert.equal(d.overview?.length ? true : false, true);
	assert.deepEqual(d.people, []);
	assert.deepEqual(d.seasons, []);
	assert.equal(d.status, null);
	assert.equal(d.originalLanguage, null);
});

test('titleDetails de película con TMDB: título e idioma de la app, director', () => {
	const d = adapt.titleDetails(fixture<Raw.Meta>('catalog_meta__movie_tt0137523'), fixture<Raw.DetailsView>('catalog_details__movie_tt0137523'));
	assert.equal(d.title, 'El club de la pelea');
	assert.ok(d.people.some((p) => p.role === 'director'));
});

test('episodes: nombre y sinopsis en el idioma elegido, fecha ISO corta', () => {
	const meta = fixture<Raw.Meta>('catalog_meta__series_tt0903747');
	const texts = fixture<Raw.EpisodeText[]>('catalog_episodes__tt0903747_1');
	const eps = adapt.episodes(meta.episodes, texts, 1);
	assert.equal(eps.length, texts.length);
	assert.deepEqual([eps[0]?.season, eps[0]?.number, eps[0]?.title, eps[0]?.date], [1, 1, 'Principio del fin', '2008-01-21']);
	assert.equal(adapt.episodes(meta.episodes, [], 1)[0]?.title, 'Pilot');
});

test('seasonRatings: status de la serie', () => {
	assert.deepEqual(adapt.seasonRatings(fixture<Raw.SeasonRatings>('catalog_season_ratings__tt0903747_true')), { seasons: [], status: { state: 'ended', next: null } });
});

test('similar', () => {
	const s = adapt.similar(fixture<Raw.Similar[]>('catalog_similar__movie_tt0137523'));
	assert.deepEqual(s[0], { id: 'tt0180093', title: 'Réquiem por un sueño', year: '2000', poster: 'https://image.tmdb.org/t/p/w500/tz2xgFG1peQGcUUCywVwFMFvSYd.jpg', rating: 8.3 });
});

test('optionsUpdate: evento catalog-streams de película', () => {
	const ev = fixture<{ type: string; update: Raw.StreamsUpdate }[]>('events__catalog_streams__movie_tt0137523');
	const raw = ev[ev.length - 1]?.update; // la secuencia es progresiva: el último evento trae todo
	assert.ok(raw);
	const up = adapt.optionsUpdate(raw);
	assert.equal(up.done, true);
	assert.equal(up.options.length, raw.candidates.length);
	assert.equal(up.sources.length, raw.addons.length);
	assert.deepEqual(up.progress, { done: raw.addons.filter((a) => a.state !== 'pending').length, total: raw.addons.length });
	const first = up.options[0];
	assert.equal(first?.hash, '40712b59caaee09d17a4337c7f357bb2a57a48d6');
	assert.equal(first?.resolution, '1080p');
	assert.equal(first?.sizeBytes, 13636521164);
	assert.equal(first?.seeds, 17);
	assert.equal(first?.leechers, 1);
	assert.equal(first?.source, 'BluRay');
	assert.deepEqual(first?.audio, ['en', 'cast', 'it']);
	assert.equal(first?.hint, 'spain');
	assert.equal(first?.isPack, false);
	assert.equal(adapt.optionsUpdate(raw, new Set(['40712b59caaee09d17a4337c7f357bb2a57a48d6'])).options[0]?.subFile, true);
});

test('optionsUpdate: serie (episodio) también', () => {
	const ev = fixture<{ type: string; update: Raw.StreamsUpdate }[]>('events__catalog_streams__series_tt0903747-1-1');
	const up = adapt.optionsUpdate(ev[ev.length - 1]?.update as Raw.StreamsUpdate);
	assert.ok(up.options.length > 0 && up.options.every((o) => o.hash.length === 40));
});

test('quota / subtitle / magnet', () => {
	assert.deepEqual(adapt.quota({ has_key: true, has_login: false, login_error: null, remaining: 4, per_day: 5, resets_at: '2026-11-23T00:00:00Z' }), { hasKey: true, remaining: 4, perDay: 5, resetsAt: Date.parse('2026-11-23T00:00:00Z'), loginError: null });
	const sub = adapt.subtitle({ key: 'premium:77', provider: 'OpenSubtitles.com', language: 'es', release_name: 'X', downloads: 3, path: '', level: 'release', latino: true, head: '', spec: '' }, true);
	assert.deepEqual([sub.id, sub.premium, sub.level, sub.latino], ['premium:77', true, 'release', true]);
	const view = adapt.magnetView({ status: { state: 'cached', name: 'Peli', progress: 0, speed: 0, seeds: 3, eta: 0, files: [{ name: 'a.mkv', size: 100 }] }, ident: { kind: 'series', id: 'tt1', name: 'Show', year: '2020', poster: null, rating: null, season: 1, episode: 2 } }, 'h'.repeat(40));
	assert.equal(view.status.options[0]?.sizeBytes, 100);
	assert.deepEqual([view.ident?.kind, view.ident?.season], ['tv', 1]);
});

test('apiEvent: catalog-streams / excluded / subtitles; el resto es null', () => {
	const streams = fixture<Raw.CoreEvent[]>('events__catalog_streams__movie_tt0137523')[0];
	assert.ok(streams);
	const e = adapt.apiEvent(streams);
	assert.deepEqual([e?.type, e?.type === 'options' ? e.videoId : null], ['options', 'tt0137523']);
	assert.deepEqual(adapt.apiEvent({ type: 'catalog-excluded', id: 'tt1' }), { type: 'excluded', id: 'tt1' });
	assert.deepEqual(adapt.apiEvent({ type: 'catalog-subtitles-progress', video_id: 'tt1', downloading: true, done: 1, total: 3 }), { type: 'subtitles-progress', videoId: 'tt1', downloading: true, done: 1, total: 3 });
	assert.equal(adapt.apiEvent({ type: 'confirm-close', active: 1 }), null);
});
