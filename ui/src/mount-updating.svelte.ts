// Pantalla completa "Actualizando" del desktop (componente compartido), para `updater.js`: se muestra al tocar
// Actualizar y reiniciar y avanza con la descarga.
import { mount, unmount } from 'svelte';
import Updating from '../../packages/ui/src/components/Updating.svelte';
import UpdateBar from '../../packages/ui/src/components/UpdateBar.svelte';

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

export interface UpdateBarHandle {
	/** Texto del botón y si queda deshabilitado (mientras baja la versión). */
	setAction(actionLabel: string, busy: boolean): void;
	close(): void;
}

/** Aviso de versión nueva (componente compartido) abajo, sobre la barra de estado; `updater.ts` solo llama a Tauri. */
export function showUpdateBar(p: { text: string; notes?: string; actionLabel: string; onaction: () => void }): UpdateBarHandle {
	const props = $state({ text: p.text, notes: p.notes, actionLabel: p.actionLabel, busy: false, onaction: p.onaction, bottom: '44px', ondismiss: () => inst && unmount(inst) });
	const inst = mount(UpdateBar, { target: document.body, props });
	return {
		setAction: (actionLabel, busy) => Object.assign(props, { actionLabel, busy }),
		close: () => void unmount(inst),
	};
}
