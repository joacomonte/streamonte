// Puente JS → Svelte de la lista de opciones: una lista compartida (`$ui/options/OptionsList.svelte`) por lugar del panel
// ('main', 'match', 'spain'), montada una sola vez. `catalog-options.js` y `catalog-flow.js` rearman el panel en cada
// redibujo y vuelven a poner el mismo nodo con las filas nuevas: las filas que siguen se actualizan, no se rehacen.
import { flushSync, mount } from 'svelte';
import OptionsList from '$ui/options/OptionsList.svelte';
import type { OptionRowView } from '$ui/options/row.ts';

class Slot {
	rows = $state.raw<OptionRowView[]>([]);
	host = document.createElement('div');
	constructor() {
		this.host.className = 'cat-options-host';
		this.host.style.display = 'contents';
		const slot = this;
		mount(OptionsList, { target: this.host, props: { get rows() { return slot.rows; } } });
	}
}
const slots = new Map<string, Slot>();

/** El nodo de la lista `name` con estas filas (para meterlo en el panel). */
export function optionsList(name: string, rows: OptionRowView[]): HTMLElement {
	let slot = slots.get(name);
	if (!slot) {
		slot = new Slot();
		slots.set(name, slot);
	}
	slot.rows = rows;
	return slot.host;
}

/** Aplica ya lo pendiente (para medir las filas después de redibujar). */
export const flushOptions = (): void => flushSync();
