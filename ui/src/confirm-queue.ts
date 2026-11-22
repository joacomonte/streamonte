// Cola del diálogo de confirmación: hay un solo <dialog> (`ConfirmDialog.svelte`), los pedidos se muestran de a uno.
export type ConfirmButton<T> = { id?: string; label: string; value: T; primary?: boolean; danger?: boolean };
/** Texto, o una barra de progreso con nombre (reproducción que sigue bajando). */
export type ConfirmBody = string | { name: string; pct: number };
export type ConfirmRequest = { title: string; body: ConfirmBody; buttons: ConfirmButton<unknown>[]; resolve: (value: unknown) => void; closing: boolean };

let current: ConfirmRequest | null = null;
const pending: ConfirmRequest[] = [];
const listeners = new Set<() => void>();
const emit = (): void => listeners.forEach((l) => l());

export const currentConfirm = (): ConfirmRequest | null => current;
export function subscribeConfirm(fn: () => void): () => void {
	listeners.add(fn);
	return () => void listeners.delete(fn);
}

function pump(): void {
	if (current) return;
	current = pending.shift() ?? null;
	if (current) emit();
}

/** Devuelve el `value` del botón elegido, o null si se cierra el diálogo (Esc). */
export function confirmDialog<T>(title: string, body: ConfirmBody, buttons: ConfirmButton<T>[]): Promise<T | null> {
	return new Promise((resolve) => {
		pending.push({ title, body, buttons, resolve: (v) => resolve(v as T | null), closing: false });
		pump();
	});
}

/** Responde el pedido en curso. El siguiente sale en otro turno: así el evento `close` del diálogo anterior no lo descarta. */
export function answerConfirm(value: unknown): void {
	const c = current;
	if (!c) return;
	current = null;
	emit();
	c.resolve(value);
	setTimeout(pump, 0);
}
