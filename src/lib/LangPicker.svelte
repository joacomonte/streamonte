<script>
	// Los idiomas que elige el usuario (app y títulos): uno por paso en el tutorial, los dos juntos en Ajustes.
	// Cada cambio se aplica al toque y vuelve a pedir lo de TMDB en el idioma nuevo.
	import { i18n, setLang, setTitles, t } from './i18n.svelte.js';
	import { relang } from './catalog.svelte.js';
	import Icon from './Icon.svelte';

	/** Cada idioma con su nombre en su propio idioma. */
	const LANGS = /** @type {const} */ ([['es', 'Español'], ['en', 'English']]);

	/** `only`: muestra un solo grupo (el tutorial pregunta de a uno); sin él, los dos.
	 * @type {{id: string, only?: 'app' | 'titles'}} */
	let { id, only } = $props();

	/** @param {() => void} change */
	const apply = (change) => {
		change();
		relang();
	};
</script>

{#snippet seg(/** @type {string} */ key, /** @type {string} */ label, /** @type {'phone' | 'film'} */ icon, /** @type {string} */ value, /** @type {(v: string) => void} */ pick)}
	<div class="row">
		<span class="lbl" id="{id}-{key}-lbl"><Icon name={icon} size={16} />{label}</span>
		<div class="seg" role="radiogroup" aria-labelledby="{id}-{key}-lbl">
			{#each LANGS as [v, l] (v)}
				<button id="{id}-{key}-{v}" type="button" role="radio" aria-checked={value === v} onclick={() => value !== v && apply(() => pick(v))}>
					<span class="code">{v.toUpperCase()}</span>
					<span class="name">{l}</span>
					<span class="tick" aria-hidden="true"><Icon name="check" size={13} /></span>
				</button>
			{/each}
		</div>
	</div>
{/snippet}

<div class="lp" class:big={only}>
	{#if only !== 'titles'}
	{@render seg('app', t('Idioma de la app'), 'phone', i18n.lang, (v) => setLang(/** @type {'es' | 'en'} */ (v)))}
	{/if}
	{#if only !== 'app'}
	{@render seg('titles', t('Títulos de pelis, series y capítulos'), 'film', i18n.titles, (v) => setTitles(/** @type {'es' | 'en'} */ (v)))}
	{/if}
</div>

<style>
	.lp { display: flex; flex-direction: column; gap: 18px; }
	.row { display: flex; flex-direction: column; gap: 8px; }
	.lbl { display: inline-flex; align-items: center; gap: 7px; font-size: 13.5px; font-weight: 650; color: var(--muted); }
	/* Dos tarjetas grandes: la elegida se llena de color, con su código en un disco y un tilde que salta. */
	.seg { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
	.seg button {
		position: relative;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 6px;
		min-height: 104px;
		padding: 14px 8px 12px;
		border: 1.5px solid var(--border-strong);
		border-radius: 18px;
		background: var(--surface);
		color: var(--muted);
		transition: background 0.25s var(--ease), border-color 0.25s var(--ease), color 0.25s var(--ease), transform 0.15s var(--out);
	}
	.code {
		display: grid;
		place-items: center;
		width: 48px;
		height: 48px;
		border-radius: 50%;
		background: var(--surface-3);
		color: var(--text);
		font-size: 17px;
		font-weight: 800;
		letter-spacing: 0.02em;
		transition: background 0.25s var(--ease), color 0.25s var(--ease), transform 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);
	}
	.name { font-size: 15.5px; font-weight: 700; }
	.tick {
		position: absolute;
		top: 8px;
		right: 8px;
		display: grid;
		place-items: center;
		width: 22px;
		height: 22px;
		border-radius: 50%;
		background: var(--accent-text);
		color: var(--accent);
		opacity: 0;
		transform: scale(0.4);
		transition: opacity 0.2s var(--ease), transform 0.35s cubic-bezier(0.34, 1.56, 0.64, 1);
	}
	/* Solo, en el tutorial: tarjetas más grandes, que la pregunta ya la hace el título. */
	.big .seg button { min-height: 148px; gap: 10px; padding-top: 22px; border-radius: 22px; }
	.big .code { width: 60px; height: 60px; font-size: 20px; }
	.big .name { font-size: 17px; }
	.seg button[aria-checked='true'] { background: var(--accent); border-color: var(--accent); color: var(--accent-text); box-shadow: 0 6px 18px color-mix(in srgb, var(--accent) 35%, transparent); }
	.seg button[aria-checked='true'] .code { background: var(--accent-text); color: var(--accent); transform: scale(1.08); }
	.seg button[aria-checked='true'] .tick { opacity: 1; transform: none; }
	.seg button:active { transform: scale(0.97); }
	@media (prefers-reduced-motion: reduce) { .seg button, .code, .tick { transition: none; } }
</style>
