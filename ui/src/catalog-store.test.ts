// Estado del catálogo compartido (filtros → pedido, paginado, búsqueda, restaurar) con respuestas REALES grabadas (ui/mock/*.json).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { Api } from '../../packages/ui/src/api.ts';
import { DEFAULTS, parseSaved, toBrowse } from '../../packages/ui/src/catalog/filters.ts';
import { createCatalog, initialState, type CatalogOptions } from '../../packages/ui/src/catalog/store.ts';
import type { ApiEvent, BrowseFilters, CatalogItem, CatalogPage, PersonRole } from '../../packages/ui/src/types.ts';
import * as adapt from './tauri-adapt.ts';
import type * as Raw from './types.js';

const fixture = <T>(name: string): T => JSON.parse(readFileSync(new URL(`../mock/${name}.json`, import.meta.url), 'utf8')) as T;
const trending = adapt.catalogPage(fixture<Raw.BrowsePage>('catalog_trending__movie_0'));
const top = adapt.catalogPage(fixture<Raw.BrowsePage>('catalog_browse_top__movie_rating'));
const found = adapt.catalogItems(fixture<Raw.CatalogItem[]>('catalog_search__fight-club'));
const genreList = adapt.genres(fixture<Raw.GenreName[]>('catalog_genres__movie'));
const wait = (ms = 0) => new Promise((r) => setTimeout(r, ms));

type Calls = { browse: [BrowseFilters, number][]; search: [string, number][]; person: [number, PersonRole][] };
/** Un `Api` con solo `catalog` y `events`: responde con las fixtures y anota cada pedido. */
function fakeApi(over: { browse?: (f: BrowseFilters, page: number) => Promise<CatalogPage> } = {}) {
	const calls: Calls = { browse: [], search: [], person: [] };
	let emit: (e: ApiEvent) => void = () => {};
	const api = {
		catalog: {
			browse: (f: BrowseFilters, page: number) => (calls.browse.push([f, page]), over.browse ? over.browse(f, page) : Promise.resolve(page === 1 ? top : { items: top.items, hasMore: false })),
			search: (q: string, page: number) => (calls.search.push([q, page]), Promise.resolve({ items: found, hasMore: false })),
			people: () => Promise.resolve([]),
			personTitles: (id: number, role: PersonRole): Promise<CatalogItem[]> => (calls.person.push([id, role]), Promise.resolve(found.slice(0, 3))),
			genres: () => Promise.resolve(genreList)
		},
		events: { subscribe: (h: (e: ApiEvent) => void) => ((emit = h), () => {}) }
	} as unknown as Api;
	return { api, calls, emit: (e: ApiEvent) => emit(e) };
}
const memory = (initial: Record<string, string> = {}) => {
	const data = new Map(Object.entries(initial));
	return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) };
};
function make(api: Api, opts: Partial<CatalogOptions> = {}, saved?: string) {
	const storage = memory(saved ? { k: saved } : {});
	const st = initialState(storage, 'k');
	return { store: createCatalog(api, st, { storageKey: 'k', storage, searchWait: 5, ...opts }), st, storage };
}

test('filtros → pedido: fechas ISO, "hasta hoy" vacío, idiomas y géneros', () => {
	const now = new Date(2026, 10, 22);
	const q = toBrowse({ ...DEFAULTS, from: 12, to: 3, lang: 'en,es', genres: ['28'] }, now);
	assert.deepEqual(q, { kind: 'movie', sort: 'rating', from: '2025-11-22', to: '2026-08-22', minVotes: 10000, languages: ['en', 'es'], genres: ['28'] });
	assert.equal(toBrowse({ ...DEFAULTS, lang: '' }, now).languages.length, 0);
	assert.equal(toBrowse(DEFAULTS, now).to, '');
});

test('restaurar: lo guardado vale, lo roto vuelve a su valor por defecto', () => {
	const ok = parseSaved(JSON.stringify({ kind: 'tv', sort: 'popular', from: 60, to: 12, votes: 5000, lang: '', genres: ['18'] }));
	assert.deepEqual(ok, { kind: 'tv', sort: 'popular', from: 60, to: 12, votes: 5000, lang: '', genres: ['18'] });
	assert.deepEqual(parseSaved('no es json'), DEFAULTS);
	assert.equal(parseSaved(JSON.stringify({ kind: 'doc', votes: 7, from: 13 })).votes, DEFAULTS.votes);
	assert.equal(parseSaved(JSON.stringify({ from: 12, to: 24 })).to, 0, 'hasta más viejo que desde: queda en hoy');
	const { st } = make(fakeApi().api, {}, JSON.stringify({ kind: 'tv', votes: 1000 }));
	assert.equal(st.f.kind, 'tv');
	assert.equal(st.f.votes, 1000);
});

test('paginado: la página 2 se suma sin repetir y termina con hasMore false', async () => {
	const { api, calls } = fakeApi({ browse: (_f, page) => Promise.resolve(page === 1 ? { items: trending.items, hasMore: true } : { items: [...trending.items.slice(0, 2), ...top.items.filter((i) => !trending.items.some((t) => t.id === i.id)).slice(0, 1)], hasMore: false }) });
	const { store, st } = make(api);
	await store.loadMore();
	assert.equal(st.items.length, trending.items.length);
	assert.equal(st.done, false);
	await store.loadMore();
	assert.deepEqual(calls.browse.map(([, p]) => p), [1, 2]);
	assert.equal(st.items.length, trending.items.length + 1, 'los dos repetidos no se suman');
	assert.equal(st.done, true);
	await store.loadMore();
	assert.equal(calls.browse.length, 2, 'terminado: no pide más');
});

test('cambiar el tipo: vacía la lista, borra géneros, guarda y pide con el filtro nuevo', async () => {
	const { api, calls } = fakeApi();
	const { store, st, storage } = make(api);
	store.start();
	await wait();
	store.toggleGenre('28');
	await wait();
	assert.deepEqual(st.f.genres, ['28']);
	store.setFilters({ kind: 'tv', votes: 5000 });
	assert.equal(st.items.length, 0);
	assert.deepEqual(st.f.genres, []);
	await wait();
	const last = calls.browse.at(-1)?.[0];
	assert.equal(last?.kind, 'tv');
	assert.equal(last?.minVotes, 5000);
	assert.equal(JSON.parse(storage.getItem('k') ?? '{}').kind, 'tv');
	assert.ok(st.genreList.tv, 'géneros del tipo nuevo');
});

test('una respuesta de una lista anterior no pisa a la nueva', async () => {
	let release: (p: CatalogPage) => void = () => {};
	const slow = new Promise<CatalogPage>((r) => (release = r));
	const { api } = fakeApi({ browse: (f) => (f.sort === 'rating' ? slow : Promise.resolve({ items: trending.items.slice(0, 2), hasMore: false })) });
	const { store, st } = make(api);
	void store.loadMore();
	store.setFilters({ sort: 'popular' });
	await wait();
	release({ items: top.items, hasMore: false });
	await wait();
	assert.equal(st.items.length, 2);
});

test('sin key de TMDB (filtered: false) la pantalla lo sabe', async () => {
	const { api } = fakeApi({ browse: () => Promise.resolve({ items: trending.items, hasMore: false, filtered: false }) });
	const { store, st } = make(api);
	await store.loadMore();
	assert.equal(st.filtered, false);
});

test('buscar: espera la pausa, pide por texto y al limpiar vuelve al catálogo', async () => {
	const { api, calls } = fakeApi();
	const status: string[] = [];
	const { store, st } = make(api, { minQuery: 2, onstatus: (s) => status.push(s) });
	store.start();
	await wait();
	store.setQuery('f');
	assert.equal(store.mode(), 'browse', 'menos letras que el mínimo: sigue el catálogo');
	store.setQuery('fight club');
	assert.equal(store.mode(), 'search');
	assert.equal(st.items.length, 0);
	assert.equal(calls.search.length, 0, 'todavía esperando');
	await wait(30);
	assert.deepEqual(calls.search, [['fight club', 1]]);
	assert.equal(st.items.length, found.length);
	assert.ok(status.some((s) => s.includes('Elegí')));
	store.clearSearch();
	await wait();
	assert.equal(store.mode(), 'browse');
	assert.equal(st.q, '');
	assert.equal(st.items.length, top.items.length);
});

test('persona elegida: muestra lo suyo; escribir de nuevo la saca', async () => {
	const { api, calls } = fakeApi();
	const { store, st } = make(api);
	store.pickPerson({ id: 287, name: 'Brad Pitt', photo: null, role: 'cast' });
	await wait();
	assert.deepEqual(calls.person, [[287, 'cast']]);
	assert.equal(store.mode(), 'person');
	assert.equal(st.items.length, 3);
	assert.equal(st.done, true);
	store.setQuery('fi');
	assert.equal(st.person, null);
});

test('evento "excluded": la tarjeta deja de verse sin recargar', async () => {
	const { api, emit } = fakeApi();
	const { store, st } = make(api);
	store.connect();
	await store.loadMore();
	const before = store.visible().length;
	emit({ type: 'excluded', id: st.items[0]?.id ?? '' });
	assert.equal(store.visible().length, before - 1);
});
