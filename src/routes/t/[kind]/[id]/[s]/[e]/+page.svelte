<script>
	import Icon from '#lib/Icon.svelte';
	import Torrents from '#lib/Torrents.svelte';

	let { data } = $props();
	const t = $derived(data.t);
	const code = $derived(`T${data.s} · E${data.e}`);
	/** @param {string} d ISO (AAAA-MM-DD) */
	const fecha = (d) => new Date(`${d}T00:00`).toLocaleDateString('es-AR', { day: 'numeric', month: 'long', year: 'numeric' });
</script>

<svelte:head><title>{t.title} {code} · Streamonte</title></svelte:head>

<header class="topbar">
	<div class="wrap row">
		<a id="back" class="icon-btn" href="/t/tv/{t.id}" aria-label="Volver a los capítulos" onclick={(e) => { if (history.length > 1) { e.preventDefault(); history.back(); } }}><Icon name="back" /></a>
		<span class="top-title">{t.title}</span>
	</div>
</header>

<main class="wrap">
	<div class="ep-hero">
		{#if data.ep?.still}
			<img class="still" src={data.ep.still} alt="" width="300" height="169" />
		{/if}
		<p class="code">{t.title} · {code}</p>
		<h1>{data.ep?.name ?? `Capítulo ${data.e}`}</h1>
		{#if data.ep?.date}<p class="muted date">{fecha(data.ep.date)}</p>{/if}
	</div>

	{#if !t.imdb}
		<p class="error">TMDB no tiene el IMDb id de esta serie: no puedo buscar torrents.</p>
	{:else}
		<h2>Opciones en TorBox</h2>
		<Torrents imdb={t.imdb} s={data.s} e={data.e} name={t.title} />
	{/if}
</main>

<style>
	.row { display: flex; align-items: center; gap: 4px; margin-left: -10px; }
	.top-title { font-size: 16px; font-weight: 650; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
	main { padding: 14px 16px calc(32px + var(--safe-bottom)); }
	.still { width: 100%; max-width: 560px; height: auto; aspect-ratio: 16 / 9; object-fit: cover; border-radius: var(--radius-card); background: var(--surface-2); box-shadow: 0 6px 20px var(--shadow); }
	.code { margin: 14px 0 2px; font-size: 13px; font-weight: 650; color: var(--accent-fg); }
	h1 { margin: 0; font-size: 22px; line-height: 1.2; letter-spacing: -0.015em; text-wrap: balance; }
	.date { margin: 4px 0 0; font-size: 13.5px; }
	h2 { margin: 22px 0 4px; font-size: 17px; }
</style>
