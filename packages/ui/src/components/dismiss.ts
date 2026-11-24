// `use:dismiss`: cierra un panel con Esc o con un toque afuera. Los matices de cada uso van por opciones.
export type DismissBy = 'pointer' | 'escape';

export interface DismissOptions {
	/** Cierra el panel; `by` dice qué lo disparó (p. ej. devolver el foco solo con Esc). */
	onDismiss: (by: DismissBy) => void;
	/** Si devuelve false no se hace nada (panel cerrado, fijado…); por defecto siempre. */
	active?: (by: DismissBy) => boolean;
	/** Toques que cuentan como adentro además de `node` (el botón que abre el panel). */
	ignore?: (target: Element) => boolean;
	/** `pointerdown` en captura (llega aunque otro frene la propagación). */
	capture?: boolean;
	/** Esc: en todo el documento (por defecto) o solo con el foco dentro de `node`. */
	escapeOn?: 'document' | 'node';
	/** Frena la propagación del Esc. */
	stop?: boolean;
	/** No cierra con toques dentro de un `<dialog>` ni con Esc mientras haya uno abierto. */
	dialogGuard?: boolean;
}

export function dismiss(node: HTMLElement, options: DismissOptions): { update: (next: DismissOptions) => void; destroy: () => void } {
	let o = options;
	const capture = !!o.capture;
	const keys: EventTarget = o.escapeOn === 'node' ? node : document;
	const onPointer = (ev: Event): void => {
		const target = ev.target as Element;
		if (o.active && !o.active('pointer')) return;
		if (node.contains(target) || o.ignore?.(target) || (o.dialogGuard && target.closest('dialog'))) return;
		o.onDismiss('pointer');
	};
	const onKey = (ev: Event): void => {
		if ((ev as KeyboardEvent).key !== 'Escape') return;
		if (o.active && !o.active('escape')) return;
		if (o.dialogGuard && document.querySelector('dialog[open]')) return;
		if (o.stop) ev.stopPropagation();
		o.onDismiss('escape');
	};
	document.addEventListener('pointerdown', onPointer, capture);
	keys.addEventListener('keydown', onKey);
	return {
		update: (next) => void (o = next),
		destroy: () => {
			document.removeEventListener('pointerdown', onPointer, capture);
			keys.removeEventListener('keydown', onKey);
		},
	};
}
