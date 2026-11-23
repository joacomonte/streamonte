<script lang="ts">
	// Segmentado Español / English con un knob que se desliza al elegido (bienvenida: grande; Ajustes: chico).
	// Botones con id `{id}-es` / `{id}-en`.
	import { LANGS } from './lang-data.ts';
	import type { LangCode } from './tour-state.ts';

	interface Props {
		id: string;
		value: LangCode;
		label: string;
		onpick: (value: LangCode) => void;
		small?: boolean;
	}
	let { id, value, label, onpick, small = false }: Props = $props();
</script>

<div class="seg" class:small role="radiogroup" aria-label={label} class:en={value === 'en'}>
	<span class="knob"></span>
	{#each LANGS as [v, name] (v)}
		<button id="{id}-{v}" type="button" role="radio" aria-checked={value === v} onclick={() => onpick(v)}>{name}</button>
	{/each}
</div>

<style>
	.seg {
		position: relative;
		display: grid;
		grid-template-columns: 1fr 1fr;
		width: min(320px, 100%);
		padding: 4px;
		border-radius: var(--r-pill);
		background: var(--surface-3);
	}
	.knob {
		position: absolute;
		top: 4px;
		bottom: 4px;
		left: 4px;
		width: calc(50% - 4px);
		border-radius: var(--r-pill);
		background: var(--accent);
		box-shadow: 0 4px 12px -4px color-mix(in srgb, var(--accent) var(--tint-4), transparent);
		transition: transform 0.45s cubic-bezier(0.34, 1.56, 0.64, 1);
	}
	.seg.en .knob { transform: translateX(100%); }
	button {
		position: relative;
		height: 48px;
		border: 0;
		border-radius: var(--r-pill);
		background: none;
		color: var(--muted);
		font-size: 16px;
		font-weight: 700;
		transition: color 0.25s var(--ease);
	}
	button[aria-checked='true'] { color: var(--accent-text); }
	button:focus-visible { outline: 2px solid var(--accent-fg); outline-offset: 2px; }
	.small { width: 196px; padding: 3px; }
	.small .knob { top: 3px; bottom: 3px; left: 3px; width: calc(50% - 3px); }
	.small button { height: 32px; padding: 0 10px; font-size: 13.5px; font-weight: 650; }
	@media (prefers-reduced-motion: reduce) { .knob, button { transition: none; } }
</style>
