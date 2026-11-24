<script lang="ts">
	import Icon from '$ui/components/Icon.svelte';
	import Torrents from '#lib/Torrents.svelte';
	import { loc, t as tr } from '#lib/i18n.svelte.ts';

	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const t = $derived(data.t);
	const code = $derived(tr('T{s} · E{e}', { s: data.s, e: data.e }));
	/** `d`: ISO (AAAA-MM-DD). */
	const fecha = (d: string) => new Date(`${d}T00:00`).toLocaleDateString(loc(), { day: 'numeric', month: 'long', year: 'numeric' });
</script>

<svelte:head><title>{t.title} {code} · Streamonte</title></svelte:head>

<header class="topbar">
	<div class="wrap row">
		<a id="back" class="btn-icon" href="/t/tv/{t.id}?s={data.s}" aria-label={tr('Volver a los capítulos')} onclick={(e) => { if (history.length > 1) { e.preventDefault(); history.back(); } }}><Icon name="back" /></a>
		<span class="top-title">{t.title}</span>
	</div>
</header>

<main class="wrap">
	<div class="ep-hero">
		{#if data.ep?.still}
			<img class="still" src={data.ep.still} alt="" width="300" height="169" />
		{/if}
		<nav class="crumbs" aria-label={tr('Ruta')}>
			<a id="crumb-show" href="/t/tv/{t.id}">{t.title}</a><span aria-hidden="true">›</span>
			<a id="crumb-season" href="/t/tv/{t.id}?s={data.s}">{tr('Temporada {n}', { n: data.s })}</a><span aria-hidden="true">›</span>
			<span aria-current="page">{tr('Episodio {n}', { n: data.e })}</span>
		</nav>
		<h1>{data.ep?.name ?? tr('Capítulo {n}', { n: data.e })}</h1>
		{#if data.ep?.date}<p class="muted date">{fecha(data.ep.date)}</p>{/if}
	</div>

	{#if !t.imdb}
		<p class="error">{tr('TMDB no tiene el IMDb id de esta serie: no puedo buscar torrents.')}</p>
	{:else}
		<Torrents imdb={t.imdb ?? ''} s={data.s} e={data.e} name={t.title ?? ''} orig={t.origLang} runtime={t.runtime} seen={{ kind: t.kind, id: String(t.id), poster: t.poster, backdrop: t.backdrop }} />
	{/if}
</main>

<style>
	.row { display: flex; align-items: center; gap: 4px; margin-left: -10px; }
	.top-title { font-size: 16px; font-weight: 650; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
	main { padding: 14px 16px calc(32px + var(--safe-bottom)); }
	.still { width: 100%; max-width: 560px; height: auto; aspect-ratio: 16 / 9; object-fit: cover; border-radius: var(--r-card); background: var(--surface-2); box-shadow: 0 6px 20px var(--shadow); }
	.crumbs { display: flex; flex-wrap: wrap; align-items: center; gap: 2px 6px; margin: 10px 0 2px; font-size: 13px; font-weight: 650; color: var(--muted); }
	.crumbs a { display: inline-flex; align-items: center; min-height: 32px; color: var(--accent-fg); text-decoration: none; }
	.crumbs a:active { opacity: 0.6; }
	h1 { margin: 0; font-size: 22px; line-height: 1.2; letter-spacing: -0.015em; text-wrap: balance; }
	.date { margin: 4px 0 0; font-size: 13.5px; }
	main :global(.torrents) { margin-top: 22px; }
</style>
