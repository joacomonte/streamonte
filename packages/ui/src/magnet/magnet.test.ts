import { mock, test } from 'node:test';
import assert from 'node:assert/strict';
import type { Api } from '../api.ts';
import type { Identified, MagnetStatus, MagnetView } from '../types.ts';
import { MagnetFlow } from './magnet-flow.ts';
import { etaText, magnetSubtitle, magnetTitle, progressText, speedText } from './magnet-logic.ts';

const status = (over: Partial<MagnetStatus> = {}): MagnetStatus => ({ state: 'missing', name: 'Torrent.X', progress: 0, speed: 0, seeds: 0, eta: 0, options: [], ...over });
const ident: Identified = { kind: 'tv', id: '1396', imdb: 'tt0903747', title: 'Breaking Bad', year: '2008', poster: null, rating: '9.5', season: 1, episode: 2 };

function fakeApi(views: MagnetView[], over: { fail?: boolean } = {}) {
	const calls: string[] = [];
	let i = 0;
	const api = {
		magnet: {
			status: async (_h: string, _n: string, who: boolean) => (calls.push(`status:${who}`), over.fail ? Promise.reject(new Error('sin red')) : views[Math.min(i++, views.length - 1)]),
			download: async () => (calls.push('download'), status({ state: 'downloading', progress: 0.1 }))
		}
	} as unknown as Api;
	return { api, calls };
}

test('textos: velocidad, eta, progreso, título y subtítulo', () => {
	assert.deepEqual([speedText(2.5e6), speedText(1500), etaText(30), etaText(120), etaText(7500)], ['2.5 MB/s', '2 KB/s', '30 s', '2 min', '2 h 5 min']);
	assert.equal(progressText({ progress: 0.426, speed: 1e6, seeds: 8, eta: 180 }), '42 % · 1.0 MB/s · 8 seeds · falta 3 min');
	assert.equal(magnetTitle(ident, null, 'dn'), 'Breaking Bad');
	assert.equal(magnetTitle(null, status(), 'dn'), 'Torrent.X');
	assert.equal(magnetSubtitle(ident, null, 'Breaking Bad'), '2008 · T1 E2 · ★ 9.5');
	assert.equal(magnetSubtitle(null, status({ name: 'Otro' }), 'Algo'), 'Torrent pegado');
	assert.equal(magnetTitle(null, null, ''), 'Torrent pegado');
	assert.equal(magnetSubtitle(null, null, 'Torrent pegado'), '');
});

test('MagnetFlow: identifica una vez y deja de consultar al terminar de bajar', async () => {
	const { api, calls } = fakeApi([
		{ status: status({ state: 'downloading', progress: 0.5 }), ident },
		{ status: status({ state: 'downloading', progress: 0.9 }), ident: null },
		{ status: status({ state: 'ready' }), ident: null }
	]);
	// Reloj falso: cada tick dispara una consulta; `settle` deja resolver las promesas (sin esperar tiempo real).
	mock.timers.enable({ apis: ['setInterval'] });
	const settle = () => new Promise((r) => setTimeout(r, 0));
	try {
		const flow = new MagnetFlow(api, 'a'.repeat(40), 'dn', () => {}, 5);
		await flow.load(true);
		assert.equal(flow.view.ident?.title, 'Breaking Bad');
		mock.timers.tick(5);
		await settle();
		assert.equal(flow.view.status?.progress, 0.9);
		mock.timers.tick(5);
		await settle();
		assert.equal(flow.view.status?.state, 'ready');
		assert.equal(flow.view.ident?.title, 'Breaking Bad');
		const n = calls.length;
		mock.timers.tick(50);
		await settle();
		assert.equal(calls.length, n);
		assert.deepEqual(calls.slice(0, 2), ['status:true', 'status:false']);
		flow.dispose();
	} finally {
		mock.timers.reset();
	}
});

test('MagnetFlow: error inicial se muestra; download pasa a downloading', async () => {
	const bad = new MagnetFlow(fakeApi([], { fail: true }).api, 'h', 'dn', () => {});
	await bad.load(true);
	assert.equal(bad.view.error, 'sin red');
	const ok = new MagnetFlow(fakeApi([{ status: status(), ident: null }]).api, 'h', 'dn', () => {}, 1e6);
	await ok.load(true);
	await ok.download();
	assert.deepEqual([ok.view.status?.state, ok.view.adding], ['downloading', false]);
	ok.dispose();
});
