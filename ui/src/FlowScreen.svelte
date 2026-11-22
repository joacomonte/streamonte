<!-- Pasos antes de la lista de opciones (`catalog-flow.ts` `flowStep`): buscando, torrent/TorBox, conexión, ¿latino?, calidad, y los
     resultados de TorBox. La entrada animada se repite solo al cambiar de pantalla (`still`: la misma de antes). -->
<script lang="ts">
	import Icon from '$ui/components/Icon.svelte';
	import type { IconName } from '$ui/components/icons.ts';
	import OptionsList from '$ui/options/OptionsList.svelte';
	import Crumbs from './Crumbs.svelte';
	import MoreRow from './MoreRow.svelte';
	import type { ChoiceView, FlowButton, FlowView } from './streams-view.ts';

	let { flow }: { flow: FlowView } = $props();
	const BLIPS = [[60, 20], [94, 46], [88, 88], [40, 96], [24, 52]];
</script>

{#snippet ic(name: IconName, size: number)}<span class="ico" aria-hidden="true"><Icon {name} {size} /></span>{/snippet}

{#snippet choice(c: ChoiceView)}
	<button id={c.id} type="button" class="cat-menu-item cat-choice {c.cls} {c.primary ? 'deep' : ''} {c.muted ? 'muted' : ''}" disabled={c.disabled || null} onclick={c.disabled ? null : c.onclick}>
		<span class="cat-menu-ic" aria-hidden="true">{#if c.icon === 'es'}<span class="cat-es-bubble">ES</span>{:else}{@render ic(c.icon, 28)}{/if}</span>
		<span class="cat-menu-text"><b>{c.title}{#if c.badge}<span class="cat-menu-badge">{c.badge}</span>{/if}</b><span>{c.sub}{#if c.note}<span class="cat-choice-note">{c.note}</span>{/if}</span></span>
	</button>
{/snippet}

{#snippet flowBtn(b: FlowButton)}
	<button id={b.id} type="button" class="cat-flow-btn" title={b.title} onclick={b.onclick}>
		{@render ic(b.icon, 15)}{#if b.small}<span class="cat-flow-text"><b>{b.text}</b><small>{b.small}</small></span>{:else}{b.text}{/if}{#if b.count != null}<span class="cat-flow-count">{b.count}</span>{/if}
	</button>
{/snippet}

{#if flow.kind === 'search'}
	<div class="cat-flow cat-flow-wait" id="cat-flow" role="status" aria-busy="true">
		<span class="cat-res-spin big" aria-hidden="true"></span><b>{flow.title}</b><span>{flow.sub}</span>
	</div>
{:else}
	{#key flow.title}
		<div class="cat-flow" class:still={flow.still} id="cat-flow">
			{#if flow.crumbs}<Crumbs crumbs={flow.crumbs} />{/if}
			{#if flow.title}<h3 class="cat-flow-title">{flow.title}</h3>{/if}
			{#if flow.kind === 'choices'}
				{#each flow.choices as c (c.id)}{@render choice(c)}{/each}
			{:else if flow.kind === 'scan'}
				<div class="cat-hunt" role="status" aria-live="polite">
					<!-- Radar (como la web): el barrido da una vuelta cada 2,4 s y cada punto se enciende cuando le pasa por encima. -->
					<svg class="cat-hunt-radar" viewBox="0 0 120 120" aria-hidden="true">
						<circle class="ring" cx="60" cy="60" r="52" /><circle class="ring inner" cx="60" cy="60" r="34" />
						<g class="sweep"><path d="M60 60L60 8A52 52 0 0 1 105 34Z" /></g>
						{#each BLIPS as [x, y], i (i)}<circle class="blip" cx={x} cy={y} r="4" style="--i:{i}" />{/each}
						<circle class="core" cx="60" cy="60" r="16" /><path class="core-play" d="M55 52.5v15l12.5-7.5z" />
					</svg>
					<b class="cat-hunt-title">{flow.text}</b>
					<span class="bar cat-hunt-bar"><i class="bar-fill" style="width:{flow.frac}%"></i></span>
					<span class="cat-hunt-count">{flow.count}</span>
					<button id={flow.stop.id} type="button" class="cat-flow-btn" title={flow.stop.title} onclick={flow.stop.onclick}>{@render ic(flow.stop.icon, 14)}{flow.stop.text}</button>
				</div>
			{:else if flow.kind === 'nolat'}
				<p class="cat-flow-none" role="status">{flow.none}</p>
				{#each flow.choices as c (c.id)}{@render choice(c)}{/each}
				<div class="cat-flow-actions rows">{#if flow.more}<MoreRow more={flow.more} />{/if}</div>
			{:else if flow.kind === 'match'}
				{#if flow.note}<p class="cat-flow-note" role="status">{flow.note}</p>{/if}
				<OptionsList rows={flow.rows} />
				<div class="cat-flow-actions rows">
					{#if flow.lighter}{@render flowBtn(flow.lighter)}{/if}
					{#if flow.more}<MoreRow more={flow.more} />{/if}
					{@render flowBtn(flow.all)}
				</div>
			{:else if flow.kind === 'spain'}
				<p class="cat-flow-note">{flow.note}</p>
				<OptionsList rows={flow.rows} />
				<div class="cat-flow-actions rows">{@render flowBtn(flow.original)}{@render flowBtn(flow.all)}</div>
			{/if}
		</div>
	{/key}
{/if}
