// Reductor del estado en vivo (live.ts): eventos del núcleo → `Live` nuevo, sin mutar el anterior.
import './test-stub.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyLive, loaded, reduce, titleOf } from './live.ts';
import type { CoreEvent, LibraryRow, PlaybackRow } from './types.js';

const entry = (key: string, more: Partial<LibraryRow> = {}): LibraryRow =>
	({ key, info_hash: key.split(':')[0], name: 'dn.mkv', torrent_name: null, live: null, release: null, ...more }) as LibraryRow;
const row = (id: number, key: string, kind: PlaybackRow['state']['kind'], more: Partial<PlaybackRow> = {}): PlaybackRow =>
	({ id, key, info_hash: key.split(':')[0], name: 'Video', state: { kind }, progress: 0, speed_bps: 0, peers: 0, ...more }) as PlaybackRow;

test('reduce: biblioteca y reproducciones, inmutable', () => {
	const s0 = emptyLive();
	const s1 = reduce(s0, { type: 'library-entry-updated', entry: entry('aa:1') });
	assert.equal(s0.entries.size, 0, 'no muta el anterior');
	assert.equal(s1.entries.get('aa:1')?.name, 'dn.mkv');
	const s2 = reduce(s1, { type: 'playback-updated', row: row(7, 'aa:1', 'playing') });
	assert.equal(s2.entries, s1.entries, 'lo que no cambia conserva la referencia');
	assert.equal(s2.playbacks.get(7)?.state.kind, 'playing');
	const s3 = reduce(s2, { type: 'playback-removed', id: 7 });
	assert.equal(s3.playbacks.size, 0);
	assert.equal(reduce(s3, { type: 'playback-removed', id: 7 }), s3, 'quitar lo que no está no cambia nada');
	assert.equal(reduce(s3, { type: 'library-entry-removed', key: 'aa:1' }).entries.size, 0);
});

test('reduce: análisis y cola; los demás eventos no tocan el estado', () => {
	const s0 = emptyLive();
	const s1 = reduce(s0, { type: 'analyzer-queue', queued: ['h1', 'h2'], held: ['h3'] });
	assert.deepEqual(s1.queued, ['h1', 'h2']);
	assert.ok(s1.held.has('h3'));
	const s2 = reduce(s1, { type: 'analyzer-progress', state: { kind: 'scraping', total: 2 } });
	assert.equal(s2.analyzer.kind, 'scraping');
	const other: CoreEvent = { type: 'status', level: 'info', message: 'hola' } as CoreEvent;
	assert.equal(reduce(s2, other), s2);
});

test('loaded: no pisa filas que ya llegaron por evento', () => {
	const s1 = reduce(emptyLive(), { type: 'library-entry-updated', entry: entry('aa:1', { name: 'nuevo' }) });
	const s2 = loaded(s1, { pasted_now: [entry('aa:1', { name: 'viejo' })], previous: [entry('bb:1')] }, [row(1, 'bb:1', 'paused')]);
	assert.equal(s2.entries.get('aa:1')?.name, 'nuevo');
	assert.equal(s2.entries.size, 2);
	assert.equal(s2.playbacks.size, 1);
});

test('titleOf: release con episodio, por key o por info_hash, y desconocido', () => {
	const s = reduce(emptyLive(), { type: 'library-entry-updated', entry: entry('aa:1', { release: { title: 'Serie', season: 1, episode: 2 } as LibraryRow['release'] }) });
	assert.equal(titleOf(s, 'aa:1'), 'Serie T1·E2');
	assert.equal(titleOf(s, 'aa'), 'Serie T1·E2');
	assert.equal(titleOf(s, 'zz'), 'un torrent');
});
