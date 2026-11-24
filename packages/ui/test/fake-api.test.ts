// La Api falsa: el guion se devuelve y un fallo inyectado rechaza con su mensaje (si esto falla, fallan los tests de flujo por otro motivo).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fakeApi } from './fake-api.ts';
import { option, subtitle } from './fixtures/options.ts';

test('fakeApi: devuelve el guion y anota las llamadas', async () => {
	const { api, calls } = fakeApi({ subs: [subtitle('1')] });
	const list = await api.subs.find({ kind: 'movie', videoId: 'tt1' }, option('a'), { file: { hash: 'h', size: '1' } });
	assert.equal(list.length, 1);
	assert.deepEqual(calls, ['subs.find:h']);
});

test('fakeApi: un fallo inyectado rechaza con el mensaje', async () => {
	const { api } = fakeApi({ fail: { 'magnet.download': 'sin cupo' } });
	await assert.rejects(api.magnet.download('h', 'n'), /sin cupo/);
});
