// Puente entre los wrappers JS (dialogs.js, speed.js) y los componentes Svelte: `main.ts` monta los componentes, que se registran acá.
export const host: {
	openSettings?: () => Promise<void>;
	openLog?: (title: string, lines: string[]) => void;
	/** Dibuja el panel "Tu conexión" dentro del popover `pop` (reemplaza el anterior). */
	showSpeedPanel?: (pop: HTMLElement) => void;
} = {};
