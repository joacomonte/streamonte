<script lang="ts" module>
	import type { Snippet } from 'svelte';
	import type { IconName } from '../../components/icons.ts';
	/** Una ficha del tablero de Ajustes. `area` es su nombre en `areas` (grid-template-areas). */
	export type BoardTile = {
		id: string;
		label: string;
		/** Título del panel abierto, si no es `label`. */
		title?: string;
		icon: IconName;
		/** Lo que se ve en la ficha cerrada (estado de un vistazo). */
		summary: Snippet;
		/** Ilustración del encabezado del panel abierto. */
		art: Snippet;
		/** Una línea viva bajo el título del panel. */
		hero: string;
		/** Las filas de siempre (Section, KeyField…). */
		panel: Snippet;
	};
</script>

<script lang="ts">
	// Ajustes como tablero (web y desktop): fichas con el estado de un vistazo; tocar una la abre en su lugar
	// (recorte animado desde la ficha). ← o Esc vuelven y el foco vuelve a la ficha. Estilos: css/board.css.
	import { tick } from 'svelte';
	import Icon from '../../components/Icon.svelte';
	import { t } from '../../i18n/runtime.ts';
	import ArtDefs from './art/ArtDefs.svelte';

	interface Props {
		tiles: BoardTile[];
		/** grid-template-areas con 3 columnas, ej. `"'keys keys profile' 'repro net profile'"`. */
		areas: string;
		/** Lo mismo con 2 columnas, para anchos < 560 px. */
		areasNarrow: string;
	}
	let { tiles, areas, areasNarrow }: Props = $props();

	let openId = $state<string | null>(null);
	let root = $state<HTMLElement>();
	let panel = $state<HTMLElement>();
	const current = $derived(tiles.find((x) => x.id === openId));
	const reduce = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
	const tileEl = (id: string) => root?.querySelector<HTMLElement>(`#board-tile-${id}`);

	/** Recorte del panel que coincide con la ficha: de ahí crece o ahí vuelve. */
	function insetOf(id: string): string {
		const R = root!.getBoundingClientRect();
		const r = tileEl(id)!.getBoundingClientRect();
		return `inset(${r.top - R.top}px ${R.right - r.right}px ${R.bottom - r.bottom}px ${r.left - R.left}px round 24px)`;
	}

	/** Abre una ficha (también desde afuera con `bind:this`, ej. Ajustes directo en Llaves). */
	export async function open(id: string): Promise<void> {
		openId = id;
		await tick();
		if (!reduce()) panel?.animate([{ clipPath: insetOf(id) }, { clipPath: 'inset(0 0 0 0 round 18px)' }], { duration: 420, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' });
		root?.querySelector<HTMLElement>('#board-back')?.focus({ preventScroll: true });
	}

	function close(): void {
		const id = openId;
		if (!id) return;
		const done = () => {
			openId = null;
			// Tras quitar el `inert` de la grilla, si no el foco no entra.
			void tick().then(() => tileEl(id)?.focus({ preventScroll: true }));
		};
		if (reduce() || !panel) return done();
		panel.animate([{ clipPath: 'inset(0 0 0 0 round 18px)', opacity: 1 }, { clipPath: insetOf(id), opacity: 0.5 }], { duration: 300, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)', fill: 'forwards' }).onfinish = done;
	}

	/** Esc con un panel abierto vuelve al tablero (no cierra el diálogo que lo contiene). */
	function onkeydown(e: KeyboardEvent): void {
		if (e.key === 'Escape' && openId) {
			e.preventDefault();
			e.stopPropagation();
			close();
		}
	}
</script>

<div bind:this={root} id="board" class="board" class:open={!!openId} style:--areas={areas} style:--areas-narrow={areasNarrow} role="presentation" {onkeydown}>
	<ArtDefs />
	<div class="board-amb" aria-hidden="true"><i></i><i></i><i></i><i></i></div>
	<div class="board-grid" inert={!!openId}>
		{#each tiles as tile (tile.id)}
			<button id="board-tile-{tile.id}" class="board-tile" type="button" style:grid-area={tile.id} aria-label={t('{x}: abrir', { x: tile.label })} onclick={() => open(tile.id)}>
				<span class="board-h"><Icon name={tile.icon} size={15} />{tile.label}<span class="board-go"><Icon name="arrow" size={14} /></span></span>
				{@render tile.summary()}
			</button>
		{/each}
	</div>
	{#if current}
		<section bind:this={panel} id="board-panel" class="board-panel" aria-labelledby="board-panel-title">
			<div class="board-top">
				<button id="board-back" class="board-back" type="button" aria-label={t('Volver al tablero')} onclick={close}><Icon name="back" size={18} /></button>
				<span>{t('Ajustes')} › {current.label}</span>
			</div>
			<div class="board-hero">
				<div class="board-hero-art">{@render current.art()}</div>
				<div><h3 id="board-panel-title">{current.title ?? current.label}</h3><p>{current.hero}</p></div>
			</div>
			{@render current.panel()}
		</section>
	{/if}
</div>
