// Flujo de subtítulos con la Api falsa compartida: elegir, "no encaja", Premium y fallos inyectados.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fakeApi, type FakeScript } from '../../test/fake-api.ts';
import { quota, subtitle } from '../../test/fixtures/options.ts';
import { SubsFlow } from './subs-flow.ts';
import { noFitText, rankSubs } from './subs-logic.ts';

const make = (script: FakeScript, file: { hash: string; size: string } | null = null) => {
	const { api, calls } = fakeApi(script);
	return { calls, flow: new SubsFlow(api, { kind: 'movie', videoId: 'tt1' }, { hash: 'h', release: 'r', file: null }, file, () => {}) };
};

test('elegir: buscar → usar un subtítulo lo deja elegido y devuelve el archivo', async () => {
	const { flow, calls } = make({ subs: [subtitle('1'), subtitle('2')] }, { hash: 'abc', size: '9' });
	await flow.search();
	assert.equal(flow.view.list.length, 2);
	const file = await flow.use(subtitle('2'));
	assert.equal(file?.url, '/sub/2');
	assert.equal(flow.view.picked, 'o2');
	assert.deepEqual(calls, ['subs.find:abc', 'subs.get:2']);
});

test('no encaja: ninguno calza → aviso; cambiar de elegido marca el anterior como probado', async () => {
	const { flow } = make({ subs: [subtitle('1'), subtitle('2')] });
	await flow.search();
	assert.ok(noFitText(rankSubs(flow.view.list, null), true));
	await flow.use(subtitle('1'));
	await flow.use(subtitle('2'));
	assert.deepEqual([flow.view.picked, flow.view.tried], ['o2', ['o1']]);
});

test('Premium: abrir busca con key, bajar gasta cuota y la refresca', async () => {
	const { flow, calls } = make({ premiumSubs: [subtitle('9', { premium: true })] });
	await flow.togglePremium();
	assert.equal(flow.view.prem.status, 'ready');
	await flow.use(subtitle('9', { premium: true }));
	assert.equal(flow.view.picked, 'p9');
	assert.equal(flow.view.prem.busy, null);
	assert.ok(calls.includes('premium.search') && calls.includes('subs.get:9'));
});

test('Premium sin cuota no baja; sin key no busca', async () => {
	const spent = make({ quota: quota({ remaining: 0 }) });
	await spent.flow.loadQuota();
	assert.equal(await spent.flow.use(subtitle('1', { premium: true })), null);
	assert.ok(!spent.calls.includes('subs.get:1'));
	const nokey = make({ quota: quota({ hasKey: false }) });
	await nokey.flow.togglePremium();
	assert.ok(!nokey.calls.includes('premium.search'));
});

test('fallos: buscar, bajar y buscar Premium', async () => {
	const find = make({ fail: { 'subs.find': 'caído' } });
	await find.flow.search();
	assert.deepEqual([find.flow.view.status, find.flow.view.error], ['error', 'caído']);

	const get = make({ subs: [subtitle('1')], fail: { 'subs.get': 'sin permiso' } });
	await get.flow.search();
	assert.equal(await get.flow.use(subtitle('1')), null);
	assert.equal(get.flow.view.error, 'sin permiso');
	assert.equal(get.flow.view.picked, null);

	const prem = make({ fail: { 'premium.search': 'x' } });
	await prem.flow.togglePremium();
	assert.equal(prem.flow.view.prem.status, 'error');
});
