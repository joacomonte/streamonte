// Modelo de vista del panel de opciones del desktop (`#cat-streams`): lo arman `catalog-options.ts` (lista, análisis, filtros)
// y `catalog-flow.ts` (pasos); lo dibujan `StreamsPanel.svelte`, `FlowScreen.svelte` y sus partes. Textos ya traducidos.
import type { IconName } from '$ui/components/icons.ts';
import type { FlowCrumb, TileSpec } from '$ui/flow/types.ts';
import type { OptionRowView } from '$ui/options/row.ts';

export type Click = (ev: MouseEvent & { currentTarget: HTMLButtonElement }) => void;

/** Migas: lo elegido hasta ahora; las que tienen `onclick` vuelven a ese paso. */
export type CrumbsView = { aria: string; items: FlowCrumb[] };

/** Al pie de lo que se ve: búsqueda de pistas en curso, ya no hay más, o "Seguir buscando". */
export type MoreRowView =
	| { kind: 'running'; text: string; stop: string; onstop: () => void }
	| { kind: 'done'; found: boolean; text: string }
	| { kind: 'more'; title: string; small: string | null; onclick: () => void };

/** Tarjeta de un paso (la dibuja `$ui/flow/FlowChoice.svelte`): ícono (`tile`), su color CSS (`tone`) y la posición en la pantalla
 *  (`i`, entrada escalonada). */
export type ChoiceView = {
	id: string;
	tile: TileSpec;
	tone: string;
	i: number;
	title: string;
	sub: string;
	note: string | null;
	badge: string | null;
	disabled: boolean;
	primary: boolean;
	onclick: () => void;
};
/** Botón ancho de los pasos (`.cat-flow-btn`): con `small`, título en negrita y aclaración debajo; `count`, el número al costado. */
export type FlowButton = { id: string; icon: IconName; text: string; small: string | null; title: string | null; count: string | null; onclick: () => void };

type Screen = { crumbs: CrumbsView | null; title: string | null };
export type FlowView =
	| { kind: 'search'; title: string; sub: string; frac: number | null }
	| (Screen & { kind: 'choices'; choices: ChoiceView[] })
	| (Screen & { kind: 'scan'; text: string; /** Avance 0..1. */ frac: number; count: string; stop: FlowButton })
	| (Screen & { kind: 'nolat'; none: string; choices: ChoiceView[]; more: MoreRowView | null })
	| (Screen & { kind: 'match'; note: string | null; rows: OptionRowView[]; lighter: FlowButton | null; more: MoreRowView | null; all: FlowButton })
	| (Screen & { kind: 'spain'; note: string; rows: OptionRowView[]; original: FlowButton; all: FlowButton });

/** Panel del análisis de la resolución abierta (`groupPanel`). */
export type PanelView =
	| { kind: 'stopping'; title: string; sub: string }
	| {
			kind: 'running';
			title: string;
			line: string;
			fresh: boolean;
			best: { on: boolean; title: string; text: string; onclick: () => void } | null;
			stop: { aria: string; title: string; onclick: Click };
			bar: { kind: 'deep'; fill: string; creep: string | null } | { kind: 'quick'; now: number; max: number; fill: string };
	  }
	| { kind: 'offer'; title: string; sub: string; onclick: () => void }
	| { kind: 'done'; title: string; sub: string; next: { id: string; text: string; onclick: () => void } };

export type ToggleView = { id: string; pressed: boolean; title: string; text: string; icon: IconName | null; onclick: () => void };
export type SortView = {
	order:
		| { kind: 'fixed'; label: string; icon: IconName; title: string; text: string }
		| { kind: 'choose'; label: string; buttons: { id: string; pressed: boolean; title: string; text: string; onclick: () => void }[] };
	subscan: { kind: 'done'; text: string } | { kind: 'button'; running: boolean; title: string; text: string; onclick: () => void } | null;
	filters: ToggleView[];
};

export type ListView = {
	kind: 'list';
	crumbs: CrumbsView | null;
	auto: { step: 'done' | 'none'; lead: string; text: string; close: string; onclose: () => void } | null;
	group: { id: string; analyzing: boolean; phase: string | null; headId: string; name: string; count: string };
	latOff: string | null;
	panel: PanelView | null;
	/** Analizando: solo el panel, sin filas. */
	panelOnly: boolean;
	sort: SortView;
	rows: OptionRowView[];
	empty: { text: string; clear: { text: string; onclick: () => void } | null } | null;
	moreRows: { text: string; onclick: () => void } | null;
	probing: string | null;
	more: MoreRowView | null;
	lower: { title: string; sub: string; go: string; onclick: () => void } | null;
};

export type StreamsView = { kind: 'empty'; text: string } | { kind: 'flow'; flow: FlowView } | ListView;

/** Menú de clic derecho en una opción. */
export type CtxItem = { id: string; icon: IconName; text: string; onclick: () => void };
