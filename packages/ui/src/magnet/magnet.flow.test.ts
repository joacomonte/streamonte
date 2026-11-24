// Flujo del magnet pegado con la Api falsa compartida: estado, identificación, bajar y fallos inyectados.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fakeApi, type FakeScript } from '../../test/fake-api.ts';
import { identified, magnetStatus } from '../../test/fixtures/options.ts';
import { MagnetFlow } from './magnet-flow.ts';

const make = (script: FakeScript) => {
	const { api, calls } = fakeApi(script);
	// pollMs enorme: estos tests no esperan al intervalo; dispose() lo corta.
	return { api, calls, flow: new MagnetFlow(api, 'a'.repeat(40), 'dn', () => {}, 1e9) };
};

test('pegar → estado con quién es → bajarlo', async () => {
	const { flow, calls } = make({ magnet: [{ status: magnetStatus({ state: 'missing' }), ident: identified }] });
	await flow.load(true);
	assert.equal(flow.view.ident?.title, 'Peli');
	assert.equal(flow.view.status?.state, 'missing');
	await flow.download();
	assert.deepEqual([flow.view.status?.state, flow.view.adding], ['downloading', false]);
	assert.deepEqual(calls, ['magnet.status:true', 'magnet.download']);
	flow.dispose();
});

test('cacheado: queda con ese estado y sin error', async () => {
	const { flow } = make({ magnet: [{ status: magnetStatus({ state: 'cached' }), ident: null }] });
	await flow.load(true);
	assert.equal(flow.view.status?.state, 'cached');
	assert.equal(flow.view.error, '');
	flow.dispose();
});

test('fallo al consultar: se muestra el error', async () => {
	const { flow } = make({ fail: { 'magnet.status': 'sin red' } });
	await flow.load(true);
	assert.equal(flow.view.error, 'sin red');
	assert.equal(flow.view.status, null);
});

test('fallo al bajar: error visible, sin "agregando" colgado', async () => {
	const { flow } = make({ fail: { 'magnet.download': 'sin cupo' } });
	await flow.download();
	assert.equal(flow.view.error, 'sin cupo');
	assert.equal(flow.view.adding, false);
});

test('fallo de una consulta de avance no tapa lo que ya se veía', async () => {
	const script: FakeScript = { magnet: [{ status: magnetStatus({ state: 'downloading', progress: 0.5 }), ident: null }] };
	const { flow } = make(script);
	await flow.load(true);
	script.fail = { 'magnet.status': 'cortó' }; // el guion se lee en cada llamada
	await flow.load(false);
	assert.equal(flow.view.error, '');
	assert.equal(flow.view.status?.progress, 0.5);
	flow.dispose();
});
