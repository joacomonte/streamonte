// Cola del toast (`Toast.svelte`): hay uno solo por app; uno nuevo reemplaza al que está a la vista.
export type ToastAction = { id?: string; label: string; onclick: () => void };
export type ToastRequest = {
	/** Cambia en cada `toast()`: reinicia el temporizador y las animaciones. */
	n: number;
	text: string;
	sub?: string;
	action?: ToastAction;
	/** Con tilde animada (confirmaciones como "Link copiado"). */
	check?: boolean;
	/** Id del elemento; por defecto `toast`. */
	id?: string;
	/** Cuánto dura a la vista (ms). */
	ms: number;
};
export type ToastOptions = Omit<ToastRequest, 'n' | 'ms'> & { ms?: number };

let current: ToastRequest | null = null;
let count = 0;
const listeners = new Set<() => void>();
const emit = (): void => listeners.forEach((l) => l());

export const currentToast = (): ToastRequest | null => current;
export function subscribeToast(fn: () => void): () => void {
	listeners.add(fn);
	return () => void listeners.delete(fn);
}

/** Muestra el toast (reemplaza al anterior); se va solo a los 2800 ms salvo `ms`. */
export function toast(opts: ToastOptions): void {
	current = { ...opts, n: ++count, ms: opts.ms ?? 2800 };
	emit();
}

export function dismissToast(): void {
	current = null;
	emit();
}
