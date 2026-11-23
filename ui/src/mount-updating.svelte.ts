// Pantalla completa "Actualizando" del desktop (componente compartido), para `updater.js`: se muestra al tocar
// Actualizar y reiniciar y avanza con la descarga.
import { mount, unmount } from 'svelte';
import Updating from '../../packages/ui/src/components/Updating.svelte';

export interface UpdatingScreen {
	/** `progress` 0–1, o null si todavía no se sabe el tamaño. */
	set(detail: string, progress: number | null): void;
	close(): void;
}

export function showUpdating(detail: string): UpdatingScreen {
	const props = $state<{ detail: string; progress: number | null }>({ detail, progress: null });
	const inst = mount(Updating, { target: document.body, props });
	return {
		set: (d, p) => Object.assign(props, { detail: d, progress: p }),
		close: () => void unmount(inst),
	};
}
