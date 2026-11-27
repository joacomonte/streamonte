<script lang="ts" generics="V extends string">
	// Control segmentado (iOS/Android): la píldora elevada (`.nu-lift`) se desliza a la opción elegida. Vive dentro del canal
	// hundido del tipo en el catálogo (C1 2026-11-27): no tiene fondo propio, llena lo que le deja el canal y nunca lo desborda
	// (el texto se corta con "…"). El ícono elegido va en ámbar con brillo.
	import Icon from '../components/Icon.svelte';
	import type { IconName } from '../components/icons.ts';
	import { t } from '../i18n/runtime.ts';

	type Item = { v: V; label: string; icon?: IconName };
	interface Props {
		id: string;
		label?: string;
		labelledby?: string;
		items: Item[];
		value: V;
		onpick: (v: V) => void;
		/** Opción recién tocada: solo esa hace el "pop". */
		popped?: V | '';
	}
	let { id, label, labelledby, items, value, onpick, popped = '' }: Props = $props();
	const idx = $derived(Math.max(0, items.findIndex((i) => i.v === value)));
</script>

<div {id} class="seg" role="radiogroup" aria-label={label} aria-labelledby={labelledby} style:--i={idx} style:--n={items.length}>
	<span class="seg-thumb nu-lift" aria-hidden="true"></span>
	{#each items as it (it.v)}
		<button id="{id}-{it.v || 'any'}" type="button" role="radio" aria-checked={it.v === value} onclick={() => it.v !== value && onpick(it.v)}>
			<span class="seg-in" class:pop={popped === it.v}>{#if it.icon}<Icon name={it.icon} size={22} />{/if}<span class="seg-txt">{t(it.label)}</span></span>
		</button>
	{/each}
</div>

<style>
	.seg { position: relative; flex: 1 1 0; min-width: 0; display: grid; grid-template-columns: repeat(var(--n), minmax(0, 1fr)); border-radius: var(--nu-radius); }
	/* `.seg-thumb.nu-lift`: la sombra del elevado, más corta (va dentro del canal). */
	.seg-thumb.nu-lift {
		position: absolute; top: 0; bottom: 0; left: 0;
		width: calc(100% / var(--n));
		border-radius: var(--nu-radius);
		box-shadow: var(--nu-raise-sm);
		transform: translateX(calc(100% * var(--i)));
		/* Resorte con rebote (el reduced-motion global lo deja instantáneo). */
		transition: transform 0.5s cubic-bezier(0.34, 1.56, 0.64, 1);
	}
	button { position: relative; min-width: 0; min-height: 58px; padding: 0 8px; border: 0; border-radius: var(--nu-radius); background: none; font-size: 18px; font-weight: 750; color: var(--muted); transition: color 0.2s var(--ease); }
	button[aria-checked='true'] { color: #fff; }
	.seg-in { display: inline-flex; align-items: center; justify-content: center; gap: 10px; max-width: 100%; white-space: nowrap; }
	.seg-in :global(svg) { flex: none; transition: color 0.2s var(--ease), filter 0.2s var(--ease); }
	button[aria-checked='true'] .seg-in :global(svg) { color: var(--amber); filter: drop-shadow(0 0 6px rgb(245 176 65 / 0.6)); }
	.seg-txt { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
	.seg-in.pop { animation: seg-pop 0.45s var(--ease); }
	@keyframes seg-pop { 30% { transform: scale(1.14, 0.86); } 55% { transform: scale(0.94, 1.08); } 80% { transform: scale(1.03, 0.98); } }
	@media (max-width: 720px) {
		button { font-size: 16px; }
		.seg-in { gap: 8px; }
	}
</style>
