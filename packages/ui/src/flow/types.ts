// Contrato de los pasos (buscar torrents → elegir → buscar el mejor): las piezas de esta carpeta las dibujan con la UI y
// animaciones de la web; `FlowView` es lo que arma `flow-model.ts` y dibujan `web/src/lib/Torrents.svelte` y `ui/src/FlowScreen.svelte`.
import type { IconName } from '../components/icons.ts';
import type { OptionRowView } from '../options/row.ts';

/** Ícono de la tarjeta: barras de conexión (1-4 encendidas), parlante que late, globo con texto (LAT/ES), lista animada ("Ver todas") o ícono común. */
export type TileSpec = { kind: 'net'; level: 1 | 2 | 3 | 4 } | { kind: 'wave' } | { kind: 'bubble'; text: string } | { kind: 'list' } | { kind: 'icon'; icon: IconName };

/** Dato corto de una tarjeta en vez de texto (2026-11-23, variante A de docs/mockups/audio-latino): seguras (✓), a revisar
 * (lupa), tarda más (reloj) o la resolución típica. `title`: el detalle al pasar el mouse. */
export type FlowChip = { kind: 'ok' | 'maybe' | 'slow' | 'res'; text: string; title?: string | null };

/** Tarjeta de un paso. `tone`: color CSS del ícono (p. ej. 'var(--green)'); `i`: orden para la entrada escalonada. */
export type FlowChoiceProps = {
	id: string;
	title: string;
	sub: string;
	tile: TileSpec;
	tone: string;
	i: number;
	badge?: string | null;
	note?: string | null;
	/** Con chips, reemplazan a `sub` (que queda como texto para lectores de pantalla). */
	chips?: FlowChip[] | null;
	primary?: boolean;
	picked?: boolean;
	disabled?: boolean;
	onclick: () => void;
};

/** Migas: lo elegido hasta ahora; las que tienen `onclick` vuelven a ese paso. */
export type FlowCrumb = { id: string | null; label: string; onclick: (() => void) | null; title?: string | null };

/** Al pie de lo que se ve: búsqueda de pistas en curso (`small`: el avance "{a} de {n}"), ya no hay más, o "Seguir buscando". */
export type MoreRowView =
	| { kind: 'running'; text: string; small?: string; stop: string; onstop: () => void }
	| { kind: 'done'; found: boolean; text: string }
	| { kind: 'more'; title: string; small: string | null; onclick: () => void };

/** Migas con su etiqueta para lectores de pantalla. */
export type CrumbsView = { aria: string; items: FlowCrumb[] };

/** Pasos: modo (TorBox / torrent, solo desktop), conexión, ¿latino?, calidad (solo por torrent) y el resultado / la lista. */
export type FlowStep = 'mode' | 'net' | 'lat' | 'res' | 'list';

/** Tarjeta de un paso (la dibuja `FlowChoice.svelte`): ícono (`tile`), su color CSS (`tone`) y la posición (`i`, entrada escalonada). */
export type ChoiceView = {
	id: string;
	tile: TileSpec;
	tone: string;
	i: number;
	title: string;
	sub: string;
	note: string | null;
	badge: string | null;
	chips: FlowChip[] | null;
	disabled: boolean;
	primary: boolean;
	onclick: () => void;
};
/** Botón ancho de los pasos: con `small`, título en negrita y aclaración debajo; `count`, el número al costado. */
export type FlowButton = { id: string; icon: IconName; text: string; small: string | null; title: string | null; count: string | null; onclick: () => void };

type Screen = { crumbs: CrumbsView | null; title: string | null };
/** Una pantalla de los pasos, con textos ya traducidos. `search` lo arma cada app (cómo carga sus fuentes es suyo). */
export type FlowView =
	| { kind: 'search'; title: string; sub: string; frac: number | null }
	| (Screen & { kind: 'choices'; step: FlowStep; choices: ChoiceView[]; /** Aviso arriba de las tarjetas y "Ver todas" al pie (TorBox sin latino). */ note: string | null; all: FlowButton | null })
	| (Screen & { kind: 'scan'; text: string; /** Avance 0..1. */ frac: number; count: string; stop: FlowButton })
	/** TorBox sin nada para elegir (2026-11-24): el aviso, "Ver por torrent" (desktop) y "Ver todas" si hay lista. */
	| (Screen & { kind: 'notice'; text: string; action: FlowButton | null; all: FlowButton | null })
	| (Screen & { kind: 'match'; note: string | null; rows: OptionRowView[]; lighter: FlowButton | null; more: MoreRowView | null; all: FlowButton })
	| (Screen & { kind: 'spain'; note: string; rows: OptionRowView[]; original: FlowButton; all: FlowButton });
