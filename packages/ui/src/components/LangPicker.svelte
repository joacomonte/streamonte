<script lang="ts">
	// Idiomas en Ajustes, con la estética de la bienvenida (TourLang) en chico: la app con banderas y los títulos con
	// el segmentado; debajo de "Títulos", el ejemplo real (La Odisea / The Odyssey). Filas de `.st-list` (css/settings.css).
	// Qué pasa al elegir lo decide cada app (`onpick`, también si es el idioma ya elegido): la web aplica al toque, el desktop recarga la ventana.
	import { t } from '../i18n/runtime.ts';
	import LangFlag from './LangFlag.svelte';
	import LangSwitch from './LangSwitch.svelte';
	import { LANGS, SAMPLE_TITLE } from './lang-data.ts';
	import type { LangOptions } from './tour-state.ts';

	interface Props extends LangOptions {
		id: string;
	}
	let { id, app, titles, onpick }: Props = $props();
</script>

<div class="st-list lp">
	<div class="st-row">
		<span class="st-lbl"><span class="st-name" id="{id}-app-lbl">{t('App')}</span></span>
		<div class="flags" role="radiogroup" aria-labelledby="{id}-app-lbl">
			{#each LANGS as [v, name] (v)}
				<button id="{id}-app-{v}" type="button" role="radio" aria-checked={app === v} onclick={() => onpick('app', v)}>
					<span class="flag"><LangFlag lang={v} /></span>{name}
				</button>
			{/each}
		</div>
	</div>
	<div class="st-row">
		<span class="st-lbl">
			<span class="st-name">{t('Títulos')}</span>
			<span class="st-sub" aria-live="polite">{SAMPLE_TITLE[titles]}</span>
		</span>
		<LangSwitch id="{id}-titles" value={titles} label={t('Títulos')} small onpick={(v) => onpick('titles', v)} />
	</div>
</div>

<style>
	.lp .st-row { flex-wrap: wrap; }
	/* Dos chips del mismo ancho que el segmentado de abajo; el elegido toma el borde y el tinte del acento. */
	.flags { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; width: 196px; }
	.flags button {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 7px;
		height: 38px;
		padding: 0 8px;
		border: 1.5px solid var(--border);
		border-radius: var(--r-pill);
		background: none;
		color: var(--muted);
		font-size: 13.5px;
		font-weight: 650;
		transition: border-color 0.2s var(--ease), background 0.2s var(--ease), color 0.2s var(--ease);
	}
	.flag {
		flex: none;
		display: block;
		width: 20px;
		height: 20px;
		border-radius: 50%;
		overflow: hidden;
		box-shadow: 0 0 0 1.5px color-mix(in srgb, var(--text) 10%, transparent);
		transition: transform 0.3s var(--out);
	}
	.flags button:hover { border-color: color-mix(in srgb, var(--accent) 50%, var(--border)); }
	.flags button[aria-checked='true'] { border-color: var(--accent); background: color-mix(in srgb, var(--accent) 12%, transparent); color: var(--text); }
	.flags button[aria-checked='true'] .flag { transform: scale(1.1); }
	.flags button:focus-visible { outline: 2px solid var(--accent-fg); outline-offset: 2px; }
	@media (prefers-reduced-motion: reduce) { .flags button, .flag { transition: none; } }
</style>
