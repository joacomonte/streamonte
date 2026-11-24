<script lang="ts">
	// Subtítulos de una opción: buscar afuera (gratis), lista por cuánto calzan y Premium plegado con cuota.
	// Datos por `getApi().subs` / `.premium`. Lo propio de cada app (copiar link, bajar, cargar en el reproductor) entra por `actions`/`onUse`.
	import type { Snippet } from 'svelte';
	import { onDestroy, onMount } from 'svelte';
	import type { SubsFileId, SubsOption, SubtitleFile } from '../api.ts';
	import Icon from '../components/Icon.svelte';
	import { getApi } from '../context.ts';
	import { t } from '../i18n/runtime.ts';
	import type { Match } from '../sub-match.ts';
	import type { OptionRef, SubtitleOption } from '../types.ts';
	import SubRow from './SubRow.svelte';
	import { SubsFlow, type SubsCtx } from './subs-flow.ts';
	import { episodeLabel, headOf, keyOf, noFitText, quotaText, rankSubs, specOf, srcOf, timingOf } from './subs-logic.ts';

	interface Props {
		ref: OptionRef;
		option: SubsOption;
		/** El archivo concreto (web): suma los subtítulos hechos para él. */
		file?: SubsFileId | null;
		/** El video copiado (web): ordena por release/fps/duración. Sin él, manda el `level` que ya trae cada subtítulo. */
		match?: Match | null;
		/** Busca solo (sin tocar "Buscar más subtítulos"). */
		autoSearch?: boolean;
		settingsHref?: string;
		onSettings?: () => void;
		/** Acciones de cada fila gratis (copiar, bajar, usar…). */
		actions?: Snippet<[SubtitleOption, SubsCtx]>;
		/** Filas propias arriba de la lista (los subtítulos que trae el video). */
		lead?: Snippet<[SubsCtx]>;
		/** Se bajó/eligió un Premium con el botón de la fila. */
		onUse?: (sub: SubtitleOption, file: SubtitleFile) => void;
		/** Texto e ícono del botón Premium (por defecto "Usar", sin ícono). */
		useLabel?: string;
		useIcon?: 'copy';
	}
	let { ref, option, file = null, match = null, autoSearch = false, settingsHref, onSettings, actions: rowActions, lead, onUse, useLabel, useIcon }: Props = $props();

	const api = getApi();
	const premiumOn = api.capabilities.premiumSubs && !!api.premium;
	// Una sola vez por montaje: la lista es de esta opción (el padre remonta con `{#key}` al cambiar).
	// svelte-ignore state_referenced_locally
	const flow = new SubsFlow(api, ref, option, file, () => { view = flow.view; });
	let view = $state.raw(flow.view);

	const ranked = $derived(rankSubs(view.list, match));
	const premRanked = $derived(rankSubs(view.prem.results, match));
	const timing = $derived(timingOf(view.list, match));
	const noFit = $derived(noFitText(ranked, timing));
	const premNoFit = $derived(noFitText(premRanked, timing));
	const hour = (ms: number) => new Date(ms).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
	const quotaLine = $derived(quotaText(view.quota, hour));
	const hot = $derived(view.tried.length >= 2 && !!view.quota?.hasKey);
	const noKey = $derived(!!view.quota && !view.quota.hasKey);
	const off = $derived(view.quota?.remaining === 0);
	const ctx: SubsCtx = $derived({ use: (sub) => flow.use(sub), pick: (key) => flow.pick(key), picked: view.picked, tried: view.tried });

	$effect(() => {
		if (autoSearch && view.status === 'idle') void flow.search();
	});
	// La cuota se ve en el candado antes de abrirlo.
	$effect(() => {
		if (premiumOn && view.status === 'ready' && !view.quota) void flow.loadQuota();
	});
	onMount(() =>
		api.events.subscribe((e) => {
			if (e.type === 'subtitles-progress' && e.videoId === ref.videoId) flow.setProgress(e.downloading ? { done: e.done, total: e.total } : null);
		})
	);
	onDestroy(() => flow.dispose());

	async function useFromRow(sub: SubtitleOption) {
		const got = await flow.use(sub);
		if (got) onUse?.(sub, got);
	}
</script>

<ul class="subs" id="subs-picker">
	{@render lead?.(ctx)}

	{#if view.status === 'idle'}
		<li>
			<button id="subs-search-more" type="button" class="more" onclick={() => flow.search()}>
				<Icon name="search" size={16} /><span><b>{t('Buscar más subtítulos')}</b><span>{t('Por si los del video no te sirven')}</span></span>
			</button>
		</li>
	{:else if view.status === 'searching'}
		<li class="msg" role="status"><span class="spin"></span>{view.progress ? t('Bajando subtítulos · {done} de {total}', view.progress) : t('Buscando en OpenSubtitles.org…')}</li>
	{:else}
		{#if lead}<li class="grp">{t('Encontrados para vos')}</li>{/if}
		{#if view.status === 'error'}
			<li class="msg err" role="alert"><span>{view.error}</span><button id="subs-retry" type="button" class="btn btn-sm" onclick={() => flow.search()}>{t('Reintentar')}</button></li>
		{:else if !ranked.length}
			<li class="msg">{t('No encontré en OpenSubtitles.org')}</li>
		{/if}
		{#each ranked as { sub, lvl } (keyOf(sub))}
			<SubRow head={headOf(sub)} spec={specOf(sub)} latino={sub.latino} en={sub.language === 'en'} src={srcOf(sub)} lvl={match || lvl > 0 ? lvl : null} on={view.picked === keyOf(sub)} tried={view.picked !== keyOf(sub) && view.tried.includes(keyOf(sub))} title={sub.release}>
				{#snippet actions()}{@render rowActions?.(sub, ctx)}{/snippet}
			</SubRow>
		{/each}
		{#if noFit}<li class="msg none" id="subs-nofit">{noFit}</li>{/if}
		{#if view.error && view.status === 'ready'}<li class="msg err" role="alert">{view.error}</li>{/if}

		{#if premiumOn}
			<li class="sep"></li>
			<li>
				<button id="prem-gate" type="button" class="gate" class:hot aria-expanded={view.prem.open} onclick={() => flow.togglePremium()}>
					<span class="gi"><Icon name="lock" size={16} /></span>
					<span>
						<b>{hot ? t('¿Ninguno anduvo? Buscá en Premium') : t('Buscar en Premium')}</b>
						<span class="gs">{noKey ? t('Necesita tu API key de opensubtitles.com') : hot ? t('Probaste {n} y no sincronizaron · {q}', { n: view.tried.length, q: quotaLine }) : t('Último recurso · {q}', { q: quotaLine })}</span>
					</span>
					<span class="chev" class:up={view.prem.open}><Icon name="chev" size={16} /></span>
				</button>
			</li>
			{#if view.prem.open}
				{#if noKey}
					<li class="msg">
						<Icon name="lock" size={15} /><span>{t('Necesita tu API key de opensubtitles.com.')}</span>
						{#if settingsHref}<a id="prem-key" class="btn btn-sm" href={settingsHref}>{t('Ajustes')}</a>
						{:else if onSettings}<button id="prem-key" type="button" class="btn btn-sm" onclick={onSettings}>{t('Ajustes')}</button>{/if}
					</li>
				{:else if view.prem.status === 'loading' || view.prem.status === 'idle'}
					<li class="msg"><span class="spin"></span>{t('Buscando en opensubtitles.com…')}</li>
				{:else if view.prem.status === 'error'}
					<li class="msg err"><span>{t('opensubtitles.com no respondió. No se gastó ninguna descarga.')}</span><button id="prem-retry" type="button" class="btn btn-sm" onclick={() => flow.premiumSearch()}>{t('Reintentar')}</button></li>
				{:else if view.prem.status === 'empty'}
					<li class="msg"><span>{t('Tampoco hay en español para {x}. No se gastó ninguna descarga.', { x: episodeLabel(ref.videoId) ?? t('esta película') })}</span></li>
				{:else}
					{#each premRanked as { sub, lvl } (keyOf(sub))}
						<SubRow head={headOf(sub)} spec={specOf(sub)} latino={sub.latino} en={sub.language === 'en'} src={srcOf(sub)} lvl={match || lvl > 0 ? lvl : null} on={view.picked === keyOf(sub)} tried={view.picked !== keyOf(sub) && view.tried.includes(keyOf(sub))} title={sub.release}>
							{#snippet actions()}
								<button id="prem-use-{sub.id}" type="button" class="btn btn-sm cost-btn" aria-disabled={off} title={off ? t('Sin descargas por hoy') : t('Gasta 1 descarga de hoy')} onclick={() => useFromRow(sub)}>
									{#if view.prem.busy === sub.id}<span class="spin"></span>{:else}{#if useIcon}<Icon name={useIcon} size={14} />{/if}{useLabel ?? t('Usar')} <span class="cost">· 1</span>{/if}
								</button>
							{/snippet}
						</SubRow>
					{/each}
					{#if premNoFit}<li class="msg none" id="prem-nofit">{premNoFit}</li>{/if}
				{/if}
			{/if}
		{/if}
	{/if}
</ul>

<style>
	.subs { margin: 4px 0 0; padding: 0; list-style: none; }
	.grp { padding: 14px 0 4px; font-size: 11px; font-weight: 800; letter-spacing: 0.06em; text-transform: uppercase; color: var(--dim, var(--muted)); }
	.msg { display: flex; align-items: center; gap: 8px; padding: 10px 0; font-size: 13px; color: var(--muted); }
	.msg .btn { margin-left: auto; }
	.msg.none { font-size: 12px; }
	.msg.err { color: var(--red); }
	.sep { height: 1px; margin: 10px 0 6px; background: var(--border); }
	.cost { color: #f5b041; font-weight: 700; }
	.cost-btn { grid-column: span 2; display: inline-flex; align-items: center; gap: 6px; }
	.cost-btn[aria-disabled='true'] { opacity: 0.45; }
	.more, .gate { display: grid; align-items: center; gap: 10px; width: 100%; padding: 10px 12px; border-radius: var(--r-card); color: var(--text); text-align: left; font: inherit; }
	.more { grid-template-columns: 28px minmax(0, 1fr); margin-top: 6px; border: 1px dashed var(--border-strong); background: none; }
	.more :global(svg) { justify-self: center; color: var(--accent-fg); }
	.more b, .gate b { display: block; font-size: 14px; }
	.more span span, .gs { font-size: 12px; color: var(--muted); }
	/* Premium, último recurso: sin caja; solo se marca cuando ya probaste varios. */
	.gate { grid-template-columns: 30px minmax(0, 1fr) auto; border: 1px solid transparent; background: none; }
	.gate:not(.hot) b { font-weight: 600; color: var(--muted); }
	.gate.hot { border-color: color-mix(in srgb, #f5b041 70%, var(--border)); background: color-mix(in srgb, #f5b041 7%, var(--surface)); }
	.gi { display: grid; place-items: center; width: 30px; height: 30px; color: var(--muted); }
	.chev { display: inline-flex; color: var(--muted); transition: transform 0.2s var(--ease); }
	.chev.up { transform: rotate(180deg); }
</style>
