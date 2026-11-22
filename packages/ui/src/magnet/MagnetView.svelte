<script lang="ts">
	// "Pegar magnet": el torrent que pegaste en el buscador. Si TorBox lo tiene, sus videos (`ready`); si no, "Bajarlo en TorBox"
	// con el avance. Arriba, la película o serie si se reconoce. Datos por `getApi().magnet`.
	import type { Snippet } from 'svelte';
	import { onDestroy, onMount } from 'svelte';
	import Icon from '../components/Icon.svelte';
	import { getApi } from '../context.ts';
	import { humanBytes } from '../format.ts';
	import { t } from '../i18n/runtime.ts';
	import type { Identified, MagnetStatus } from '../types.ts';
	import { MagnetFlow } from './magnet-flow.ts';
	import { magnetSubtitle, magnetTitle, progressText } from './magnet-logic.ts';

	interface Props {
		hash: string;
		/** `dn` del magnet. */
		name?: string;
		/** El título que se ve (para el <title> de la página o el diálogo). */
		title?: string;
		/** Link a la ficha (web). */
		titleHref?: (ident: Identified) => string;
		/** Abrir la ficha (desktop). */
		onTitle?: (ident: Identified) => void;
		/** Lo que se ve cuando TorBox ya lo tiene; por defecto, la lista de archivos. */
		ready?: Snippet<[MagnetStatus, Identified | null, string]>;
	}
	let { hash, name = '', title = $bindable(''), titleHref, onTitle, ready }: Props = $props();

	// Una sola vez por montaje: otro hash = otra vista (el padre remonta con `{#key}`).
	// svelte-ignore state_referenced_locally
	const flow = new MagnetFlow(getApi(), hash, name, () => { view = flow.view; });
	let view = $state.raw(flow.view);
	const st = $derived(view.status);
	const shown = $derived(magnetTitle(view.ident, st, name));
	const sub = $derived(magnetSubtitle(view.ident, st, shown));
	$effect(() => {
		title = shown;
	});
	onMount(() => void flow.load(true));
	onDestroy(() => flow.dispose());
</script>

<header class="head">
	{#if view.ident?.poster}<img class="poster" src={view.ident.poster} alt="" referrerpolicy="no-referrer" />{:else}<span class="poster none"><Icon name="link" size={26} /></span>{/if}
	<div class="who">
		<h1>{shown}</h1>
		{#if sub}<p class="muted">{sub}</p>{/if}
		{#if view.ident}
			{@const ident = view.ident}
			{#if titleHref}<a id="mag-to-title" class="to-title" href={titleHref(ident)}>{t('Ver ficha')}</a>
			{:else if onTitle}<button id="mag-to-title" type="button" class="to-title" onclick={() => onTitle(ident)}>{t('Ver ficha')}</button>{/if}
		{/if}
	</div>
</header>

{#if view.error}
	<p class="status error" role="alert">{view.error}</p>
{:else if !st}
	<p class="status" role="status"><span class="spin"></span>{t('Preguntándole a TorBox…')}</p>
{:else if st.state === 'missing'}
	<!-- No está en TorBox: se ofrece bajarlo en sus servidores. -->
	<div class="card">
		<svg class="art cloud" viewBox="0 0 120 70" aria-hidden="true">
			<path class="c" d="M34 56h52a16 16 0 0 0 0-32 22 22 0 0 0-42-4 15 15 0 0 0-10 36z" />
			<path class="arrow" d="M60 30v20M52 42l8 8 8-8" />
		</svg>
		<b>{t('TorBox todavía no lo tiene')}</b>
		<span class="muted">{t('Lo puede bajar en sus servidores: tarda según cuántos lo comparten. Después se ve al instante.')}</span>
		<button id="mag-download" type="button" class="go" disabled={view.adding} onclick={() => flow.download()}>
			{#if view.adding}<span class="spin light"></span>{:else}<Icon name="download" size={18} />{/if}{t('Bajarlo en TorBox')}
		</button>
	</div>
{:else if st.state === 'downloading'}
	<!-- TorBox lo está bajando: avance en vivo. -->
	<div class="card" role="status">
		<svg class="art cloud" viewBox="0 0 120 70" aria-hidden="true">
			<path class="c" d="M34 56h52a16 16 0 0 0 0-32 22 22 0 0 0-42-4 15 15 0 0 0-10 36z" />
			<path class="arrow moving" d="M60 30v20M52 42l8 8 8-8" />
		</svg>
		<b>{t('TorBox lo está bajando')}</b>
		<span class="bar"><i class="bar-fill" style:width="{Math.max(3, st.progress * 100)}%"></i></span>
		<span class="muted nums">{progressText(st)}</span>
		<span class="muted small">{t('Podés cerrar esto: sigue bajando en TorBox y vuelve a aparecer acá.')}</span>
	</div>
{:else if !st.options.length}
	<p class="status muted">{t('Este torrent no trae videos.')}</p>
{:else if ready}
	{@render ready(st, view.ident, shown)}
{:else}
	<p class="ready"><Icon name="check" size={14} />{st.state === 'ready' ? t('Ya está en tu cuenta de TorBox') : t('Está en la caché de TorBox: se ve al instante')}</p>
	<ul class="files">
		{#each st.options as o, i (i)}
			<li id="mag-file-{i}"><span class="file-name" title={o.release}>{o.release}</span><span class="file-size">{o.sizeBytes ? humanBytes(o.sizeBytes) : ''}</span></li>
		{/each}
	</ul>
{/if}

<style>
	.head { display: flex; gap: 14px; align-items: flex-start; margin: 4px 0 18px; }
	.poster { flex: none; width: 76px; aspect-ratio: 2 / 3; border-radius: var(--r-md); object-fit: cover; background: var(--surface-2); }
	.poster.none { display: grid; place-items: center; color: var(--muted); }
	.who { min-width: 0; display: flex; flex-direction: column; gap: 3px; }
	h1 { margin: 0; font-size: 20px; line-height: 1.2; text-wrap: balance; overflow-wrap: anywhere; }
	.muted { color: var(--muted); }
	.who .muted { margin: 0; font-size: 13px; overflow-wrap: anywhere; }
	.to-title { align-self: flex-start; margin-top: 4px; padding: 0; border: 0; background: none; font: inherit; font-size: 13.5px; font-weight: 600; color: var(--accent-fg); cursor: pointer; text-decoration: none; }
	.card { display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 20px 18px; border: 1px solid var(--border); border-radius: var(--r-lg); background: var(--surface-2); text-align: center; }
	.card b { font-size: 16.5px; }
	.card .muted { font-size: 13.5px; text-wrap: balance; }
	.card .small { font-size: 12.5px; }
	.nums { font-variant-numeric: tabular-nums; }
	.art { width: 100%; height: auto; fill: none; stroke-linecap: round; stroke-linejoin: round; }
	.cloud { max-width: 130px; }
	.cloud .c { stroke: var(--muted); stroke-width: 3; fill: color-mix(in srgb, var(--accent) var(--tint-1), transparent); }
	.cloud .arrow { stroke: var(--accent-fg); stroke-width: 4; }
	.cloud .moving { animation: drop 1.4s var(--ease) infinite; }
	@keyframes drop { 0% { transform: translateY(-6px); opacity: 0; } 40% { opacity: 1; } 100% { transform: translateY(6px); opacity: 0; } }
	.bar { width: min(280px, 90%); height: 8px; margin-top: 4px; }
	.bar i { transition-duration: 0.6s; }
	.go { display: inline-flex; align-items: center; justify-content: center; gap: 8px; min-height: 50px; margin-top: 8px; padding: 0 22px; border: 0; border-radius: var(--r-pill); background: var(--accent); color: var(--accent-text, #fff); font: inherit; font-size: 15px; font-weight: 650; cursor: pointer; }
	.go:active { transform: scale(0.98); }
	.go:disabled { opacity: 0.7; }
	.status { display: flex; align-items: center; gap: 10px; padding: 14px 0; margin: 0; font-size: 14px; }
	.status.error { color: var(--red, #e5484d); }
	.ready { display: flex; align-items: center; gap: 6px; margin: 0 0 8px; font-size: 13px; color: var(--green); }
	.files { display: grid; gap: 4px; margin: 0; padding: 0; list-style: none; }
	.files li { display: flex; gap: 12px; align-items: center; justify-content: space-between; padding: 8px 10px; border-radius: var(--r-md); background: var(--surface-2); font-size: 13px; }
	.file-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.file-size { color: var(--muted); font-variant-numeric: tabular-nums; }
	@media (prefers-reduced-motion: reduce) { .cloud .moving, .spin { animation-duration: 3s; } }
</style>
