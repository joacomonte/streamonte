<!-- Al pie de lo que se ve (`catalog-flow.ts` `moreRow`): búsqueda de pistas en curso, "Seguir buscando" o que no hay más. -->
<script lang="ts">
	import Icon from '$ui/components/Icon.svelte';
	import type { MoreRowView } from './streams-view.ts';

	let { more }: { more: MoreRowView } = $props();
</script>

{#if more.kind === 'running'}
	<div class="cat-lat-more" role="status">
		<span class="cat-res-spin" aria-hidden="true"></span><span>{more.text}</span><button id="cat-lat-stop" type="button" class="link" onclick={more.onstop}>{more.stop}</button>
	</div>
{:else if more.kind === 'done'}
	<p class="cat-lat-more done" role="status"><span class="ico" aria-hidden="true"><Icon name={more.found ? 'check' : 'ban'} size={13} /></span>{more.text}</p>
{:else}
	<button id="cat-lat-more" type="button" class="cat-lat-more go" onclick={more.onclick}>
		<span class="ico" aria-hidden="true"><Icon name="search" size={14} /></span><span><b>{more.title}</b>{#if more.small}<small>{more.small}</small>{/if}</span>
	</button>
{/if}
