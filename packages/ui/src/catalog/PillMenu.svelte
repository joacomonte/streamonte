<script lang="ts" generics="V extends string | number">
	// Pastilla elevada de los filtros del catálogo que abre un menú corto (votos y orden). El menú va al final de `body`,
	// arriba de todo y fuera del encabezado pegajoso. Cara y opciones en acrílico (`.ac-face`, docs/estilo/README.md).
	// Se cierra eligiendo, tocando afuera, con Esc (vuelve el foco a la pastilla) o con Tab; flechas, Inicio y Fin recorren.
	import type { Snippet } from 'svelte';
	import { tick } from 'svelte';
	import Icon from '../components/Icon.svelte';

	interface Props {
		/** Id de la pastilla; el menú es `{id}-menu` y cada opción `{id}-opt-{v}`. */
		id: string;
		/** Nombre accesible del menú (y de la pastilla, si su cara no alcanza). */
		label: string;
		items: V[];
		value: V;
		onpick: (v: V) => void;
		/** Lo que se ve en la pastilla (sin el chevron). */
		face: Snippet;
		/** Una opción del menú (sin la tilde del elegido). */
		option: Snippet<[V]>;
		/** Acrílico por partes: la cara y las opciones no llevan filtro; lo toman sus `.ac-part` (las `.ac-part.flick`
		 *  parpadean cada una con su retraso `--d`). Los textos de las partes ponen su `.ac-face`. */
		split?: boolean;
	}
	let { id, label, items, value, onpick, face, option, split = false }: Props = $props();

	let open = $state(false);
	let btn = $state<HTMLButtonElement>();
	let menu = $state<HTMLElement>();
	let at = $state({ top: 0, left: 0 });

	/** Bajo la pastilla, sin salirse de la pantalla por los costados. Si alineado a la izquierda de la pastilla no entra
	 *  (pastilla a la derecha), se alinea a su borde derecho: así queda sobre el panel y no bajo lo que haya a la derecha.
	 *  `clientWidth` y no `innerWidth`: este cuenta la barra de scroll. */
	function place() {
		if (!btn) return;
		const r = btn.getBoundingClientRect();
		const w = menu?.offsetWidth ?? 240;
		const vw = document.documentElement.clientWidth;
		const left = r.left + w > vw - 12 ? r.right - w : r.left;
		at = { top: r.bottom + 8, left: Math.max(12, Math.min(left, vw - w - 12)) };
	}
	const options = () => [...(menu?.querySelectorAll<HTMLElement>('[role="menuitemradio"]') ?? [])];
	async function show() {
		place();
		open = true;
		await tick();
		place();
		options()[Math.max(0, items.indexOf(value))]?.focus();
	}
	function close(focus = false) {
		open = false;
		if (focus) btn?.focus();
	}
	function pick(v: V) {
		close(true);
		if (v !== value) onpick(v);
	}
	function keys(e: KeyboardEvent) {
		if (e.key === 'Escape') return void (e.preventDefault(), close(true));
		if (e.key === 'Tab') return close();
		const all = options();
		const i = all.indexOf(document.activeElement as HTMLElement);
		const next = ({ ArrowDown: i + 1, ArrowUp: i - 1, Home: 0, End: all.length - 1 } as Record<string, number>)[e.key];
		if (next === undefined) return;
		e.preventDefault();
		all[(next + all.length) % all.length]?.focus();
	}
	function outside(e: PointerEvent) {
		const t = e.target as Node;
		if (open && !menu?.contains(t) && !btn?.contains(t)) close();
	}
	function onwinkey(e: KeyboardEvent) {
		if (open && e.key === 'Escape' && !menu?.contains(document.activeElement)) close(true);
	}
	/** El menú va al final de `body`: arriba de todo y fuera del encabezado pegajoso. */
	function portal(node: HTMLElement) {
		document.body.appendChild(node);
		return { destroy: () => node.remove() };
	}
</script>

<svelte:window onpointerdown={outside} onkeydown={onwinkey} onresize={() => open && place()} onscrollcapture={() => open && place()} />

<button bind:this={btn} {id} type="button" class="trig nu-lift" aria-haspopup="menu" aria-expanded={open} aria-controls={open ? `${id}-menu` : undefined} onclick={() => (open ? close() : show())}>
	<span class="face" class:ac-face={!split} class:split>{@render face()}</span>
	<span class="chev" class:up={open}><Icon name="chev" size={16} /></span>
</button>

{#if open}
	<div use:portal bind:this={menu} id="{id}-menu" class="pm-menu" role="menu" tabindex="-1" aria-label={label} style:top="{at.top}px" style:left="{at.left}px" onkeydown={keys}>
		{#each items as v, i (v)}
			<button id="{id}-opt-{v}" type="button" class="pm-opt" role="menuitemradio" aria-checked={v === value} tabindex="-1" style:--i={i} onclick={() => pick(v)}>
				<span class="opt-face" class:ac-face={!split} class:split>{@render option(v)}</span>
				<span class="tick">{#if v === value}<Icon name="check" size={15} />{/if}</span>
			</button>
		{/each}
	</div>
{/if}

<style>
	/* Sombra de chip del contenedor (`--chip-raise*`) o la elevada chica de siempre. Al abrir baja al ras. */
	.trig { flex: none; display: inline-flex; align-items: center; gap: 8px; height: 40px; padding: 0 12px 0 14px; border-radius: var(--nu-radius); box-shadow: var(--chip-raise, var(--nu-raise-sm)); font: inherit; font-size: 13px; font-weight: 600; white-space: nowrap; cursor: pointer; transition: box-shadow 0.4s var(--out), transform 0.25s var(--out); -webkit-tap-highlight-color: transparent; }
	@media (hover: hover) { .trig:hover { box-shadow: var(--chip-raise-hover, var(--nu-raise-hover)); transform: translateY(-1px); } }
	.trig:active { box-shadow: var(--nu-press-sm); transform: translateY(0) scale(0.98); }
	.trig[aria-expanded='true'] { box-shadow: none; transform: none; }
	.trig:focus-visible { outline: 2px solid var(--accent-fg); outline-offset: 2px; }
	.chev { display: flex; color: var(--muted); transition: transform 0.25s var(--out); }
	.chev.up { transform: rotate(180deg); }
	/* Cara prendida; al abrir le cuesta prender (`ac-struggle`) y termina prendida. */
	.face { display: inline-flex; align-items: center; gap: inherit; min-width: 0; }
	.face:not(.split), .face.split :global(.ac-part) { filter: var(--ac-on); }
	.trig[aria-expanded='true'] .face:not(.split), .trig[aria-expanded='true'] .face.split :global(.ac-part) { animation: ac-struggle 0.7s var(--d, 0s) linear backwards; }

	/* Menú flotante: mismo carbón que el panel. Aparece y la sombra "respira": de plana a flotante, se pasa y vuelve. */
	.pm-menu {
		position: fixed;
		z-index: 60;
		display: grid;
		gap: 2px;
		min-width: 220px;
		padding: 6px;
		border: 0;
		border-radius: 16px;
		background: var(--nu-tile), var(--nu-bg);
		box-shadow: var(--nu-float);
		transform-origin: top left;
		animation: pm-in 0.28s var(--out), ac-float-in 0.9s var(--ac-breathe) backwards;
	}
	.pm-menu:focus { outline: none; }
	.pm-opt { display: flex; align-items: center; gap: 10px; min-height: 44px; padding: 0 10px 0 12px; border: 0; border-radius: 11px; background: none; color: var(--muted); font: inherit; font-size: 14px; font-weight: 600; text-align: left; white-space: nowrap; cursor: pointer; transition: background 0.15s, color 0.15s; animation: pm-opt-in 0.3s calc(0.12s + var(--i) * 0.08s) backwards; }
	.pm-opt:hover, .pm-opt:focus-visible { outline: none; background: rgb(255 255 255 / 0.05); color: var(--text); }
	/* Elegida: se hunde con rebote, con la tilde ámbar. */
	.pm-opt[aria-checked='true'] { background: var(--nu-well); box-shadow: var(--nu-press-sm); color: #fff; animation: pm-opt-in 0.3s calc(0.12s + var(--i) * 0.08s) backwards, ac-sink 0.8s 0.35s var(--ac-breathe) backwards; }
	/* Las no elegidas quedan tenues; la elegida arranca como tubo 0,12 s después del botón. Hover/foco: prendida. */
	.opt-face { display: inline-flex; align-items: center; gap: inherit; min-width: 0; }
	.opt-face:not(.split), .opt-face.split :global(.ac-part) { filter: var(--ac-dim); animation: ac-dim-in 0.6s 0.2s var(--out) backwards; transition: filter 0.2s; }
	.opt-face.split :global(.ac-part.flick) { animation: ac-struggle-dim 0.7s calc(0.2s + var(--d)) linear backwards; }
	.pm-opt[aria-checked='true'] .opt-face:not(.split), .pm-opt[aria-checked='true'] .opt-face.split :global(.ac-part) { filter: var(--ac-on); animation: ac-struggle 0.7s calc(0.12s + var(--d, 0s)) linear backwards; }
	.pm-opt:is(:hover, :focus-visible) .opt-face:not(.split), .pm-opt:is(:hover, :focus-visible) .opt-face.split :global(.ac-part) { filter: var(--ac-on); }
	.tick { display: flex; width: 15px; margin-left: auto; padding-left: 8px; box-sizing: content-box; color: var(--amber); }
	.tick :global(svg) { animation: pm-tick 0.45s 0.55s cubic-bezier(0.34, 1.56, 0.64, 1) backwards; }
	@keyframes pm-in { from { opacity: 0; transform: translateY(-6px) scale(0.97); } }
	@keyframes pm-opt-in { from { opacity: 0; } }
	@keyframes pm-tick { from { transform: scale(0); } }
	@media (prefers-reduced-motion: reduce) { .pm-menu { animation: none; } }
</style>
