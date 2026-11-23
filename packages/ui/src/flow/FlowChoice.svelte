<script lang="ts">
	// Tarjeta de un paso (conexión, audio, "sin latino"): ícono + título (+ badge) + subtítulo (+ nota).
	import FlowTile from './FlowTile.svelte';
	import type { FlowChoiceProps } from './types.ts';

	let { id, title, sub, tile, tone, i, badge = null, note = null, primary = false, picked = false, disabled = false, onclick }: FlowChoiceProps = $props();
	const max = $derived(tile.kind === 'net' && tile.level === 4);
</script>

<button {id} type="button" class="choice net" class:primary class:picked class:max class:off={disabled} {disabled} style="--lvl: {tone}; --i: {i}" {onclick}>
	<FlowTile {tile} />
	<span class="txt">
		<strong>{title}{#if badge}<span class="slow">{badge}</span>{/if}</strong>
		<span class="muted">{sub}</span>
		{#if note}<span class="muted note">{note}</span>{/if}
	</span>
</button>

<style>
	.choice { display: flex; flex-direction: column; align-items: flex-start; gap: 3px; min-height: 64px; padding: 12px 14px; border: 1px solid var(--border); border-radius: var(--r-card); background: var(--surface); text-align: left; transition: background 0.2s var(--ease), transform 0.15s var(--out); }
	.choice strong { display: inline-flex; align-items: center; gap: 8px; font-size: 15px; }
	.choice .muted { font-size: 12.5px; line-height: 1.35; }
	.choice:active { transform: scale(0.985); background: var(--surface-2); }
	.choice.primary { background: var(--accent); border-color: var(--accent); color: var(--accent-text); align-items: center; }
	.choice.off { opacity: 0.55; }
	/* Entrada escalonada (`--i`); el ícono va en el color del nivel (`--lvl`). */
	.net { flex-direction: row; align-items: center; gap: 12px; animation: net-rise 0.36s var(--out) both; animation-delay: calc(var(--i) * 50ms); }
	.net .txt { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
	.net.primary :global(.tile) { background: color-mix(in srgb, var(--accent-text) var(--tint-2), transparent); color: var(--accent-text); }
	.net.max :global(.bar.lit:nth-child(4)) { animation: bar-up 0.3s var(--out) both, bar-pulse 2.4s ease-in-out infinite; animation-delay: calc(var(--i) * 50ms + 350ms), 1.2s; }
	.net:active { transform: scale(0.97); }
	.net:active :global(.tile) { transform: scale(0.92); background: color-mix(in srgb, var(--lvl) 26%, transparent); }
	.net.picked :global(.tile) { background: var(--lvl); color: var(--bg); transform: scale(1.06); }
	.net.picked :global(.bar.lit) { animation: bar-flash 0.22s var(--ease); }
	.slow { padding: 1px 7px; border-radius: var(--r-pill); font-size: 10.5px; font-weight: 750; background: color-mix(in srgb, var(--green) var(--tint-2), transparent); color: var(--green); }
	@keyframes net-rise { from { opacity: 0; transform: translateY(8px); } }
	/* Mismo nombre que en FlowTile: Svelte los hashea por componente, así que acá se repiten a propósito. */
	@keyframes bar-up { from { transform: scaleY(0); } }
	@keyframes bar-pulse { 50% { opacity: 0.45; } }
	@keyframes bar-flash { 40% { transform: scaleY(0.55); } }
	@media (hover: hover) { .choice:hover { background: var(--surface-2); } }
	@media (prefers-reduced-motion: reduce) { .net, .net.max :global(.bar.lit:nth-child(4)), .net.picked :global(.bar.lit) { animation: none; } .net:active, .net :global(.tile) { transform: none; } }
</style>
