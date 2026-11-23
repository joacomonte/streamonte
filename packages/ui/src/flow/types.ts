// Contrato de las piezas compartidas de los pasos (buscar torrents → elegir → buscar el mejor): las dibujan los componentes de
// esta carpeta con la UI y animaciones de la web; las usan `web/src/lib/Torrents.svelte` y `ui/src/FlowScreen.svelte`.
import type { IconName } from '../components/icons.ts';

/** Ícono de la tarjeta: barras de conexión (1-4 encendidas), parlante que late, globo con texto (LAT/ES), lista animada ("Ver todas") o ícono común. */
export type TileSpec = { kind: 'net'; level: 1 | 2 | 3 | 4 } | { kind: 'wave' } | { kind: 'bubble'; text: string } | { kind: 'list' } | { kind: 'icon'; icon: IconName };

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
	primary?: boolean;
	picked?: boolean;
	disabled?: boolean;
	onclick: () => void;
};

/** Migas: lo elegido hasta ahora; las que tienen `onclick` vuelven a ese paso. */
export type FlowCrumb = { id: string | null; label: string; onclick: (() => void) | null; title?: string | null };
