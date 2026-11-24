<!-- Panel lateral del catálogo: la ficha es la `TitleView` compartida con la web; acá solo el contenedor (cerrar, migas, torrents del JS viejo). -->
<script lang="ts">
	import { t } from '$ui/i18n/runtime.ts';
	import TitleView from '$ui/title/TitleView.svelte';
	import { actions, panel } from './side-panel.svelte.ts';

	interface Props {
		locale: string;
		genreLabel: (genre: string) => string;
	}
	let { locale, genreLabel }: Props = $props();

	/** Serie › Temporada › Episodio: las anteriores llevan de vuelta a ese paso. */
	const steps = $derived.by(() => {
		const out: { label: string; back: (() => void) | null; root: boolean }[] = [{ label: panel.title, back: panel.season != null ? () => actions.season(null) : null, root: true }];
		const s = panel.season;
		if (s != null) out.push({ label: s === 0 ? t('Especiales') : t('Temporada {n}', { n: s }), back: panel.episode != null ? () => actions.season(s) : null, root: false });
		if (panel.episode != null) out.push({ label: t('Episodio {n}', { n: panel.episode }), back: null, root: false });
		return out;
	});
	const up = $derived(steps.at(-2)?.back);
	/** Avisa que `#cat-streams` ya existe en el DOM. */
	const streams = (_: HTMLElement) => actions.optionsMounted();
</script>

{#if panel.open}
	<button id="cat-side-close" type="button" class="side-close" title={t('Cerrar (Esc)')} aria-label={t('Cerrar panel')} onclick={actions.close}>✕</button>
	{#key `${panel.kind}:${panel.id}:${panel.epoch}`}
		<TitleView
			kind={panel.kind}
			id={panel.id}
			season={panel.season}
			episode={panel.episode}
			onSeason={actions.season}
			onEpisode={(ep) => actions.episode(ep.season, ep.number)}
			onPerson={actions.person}
			onOpenTitle={actions.openTitle}
			onOpenImdb={actions.imdb}
			similar={panel.hasKey === true}
			teaser={panel.hasKey === false ? teaser : undefined}
			collapsed={panel.season != null}
			crumbs={false}
			{genreLabel}
			{locale}
		>
			{#snippet between()}
				<!-- Migas solo en series con una temporada abierta: sin eso solo repetían el título (2026-11-24). -->
				{#if panel.kind === 'tv' && steps.length > 1}
					<div class="side-head">
						<nav class="crumbs" aria-label={t('Serie')}>
							{#if up}<button id="cat-crumb-up" type="button" class="crumb-up" title={t('Volver')} aria-label={t('Volver')} onclick={up}>←</button>{/if}
							<ol class="crumb-path">
								{#each steps as st, i (i)}
									<li>
										{#if st.back}
											<button id="cat-crumb-{i}" type="button" class="crumb" class:root={st.root} title={st.label} onclick={st.back}>{st.label}</button>
										{:else}
											<span class="crumb current" class:root={st.root} title={st.label} aria-current="page">{st.label}</span>
										{/if}
									</li>
								{/each}
							</ol>
						</nav>
					</div>
				{/if}
			{/snippet}
			{#snippet options()}
				<div id="cat-streams" use:streams></div>
			{/snippet}
		</TitleView>
	{/key}
{/if}

{#snippet teaser()}
	<div class="side-tmdb-teaser">
		<p><b>{t('Más datos con TMDB')}</b>{t('Idioma original (elige mejor el audio), dónde verla, cadena de la serie y títulos similares. La key es gratis.')}</p>
		<button id="cat-tmdb-setup" type="button" class="btn btn-sm btn-pill pop-btn" onclick={actions.setupTmdb}>{t('Configurar')}</button>
	</div>
{/snippet}
