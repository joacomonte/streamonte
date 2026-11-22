<!-- Panel del análisis de la resolución abierta (`catalog-options.ts` `groupPanel`): deteniendo, analizando (fase 1/2 con su línea de
     avance), ofrecer el análisis profundo o su resultado. -->
<script lang="ts">
	import Icon from '$ui/components/Icon.svelte';
	import type { IconName } from '$ui/components/icons.ts';
	import type { PanelView } from './streams-view.ts';

	let { panel }: { panel: PanelView } = $props();
</script>

{#snippet ic(name: IconName, size: number)}<span class="ico" aria-hidden="true"><Icon {name} {size} /></span>{/snippet}

{#if panel.kind === 'stopping'}
	<div id="cat-deep" class="cat-deep running stopping" role="status" aria-busy="true">
		<span class="cat-deep-icon" aria-hidden="true"><span class="cat-res-spin big"></span></span><span class="cat-deep-text"><span class="cat-deep-title"><b>{panel.title}</b></span><span class="cat-deep-sub">{panel.sub}</span></span><span class="cat-deep-bar waiting"><i></i></span>
	</div>
{:else if panel.kind === 'running'}
	<div id="cat-deep" class="cat-deep running" role="status">
		<span class="cat-deep-icon" aria-hidden="true"><span class="cat-radar big"></span></span><span class="cat-deep-text"><span class="cat-deep-title"><b>{panel.title}</b></span>{#key panel.line}<span class="cat-deep-sub cat-progress-line" class:fresh={panel.fresh} aria-live="polite">{panel.line}</span>{/key}</span><span class="cat-deep-icons">{#if panel.best}<button id="cat-run-best" class="cat-best-toggle" class:on={panel.best.on} aria-pressed={panel.best.on} title={panel.best.title} onclick={panel.best.onclick}>{@render ic(panel.best.on ? 'check' : 'download', 14)}{panel.best.text}</button>{/if}<button id="cat-deep-stop" class="cat-icon-btn stop" aria-label={panel.stop.aria} title={panel.stop.title} onclick={panel.stop.onclick}>{@render ic('stop', 14)}</button></span>{#if panel.bar.kind === 'deep'}<span class="cat-deep-bar"><i style={panel.bar.fill}></i>{#if panel.bar.creep}<b class="cat-deep-creep" style={panel.bar.creep}></b>{/if}</span>{:else}<span class="cat-deep-bar" role="progressbar" aria-valuenow={panel.bar.now} aria-valuemax={panel.bar.max}><i style={panel.bar.fill}></i></span>{/if}
	</div>
{:else if panel.kind === 'offer'}
	<button id="cat-deep-go" class="cat-deep-offer" onclick={panel.onclick}><span class="cat-deep-offer-text"><b>{panel.title}</b><span>{panel.sub}</span></span><span class="cat-res-arrow">{@render ic('chev', 16)}</span></button>
{:else}
	<div id="cat-deep" class="cat-deep done" role="status">
		<span class="cat-deep-icon" aria-hidden="true">{@render ic('check', 16)}</span><span class="cat-deep-text"><span class="cat-deep-title"><b>{panel.title}</b></span><span class="cat-deep-sub">{panel.sub}</span></span><button id={panel.next.id} class="cat-deep-go" onclick={panel.next.onclick}>{panel.next.text}</button>
	</div>
{/if}
