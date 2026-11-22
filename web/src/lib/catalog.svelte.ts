// Catálogo de la web: un store a nivel módulo (la lista y los filtros siguen ahí al volver de una ficha) sobre `webApi`.
import { createCatalogStore, type CatalogStore } from '$ui/catalog/catalog.svelte.ts';
import * as cache from './saved.ts';
import { createWebApi } from './webApi.ts';

/** Catálogo y géneros quedan guardados un día: al volver a entrar se ve al instante. */
const cachedFetch: typeof fetch = async (input, init) => {
	const url = String(input);
	if (init?.method || !/^\/api\/(catalog|genres)\?/.test(url)) return fetch(input, init);
	const { ok, status, data } = await cache.json(fetch, url, cache.DAY);
	return new Response(JSON.stringify(data), { status: ok ? 200 : status });
};

let store: CatalogStore | null = null;

/** El store de la sesión (en el servidor, uno nuevo por render: nada se comparte entre pedidos). */
export function webCatalog(): CatalogStore {
	const make = () => createCatalogStore(createWebApi(cachedFetch), { storageKey: 'streamonte.catalog.filters.v3' });
	if (typeof window === 'undefined') return make();
	return (store ??= make());
}
