<!-- Migas de los pasos de opciones (`catalog-flow.ts` `crumbs`): las anteriores vuelven a ese paso. -->
<script lang="ts">
	import type { CrumbsView } from './streams-view.ts';

	let { crumbs }: { crumbs: CrumbsView } = $props();
</script>

<nav class="cat-crumbs" aria-label={crumbs.aria}>
	{#each crumbs.items as item, i (i)}
		{#if i}<span class="cat-crumb-sep" aria-hidden="true">›</span>{/if}
		{#if item.onclick && item.id}
			<button id={item.id} type="button" class="cat-crumb" title={crumbs.title} onclick={item.onclick}>{item.label}</button>
		{:else}
			<span class="cat-crumb current">{item.label}</span>
		{/if}
	{/each}
</nav>
