<!-- Clic derecho en una opción: copiar magnet / link de TorBox, subtítulos. Lo abre `catalog-options.ts` (`openCtxMenu`). -->
<script lang="ts">
	import { onMount } from 'svelte';
	import Icon from '$ui/components/Icon.svelte';
	import { closeCtxMenu, ctx } from './streams-panel.svelte.ts';

	let menu: HTMLDivElement;
	const outside = (ev: PointerEvent): void => {
		if (ctx.open && !(ev.target instanceof Node && menu.contains(ev.target))) closeCtxMenu();
	};
	const onKey = (ev: KeyboardEvent): void => {
		if (ev.key === 'Escape') closeCtxMenu();
	};
	onMount(() => {
		document.addEventListener('scroll', closeCtxMenu, { capture: true, passive: true });
		return () => document.removeEventListener('scroll', closeCtxMenu, { capture: true });
	});
</script>

<svelte:document onpointerdown={outside} onkeydown={onKey} />

<div bind:this={menu} id="cat-ctx" class="cat-ctx" role="menu" hidden={!ctx.open} style:left="{ctx.x}px" style:top="{ctx.y}px">
	{#each ctx.items as item (item.id)}
		<button id={item.id} class="cat-ctx-item" role="menuitem" type="button" onclick={() => { closeCtxMenu(); item.onclick(); }}>
			<span class="ico" aria-hidden="true"><Icon name={item.icon} size={14} /></span>{item.text}
		</button>
	{/each}
</div>
