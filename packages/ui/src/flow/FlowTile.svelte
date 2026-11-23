<script lang="ts">
	// Ícono de una tarjeta de paso: barras de conexión, parlante que late, globo con texto, lista animada o ícono común.
	import Icon from '../components/Icon.svelte';
	import type { TileSpec } from './types.ts';

	let { tile }: { tile: TileSpec } = $props();
</script>

{#if tile.kind === 'net'}
	<span class="tile">
		<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true">
			{#each [16, 12.5, 9, 5.5] as y1, b (b)}
				<line class="bar" class:lit={b < tile.level} style="--b: {b}" x1={5 + b * 4.7} x2={5 + b * 4.7} y1={y1} y2="19" />
			{/each}
		</svg>
	</span>
{:else if tile.kind === 'wave'}
	<span class="tile wave" aria-hidden="true">
		<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
			<path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5H4Z" fill="currentColor" fill-opacity="0.25" />
			<path class="w1" d="M15.5 9.5a3.5 3.5 0 0 1 0 5" />
			<path class="w2" d="M18 7a7 7 0 0 1 0 10" />
		</svg>
	</span>
{:else if tile.kind === 'bubble'}
	<span class="tile lat-tile" aria-hidden="true">
		<svg width="28" height="28" viewBox="0 0.75 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round">
			<path d="M4 5.5h16a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-9l-4.5 3.5v-3.5H4a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1Z" fill="currentColor" fill-opacity="0.18" />
			<text x="12" y="13.9" text-anchor="middle" font-size="7" font-weight="800" fill="currentColor" stroke="none" letter-spacing="0.3">{tile.text}</text>
		</svg>
	</span>
{:else if tile.kind === 'list'}
	<span class="tile list-tile" aria-hidden="true">
		<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
			<path class="l1" d="M9 6h11" /><path class="l2" d="M9 12h11" /><path class="l3" d="M9 18h11" />
			<path class="l1" d="M4 6h.01" /><path class="l2" d="M4 12h.01" /><path class="l3" d="M4 18h.01" />
		</svg>
	</span>
{:else}
	<span class="tile" aria-hidden="true"><Icon name={tile.icon} size={24} /></span>
{/if}

<style>
	/* La caja (42 px, color del nivel `--lvl`); sus estados picked/primary los pone la tarjeta (FlowChoice). */
	.tile { flex: none; display: grid; place-items: center; width: 42px; height: 42px; padding: 0; border: 0; border-radius: var(--r-card); background: color-mix(in srgb, var(--lvl) 14%, transparent); color: var(--lvl); transition: background 0.18s var(--ease), color 0.18s var(--ease), transform 0.15s var(--out); }
	/* Barras: las encendidas suben una tras otra (entrada escalonada con `--i` de la tarjeta). */
	.bar { opacity: 0.25; transform-box: fill-box; transform-origin: bottom; }
	.bar.lit { opacity: 1; animation: bar-up 0.3s var(--out) both; animation-delay: calc(var(--i) * 50ms + 140ms + var(--b) * 70ms); }
	/* Parlante: las dos ondas se encienden una tras otra, en loop. Globo latino: entra con un saludo y cada tanto se mueve. */
	/* Centro óptico: el globo pesa abajo (la colita), por eso su viewBox va corrido. */
	.wave svg, .lat-tile svg { display: block; }
	.wave .w1, .wave .w2 { animation: wave 1.6s ease-in-out infinite; }
	.wave .w2 { animation-delay: 0.2s; }
	@keyframes wave { 0% { opacity: 0; } 30% { opacity: 1; } 70%, 100% { opacity: 0; } }
	.list-tile .l1, .list-tile .l2, .list-tile .l3 { animation: list-in 2.4s var(--out) infinite; }
	.list-tile .l2 { animation-delay: 0.15s; }
	.list-tile .l3 { animation-delay: 0.3s; }
	@keyframes list-in { 0%, 60%, 100% { opacity: 1; transform: none; } 10% { opacity: 0.2; transform: translateX(-3px); } }
	.lat-tile svg { transform-origin: 30% 90%; animation: lat-in 0.6s var(--out) 0.15s both, lat-talk 3.2s ease-in-out 1.2s infinite; }
	@keyframes lat-in { from { transform: scale(0.4) rotate(-16deg); opacity: 0; } 60% { transform: scale(1.12) rotate(5deg); opacity: 1; } }
	@keyframes lat-talk { 0%, 82%, 100% { transform: none; } 88% { transform: rotate(-7deg) scale(1.05); } 94% { transform: rotate(5deg); } }
	@keyframes bar-up { from { transform: scaleY(0); } }
	@media (prefers-reduced-motion: reduce) { .lat-tile svg, .wave .w1, .wave .w2, .list-tile path, .bar.lit { animation: none; } .tile { transform: none; } }
</style>
