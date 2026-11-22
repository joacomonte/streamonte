// Monta el catálogo compartido (grilla, buscador, filtros) en #cat-root, con el `Api` del desktop. `catalog.js` conserva
// Pegados, Fuentes y el panel lateral; acá solo se los conecta.
import { createRawSnippet, mount } from 'svelte';
import type { Api } from '../../packages/ui/src/api.ts';
import Catalog from '../../packages/ui/src/catalog/Catalog.svelte';
import { createCatalogStore } from '../../packages/ui/src/catalog/catalog.svelte.ts';
import { apiContext } from '../../packages/ui/src/context.ts';
import { askTmdbKey, attachStore, pasteMagnet, setPastedHost } from './catalog.js';
import { hooks } from './catalog-state.js';
import { openSide } from './catalog-side.js';
import { openSettings } from './dialogs.js';
import { setStatus } from './dom.js';
import { rawKind } from './tauri-adapt.ts';
import { isTouring } from './welcome-state.js';

export function mountCatalog(api: Api): void {
	const store = createCatalogStore(api, { storageKey: 'streamonte.catalog.filters.v3', searchWait: 900, minQuery: 2, filterWait: 400, onstatus: setStatus });
	attachStore(store);
	store.st.covered = isTouring();
	window.addEventListener('welcome-done', () => (store.st.covered = false));
	hooks.side = (side) => (store.st.activeId = side?.id ?? null);
	// "Pegados" (legacy) va arriba de la grilla, salvo mientras se busca.
	const top = createRawSnippet((searching: () => boolean) => ({
		render: () => '<div id="cat-pasted-host"></div>',
		setup: (node: Element) => setPastedHost(searching() ? null : (node as HTMLElement))
	}));
	const target = document.getElementById('cat-root');
	if (!target) throw new Error('Falta #cat-root');
	mount(Catalog, {
		target,
		context: apiContext(api),
		props: {
			store, top, pinned: true, cardMin: 170, onsettings: openSettings, onneedskey: askTmdbKey, onmagnet: pasteMagnet,
			onopen: (it) => openSide(rawKind(it.kind), it.id, it.title)
		}
	});
}
