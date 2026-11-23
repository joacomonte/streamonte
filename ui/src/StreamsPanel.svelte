<!-- Panel de opciones del video abierto (`#cat-streams` de `SidePanel.svelte`): sin opciones, un paso (`FlowScreen`), o la lista del
     grupo abierto con su análisis, orden y filtros. Lo alimenta `catalog-options.ts` vía `streams-panel.svelte.ts`. -->
<script lang="ts">
	import Icon from '$ui/components/Icon.svelte';
	import type { IconName } from '$ui/components/icons.ts';
	import FlowCrumbs from '$ui/flow/FlowCrumbs.svelte';
	import OptionsList from '$ui/options/OptionsList.svelte';
	import FlowScreen from './FlowScreen.svelte';
	import GroupPanel from './GroupPanel.svelte';
	import MoreRow from './MoreRow.svelte';
	import type { SortView, StreamsView } from './streams-view.ts';

	let { view }: { view: StreamsView | null } = $props();
</script>

{#snippet ic(name: IconName, size: number)}<span class="ico" aria-hidden="true"><Icon {name} {size} /></span>{/snippet}

{#snippet sortRow(s: SortView)}
	<div class="cat-list-bar">
		{#if s.order.kind === 'fixed'}
			<div class="cat-sort-row" id="cat-sort-info"><span class="cat-sort-label">{s.order.label}</span><span class="cat-sort-fixed" title={s.order.title}>{@render ic(s.order.icon, 13)}{s.order.text}</span></div>
		{:else}
			<div class="cat-sort-row"><span class="cat-sort-label" id="cat-sort-label">{s.order.label}</span><div class="cat-sort" role="group" aria-labelledby="cat-sort-label">{#each s.order.buttons as b (b.id)}<button id={b.id} aria-pressed={b.pressed} title={b.title} onclick={b.onclick}>{b.text}</button>{/each}</div></div>
		{/if}
		<span class="cat-list-filters">{#if s.subscan?.kind === 'done'}<span id="cat-subscan" class="cat-hdr-filter done" role="status">{@render ic('subs', 12)}{s.subscan.text}</span>{:else if s.subscan}<button id="cat-subscan" class="cat-hdr-filter {s.subscan.running ? 'busy' : ''}" aria-pressed={s.subscan.running} title={s.subscan.title} onclick={s.subscan.onclick}>{#if s.subscan.running}<span class="cat-res-spin" aria-hidden="true"></span>{:else}{@render ic('subs', 12)}{/if}{s.subscan.text}</button>{/if}{#each s.filters as f (f.id)}<button id={f.id} class="cat-hdr-filter" aria-pressed={f.pressed} title={f.title} onclick={f.onclick}>{#if f.icon}{@render ic(f.icon, 12)}{/if}{f.text}</button>{/each}</span>
	</div>
{/snippet}

{#if view?.kind === 'empty'}
	<p class="pop-empty">{view.text}</p>
{:else if view?.kind === 'flow'}
	<FlowScreen flow={view.flow} />
{:else if view?.kind === 'list'}
	{#if view.crumbs}<FlowCrumbs aria={view.crumbs.aria} items={view.crumbs.items} />{/if}
	{#if view.auto}
		<div class="cat-sticky"><div class="cat-opt-head"><div id="cat-auto-status" class="cat-auto-status {view.auto.step}" role="status">{@render ic(view.auto.step === 'done' ? 'check' : 'ban', 16)}<span class="cat-auto-msg"><b>{view.auto.lead}</b>{view.auto.text}</span><button id="cat-auto-close" class="link" onclick={view.auto.onclose}>{view.auto.close}</button></div></div></div>
	{/if}
	<section class="cat-group open {view.group.analyzing ? 'analyzing' : ''}" id={view.group.id} aria-busy={view.group.analyzing ? 'true' : null} style={view.group.phase}>
		<div class="cat-group-head" id={view.group.headId}><span class="cat-group-name">{view.group.name}</span><span class="cat-res-count">{view.group.count}</span></div>
		{#if view.latOff}<p class="cat-flow-note inline" role="status">{view.latOff}</p>{/if}
		{#if view.panel}<GroupPanel panel={view.panel} />{/if}
		{#if !view.panelOnly}
			{@render sortRow(view.sort)}
			{#if view.empty}
				<p class="pop-empty" role="status">{view.empty.text}{#if view.empty.clear}<button id="cat-filters-off" class="link" onclick={view.empty.clear.onclick}>{view.empty.clear.text}</button>{/if}</p>
			{:else}
				<OptionsList rows={view.rows} />
			{/if}
			{#if view.moreRows}<button id="cat-more-rows" class="cat-more-rows" onclick={view.moreRows.onclick}>{view.moreRows.text}</button>{/if}
			{#if view.probing}<p class="cat-probing" role="status"><span class="cat-res-spin" aria-hidden="true"></span>{view.probing}</p>{/if}
			{#if view.more}<MoreRow more={view.more} />{/if}
			{#if view.lower}
				<div class="cat-lower" role="status"><span class="cat-radar" aria-hidden="true"></span><span class="cat-lower-text"><b>{view.lower.title}</b><span>{view.lower.sub}</span></span><button id="cat-deep-lower" onclick={view.lower.onclick}>{view.lower.go}</button></div>
			{/if}
		{/if}
	</section>
{/if}
