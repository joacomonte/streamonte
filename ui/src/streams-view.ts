// Modelo de vista del panel de opciones del desktop (`#cat-streams`): lo arman `catalog-options.ts` (lista, análisis, filtros)
// y `catalog-flow.ts` (pasos, modelo en `$ui/flow/flow-model.ts`); lo dibujan `StreamsPanel.svelte`, `FlowScreen.svelte` y sus partes. Textos ya traducidos.
import type { IconName } from '$ui/components/icons.ts';
import type { CrumbsView, FlowView, MoreRowView } from '$ui/flow/types.ts';

export type { MoreRowView };
import type { OptionRowView } from '$ui/options/row.ts';

export type Click = (ev: MouseEvent & { currentTarget: HTMLButtonElement }) => void;

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
