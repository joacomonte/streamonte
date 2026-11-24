// Reglas puras de la lista de opciones del desktop (options-logic.ts), con candidatos grabados en `ui/mock/`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { bgTone, etaSecs, fileBytesOf, isUnlikely, leechersFrom, learned, pickLine, pinActive, playbackFor, quickGroupOf, scanSecs, seedsOf, topFinalists, trackersWin, type Count } from './options-logic.ts';
import type { CoreEvent, PlaybackRow, StreamCandidate, StreamsUpdate } from './types.ts';

const lastUpdate = (slug: string): StreamsUpdate => {
	const events = JSON.parse(readFileSync(new URL(`../mock/events__catalog_streams__${slug}.json`, import.meta.url), 'utf8')) as CoreEvent[];
	const last = events.findLast((e) => e.type === 'catalog-streams');
	if (last?.type !== 'catalog-streams') throw new Error(`sin catalog-streams en ${slug}`);
	return last.update;
};
const movie = lastUpdate('movie_tt0137523').candidates;
const series = lastUpdate('series_tt0903747-1-1').candidates;
const byHash = (list: StreamCandidate[], prefix: string): StreamCandidate => {
	const c = list.find((x) => x.info_hash.startsWith(prefix));
	if (!c) throw new Error(`sin ${prefix}`);
	return c;
};
const count = (seeds: number, peers: number, reached = true): Count => ({ seeds, peers, reached });

test('quickGroupOf: testeada, 8+, 3-7, sin probar, 1-2, nadie', () => {
	assert.equal(quickGroupOf(true, undefined), 0);
	assert.equal(quickGroupOf(false, count(8, 20)), 0);
	assert.equal(quickGroupOf(false, count(3, 9)), 1);
	assert.equal(quickGroupOf(false, undefined), 2);
	assert.equal(quickGroupOf(false, count(2, 4)), 3);
	assert.equal(quickGroupOf(false, count(0, 5, false)), 3, 'sin respuesta pero con gente conocida');
	assert.equal(quickGroupOf(false, count(0, 0, false)), 4);
	assert.equal(quickGroupOf(false, count(0, 3)), 4);
});

test('trackersWin / seedsOf: el 0 del tracker con la fuente diciendo más vale la fuente', () => {
	const normal = byHash(movie, '40712b59'); // 17 trackers, 40 fuente
	assert.equal(trackersWin(normal), true);
	assert.equal(seedsOf(normal), 17);
	const zero = byHash(movie, 'f5ca8846'); // 0 trackers, 1 fuente
	assert.equal(trackersWin(zero), false);
	assert.equal(seedsOf(zero), 1);
	assert.equal(seedsOf({ ...zero, seeders_declared: 0 }), 0, 'tracker 0 y fuente 0: vale el tracker');
});

test('isUnlikely: 0/0 sin fuente, salvo que el censo vea gente', () => {
	const dead = { ...byHash(movie, '3fa999f5'), seeders: 0, leechers: 0, seeders_declared: 0 };
	assert.equal(isUnlikely(dead, undefined), true);
	assert.equal(isUnlikely(dead, 3), false);
	assert.equal(isUnlikely(byHash(movie, '40712b59'), undefined), false);
});

test('topFinalists: los de más seeds contados (desempate peers), sin los de 0', () => {
	const counted = new Map<string, Count>([
		[movie[0].info_hash, count(5, 10)],
		[movie[1].info_hash, count(9, 12)],
		[movie[2].info_hash, count(5, 30)],
		[movie[3].info_hash, count(0, 8)],
	]);
	assert.deepEqual(topFinalists(movie, counted, 2), [movie[1].info_hash, movie[2].info_hash]);
	assert.equal(topFinalists(movie, counted, 8).length, 3);
});

test('fileBytesOf: peli entera; pack ÷ episodios, el archivo de la fuente, o nada si son varias temporadas', () => {
	assert.equal(fileBytesOf(byHash(movie, '40712b59'), null, 0), 13636521164);
	const pack = byHash(series, '46bbb2af');
	assert.equal(fileBytesOf(pack, 123, 7), 123, 'el episodio ya leído manda');
	assert.equal(fileBytesOf(pack, null, 7), pack.size_bytes, 'la fuente señala el archivo');
	const noFile = { ...pack, file_name: null };
	assert.equal(fileBytesOf(noFile, null, 7), (pack.size_bytes ?? 0) / 7);
	assert.equal(fileBytesOf({ ...byHash(series, '1b42b99b'), file_name: null }, null, 7), null, 'S01-S05');
});

test('playbackFor / pinActive: gana la más viva; fijadas arriba las activas', () => {
	const row = (id: number, key: string, kind: PlaybackRow['state']['kind']): PlaybackRow => ({ id, key, state: { kind } }) as PlaybackRow;
	const rows = [row(1, 'aa:s1e1', 'paused'), row(2, 'aa:s1e2', 'playing'), row(3, 'bb', 'failed')];
	assert.equal(playbackFor(rows, 'aa')?.id, 2);
	assert.equal(playbackFor(rows, 'cc'), undefined);
	const list = [{ info_hash: 'cc' }, { info_hash: 'bb' }, { info_hash: 'aa' }];
	assert.deepEqual(pinActive(list, rows).map((c) => c.info_hash), ['aa', 'cc', 'bb'], 'la fallida no sube');
});

test('pickLine, bgTone, eta y leechers', () => {
	assert.equal(pickLine([null, 'a', 0, 'b', false], 0, 1000), 'a');
	assert.equal(pickLine([null, 'a', 0, 'b', false], 1000, 1000), 'b');
	assert.equal(pickLine([null, false], 0, 1000), undefined);
	assert.equal(bgTone(1.5), 'green');
	assert.equal(bgTone(1.2), 'yellow');
	assert.equal(bgTone(0.9), 'red');
	assert.equal(etaSecs({}, 15, 15, 10), 35 + 2 * 110);
	assert.equal(etaSecs({ quick: 20, deepBatch: 60 }, 4, 15, 10), 80);
	assert.equal(learned(undefined, 10), 10);
	assert.equal(learned(10, 20), 13);
	assert.equal(scanSecs(4, true), 32);
	assert.equal(scanSecs(4, false), 120);
	assert.equal(leechersFrom(count(3, 10), 99), 7);
	assert.equal(leechersFrom(count(0, 10, false), 99), null);
	assert.equal(leechersFrom(null, 4), 4);
});
