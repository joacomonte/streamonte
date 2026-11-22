// Puente TS → Svelte del panel de opciones: `catalog-options.ts` arma la vista (`streams-view.ts`) y la deja acá; `StreamsPanel.svelte`
// se monta una vez por `#cat-streams` (la ficha lo recrea al cambiar de título) y redibuja solo lo que cambió. También el menú de
// clic derecho de una opción (`CtxMenu.svelte`, uno en `body`).
import { flushSync, mount, unmount } from 'svelte';
import CtxMenu from './CtxMenu.svelte';
import StreamsPanel from './StreamsPanel.svelte';
import type { CtxItem, StreamsView } from './streams-view.ts';

class Current {
	v = $state.raw<StreamsView | null>(null);
}
const current = new Current();
let target: HTMLElement | null = null;
let app: ReturnType<typeof mount> | null = null;

/** Deja esta vista en `box` (monta el panel la primera vez que se ve ese nodo). */
export function showStreams(box: HTMLElement, v: StreamsView | null): void {
	current.v = v;
	if (target === box) return;
	if (app) void unmount(app);
	target = box;
	app = mount(StreamsPanel, { target: box, props: { get view() { return current.v; } } });
}
/** Aplica ya lo pendiente (para medir las filas después de redibujar). */
export const flushStreams = (): void => flushSync();

export const ctx: { open: boolean; x: number; y: number; items: CtxItem[] } = $state({ open: false, x: 0, y: 0, items: [] });
let ctxMounted = false;
export function mountCtxMenu(): void {
	if (ctxMounted) return;
	ctxMounted = true;
	mount(CtxMenu, { target: document.body });
}
/** Abre el menú en (x, y), sin salirse de la ventana, con el foco en el primer ítem. */
export function openCtxMenu(items: CtxItem[], x: number, y: number): void {
	Object.assign(ctx, { open: true, items, x, y });
	flushSync();
	const menu = document.getElementById('cat-ctx');
	if (!menu) return;
	ctx.x = Math.min(x, innerWidth - menu.offsetWidth - 8);
	ctx.y = Math.min(y, innerHeight - menu.offsetHeight - 8);
	menu.querySelector('button')?.focus({ preventScroll: true });
}
export const closeCtxMenu = (): void => { ctx.open = false; };
