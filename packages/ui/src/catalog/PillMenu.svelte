<script lang="ts" generics="V extends string | number">
	// Pastilla elevada de los filtros del catálogo que abre un menú corto (votos y orden; C1 2026-11-27). El menú va al final
	// de `body`: en el celu la fila de pastillas scrollea de costado y lleva máscara, y adentro quedaba recortado.
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
	}
	let { id, label, items, value, onpick, face, option }: Props = $props();

	let open = $state(false);
	let btn = $state<HTMLButtonElement>();
	let menu = $state<HTMLElement>();
	let at = $state({ top: 0, left: 0 });

	/** Bajo la pastilla, sin salirse de la pantalla por los costados. */
	function place() {
		if (!btn) return;
		const r = btn.getBoundingClientRect();
		const w = menu?.offsetWidth ?? 240;
		at = { top: r.bottom + 8, left: Math.max(12, Math.min(r.left, innerWidth - w - 12)) };
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
	{@render face()}
	<span class="chev" class:up={open}><Icon name="chev" size={16} /></span>
</button>

{#if open}
	<div use:portal bind:this={menu} id="{id}-menu" class="pm-menu" role="menu" tabindex="-1" aria-label={label} style:top="{at.top}px" style:left="{at.left}px" onkeydown={keys}>
		{#each items as v (v)}
			<button id="{id}-opt-{v}" type="button" class="pm-opt" role="menuitemradio" aria-checked={v === value} tabindex="-1" onclick={() => pick(v)}>
				{@render option(v)}
				<span class="tick">{#if v === value}<Icon name="check" size={15} />{/if}</span>
			</button>
		{/each}
	</div>
{/if}

<style>
	.trig { flex: none; display: inline-flex; align-items: center; gap: 8px; height: 40px; padding: 0 12px 0 14px; border-radius: var(--nu-radius); font: inherit; font-size: 13px; font-weight: 600; white-space: nowrap; cursor: pointer; -webkit-tap-highlight-color: transparent; }
	.trig:focus-visible { outline: 2px solid var(--accent-fg); outline-offset: 2px; }
	.chev { display: flex; color: var(--muted); transition: transform 0.25s var(--out); }
	.chev.up { transform: rotate(180deg); }

	/* Menú flotante sobre el panel neumórfico: mismo carbón, flota (--nu-float), sin borde de luz. */
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
		animation: pm-in 0.28s var(--out);
	}
	.pm-menu:focus { outline: none; }
	.pm-opt { display: flex; align-items: center; gap: 10px; min-height: 44px; padding: 0 10px 0 12px; border: 0; border-radius: 11px; background: none; color: var(--muted); font: inherit; font-size: 14px; font-weight: 600; text-align: left; white-space: nowrap; cursor: pointer; transition: background 0.15s, color 0.15s; }
	.pm-opt:hover, .pm-opt:focus-visible { outline: none; background: rgb(255 255 255 / 0.05); color: var(--text); }
	/* Elegido: hundido en el panel, en blanco y con la tilde ámbar. */
	.pm-opt[aria-checked='true'] { background: var(--nu-well); box-shadow: var(--nu-press-sm); color: #fff; }
	.tick { display: flex; width: 15px; margin-left: auto; padding-left: 8px; box-sizing: content-box; color: var(--amber); }
	@keyframes pm-in { from { opacity: 0; transform: translateY(-6px) scale(0.97); } }
	@media (prefers-reduced-motion: reduce) { .pm-menu { animation: none; } }
</style>
