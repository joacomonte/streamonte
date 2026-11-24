<script lang="ts">
	// Premios compactos (tarjeta del catálogo y ficha): el ícono del mejor nivel y "ganados/nominaciones".
	// Copa dorada = ganó mejor película o serie; medalla dorada = ganó otra categoría; escarapela gris = solo nominaciones.
	import Icon from '../components/Icon.svelte';
	import type { CardAwards } from './awards.ts';

	let { c, size = 10 }: { c: CardAwards; size?: number } = $props();
	const won = $derived(c.best + c.other);
</script>

<span class="awb" class:best={c.best > 0} class:win={!c.best && won > 0}><Icon name={c.best ? 'trophy' : won ? 'medal' : 'award'} {size} />{#if won}{won}{#if c.nominations}<span class="of">/{c.nominations}</span>{/if}{:else}{c.nominations}{/if}</span>

<style>
	.awb { display: inline-flex; align-items: center; gap: 1px; font-weight: 600; font-variant-numeric: tabular-nums; white-space: nowrap; color: var(--muted); }
	.awb :global(svg) { flex: none; }
	.best { color: var(--yellow); }
	.win { color: color-mix(in srgb, var(--yellow) 75%, var(--muted)); }
	.of { color: var(--muted); }
</style>
