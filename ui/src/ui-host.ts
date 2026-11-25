// Puente entre los módulos TS (dialog-flows.ts, speed.ts) y los componentes Svelte: `main.ts` monta los componentes, que se registran acá.
export const host: {
	openSettings?: (tile?: string) => Promise<void>;
	openLog?: (title: string, lines: string[]) => void;
	/** Dibuja el panel "Tu conexión" dentro del popover `pop` (reemplaza el anterior). */
	showSpeedPanel?: (pop: HTMLElement) => void;
} = {};
