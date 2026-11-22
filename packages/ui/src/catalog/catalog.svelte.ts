// Store del catálogo reactivo: `$state` + la lógica de `store.ts`. Una instancia por app (a nivel módulo en la web, así la lista
// y el scroll siguen ahí al volver de una ficha).
import type { Api } from '../api.ts';
import { createCatalog, initialState, type CatalogOptions, type CatalogStore } from './store.ts';

export type { CatalogOptions, CatalogStore, PickedPerson } from './store.ts';

export function createCatalogStore(api: Api, opts: CatalogOptions): CatalogStore {
	const storage = opts.storage ?? (typeof localStorage === 'undefined' ? null : localStorage);
	const st = $state(initialState(storage, opts.storageKey));
	return createCatalog(api, st, { ...opts, storage });
}
