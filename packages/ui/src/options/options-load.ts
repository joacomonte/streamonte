// Búsqueda de opciones de un video por `Api.options.load` (sin Svelte, para probarla con node --test). La web emite progreso
// (fuente por fuente, chequeo de TorBox) y la lista con `done: true`; el desktop, una por tanda de fuentes. La lista que ya se
// ve no se vacía con una actualización de progreso.
import type { Api } from '../api.ts';
import type { OptionRef, OptionsUpdate, SourceStatus, TorrentOption } from '../types.ts';

export type OptionsLoad = {
	/** null = todavía no llegó ninguna lista. */
	options: TorrentOption[] | null;
	sources: SourceStatus[];
	progress: { done: number; total: number } | null;
	checking: boolean;
	done: boolean;
	error: string;
};

export const emptyLoad = (): OptionsLoad => ({ options: null, sources: [], progress: null, checking: false, done: false, error: '' });

/** Suma una actualización a lo que ya se ve. */
export function applyUpdate(s: OptionsLoad, u: OptionsUpdate): OptionsLoad {
	return {
		options: u.options.length || u.done ? u.options : s.options,
		sources: u.sources.length ? u.sources : s.sources,
		progress: u.progress ?? s.progress,
		checking: u.checking,
		done: u.done || s.done,
		error: s.error
	};
}

/** Pide las opciones de `ref` y llama a `set` con cada estado nuevo. `alive()` false = cambió el video: se deja de escuchar. */
export async function loadOptions(api: Pick<Api, 'options'>, ref: OptionRef, set: (s: OptionsLoad) => void, alive: () => boolean): Promise<void> {
	let s = emptyLoad();
	set(s);
	try {
		for await (const u of api.options.load(ref)) {
			if (!alive()) return;
			s = applyUpdate(s, u);
			set(s);
		}
	} catch (err) {
		if (alive()) set({ ...s, error: err instanceof Error ? err.message : String(err) });
	}
}
