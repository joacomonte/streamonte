import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as adapt from './web-adapt.ts';
import { createWebApi } from './webApi.ts';
import type { Title } from './types.ts';

async function* from<T>(items: T[]): AsyncGenerator<T> {
	for (const i of items) yield i;
}
async function collect<T>(it: AsyncIterable<T>): Promise<T[]> {
	const out: T[] = [];
	for await (const x of it) out.push(x);
	return out;
}

const torrent = { hash: 'a'.repeat(40), release: 'Peli.2160p.REMUX', file: null, res: '2160p', hdr: ['HDR'], source: 'REMUX', cam: false, codec: 'HEVC', atmos: true, hint: 'lat', multi: false, spa: true, size: 5e10, seeds: 12, addons: ['Torrentio'], subFile: true };

test('readLines: junta trozos, última línea sin salto', async () => {
	assert.deepEqual(await collect(adapt.readLines(from(['{"a":1}\n{"b"', ':2}\n', '{"c":3}']))), ['{"a":1}', '{"b":2}', '{"c":3}']);
});

test('optionsUpdates: progreso por fuente, torbox y resultado final', async () => {
	const lines = [
		JSON.stringify({ stage: 'sources', done: 0, total: 4 }),
		JSON.stringify({ stage: 'sources', done: 2, total: 4 }),
		JSON.stringify({ stage: 'torbox' }),
		JSON.stringify({ result: { list: [torrent], found: 1, sources: 4 } })
	];
	const ups = await collect(adapt.optionsUpdates(from(lines)));
	assert.deepEqual(ups.map((u) => [u.done, u.progress?.done ?? null, u.checking]), [[false, 0, false], [false, 2, false], [false, 2, true], [true, 2, false]]);
	const last = ups[3];
	assert.equal(last?.options.length, 1);
	assert.deepEqual(last?.options[0], {
		hash: torrent.hash, release: 'Peli.2160p.REMUX', file: null, fileIdx: null, resolution: '2160p', hdr: ['HDR'], source: 'REMUX', codec: 'HEVC', audioFormat: ['Atmos'],
		sizeBytes: 5e10, seeds: 12, leechers: null, completed: null, audio: [], subs: [], hint: 'lat', multi: false, spanish: true, subFile: true, sites: [], addons: ['Torrentio'], isPack: false
	});
});

test('optionsUpdates: {error} lanza con el mensaje', async () => {
	await assert.rejects(collect(adapt.optionsUpdates(from([JSON.stringify({ error: 'TorBox no respondió' })]))));
});

test('catalogPage / catalogItem', () => {
	const page = adapt.catalogPage({ items: [{ id: 550, kind: 'movie', title: 'Fight Club', year: '1999', released: '1999-10-15', poster: 'p.jpg', rating: '8.8', documentary: false }], page: 1, pages: 3 });
	assert.deepEqual(page, { items: [{ id: '550', kind: 'movie', title: 'Fight Club', year: '1999', poster: 'p.jpg', rating: '8.8', released: '1999-10-15', documentary: false }], hasMore: true });
	assert.equal(adapt.catalogPage({ items: [], page: 3, pages: 3 }).hasMore, false);
});

test('titleDetails: ficha de serie con estado y temporadas', () => {
	const raw = {
		id: 1396, kind: 'tv', title: 'Breaking Bad', year: '2008', released: null, poster: 'p', rating: '9.5', documentary: false, backdrop: 'b', overview: 'Sinopsis', runtime: 47,
		genres: ['Drama'], providers: [{ name: 'Netflix', logo: 'l' }], people: [{ id: 1, name: 'Bryan', photo: null, role: 'cast', note: 'Walter' }], companies: ['AMC'],
		lang: 'Inglés', origLang: 'en', status: 'ended', next: null, imdb: 'tt0903747', seasons: [{ n: 1, name: 'Temporada 1', count: 7, year: '2008' }]
	} satisfies Title;
	const d = adapt.titleDetails(raw);
	assert.equal(d.id, '1396');
	assert.equal(d.runtimeMin, 47);
	assert.equal(d.originalLanguage, 'en');
	assert.deepEqual(d.status, { state: 'ended', next: null });
	assert.deepEqual(d.seasons, [{ number: 1, name: 'Temporada 1', episodeCount: 7, year: '2008' }]);
	assert.deepEqual(d.people[0], { id: 1, name: 'Bryan', photo: null, role: 'cast', note: 'Walter' });
	assert.equal(adapt.titleDetails({ ...raw, status: 'raro' }).status, null);
});

test('episodes / seasonRatings / subtitle / quota', () => {
	assert.deepEqual(adapt.episodes([{ n: 2, name: 'Cat', date: '2008-01-27', still: null }], 1), [{ season: 1, number: 2, title: 'Cat', date: '2008-01-27', overview: null, still: null }]);
	assert.deepEqual(adapt.seasonRatings([{ season: 1, rating: 8.9, episodes: 7 }]), { seasons: [{ season: 1, rating: 8.9, episodes: 7 }], status: null });
	assert.equal(adapt.subtitle({ id: '9', release: 'X', latino: true, format: 'srt', downloads: 3, exact: true }).level, 'exact');
	assert.deepEqual(adapt.quota({ hasKey: true, remaining: 4, perDay: 5, resetsAt: null, login: null }), { hasKey: true, remaining: 4, perDay: 5, resetsAt: null, loginError: null });
});

test('createWebApi: arma las URLs y adapta la respuesta (fetch simulado)', async () => {
	const seen: string[] = [];
	const api = createWebApi(((url: string) => {
		seen.push(String(url));
		const body = String(url).startsWith('/api/torrents') ? `${JSON.stringify({ result: { list: [torrent] } })}\n` : JSON.stringify({ items: [], page: 1, pages: 1 });
		return Promise.resolve(new Response(body, { status: 200 }));
	}) as typeof fetch);
	assert.deepEqual(await api.catalog.search('fight', 2), { items: [], hasMore: false });
	const ups: number[] = [];
	for await (const u of api.options.load({ kind: 'tv', videoId: 'tt0903747:1:2' })) ups.push(u.options.length);
	assert.deepEqual(ups, [1]);
	assert.deepEqual(seen, ['/api/catalog?q=fight&page=2', '/api/torrents?imdb=tt0903747&s=1&e=2']);
});

test('subs: find con archivo, premium.search marca premium', async () => {
	const seen: string[] = [];
	const sub = { id: '7', release: 'Peli.1080p-GRP', latino: false, format: 'srt', downloads: 2 };
	const api = createWebApi(((url: string) => {
		seen.push(String(url));
		return Promise.resolve(new Response(JSON.stringify(String(url).startsWith('/api/premium') ? { results: [sub], quota: {} } : [sub]), { status: 200 }));
	}) as typeof fetch);
	const o = { hash: 'a'.repeat(40), release: 'Peli', file: null };
	const free = await api.subs.find({ kind: 'movie', videoId: 'tt1' }, o, { file: { hash: '0123456789abcdef', size: '99' } });
	assert.equal(free[0]?.premium, false);
	const prem = await api.premium?.search({ kind: 'tv', videoId: 'tt1:1:2' }, o);
	assert.equal(prem?.[0]?.premium, true);
	assert.deepEqual(seen, ['/api/subs?imdb=tt1&hash=0123456789abcdef&size=99', '/api/premium?imdb=tt1&s=1&e=2']);
});

test('options.link trae archivo, nativos e ids; options.tracks con ids no vuelve a agregar el torrent', async () => {
	const seen: string[] = [];
	const api = createWebApi(((url: string) => {
		seen.push(String(url));
		const body = String(url).startsWith('/api/link')
			? { url: 'https://x/v.mkv', ids: { tid: 3, fid: 4 }, file: { hash: 'f', size: '9' }, subsEs: 1 }
			: { subs: [{ label: 'Español', kind: 'del video', track: 2 }], audios: [{ language: 'es-419', title: '' }] };
		return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
	}) as typeof fetch);
	const ref = { kind: 'movie' as const, videoId: 'tt1' };
	const o = adapt.option(torrent);
	const l = await api.options.link(ref, o, { orig: 'en' });
	assert.deepEqual([l.ids, l.file, l.subsEs, l.natives, l.choices], [{ tid: 3, fid: 4 }, { hash: 'f', size: '9' }, 1, [], []]);
	const tr = await api.options.tracks(ref, o, { ids: l.ids });
	assert.equal(tr.subs, 1);
	assert.match(seen[1] ?? '', /tid=3&fid=4$/);
});
