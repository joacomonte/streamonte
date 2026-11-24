// Actividad (activity-feed.ts): evento → líneas (solo cambios), resumen de lo que corre y agrupado de líneas.
import './test-stub.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { busyText, eventLines, mergeLine, type Line } from './activity-feed.ts';
import { emptyLive, reduce, type Live } from './live.ts';
import type { CoreEvent, LibraryRow, PlaybackRow } from './types.ts';

const entry = (key: string, more: Partial<LibraryRow> = {}): LibraryRow =>
	({ key, info_hash: key.split(':')[0], name: 'dn.mkv', torrent_name: null, live: null, release: null, ...more }) as LibraryRow;
const row = (id: number, key: string, kind: PlaybackRow['state']['kind'], more: Partial<PlaybackRow> = {}): PlaybackRow =>
	({ id, key, info_hash: key.split(':')[0], name: 'Video', state: { kind }, progress: 0, speed_bps: 0, peers: 0, ...more }) as PlaybackRow;

/** Aplica eventos y junta las líneas como lo hace live.svelte.ts. */
function feed(events: CoreEvent[], s: Live = emptyLive()): { s: Live; texts: string[] } {
	const texts: string[] = [];
	for (const ev of events) { texts.push(...eventLines(s, ev).map((l) => l.text)); s = reduce(s, ev); }
	return { s, texts };
}

test('eventLines: fila nueva, metadatos y reproducción, solo al cambiar de estado', () => {
	const { texts } = feed([
		{ type: 'library-entry-updated', entry: entry('aa:1', { name: 'Peli' }) },
		{ type: 'library-entry-updated', entry: entry('aa:1', { name: 'Peli', torrent_name: 'Peli.1080p' }) },
		{ type: 'playback-updated', row: row(1, 'aa:1', 'playing', { progress: 0.5, speed_bps: 1e6, peers: 3 }) },
		{ type: 'playback-updated', row: row(1, 'aa:1', 'playing', { progress: 0.6, speed_bps: 1e6, peers: 3 }) },
		{ type: 'playback-removed', id: 1 }
	]);
	assert.deepEqual(texts, [
		'Agregado: Peli',
		'Metadatos de Peli.1080p: Peli.1080p',
		'Reproduciendo Peli.1080p en mpv',
		'Bajando Peli.1080p: 50 % · 8 Mbps · 3 peers',
		'Bajando Peli.1080p: 60 % · 8 Mbps · 3 peers',
		'Descarga de Peli.1080p borrada'
	]);
});

test('eventLines: análisis cuenta el cambio de fase, no cada tic; activity y status pasan tal cual', () => {
	const { texts } = feed([
		{ type: 'analyzer-progress', state: { kind: 'scraping', total: 2 } },
		{ type: 'analyzer-progress', state: { kind: 'scraping', total: 2 } },
		{ type: 'analyzer-progress', state: { kind: 'idle' } },
		{ type: 'activity', level: 'warn', area: 'red', message: 'sin red', at: '2026-11-22T10:00:00Z' },
		{ type: 'status', level: 'info', message: 'listo' }
	]);
	assert.deepEqual(texts, ['Consultando trackers de 2 magnet(s)', 'Análisis terminado: la lista quedó ordenada de mejor a peor', 'sin red', 'listo']);
	const failed = eventLines(emptyLive(), { type: 'playback-updated', row: row(2, 'bb:1', 'failed', { state: { kind: 'failed', message: 'boom' } }) });
	assert.equal(failed[0]?.level, 'error');
});

test('busyText: reproducciones, análisis y cola', () => {
	const { s } = feed([
		{ type: 'library-entry-updated', entry: entry('aa:1', { name: 'Peli' }) },
		{ type: 'playback-updated', row: row(1, 'aa:1', 'background', { progress: 0.42 }) },
		{ type: 'analyzer-queue', queued: ['x', 'y'], held: [] },
		{ type: 'analyzer-progress', state: { kind: 'scraping', total: 2 } }
	]);
	assert.equal(busyText(s), 'Bajando Peli de fondo · 42 % · Consultando trackers · 2 en cola');
	assert.equal(busyText(emptyLive()), '');
});

test('mergeLine: misma key se actualiza en su lugar; repetida seguida cuenta ×N; área desconocida → general', () => {
	let lines: Line[] = [];
	let last = null as Line | null;
	let id = 0;
	const push = (area: string, text: string, key?: string) => {
		const r = mergeLine(lines, last, { area, text, key }, id++);
		lines = r.lines; last = r.last;
		return r.added;
	};
	assert.equal(push('motor', 'Bajando 10 %', 'dl:1'), true);
	assert.equal(push('analisis', 'otra'), true);
	assert.equal(push('motor', 'Bajando 20 %', 'dl:1'), false);
	assert.deepEqual(lines.map((l) => l.text), ['Bajando 20 %', 'otra'], 'queda en su lugar');
	assert.equal(last?.text, 'Bajando 20 %');
	push('x', 'hola');
	push('x', 'hola');
	assert.equal(lines.at(-1)?.n, 2);
	assert.equal(lines.at(-1)?.area, 'general');
});
