// Flujo buscar → opciones → link con la Api falsa de packages/ui/test (la misma lógica en desktop y web), con fallos inyectados.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fakeApi, type FakeScript } from '../../test/fake-api.ts';
import { link, option, update } from '../../test/fixtures/options.ts';
import { loadOptions, type OptionsLoad } from './options-load.ts';

const ref = { kind: 'movie', videoId: 'tt1' } as const;
const run = async (script: FakeScript) => {
	const { api, calls } = fakeApi(script);
	const seen: OptionsLoad[] = [];
	await loadOptions(api, ref, (s) => seen.push(s), () => true);
	return { api, calls, seen, last: seen[seen.length - 1] };
};

test('buscar → opciones → link: la web (progreso y lista final) y el link de la opción elegida', async () => {
	const a = option('aaa');
	const b = option('bbb');
	const { api, calls, last, seen } = await run({
		updates: [update({ progress: { done: 1, total: 2 } }), update({ options: [a, b], progress: { done: 2, total: 2 }, done: true })],
		link: link({ url: 'https://stream.test/b.mkv' })
	});
	assert.equal(seen[0]?.options, null);
	assert.equal(last?.done, true);
	assert.deepEqual(last?.options?.map((o) => o.hash), ['aaa', 'bbb']);
	const picked = await api.options.link(ref, last?.options?.[1] ?? a);
	assert.equal(picked.url, 'https://stream.test/b.mkv');
	assert.deepEqual(calls, ['options.load', 'options.link:bbb']);
});

test('desktop: una actualización por tanda, la lista crece y no se vacía', async () => {
	const { last } = await run({ updates: [update({ options: [option('a')] }), update({ options: [option('a'), option('b')] }), update({ done: true, options: [option('a'), option('b')] })] });
	assert.equal(last?.options?.length, 2);
	assert.equal(last?.done, true);
});

test('fallo al buscar: el error se muestra y no hay lista', async () => {
	const { last } = await run({ fail: { 'options.load': 'TorBox no responde' } });
	assert.equal(last?.error, 'TorBox no responde');
	assert.equal(last?.options, null);
	assert.equal(last?.done, false);
});

test('fallo del link: rechaza con el mensaje (la UI lo muestra en la fila)', async () => {
	const { api } = fakeApi({ fail: { 'options.link': 'sin caché' } });
	await assert.rejects(api.options.link(ref, option('a')), /sin caché/);
});
