import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Api } from '../api.ts';
import type { PremiumQuota, SubtitleOption } from '../types.ts';
import { SubsFlow } from './subs-flow.ts';
import { episodeLabel, headOf, keyOf, noFitText, pickKey, quotaText, rankSubs, specOf, srcOf, timingOf } from './subs-logic.ts';

const sub = (id: string, over: Partial<SubtitleOption> = {}): SubtitleOption => ({ id, release: 'Peli.2024.1080p.WEB-DL-GRP', latino: false, format: 'srt', downloads: 1, level: 'none', premium: false, fps: null, last: null, group: null, ...over });
const quota = (over: Partial<PremiumQuota> = {}): PremiumQuota => ({ hasKey: true, remaining: 3, perDay: 5, resetsAt: null, loginError: null, ...over });

/** Api mínima: solo lo que toca el flujo de subtítulos. */
function fakeApi(over: { found?: SubtitleOption[]; prem?: SubtitleOption[]; q?: PremiumQuota; fail?: boolean } = {}) {
	const calls: string[] = [];
	const api = {
		subs: {
			find: async (_r: unknown, _o: unknown, opts?: { file?: { hash: string } | null }) => (calls.push(`find:${opts?.file?.hash ?? '-'}`), over.fail ? Promise.reject(new Error('caído')) : over.found ?? []),
			get: async (_r: unknown, _o: unknown, s: SubtitleOption) => (calls.push(`get:${s.id}`), { url: `/u/${s.id}` })
		},
		premium: { quota: async () => over.q ?? quota(), search: async () => (calls.push('psearch'), over.prem ?? []) }
	} as unknown as Api;
	return { api, calls };
}
const make = (api: Api, file: { hash: string; size: string } | null = null) =>
	new SubsFlow(api, { kind: 'movie', videoId: 'tt1' }, { hash: 'h', release: 'r', file: null }, file, () => {});

test('rankSubs: sin match respeta level; con match calcula (mismo grupo = 2)', () => {
	const list = [sub('a'), sub('b', { level: 'exact' })];
	assert.deepEqual(rankSubs(list, null).map((r) => [r.sub.id, r.lvl]), [['a', 0], ['b', 3]]);
	const r = rankSubs(list, { release: 'Otra.1080p.WEB-DL-GRP' });
	assert.deepEqual(r.map((x) => [x.sub.id, x.lvl]), [['b', 3], ['a', 2]]);
});

test('textos de fila, claves, cuota y episodio', () => {
	assert.equal(headOf(sub('a')), 'GRP');
	assert.equal(headOf(sub('a', { release: 'x', premium: true })), 'OpenSubtitles');
	assert.equal(specOf(sub('a')), 'WEB 1080p');
	assert.equal(keyOf(sub('7', { premium: true })), 'p7');
	assert.equal(episodeLabel('tt1:1:2'), 'S01E02');
	assert.equal(episodeLabel('tt1'), null);
	assert.equal(quotaText(null, () => ''), 'viendo cuántas descargas quedan…');
	assert.equal(quotaText(quota({ remaining: 0, resetsAt: 1 }), () => '10:00'), 'usaste las 5 de hoy · vuelven 10:00');
	assert.deepEqual(pickKey({ picked: 'a', tried: [] }, 'b'), { picked: 'b', tried: ['a'] });
	assert.deepEqual(pickKey({ picked: 'a', tried: ['b'] }, 'b'), { picked: 'b', tried: ['a'] });
});

test('SubsFlow.search: pasa el archivo, marca lo elegido/probado y captura errores', async () => {
	const ok = fakeApi({ found: [sub('1', { chosen: true }), sub('2', { tried: true })] });
	const flow = make(ok.api, { hash: '0123456789abcdef', size: '9' });
	await flow.search();
	assert.deepEqual(ok.calls, ['find:0123456789abcdef']);
	assert.equal(flow.view.status, 'ready');
	assert.deepEqual([flow.view.picked, flow.view.tried], ['o1', ['o2']]);
	const bad = make(fakeApi({ fail: true }).api);
	await bad.search();
	assert.deepEqual([bad.view.status, bad.view.error], ['error', 'caído']);
});

test('SubsFlow premium: abrir busca solo con key; sin cuota no baja; bajar elige y refresca cuota', async () => {
	const none = make(fakeApi({ q: quota({ hasKey: false }) }).api);
	await none.togglePremium();
	assert.deepEqual([none.view.prem.open, none.view.prem.status], [true, 'idle']);

	const { api, calls } = fakeApi({ prem: [sub('9', { premium: true })] });
	const flow = make(api);
	await flow.togglePremium();
	assert.deepEqual([flow.view.prem.status, flow.view.prem.results.length], ['ready', 1]);
	const got = await flow.use(sub('9', { premium: true }));
	assert.equal(got?.url, '/u/9');
	assert.equal(flow.view.picked, 'p9');
	assert.equal(flow.view.prem.busy, null);
	assert.ok(calls.includes('get:9'));

	const spent = make(fakeApi({ q: quota({ remaining: 0 }) }).api);
	await spent.loadQuota();
	assert.equal(await spent.use(sub('1', { premium: true })), null);
});

test('SubsFlow.dispose: lo que llega tarde se descarta', async () => {
	const flow = make(fakeApi({ found: [sub('1')] }).api);
	const p = flow.search();
	flow.dispose();
	await p;
	assert.equal(flow.view.status, 'searching');
});

test('fila: proveedor (gratis) o descargas (Premium); EN viene de language', () => {
	assert.equal(srcOf(sub('a', { provider: 'Wyzie' })), 'Wyzie');
	assert.equal(srcOf(sub('a')), null);
	assert.equal(srcOf(sub('a', { premium: true, downloads: 1200 })), `${(1200).toLocaleString('es-AR')} ↓`);
	assert.equal(srcOf(sub('a', { premium: true, downloads: 0 })), null);
});

test('noFitText: solo si ninguno calza y se sabe si hay fps/duración', () => {
	const none = rankSubs([sub('a'), sub('b')], null);
	const some = rankSubs([sub('a'), sub('b', { level: 'fps' })], null);
	assert.equal(noFitText(none, true), 'Ninguno es de este release ni de sus mismos fps y duración');
	assert.equal(noFitText(none, false), 'Sin fps ni duración de este archivo: solo se reconoce el mismo release');
	assert.equal(noFitText(none, undefined), null);
	assert.equal(noFitText(some, true), null);
	assert.equal(noFitText([], true), null);
	assert.equal(timingOf([sub('a'), sub('b', { timingKnown: false })], null), false);
	assert.equal(timingOf([sub('a')], null), undefined);
	assert.equal(timingOf([], { release: 'r', video: { fps: 24, duration: 100 } }), true);
	assert.equal(timingOf([], { release: 'r' }), false);
});
