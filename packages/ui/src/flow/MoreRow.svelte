<!-- Al pie de lo que se ve: búsqueda de pistas en curso (Detener), "Seguir buscando" o que no hay más. `look`: 'row' = botón
     ancho de la web (`.row-btn`, components.css); 'cat' = fila punteada del desktop (`.cat-lat-more`, ui/catalog.css). -->
<script lang="ts">
	import Icon from '../components/Icon.svelte';
	import type { MoreRowView } from './types.ts';

	let { more, look }: { more: MoreRowView; look: 'row' | 'cat' } = $props();
</script>

{#if look === 'row'}
	{#if more.kind === 'running'}
		<button id="more-stop" type="button" class="row-btn" onclick={more.onstop}>
			<span class="spin"></span><span class="row-text"><b>{more.text}</b>{#if more.small}<small>{more.small}</small>{/if}</span><span class="row-end">{more.stop}</span>
		</button>
	{:else if more.kind === 'more'}
		<button id="search-more" type="button" class="row-btn" onclick={more.onclick}>
			<Icon name="search" size={18} /><span class="row-text"><b>{more.title}</b>{#if more.small}<small>{more.small}</small>{/if}</span>
		</button>
	{/if}
{:else if more.kind === 'running'}
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
