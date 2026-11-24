// `createTauriApi` con un núcleo simulado: eventos `catalog-streams` reales (fixture) llegan como `AsyncIterable<OptionsUpdate>`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createTauriApi, type Core } from './tauriApi.ts';
import type * as Raw from './types.ts';

const events = JSON.parse(readFileSync(new URL('../mock/events__catalog_streams__movie_tt0137523.json', import.meta.url), 'utf8')) as Raw.CoreEvent[];

/** Núcleo simulado: `catalogStreams` dispara los eventos grabados; el resto, vacío. */
function fakeCore(calls: string[]): Core {
	let emit: (e: Raw.CoreEvent) => void = () => {};
	const empty = (): Promise<never[]> => Promise.resolve([]);
	const api = {
		catalogStreams: (kind: Raw.MediaKind, videoId: string): Promise<void> => {
			calls.push(`streams ${kind} ${videoId}`);
			setTimeout(() => events.forEach(emit), 0);
			return Promise.resolve();
		},
		apiKeys: () => Promise.resolve([{ service: 'tmdb', configured: false }]),
		catalogTrending: (kind: Raw.MediaKind, skip: number) => {
			calls.push(`trending ${kind} ${skip}`);
			return Promise.resolve({ items: [], has_more: true });
		},
		catalogSearch: empty,
		catalogPeople: empty,
		library: () => Promise.resolve({ pasted_now: [], previous: [] })
	};
	// Solo lo que usa el test; el resto del contrato no se toca (por eso el cast a la forma completa).
	return { api: api as unknown as Core['api'], listen: (h) => ((emit = h), Promise.resolve(() => {})), lang: () => 'es' };
}

test('options.load: eventos catalog-streams → actualizaciones hasta done', async () => {
	const calls: string[] = [];
	const api = createTauriApi(fakeCore(calls));
	const seen: boolean[] = [];
	let count = 0;
	for await (const up of api.options.load({ kind: 'movie', videoId: 'tt0137523' })) {
		seen.push(up.done);
		count = up.options.length;
	}
	assert.equal(seen.at(-1), true, 'el último update es el final');
	assert.ok(count > 0);
	assert.deepEqual(calls, ['streams movie tt0137523']);
});

test('catalog.browse sin key de TMDB: tendencias, 50 por página', async () => {
	const calls: string[] = [];
	const api = createTauriApi(fakeCore(calls));
	const page = await api.catalog.browse({ kind: 'tv', sort: 'popular', from: '', to: '', minVotes: 0, languages: [], interests: [] }, 3);
	assert.deepEqual(calls, ['trending series 100']);
	assert.equal(page.hasMore, true);
});

test('subs: find marca lo elegido/probado del núcleo; get premium devuelve el archivo; premium.search marca premium', async () => {
	const found = (key: string, path: string): Raw.SubtitleFound => ({ key, provider: 'Wyzie', language: 'es', release_name: `Peli-${key}`, downloads: 1, path, level: 'release', latino: false, head: '', spec: '' });
	const calls: string[] = [];
	const core = fakeCore(calls);
	Object.assign(core.api, {
		catalogSubtitles: () => Promise.resolve({ found: [found('a', '/tmp/a.srt'), found('b', ''), found('c', '')], picks: { chosen: 'a', tried: ['b'] }, timing_known: true }),
		catalogSubtitleUse: (_v: string, _h: string, key: string) => (calls.push(`use ${key}`), Promise.resolve({ chosen: key, tried: [] })),
		catalogPremiumSearch: () => Promise.resolve([found('premium:7', '')]),
		catalogPremiumUse: () => Promise.resolve({ found: [found('premium:7', '/tmp/p.srt')], picks: { chosen: 'premium:7', tried: [] }, timing_known: true })
	});
	const api = createTauriApi(core);
	const ref = { kind: 'movie' as const, videoId: 'tt1' };
	const o = { hash: 'h'.repeat(40), release: 'r', file: null };
	const list = await api.subs.find(ref, o);
	assert.deepEqual(list.map((s) => [s.id, s.chosen, s.tried, s.path]), [['a', true, false, '/tmp/a.srt'], ['b', false, true, null], ['c', false, false, null]]);
	assert.deepEqual(await api.subs.get(ref, o, list[0]!), { url: null, path: '/tmp/a.srt' });
	const prem = await api.premium?.search(ref, o);
	assert.equal(prem?.[0]?.premium, true);
	assert.deepEqual(await api.subs.get(ref, o, prem![0]!), { url: null, path: '/tmp/p.srt' });
	assert.deepEqual(calls, ['use a']);
});
