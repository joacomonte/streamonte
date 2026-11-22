// Catálogo de la web: un store a nivel módulo (la lista y los filtros siguen ahí al volver de una ficha) sobre `webApi` (con su caché de un día).
import { createCatalogStore, type CatalogStore } from '$ui/catalog/catalog.svelte.ts';
import { webApi } from './webApi.ts';

let store: CatalogStore | null = null;

/** El store de la sesión (en el servidor, uno nuevo por render: nada se comparte entre pedidos). */
export function webCatalog(): CatalogStore {
	const make = () => createCatalogStore(webApi, { storageKey: 'streamonte.catalog.filters.v3' });
	if (typeof window === 'undefined') return make();
	return (store ??= make());
}
