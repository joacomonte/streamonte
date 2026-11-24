// Lista de opciones: carga por `Api.options.load` con la secuencia REAL del desktop (ui/mock, por su adaptador) y el modelo
// de la fila (badges de idioma, globitos, calidad, resoluciones).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as adapt from '../../../../ui/src/tauri-adapt.ts';
import type * as Raw from '../../../../ui/src/types.ts';
import { applyUpdate, emptyLoad, loadOptions, type OptionsLoad } from './options-load.ts';
import { langTags, qualityOf, resKey, resLabel, sizeText, TipBook, type LangInput } from './row.ts';
import type { OptionsUpdate } from '../types.ts';

const events = JSON.parse(readFileSync(new URL('../../../../ui/mock/events__catalog_streams__movie_tt0137523.json', import.meta.url), 'utf8')) as Raw.CoreEvent[];
const updates: OptionsUpdate[] = events.flatMap((e) => (e.type === 'catalog-streams' ? [adapt.optionsUpdate(e.update)] : []));
const tr = (s: string, p?: Record<string, string | number>) => s.replace(/\{(\w+)\}/g, (_, k: string) => String(p?.[k] ?? ''));

test('loadOptions: la secuencia del mock llega entera y termina con la lista final', async () => {
	const seen: OptionsLoad[] = [];
	async function* load() {
		yield* updates;
	}
	await loadOptions({ options: { load, link: async () => ({ url: '', choices: [], video: null }), tracks: async () => ({ subs: 0, audios: [] }) } }, { kind: 'movie', videoId: 'tt0137523' }, (s) => seen.push(s), () => true);
	const last = seen.at(-1);
	assert.equal(seen[0]?.options, null); // arranca vacío
	assert.equal(last?.done, true);
	assert.equal(last?.options?.length, updates.at(-1)?.options.length);
	assert.ok((last?.options?.length ?? 0) > 0);
});

test('loadOptions: un error se muestra y deja lo que ya se veía; cambiar de video corta', async () => {
	const seen: OptionsLoad[] = [];
	async function* load(): AsyncGenerator<OptionsUpdate> {
		yield updates.at(-1) as OptionsUpdate;
		throw new Error('TorBox no responde');
	}
	const api = { options: { load, link: async () => ({ url: '', choices: [], video: null }), tracks: async () => ({ subs: 0, audios: [] }) } };
	await loadOptions(api, { kind: 'movie', videoId: 'x' }, (s) => seen.push(s), () => true);
	assert.equal(seen.at(-1)?.error, 'TorBox no responde');
	assert.ok((seen.at(-1)?.options?.length ?? 0) > 0);
	const cut: OptionsLoad[] = [];
	await loadOptions(api, { kind: 'movie', videoId: 'x' }, (s) => cut.push(s), () => cut.length === 0);
	assert.equal(cut.length, 1); // solo el estado vacío
});

test('applyUpdate: el progreso no vacía la lista; la web (fuente por fuente → lista)', () => {
	const full = applyUpdate(emptyLoad(), { options: updates.at(-1)?.options ?? [], sources: [], progress: { done: 3, total: 3 }, checking: false, done: true });
	const again = applyUpdate(full, { options: [], sources: [], progress: { done: 3, total: 3 }, checking: true, done: false });
	assert.equal(again.options?.length, full.options?.length);
	assert.equal(again.checking, true);
	assert.equal(again.done, true);
	const web = applyUpdate(emptyLoad(), { options: [], sources: [], progress: { done: 1, total: 4 }, checking: false, done: false });
	assert.equal(web.options, null);
	assert.deepEqual(web.progress, { done: 1, total: 4 });
});

const base: LangInput = { hash: 'h', lat: 'check', want: false, spokenEs: false, subs: null, best: false, audioId: 'audio-h' };

test('langTags: audio según lo pedido (latino u original) y subs solo con audio original', () => {
	const tips = new TipBook(() => 0);
	assert.equal(langTags(base, tips, tr).audio, null); // sin pedir latino y sin saber: nada
	assert.equal(langTags(base, tips, tr).subs?.state, 'unk');
	assert.equal(langTags({ ...base, lat: 'lat' }, tips, tr).audio?.text, 'LAT');
	assert.equal(langTags({ ...base, lat: 'spain' }, tips, tr).audio, null); // Gallego solo hablada en español o pidiendo latino
	assert.equal(langTags({ ...base, lat: 'spain', spokenEs: true }, tips, tr).audio?.text, 'Gallego');
	const want = langTags({ ...base, want: true, lat: 'likely' }, tips, tr);
	assert.equal(want.audio?.tappable, true);
	assert.equal(want.audio?.text, 'LAT?');
	assert.equal(want.subs, null); // pidiendo latino los subs no se muestran
	assert.equal(langTags({ ...base, want: true, lat: 'none' }, tips, tr).audio?.state, 'none');
	assert.equal(langTags({ ...base, subs: true }, tips, tr).subs?.state, 'ok');
	assert.equal(langTags({ ...base, subs: false }, tips, tr).subs?.state, 'no');
});

test('TipBook: el primero de cada tipo explica, de a uno; un globito que terminó no vuelve; tocar lo repite', () => {
	let now = 0;
	const tips = new TipBook(() => now);
	assert.equal(tips.explain('esdl', 'a', 'x')?.delay, 400);
	assert.equal(tips.explain('esdl', 'b', 'x'), null); // otra fila del mismo tipo: no
	assert.equal(tips.explain('nolat', 'c', 'y')?.delay, 2600); // el segundo tipo, después
	assert.equal(tips.explain('nolat', 'c', 'y', true)?.delay, 0); // recién leído: ya
	now = 10_000;
	assert.equal(tips.explain('esdl', 'a', 'x'), null); // ya terminó
	const lat = { ...base, want: true, lat: 'likely' as const };
	assert.equal(langTags(lat, tips, tr).audio?.tip, null);
	tips.tap('h');
	assert.equal(langTags(lat, tips, tr).audio?.tip?.delay, 0);
	tips.reset();
	assert.equal(tips.tapped, null);
});

test('qualityOf, resKey/resLabel, sizeText', () => {
	const q = qualityOf('BluRay', 'Peli.1080p.BluRay', 'q', tr);
	assert.ok(q.known && q.stars === 3 && q.name === 'Blu-ray');
	assert.ok(qualityOf('CAM', 'x', 'q', tr).known);
	const none = qualityOf(null, 'Peli.1080p', 'q-h', tr);
	assert.ok(!none.known && none.id === 'q-h' && none.tip.includes('Peli.1080p'));
	assert.equal(resKey('480p'), 'other');
	assert.equal(resLabel(resKey('2160p'), 'Otras'), '4K');
	assert.equal(resLabel('other', 'Otras'), 'Otras');
	assert.equal(sizeText(null, 'es'), '—');
	assert.equal(sizeText(700 * 1024 ** 2, 'es'), '700 MB');
	assert.equal(sizeText(1.5 * 1024 ** 3, 'en'), '1.5 GB');
});
