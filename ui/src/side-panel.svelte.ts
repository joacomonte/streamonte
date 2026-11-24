// Puente entre el JS viejo (`catalog-side.js`, dueño de `state.side`) y `SidePanel.svelte`: el JS escribe `panel` y registra `actions`;
// el panel los lee. Sin importar otros módulos del catálogo (evita ciclos).
import type { Kind, Person } from '$ui/types.ts';

export type PanelState = {
	open: boolean;
	kind: Kind;
	id: string;
	/** Título en el idioma elegido (migas). */
	title: string;
	season: number | null;
	episode: number | null;
	/** Hay key de TMDB (null = todavía no se sabe): sin ella no hay "Similares" y se ofrece configurarla. */
	hasKey: boolean | null;
	/** Sube cuando cambia la key de TMDB: la ficha se pide de nuevo. */
	epoch: number;
};

export const panel: PanelState = $state({ open: false, kind: 'movie', id: '', title: '', season: null, episode: null, hasKey: null, epoch: 0 });

export type PanelActions = {
	close: () => void;
	season: (season: number | null) => void;
	episode: (season: number, episode: number) => void;
	person: (p: Person) => void;
	openTitle: (kind: Kind, id: string, name: string) => void;
	imdb: (imdb: string) => void;
	setupTmdb: () => void;
	/** La lista de opciones (`catalog-options.ts`) se dibuja en `#cat-streams`: avisa que ya existe. */
	optionsMounted: () => void;
};
const noop = (): void => {};
export const actions: PanelActions = { close: noop, season: noop, episode: noop, person: noop, openTitle: noop, imdb: noop, setupTmdb: noop, optionsMounted: noop };
