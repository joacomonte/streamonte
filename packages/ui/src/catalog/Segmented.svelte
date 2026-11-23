<script lang="ts" generics="V extends string">
	// Control segmentado (iOS/Android): la píldora se desliza a la opción elegida. Vive dentro de la cápsula tipo | orden del
	// catálogo (2026-11-23): no tiene fondo propio, llena lo que le deja la cápsula y nunca la desborda (el texto se corta con "…").
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
	<span class="seg-thumb" aria-hidden="true"></span>
	{#each items as it (it.v)}
		<button id="{id}-{it.v || 'any'}" type="button" role="radio" aria-checked={it.v === value} onclick={() => it.v !== value && onpick(it.v)}>
			<span class="seg-in" class:pop={popped === it.v}>{#if it.icon}<Icon name={it.icon} size={17} />{/if}<span class="seg-txt">{t(it.label)}</span></span>
		</button>
	{/each}
</div>

<style>
	.seg { position: relative; flex: 1 1 0; min-width: 0; display: grid; grid-template-columns: repeat(var(--n), minmax(0, 1fr)); border-radius: var(--r-pill); }
	.seg-thumb {
		position: absolute; top: 0; bottom: 0; left: 0;
		width: calc(100% / var(--n));
		border-radius: var(--r-pill);
		background: var(--raised);
		box-shadow: 0 1px 2px var(--shadow), 0 2px 8px var(--shadow);
		transform: translateX(calc(100% * var(--i)));
		/* Resorte con rebote (el reduced-motion global lo deja instantáneo). */
		transition: transform 0.5s cubic-bezier(0.34, 1.56, 0.64, 1);
	}
	button { position: relative; min-width: 0; min-height: 42px; padding: 0 6px; border: 0; border-radius: var(--r-pill); background: none; font-size: 14px; font-weight: 600; color: var(--muted); transition: color 0.2s var(--ease); }
	button[aria-checked='true'] { color: var(--text); }
	.seg-in { display: inline-flex; align-items: center; justify-content: center; gap: 7px; max-width: 100%; white-space: nowrap; }
	.seg-txt { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
	.seg-in.pop { animation: seg-pop 0.45s var(--ease); }
	@keyframes seg-pop { 30% { transform: scale(1.14, 0.86); } 55% { transform: scale(0.94, 1.08); } 80% { transform: scale(1.03, 0.98); } }
	/* Celu angosto: sin íconos, para que el nombre entre. */
	@media (max-width: 479px) {
		.seg-in :global(svg) { display: none; }
		button { padding: 0 4px; font-size: 13.5px; }
	}
</style>
