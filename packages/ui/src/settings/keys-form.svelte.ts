// Estado y acciones del formulario de keys, igual en web y desktop: lo tipeado, qué campo está abierto, guardar/borrar
// por key y la confirmación de 1,8 s. Cada app inyecta cómo se guarda y qué está guardado (`KeysAdapter`).
import { tick } from 'svelte';
import { t } from '../i18n/runtime.ts';

export interface KeysAdapter {
	/** Qué keys están guardadas. Se lee dentro de `$derived`/plantillas: tiene que ser reactivo (estado de la app). */
	status(): Partial<Record<string, boolean>>;
	/** Guarda la key (ya recortada) y actualiza `status()`. Devuelve el texto de confirmación; sin él, "¡{nombre} conectada!". */
	set(service: string, value: string): Promise<string | void>;
	/** Borra la key y actualiza `status()`. Sin esto no hay botón "Borrar". */
	remove?(service: string): Promise<void>;
}

export const SAVED_MS = 1800;

export function createKeysForm(adapter: KeysAdapter) {
	let typed = $state<Record<string, string>>({});
	let editing = $state<string[]>([]);
	let saved = $state<{ service: string; text: string } | null>(null);
	let busy = $state('');
	let error = $state<{ service: string; text: string } | null>(null);

	const fail = (service: string, e: unknown) => (error = { service, text: e instanceof Error ? e.message : String(e) });

	return {
		get typed() { return typed; },
		get saved() { return saved; },
		get busy() { return busy; },
		get error() { return error; },
		canRemove: !!adapter.remove,
		has: (service: string): boolean => !!adapter.status()[service],
		isEditing: (service: string): boolean => editing.includes(service),
		/** Abre/cierra el reemplazo; al cerrar descarta lo tipeado. */
		async toggle(service: string): Promise<void> {
			const opening = !editing.includes(service);
			editing = opening ? [...editing, service] : editing.filter((s) => s !== service);
			typed[service] = '';
			error = null;
			if (opening) {
				await tick();
				document.getElementById(`key-${service}`)?.focus();
			}
		},
		async save(service: string, name: string): Promise<void> {
			const value = (typed[service] ?? '').trim();
			if (!value || busy) return;
			busy = service;
			error = null;
			try {
				const done = await adapter.set(service, value);
				typed[service] = '';
				editing = editing.filter((s) => s !== service);
				saved = { service, text: done || t('¡{a} conectada!', { a: name }) };
				setTimeout(() => (saved = saved?.service === service ? null : saved), SAVED_MS);
			} catch (e) {
				fail(service, e);
			} finally {
				busy = '';
			}
		},
		async remove(service: string): Promise<void> {
			if (!adapter.remove || busy) return;
			busy = service;
			error = null;
			try {
				await adapter.remove(service);
				typed[service] = '';
				editing = editing.filter((s) => s !== service);
			} catch (e) {
				fail(service, e);
			} finally {
				busy = '';
			}
		}
	};
}
export type KeysForm = ReturnType<typeof createKeysForm>;
