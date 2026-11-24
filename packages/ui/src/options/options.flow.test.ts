// Flujo buscar → opciones → link con la Api falsa de packages/ui/test (la misma lógica en desktop y web), con fallos inyectados.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fakeApi, type FakeScript } from '../../test/fake-api.ts';
import { option, update } from '../../test/fixtures/options.ts';
import { loadOptions, type OptionsLoad } from './options-load.ts';

const ref = { kind: 'movie', videoId: 'tt1' } as const;
const run = async (script: FakeScript) => {
	const { api, calls } = fakeApi(script);
	const seen: OptionsLoad[] = [];
	await loadOptions(api, ref, (s) => seen.push(s), () => true);
	return { api, calls, seen, last: seen[seen.length - 1] };
};

test('buscar → opciones: la web (progreso y lista final)', async () => {
	const a = option('aaa');
	const b = option('bbb');
	const { calls, last, seen } = await run({
		updates: [update({ progress: { done: 1, total: 2 } }), update({ options: [a, b], progress: { done: 2, total: 2 }, done: true })]
	});
	assert.equal(seen[0]?.options, null);
	assert.equal(last?.done, true);
	assert.deepEqual(last?.options?.map((o) => o.hash), ['aaa', 'bbb']);
	assert.deepEqual(calls, ['options.load']);
});

test('desktop: una actualización por tanda, la lista crece y no se vacía', async () => {
	const { last, seen } = await run({ updates: [update({ options: [option('a')] }), update({ options: [option('a'), option('b')] }), update({ progress: { done: 2, total: 2 } }), update({ done: true, options: [option('a'), option('b')] })] });
	assert.equal(seen[2]?.options?.length, 2); // la actualización de progreso sin opciones no vacía la lista
	assert.equal(last?.options?.length, 2);
	assert.equal(last?.done, true);
});

test('fallo al buscar: el error se muestra y no hay lista', async () => {
	const { last } = await run({ fail: { 'options.load': 'TorBox no responde' } });
	assert.equal(last?.error, 'TorBox no responde');
	assert.equal(last?.options, null);
	assert.equal(last?.done, false);
});
