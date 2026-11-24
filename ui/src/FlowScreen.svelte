<!-- Pasos antes de la lista de opciones (`$ui/flow/flow-model.ts` vía `catalog-flow.ts`): buscando, torrent/TorBox, conexión, ¿latino?, calidad, y los
     resultados de TorBox. Buscando, tarjetas, radar y migas son las piezas de la web (`$ui/flow/`); cada pantalla entra con `stepIn`
     (solo al cambiar de pantalla: redibujar la misma no repite la entrada). -->
<script lang="ts">
	import Icon from '$ui/components/Icon.svelte';
	import type { IconName } from '$ui/components/icons.ts';
	import FlowChoice from '$ui/flow/FlowChoice.svelte';
	import FlowChoices from '$ui/flow/FlowChoices.svelte';
	import FlowCrumbs from '$ui/flow/FlowCrumbs.svelte';
	import FlowRadar from '$ui/flow/FlowRadar.svelte';
	import FlowSearching from '$ui/flow/FlowSearching.svelte';
	import { stepIn } from '$ui/flow/step-in.ts';
	import OptionsList from '$ui/options/OptionsList.svelte';
	import MoreRow from '$ui/flow/MoreRow.svelte';
	import type { ChoiceView, FlowButton, FlowView } from '$ui/flow/types.ts';

	let { flow }: { flow: FlowView } = $props();
	const screen = $derived(flow.kind === 'search' ? 'search' : `${flow.kind}:${flow.title ?? ''}`);
</script>

{#snippet ic(name: IconName, size: number)}<span class="ico" aria-hidden="true"><Icon {name} {size} /></span>{/snippet}

{#snippet choices(list: ChoiceView[])}
	<FlowChoices even={list.length <= 3 && list.length > 1}>
		{#each list as c (c.id)}
			<FlowChoice id={c.id} title={c.title} sub={c.sub} tile={c.tile} tone={c.tone} i={c.i} badge={c.badge} note={c.note} chips={c.chips} primary={c.primary} disabled={c.disabled} onclick={c.onclick} />
		{/each}
	</FlowChoices>
{/snippet}

{#snippet flowBtn(b: FlowButton)}
	<button id={b.id} type="button" class="cat-flow-btn" title={b.title} onclick={b.onclick}>
		{@render ic(b.icon, 15)}{#if b.small}<span class="cat-flow-text"><b>{b.text}</b><small>{b.small}</small></span>{:else}{b.text}{/if}{#if b.count != null}<span class="cat-flow-count">{b.count}</span>{/if}
	</button>
{/snippet}

{#key screen}
	<div class="cat-flow" id="cat-flow" aria-busy={flow.kind === 'search' ? 'true' : null} in:stepIn>
		{#if flow.kind === 'search'}
			<FlowSearching title={flow.title} sub={flow.sub} frac={flow.frac} />
		{:else}
			{#if flow.crumbs}<FlowCrumbs aria={flow.crumbs.aria} items={flow.crumbs.items} />{/if}
			{#if flow.title}<h3 class="ask">{flow.title}</h3>{/if}
			{#if flow.kind === 'choices'}
				{#if flow.note}<p class="none" role="status">{flow.note}</p>{/if}
				{@render choices(flow.choices)}
				{#if flow.all}<div class="cat-flow-actions rows">{@render flowBtn(flow.all)}</div>{/if}
			{:else if flow.kind === 'scan'}
				<FlowRadar title={flow.text} frac={flow.frac} count={flow.count} stopId={flow.stop.id} stopText={flow.stop.text} onstop={flow.stop.onclick} />
			{:else if flow.kind === 'notice'}
				<p class="none" role="status">{flow.text}</p>
				{#if flow.action || flow.all}<div class="cat-flow-actions rows">{#if flow.action}{@render flowBtn(flow.action)}{/if}{#if flow.all}{@render flowBtn(flow.all)}{/if}</div>{/if}
			{:else if flow.kind === 'match'}
				{#if flow.note}<p class="cat-flow-note" role="status">{flow.note}</p>{/if}
				<OptionsList rows={flow.rows} />
				<div class="cat-flow-actions rows">
					{#if flow.lighter}{@render flowBtn(flow.lighter)}{/if}
					{#if flow.more}<MoreRow more={flow.more} look="cat" />{/if}
					{@render flowBtn(flow.all)}
				</div>
			{:else if flow.kind === 'spain'}
				<p class="cat-flow-note">{flow.note}</p>
				<OptionsList rows={flow.rows} />
				<div class="cat-flow-actions rows">{@render flowBtn(flow.original)}{@render flowBtn(flow.all)}</div>
			{/if}
		{/if}
	</div>
{/key}

<style>
	/* Mismas piezas que la web (pensadas para celu); en el panel lateral, más aire y letra un poco mayor, a todo el ancho. */
	.cat-flow { display: grid; gap: 6px; }
	.ask { margin: 10px 0 12px; font-size: 18px; font-weight: 700; letter-spacing: -0.01em; text-wrap: balance; }
	.none { margin: 16px 0; text-align: center; font-size: 13.5px; color: var(--muted); }
	#cat-flow :global(.choices) { gap: 10px; }
	#cat-flow :global(.choice) { min-height: 84px; padding: 16px 20px; gap: 16px; cursor: pointer; }
	#cat-flow :global(.choice:disabled) { cursor: not-allowed; }
	#cat-flow :global(.choice strong) { font-size: 16px; }
	#cat-flow :global(.choice .muted) { font-size: 13.5px; line-height: 1.45; }
	#cat-flow :global(.tile) { width: 48px; height: 48px; }
</style>
