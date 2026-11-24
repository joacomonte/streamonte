import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFlow, newFlowState, type FlowCand, type FlowDeps, type FlowIds, type FlowState } from './flow-model.ts';
import type { MatchFacts } from './match-rules.ts';
import type { OptionRowView } from '../options/row.ts';
import type { ChoiceView, FlowView } from './types.ts';

const IDS: FlowIds = {
	net: 'net-', latNo: 'lat-no', latYes: 'lat-yes', stop: 'stop', latAll: 'lat-all', noticeAll: 'notice-all',
	toTorrent: 'to-torrent', matchAll: 'match-all', spainOriginal: 'spain-original', spainAll: 'spain-all', lighter: 'lighter', crumb: 'crumb-',
};
const GB = 1024 ** 3;
/** Una opción de prueba: `q` = calidad (más alto, mejor); lo que se "lee" al probarla, en `reads`. */
type Opt = { hash: string; q: number; bytes: number | null; mbps: number; facts: MatchFacts; reads?: Partial<MatchFacts> };
const opt = (hash: string, q: number, o: Partial<Opt> & { f?: Partial<MatchFacts> } = {}): Opt => ({
	hash, q, bytes: 2 * GB, mbps: 5, ...o, facts: { latState: 'none', saysSpanish: false, subsEs: null, audioRead: false, ...o.f },
});

/** Una app falsa: estado propio, lectura que resuelve a mano (`pending`) o sola, y filas = el hash. */
function setup(opts: Opt[], over: Partial<FlowDeps<Opt>> = {}, auto = true) {
	let st: FlowState | undefined = newFlowState('net', 'torbox');
	const reads: string[] = [];
	const pending: (() => void)[] = [];
	const deps: FlowDeps<Opt> = {
		state: () => st,
		list: () => ({ kind: 'ready' }),
		episode: () => false,
		cands: () => opts.map((o): FlowCand<Opt> => ({ hash: o.hash, bytes: o.bytes, mbps: o.mbps, res: '1080p', facts: o.facts, excluded: false, failed: false, readable: true, seeds: null, inTorbox: true, src: o })),
		sort: (cs) => [...cs].sort((a, b) => b.src.q - a.src.q),
		row: (c) => ({ hash: c.hash }) as OptionRowView,
		read: ([c]) => {
			const o = c?.src as Opt;
			reads.push(o.hash);
			const done = (): void => void (o.facts = { ...o.facts, audioRead: true, subsEs: false, ...o.reads });
			if (auto) return Promise.resolve(done());
			return new Promise<void>((ok) => pending.push(() => { done(); ok(); }));
		},
		changed: () => {},
		ids: IDS,
		allIgnoresLat: true,
		...over,
	};
	const model = createFlow(deps);
	return { model, reads, pending, state: () => st as FlowState, setState: (s: FlowState | undefined) => void (st = s) };
}
const choices = (v: FlowView | null): ChoiceView[] => (v && 'choices' in v ? v.choices : []);
const click = (v: FlowView | null, id: string): void => {
	const c = choices(v).find((x) => x.id === id);
	if (!c) throw new Error(`no hay ${id}`);
	c.onclick();
};
const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

test('TorBox, audio original: lee de a una de mejor a peor hasta el primer sub ES y "Seguir buscando" sigue', async () => {
	const opts = [opt('a', 3), opt('b', 2, { reads: { subsEs: true } }), opt('c', 1, { reads: { subsEs: true } })];
	const { model, reads, state } = setup(opts);
	assert.deepEqual(choices(model.view()).map((c) => c.id), ['net-high', 'net-normal', 'net-low', 'net-terrible']);
	click(model.view(), 'net-high');
	assert.equal(state().step, 'lat');
	click(model.view(), 'lat-no');
	await flush();
	assert.deepEqual(reads, ['a', 'b']);
	assert.deepEqual(state().found, ['b']);
	const v = model.view();
	assert.equal(v?.kind, 'match');
	assert.ok(v?.kind === 'match' && v.rows.length === 1 && v.title === null && v.all.count === '3');
	const more = model.moreRow();
	assert.equal(more?.kind, 'more');
	if (more?.kind === 'more') more.onclick();
	await flush();
	assert.deepEqual(state().found, ['b', 'c']);
	assert.deepEqual(model.moreRow(), { kind: 'done', found: true, text: 'No hay más para buscar.' });
});

test('Detener: corta, lo que no se leyó vuelve a ser candidata y se ven las 3 mejores', async () => {
	const opts = [opt('a', 3), opt('b', 2), opt('c', 1)];
	const { model, pending, state } = setup(opts, {}, false);
	click(model.view(), 'net-high');
	click(model.view(), 'lat-no');
	const v = model.view();
	assert.equal(v?.kind, 'scan');
	if (v?.kind === 'scan') v.stop.onclick();
	assert.equal(state().scan?.running, false);
	assert.deepEqual(state().scanned, []);
	pending.forEach((p) => p());
	await flush();
	const after = model.view();
	assert.ok(after?.kind === 'match' && after.note === 'Búsqueda detenida: estas son las de mejor calidad' && after.rows.length === 3);
	assert.deepEqual(state().found, []);
});

test('cambiar de video corta la búsqueda (estado nuevo)', async () => {
	const opts = [opt('a', 2, { reads: { subsEs: true } }), opt('b', 1)];
	const { model, pending, setState } = setup(opts, {}, false);
	click(model.view(), 'net-high');
	click(model.view(), 'lat-no');
	setState(newFlowState('net', 'torbox'));
	pending.forEach((p) => p());
	await flush();
	assert.equal(pending.length, 1);
	assert.equal(model.view()?.kind, 'choices');
});

test('latino sin ninguno pero con España: muestra las de España', async () => {
	const opts = [opt('a', 3, { f: { latState: 'likely' } }), opt('b', 2, { f: { latState: 'spain' } }), opt('c', 1)];
	const { model, state } = setup(opts);
	click(model.view(), 'net-high');
	const lat = choices(model.view()).find((c) => c.id === 'lat-yes');
	assert.ok(lat && !lat.disabled && !lat.chips);
	click(model.view(), 'lat-yes');
	await flush();
	const spain = model.view();
	assert.ok(spain?.kind === 'spain' && spain.rows.map((r) => r.hash).join() === 'b');
	if (spain?.kind === 'spain') spain.all.onclick();
	// Web (`allIgnoresLat`): la lista la arma la app; el filtro de latino queda.
	assert.equal(model.view(), null);
	assert.equal(state().latOff, false);
});

test('ninguna entra en la conexión elegida: aviso con "Ver todas"', async () => {
	const opts = [1, 2, 3, 4].map((q) => opt(`h${q}`, q, { mbps: 50 }));
	const { model, state } = setup(opts);
	click(model.view(), 'net-low');
	click(model.view(), 'lat-no');
	await flush();
	assert.equal(state().net?.key, 'low');
	const v = model.view();
	if (v?.kind !== 'notice') throw new Error(`pantalla ${v?.kind}`);
	assert.equal(v.text, 'Todas piden más de lo que da tu conexión');
	assert.equal(v.all?.id, 'notice-all');
	v.all?.onclick();
	assert.equal(model.view(), null);
});

test('migas: vuelven al paso y limpian lo elegido después', async () => {
	const { model, state } = setup([opt('a', 1, { reads: { subsEs: true } })]);
	assert.equal(model.crumbs(), null);
	click(model.view(), 'net-normal');
	click(model.view(), 'lat-no');
	await flush();
	const c = model.crumbs();
	assert.deepEqual(c?.items.map((i) => [i.id, i.label]), [['crumb-net', 'Conexión normal'], ['crumb-lat', 'Audio original']]);
	c?.items[1]?.onclick?.();
	assert.equal(state().step, 'lat');
	assert.equal(state().lat, null);
	assert.deepEqual(state().found, []);
});

test('por torrent (desktop): sin TorBox salta el modo; con latino, calidad y búsqueda de a `parallel`', async () => {
	let openRes = '';
	const opened: string[] = [];
	const opts = [opt('a', 3, { f: { latState: 'likely' } }), opt('b', 2, { f: { latState: 'check', saysSpanish: true }, reads: { latState: 'lat' } }), opt('c', 1)];
	const { model, state, setState, reads } = setup(opts, {
		allIgnoresLat: false,
		read: async (batch) => {
			for (const c of batch) {
				reads.push(c.hash);
				c.src.facts = { ...c.src.facts, audioRead: true, ...c.src.reads };
			}
		},
		torrent: {
			hasTorbox: () => false, parallel: 3, scanSecs: (n) => Math.ceil(n / 3) * 60,
			openRes: () => openRes, setOpenRes: (r) => void (openRes = r), open: (r) => void (openRes = r),
			opened: (r) => void opened.push(r), cancel: () => {},
		},
	});
	setState(newFlowState('mode'));
	const v = model.view();
	assert.equal(state().mode, 'torrent');
	assert.deepEqual(choices(v).map((c) => c.id), ['lat-no', 'lat-yes']);
	click(v, 'lat-yes');
	assert.equal(state().step, 'res');
	click(model.view(), 'cat-flow-res-1080p');
	await flush();
	assert.deepEqual(opened, ['1080p']);
	assert.deepEqual(reads, ['a', 'b']);
	assert.equal(model.view(), null);
	assert.deepEqual(model.crumbs()?.items.map((i) => i.label), ['Torrent', 'Audio latino', '1080p']);
});

test('latino: leídas todas y ninguna latina ni de España → vuelve al audio con el aviso y "Ver todas" (#82)', async () => {
	const opts = [
		opt('a', 3, { f: { latState: 'likely' }, reads: { latState: 'none' } }),
		opt('b', 2, { f: { latState: 'check', saysSpanish: true }, reads: { latState: 'none' } }),
		opt('c', 1),
	];
	const { model, reads } = setup(opts);
	click(model.view(), 'net-high');
	click(model.view(), 'lat-yes');
	await flush();
	assert.deepEqual(reads, ['a', 'b']);
	const v = model.view();
	if (v?.kind !== 'choices') throw new Error(`pantalla ${v?.kind}`);
	assert.equal(v.step, 'lat');
	assert.equal(v.note, 'No encontré torrents con audio latino');
	assert.deepEqual(choices(v).map((c) => [c.id, c.disabled]), [['lat-no', false], ['lat-yes', true]]);
	assert.equal(v.all?.id, 'lat-all');
});
