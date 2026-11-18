<script>
	// Los tres idiomas que elige el usuario (app, títulos y sinopsis): en el primer paso del tutorial y en Ajustes.
	// Cada cambio se aplica al toque y vuelve a pedir lo de TMDB en el idioma nuevo.
	import { i18n, setInfo, setLang, setTitles, t } from './i18n.svelte.js';
	import { relang } from './catalog.svelte.js';

	/** @type {{id: string}} */
	let { id } = $props();

	/** @param {() => void} change */
	const apply = (change) => {
		change();
		relang();
	};
</script>

{#snippet seg(/** @type {string} */ key, /** @type {string} */ label, /** @type {[string, string][]} */ opts, /** @type {string} */ value, /** @type {(v: string) => void} */ pick)}
	<div class="row">
		<span class="lbl" id="{id}-{key}-lbl">{label}</span>
		<div class="seg" role="radiogroup" aria-labelledby="{id}-{key}-lbl">
			{#each opts as [v, l] (v)}
				<button id="{id}-{key}-{v}" type="button" role="radio" aria-checked={value === v} onclick={() => value !== v && apply(() => pick(v))}>{l}</button>
			{/each}
		</div>
	</div>
{/snippet}

<div class="lp">
	{@render seg('app', t('Idioma de la app'), [['es', 'Español'], ['en', 'English']], i18n.lang, (v) => setLang(/** @type {'es' | 'en'} */ (v)))}
	{@render seg('titles', t('Títulos de pelis, series y capítulos'), [['es', 'Español'], ['en', 'English']], i18n.titles, (v) => setTitles(/** @type {'es' | 'en'} */ (v)))}
	{@render seg('info', t('Sinopsis y géneros'), [['titles', t('Como los títulos')], ['app', t('Como la app')]], i18n.info, (v) => setInfo(/** @type {'titles' | 'app'} */ (v)))}
</div>

<style>
	.lp { display: flex; flex-direction: column; gap: 14px; }
	.row { display: flex; flex-direction: column; gap: 6px; }
	.lbl { font-size: 13.5px; font-weight: 650; color: var(--muted); }
	.seg { display: grid; grid-template-columns: 1fr 1fr; padding: 3px; border-radius: 12px; background: var(--surface-2); }
	.seg button {
		min-height: 40px;
		padding: 0 8px;
		border: 0;
		border-radius: 9px;
		background: none;
		color: var(--muted);
		font-size: 14.5px;
		font-weight: 650;
		transition: background 0.2s var(--ease), color 0.2s var(--ease), box-shadow 0.2s var(--ease);
	}
	.seg button[aria-checked='true'] { background: var(--surface); color: var(--text); box-shadow: 0 1px 4px var(--shadow); }
	.seg button:active { transform: scale(0.98); }
	@media (prefers-reduced-motion: reduce) { .seg button { transition: none; } }
</style>
