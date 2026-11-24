<script lang="ts">
	// Tarjeta de un paso (conexión, audio, "sin latino"): ícono + título (+ badge) + subtítulo (+ nota).
	import Icon from '../components/Icon.svelte';
	import type { IconName } from '../components/icons.ts';
	import FlowTile from './FlowTile.svelte';
	import type { FlowChip, FlowChoiceProps } from './types.ts';

	let { id, title, sub, tile, tone, i, badge = null, note = null, chips = null, primary = false, picked = false, disabled = false, onclick }: FlowChoiceProps = $props();
	const CHIP_ICON: Record<FlowChip['kind'], IconName> = { ok: 'check', maybe: 'search', slow: 'clock', res: 'monitor' };
	const max = $derived(tile.kind === 'net' && tile.level === 4);
</script>

<button {id} type="button" class="choice net" class:primary class:picked class:max class:off={disabled} {disabled} style="--lvl: {tone}; --i: {i}" {onclick}>
	<FlowTile {tile} />
	<span class="txt">
		<strong>{title}{#if badge}<span class="slow">{badge}</span>{/if}</strong>
		{#if chips?.length}
			<span class="chips"><span class="sr">{sub}</span>{#each chips as c, k (k)}<span class="chip {c.kind}" title={c.title ?? null} style="--k: {k}"><Icon name={CHIP_ICON[c.kind]} size={12} />{c.text}</span>{/each}</span>
		{:else}
			<span class="muted">{sub}</span>
		{/if}
		{#if note}<span class="muted note">{note}</span>{/if}
	</span>
</button>

<style>
	.choice { display: flex; flex-direction: column; align-items: flex-start; gap: 3px; min-height: 64px; padding: 12px 14px; border: 1px solid var(--border); border-radius: var(--r-card); background: var(--surface); text-align: left; transition: background 0.2s var(--ease), transform 0.15s var(--out); }
	.choice strong { display: inline-flex; align-items: center; gap: 8px; font-size: 15px; }
	.choice .muted { font-size: 12.5px; line-height: 1.35; }
	.choice:active { transform: scale(0.985); background: var(--surface-2); }
	.choice.primary { background: var(--accent); border-color: var(--accent); color: var(--accent-text); align-items: center; }
	.choice.primary .muted { color: color-mix(in srgb, var(--accent-text) 82%, transparent); }
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
	/* Chips: ✓ seguras en verde, a revisar y resolución en gris, "tarda más" en ámbar; entran de a uno. */
	.chips { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 1px; }
	.chip { display: inline-flex; align-items: center; gap: 4px; height: 22px; padding: 0 8px; border-radius: var(--r-pill); background: var(--surface-2); color: var(--muted); font-size: 11.5px; font-weight: 700; white-space: nowrap; font-variant-numeric: tabular-nums; animation: chip-in 0.35s var(--out) both; animation-delay: calc(var(--i) * 50ms + 120ms + var(--k) * 45ms); }
	.chip.ok { background: color-mix(in srgb, var(--green) 16%, transparent); color: var(--green); }
	.chip.slow { background: color-mix(in srgb, var(--amber) 16%, transparent); color: var(--amber); }
	.sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
	@keyframes chip-in { from { opacity: 0; transform: scale(0.8); } }
	@keyframes net-rise { from { opacity: 0; transform: translateY(8px); } }
	/* Mismo nombre que en FlowTile: Svelte los hashea por componente, así que acá se repiten a propósito. */
	@keyframes bar-up { from { transform: scaleY(0); } }
	@keyframes bar-pulse { 50% { opacity: 0.45; } }
	@keyframes bar-flash { 40% { transform: scaleY(0.55); } }
	@media (hover: hover) { .choice:hover { background: var(--surface-2); } }
	@media (prefers-reduced-motion: reduce) { .chip, .net, .net.max :global(.bar.lit:nth-child(4)), .net.picked :global(.bar.lit) { animation: none; } .net:active, .net :global(.tile) { transform: none; } }
</style>
