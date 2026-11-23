<script lang="ts">
	// Buscando el mejor torrent: un radar barre las opciones (puntos que se encienden al pasar), avance, contador y "Detener".
	import Icon from '../components/Icon.svelte';

	interface Props {
		title: string;
		/** Avance 0..1. */
		frac: number;
		count: string;
		stopId: string;
		stopText: string;
		onstop: () => void;
	}
	let { title, frac, count, stopId, stopText, onstop }: Props = $props();
</script>

<div class="hunt" role="status" aria-live="polite">
	<svg class="radar" viewBox="0 0 120 120" aria-hidden="true">
		<circle class="ring" cx="60" cy="60" r="52" />
		<circle class="ring inner" cx="60" cy="60" r="34" />
		<g class="sweep"><path d="M60 60L60 8A52 52 0 0 1 105 34Z" /></g>
		{#each [[60, 20, 0], [94, 46, 1], [88, 88, 2], [40, 96, 3], [24, 52, 4]] as [x, y, i] (i)}
			<circle class="blip" cx={x} cy={y} r="4" style="--i:{i}" />
		{/each}
		<circle class="core" cx="60" cy="60" r="16" />
		<path class="core-play" d="M55 52.5v15l12.5-7.5z" />
	</svg>
	<b class="hunt-title">{title}</b>
	<span class="bar hunt-bar"><i class="bar-fill" style:width="{Math.max(4, frac * 100)}%"></i></span>
	<span class="hunt-count">{count}</span>
	<button id={stopId} type="button" class="stop" onclick={onstop}><Icon name="stop" size={15} />{stopText}</button>
</div>

<style>
	.hunt { display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 18px 0 8px; text-align: center; }
	/* Radar: el barrido da una vuelta cada 2,4 s y cada punto se enciende cuando le pasa por encima. */
	.radar { width: 120px; height: 120px; margin-bottom: 10px; overflow: visible; }
	.radar .ring { fill: none; stroke: var(--border); stroke-width: 1.5; }
	.radar .ring.inner { stroke-dasharray: 3 5; }
	.radar .sweep { transform-origin: 60px 60px; animation: sweep 2.4s linear infinite; }
	.radar .sweep path { fill: color-mix(in srgb, var(--accent) 22%, transparent); }
	.radar .blip { fill: var(--muted); opacity: 0.25; transform-box: fill-box; transform-origin: center; animation: blip 2.4s var(--out) infinite; animation-delay: calc(var(--i) * 0.48s + 0.1s); }
	.radar .core { fill: var(--accent); filter: drop-shadow(0 4px 10px color-mix(in srgb, var(--accent) 45%, transparent)); animation: core 2.4s ease-in-out infinite; transform-box: fill-box; transform-origin: center; }
	.radar .core-play { fill: var(--accent-text, #fff); }
	@keyframes sweep { to { transform: rotate(360deg); } }
	@keyframes blip { 0% { opacity: 1; fill: var(--accent-fg); transform: scale(1.5); } 40%, 100% { opacity: 0.25; fill: var(--muted); transform: none; } }
	@keyframes core { 50% { transform: scale(1.08); } }
	.hunt-title { font-size: 17px; text-wrap: balance; }
	.hunt-bar { width: min(240px, 80%); margin-top: 10px; background: var(--surface-2); }
	.hunt-count { font-size: 12.5px; color: var(--muted); font-variant-numeric: tabular-nums; }
	/* Botón "Detener": el `.row-btn.ghost` de la web (píldora sin fondo). */
	.stop { display: flex; align-items: center; justify-content: center; gap: 8px; min-height: 44px; margin-top: 10px; padding: 0 18px; border: 1px solid var(--border); border-radius: var(--r-pill); background: none; color: var(--text); font: inherit; font-size: 14px; font-weight: 600; transition: transform 0.15s var(--out), border-color 0.2s var(--ease); }
	.stop:active { transform: scale(0.98); border-color: var(--accent-fg); }
	.stop :global(svg) { flex: none; color: var(--muted); }
	@media (prefers-reduced-motion: reduce) { .radar .sweep, .radar .blip, .radar .core { animation: none; } }
</style>
