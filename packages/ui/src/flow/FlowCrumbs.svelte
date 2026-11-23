<script lang="ts">
	// Migas: lo elegido hasta ahora. Con `onclick` es un botón que vuelve a ese paso; sin él, texto.
	import type { FlowCrumb } from './types.ts';

	let { aria, items }: { aria: string; items: FlowCrumb[] } = $props();
</script>

<nav class="crumbs" aria-label={aria}>
	{#each items as c, k (k)}
		{#if k > 0}<span aria-hidden="true">›</span>{/if}
		{#if c.onclick}
			<button id={c.id ?? undefined} type="button" title={c.title ?? undefined} onclick={c.onclick}>{c.label}</button>
		{:else}
			<span id={c.id ?? undefined}>{c.label}</span>
		{/if}
	{/each}
</nav>

<style>
	.crumbs { display: flex; flex-wrap: wrap; align-items: center; gap: 2px 6px; margin: 0 0 4px; font-size: 13.5px; font-weight: 650; color: var(--muted); }
	.crumbs button { min-height: 36px; padding: 0 2px; border: 0; background: none; color: var(--accent-fg); font: inherit; }
	.crumbs button:active { opacity: 0.6; }
</style>
