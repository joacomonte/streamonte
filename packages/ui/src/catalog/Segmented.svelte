<script lang="ts" generics="V extends string">
	// Control segmentado (iOS/Android): la píldora se desliza a la opción elegida.
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
		/** Sin el margen de arriba (dentro de una hoja). */
		flush?: boolean;
	}
	let { id, label, labelledby, items, value, onpick, popped = '', flush = false }: Props = $props();
	const idx = $derived(Math.max(0, items.findIndex((i) => i.v === value)));
</script>

<div {id} class="seg" role="radiogroup" aria-label={label} aria-labelledby={labelledby} style:--i={idx} style:--n={items.length} class:flush>
	<span class="seg-thumb" aria-hidden="true"></span>
	{#each items as it (it.v)}
		<button id="{id}-{it.v || 'any'}" type="button" role="radio" aria-checked={it.v === value} onclick={() => it.v !== value && onpick(it.v)}>
			<span class="seg-in" class:pop={popped === it.v}>{#if it.icon}<Icon name={it.icon} size={17} />{/if}{t(it.label)}</span>
		</button>
	{/each}
</div>

<style>
	.seg { position: relative; display: grid; grid-template-columns: repeat(var(--n), 1fr); margin-top: 10px; padding: 3px; border-radius: var(--r-card); background: var(--surface-2); }
	.seg.flush { margin-top: 0; }
	.seg-thumb {
		position: absolute; top: 3px; bottom: 3px; left: 3px;
		width: calc((100% - 6px) / var(--n));
		border-radius: var(--r-md);
		background: var(--raised);
		box-shadow: 0 1px 2px var(--shadow), 0 2px 8px var(--shadow);
		transform: translateX(calc(100% * var(--i)));
		/* Resorte con rebote (el reduced-motion global lo deja instantáneo). */
		transition: transform 0.5s cubic-bezier(0.34, 1.56, 0.64, 1);
	}
	button { position: relative; min-height: 38px; border: 0; border-radius: var(--r-md); background: none; font-size: 14px; font-weight: 600; color: var(--muted); transition: color 0.2s var(--ease); }
	button[aria-checked='true'] { color: var(--text); }
	.seg-in { display: inline-flex; align-items: center; justify-content: center; gap: 7px; }
	.seg-in.pop { animation: seg-pop 0.45s var(--ease); }
	@keyframes seg-pop { 30% { transform: scale(1.14, 0.86); } 55% { transform: scale(0.94, 1.08); } 80% { transform: scale(1.03, 0.98); } }
	@media (min-width: 640px) { .seg { max-width: 360px; } }
</style>
