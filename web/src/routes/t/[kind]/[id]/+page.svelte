<script lang="ts">
	// Ficha: la misma `TitleView` que el panel del desktop; acá solo la barra de arriba, la navegación (temporada en `?s=`, episodio en su
	// página) y los torrents de las películas.
	import Icon from '$ui/components/Icon.svelte';
	import Torrents from '#lib/Torrents.svelte';
	import { track } from '#lib/track.ts';
	import { webCatalog } from '#lib/catalog.svelte.ts';
	import { loc, t as tr } from '#lib/i18n.svelte.ts';
	import { titleDetails } from '#lib/web-adapt.ts';
	import TitleView from '$ui/title/TitleView.svelte';
	import type { Person } from '$ui/types.ts';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const t = $derived(data.t);
	const details = $derived(titleDetails(t));
	$effect(() => track('ver', `${t.kind === 'tv' ? 'Serie' : 'Peli'}: ${t.title}`));

	// Series en dos pasos: lista de temporadas y, al tocar una, sus episodios. La temporada va en la URL (`?s=2`):
	// ← y el atrás del celu vuelven a la lista. Con una sola temporada se saltea la lista.
	const only = $derived(t.kind === 'tv' && t.seasons?.length === 1 ? t.seasons[0].n : null);
	const season = $derived(t.kind === 'tv' ? Number(page.url.searchParams.get('s')) || only : null);
	let heroTitle = $state<HTMLElement>();
	/** El título pasa a la barra cuando el del hero queda tapado. */
	let titleUp = $state(false);
	let barH = $state(0);

	$effect(() => {
		if (!heroTitle) return;
		const io = new IntersectionObserver(([en]) => (titleUp = !en.isIntersecting), { rootMargin: '-64px 0px 0px 0px' });
		io.observe(heroTitle);
		return () => io.disconnect();
	});

	/** Tocar a alguien del reparto abre el catálogo con lo que actuó o dirigió (como elegirlo en el buscador). */
	function openPerson(p: Person) {
		webCatalog().pickPerson({ id: p.id, name: p.name, photo: p.photo, role: p.role });
		track(p.role === 'director' ? 'director' : 'actor', p.name);
		goto('/');
	}
	/** Se entró a la temporada desde la lista de esta página: volver es ir atrás en el historial. */
	let fromList = false;
	function pickSeason(n: number | null) {
		if (n == null) {
			if (fromList) history.back();
			else goto(`/t/tv/${t.id}`, { replace: true, reset: false });
			fromList = false;
			return;
		}
		fromList = true;
		goto(`?s=${n}`, { reset: false });
	}
</script>

<svelte:head><title>{t.title} · Streamonte</title></svelte:head>

<header class="topbar" class:clear={!titleUp} bind:offsetHeight={barH}>
	<div class="wrap row">
		<a id="back" class="btn-icon" href="/" aria-label={tr('Volver al catálogo')} onclick={(e) => { if (history.length > 1) { e.preventDefault(); history.back(); } }}><Icon name="back" /></a>
		<span class="top-title" class:up={titleUp} aria-hidden="true">{t.title}</span>
	</div>
</header>

<TitleView
	kind={t.kind}
	id={String(t.id)}
	{details}
	{season}
	onSeason={pickSeason}
	seasonHref={(n) => `?s=${n}`}
	episodeHref={(ep) => `/t/tv/${t.id}/${ep.season}/${ep.number}`}
	onEpisode={(ep) => goto(`/t/tv/${t.id}/${ep.season}/${ep.number}`)}
	onPerson={openPerson}
	topInset={barH}
	bind:titleEl={heroTitle}
	locale={loc()}
>
	{#snippet options()}
		<Torrents imdb={t.imdb ?? ''} name={t.title ?? ''} orig={t.origLang} runtime={t.runtime} seen={{ kind: t.kind, id: String(t.id), poster: t.poster, backdrop: t.backdrop }} />
	{/snippet}
</TitleView>

<style>
	.row { display: flex; align-items: center; gap: 4px; margin-left: -10px; }
	.top-title {
		font-size: 16px;
		font-weight: 650;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		opacity: 0;
		transform: translateY(6px);
		transition: opacity 0.2s var(--ease), transform 0.25s var(--out);
	}
	.top-title.up { opacity: 1; transform: none; }
	/* Arriba de todo la barra es transparente y el fondo de la peli sube detrás del botón de volver. */
	.topbar { transition: background-color 0.2s var(--ease), border-color 0.2s var(--ease); }
	.topbar.clear { background: transparent; border-bottom-color: transparent; backdrop-filter: none; -webkit-backdrop-filter: none; }
</style>
