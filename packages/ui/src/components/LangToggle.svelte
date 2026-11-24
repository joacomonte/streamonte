<script lang="ts">
	// ES / EN chico de la barra de arriba: dos letras, la elegida resaltada. Botones con id `{id}-es` / `{id}-en`; el grupo, `{id}`.
	// (Los segmentos grandes son `LangSwitch` / `LangPicker`.)
	import { LANGS } from './lang-data.ts';
	import type { LangCode } from './tour-state.ts';

	interface Props {
		id: string;
		value: LangCode;
		label: string;
		onpick: (value: LangCode) => void;
		/** Alto de cada letra en px (web 28, desktop 26). */
		height?: number;
		/** Zona táctil extra alrededor de cada botón (celu). */
		touch?: boolean;
	}
	let { id, value, label, onpick, height = 28, touch = false }: Props = $props();
</script>

<div {id} class="lang-toggle" style:--h="{height}px" role="radiogroup" aria-label={label}>
	{#each LANGS as [v] (v)}
		<button id="{id}-{v}" class:touch type="button" role="radio" aria-checked={value === v} onclick={() => onpick(v)}>{v.toUpperCase()}</button>
	{/each}
</div>

<style>
	.lang-toggle { display: inline-flex; padding: 2px; border-radius: var(--r-pill); background: var(--surface-2); }
	button { position: relative; min-width: 34px; height: var(--h); padding: 0 8px; border: 0; border-radius: var(--r-pill); background: none; color: var(--muted); font-size: 12px; font-weight: 750; letter-spacing: 0.04em; transition: background 0.2s var(--ease), color 0.2s var(--ease); }
	button.touch::after { content: ''; position: absolute; inset: -8px -2px; }
	button[aria-checked='true'] { background: var(--surface); color: var(--text); box-shadow: 0 1px 3px var(--shadow); }
	@media (prefers-reduced-motion: reduce) { button { transition: none; } }
</style>
