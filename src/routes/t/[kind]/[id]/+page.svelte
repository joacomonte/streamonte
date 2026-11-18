<script module>
	/** Temporada elegida por serie: al volver de un capítulo sigue en la misma. @type {Map<number, number>} */
	const lastSeason = new Map();
</script>

<script>
	import Icon from '#lib/Icon.svelte';
	import SeasonChart from '#lib/SeasonChart.svelte';
	import Torrents from '#lib/Torrents.svelte';

	let { data } = $props();
	const t = $derived(data.t);
	const isTv = $derived(t.kind === 'tv');

	let season = $state(/** @type {number | null} */ (null));
	/** @type {{n: number, name: string, date: string | null, still: string | null}[] | null} */
	let episodes = $state(null);
	let epError = $state('');
	let more = $state(false);
	const today = new Date().toISOString().slice(0, 10);
	/** @param {string} d ISO (AAAA-MM-DD) */
	const fecha = (d) => new Date(`${d}T00:00`).toLocaleDateString('es-AR', { day: 'numeric', month: 'short', year: 'numeric' });
	/** @type {HTMLElement | undefined} */
	let heroTitle = $state();
	/** El título pasa a la barra cuando el del hero queda tapado. */
	let titleUp = $state(false);
	/** @type {HTMLElement | undefined} */
	let overviewEl = $state();
	/** La sinopsis no entra en 3 líneas: hay algo que expandir. */
	let clamped = $state(false);

	$effect(() => {
		if (!heroTitle) return;
		const io = new IntersectionObserver(([en]) => (titleUp = !en.isIntersecting), { rootMargin: '-64px 0px 0px 0px' });
		io.observe(heroTitle);
		return () => io.disconnect();
	});
	$effect(() => {
		t.overview;
		if (overviewEl && !more) clamped = overviewEl.scrollHeight > overviewEl.clientHeight + 1;
	});

	// Otro título (navegación entre fichas): arranca en la última temporada vista o en la primera.
	$effect(() => {
		season = lastSeason.get(t.id) ?? t.seasons[0]?.n ?? null;
		more = false;
	});
	/** @param {number} n */
	function pickSeason(n) {
		season = n;
		lastSeason.set(t.id, n);
	}
	$effect(() => {
		if (!isTv || season == null) return;
		const n = season;
		episodes = null;
		epError = '';
		let alive = true;
		fetch(`/api/season/${t.id}/${n}`).then(async (r) => {
			const j = await r.json();
			if (!alive) return;
			if (!r.ok) epError = j.message;
			else episodes = j;
		});
		return () => (alive = false);
	});
</script>

<svelte:head><title>{t.title} · Streamonte</title></svelte:head>

<header class="topbar">
	<div class="wrap row">
		<a id="back" class="icon-btn" href="/" aria-label="Volver al catálogo" onclick={(e) => { if (history.length > 1) { e.preventDefault(); history.back(); } }}><Icon name="back" /></a>
		<span class="top-title" class:up={titleUp} aria-hidden="true">{t.title}</span>
	</div>
</header>

<div class="hero" style:--bd={t.backdrop ? `url(${t.backdrop})` : 'none'}>
	<div class="wrap hero-in">
		{#if t.poster}<img class="poster" src={t.poster} alt="" width="342" height="513" />{/if}
		<div class="facts">
			<h1 class="name" bind:this={heroTitle}>{t.title}</h1>
			<p class="muted line">
				{[t.year, t.runtime ? `${t.runtime} min` : '', isTv ? `${t.seasons.length} temporada${t.seasons.length === 1 ? '' : 's'}` : ''].filter(Boolean).join(' · ')}
				{#if t.rating}<span class="rate"><Icon name="star" size={13} />{t.rating}</span>{/if}
			</p>
		</div>
	</div>
</div>

{#if t.providers.length || t.genres.length}
	<div class="wrap tags" aria-label="Dónde verla y géneros">
		{#each t.providers as p (p.name)}
			<span class="tag provider" title="Para ver en Argentina">{#if p.logo}<img src={p.logo} alt="" width="20" height="20" />{/if}{p.name}</span>
		{/each}
		{#each t.genres as g (g)}<span class="tag">{g}</span>{/each}
	</div>
{/if}

<main class="wrap">
	{#if t.overview}
		<button id="overview" type="button" class="overview" onclick={() => (more = !more)} aria-expanded={more} disabled={!clamped && !more}>
			<span class="ov-text" class:more bind:this={overviewEl}>{t.overview}</span>
			{#if clamped || more}<span class="ov-more">{more ? 'Ver menos' : 'Ver más'}</span>{/if}
		</button>
	{/if}
	{#if t.cast.length || t.lang}
		<dl class="info">
			{#if t.cast.length}<dt>Reparto</dt><dd>{t.cast.join(', ')}</dd>{/if}
			{#if t.lang}<dt>Idioma original</dt><dd>{t.lang}</dd>{/if}
		</dl>
	{/if}

	{#if !t.imdb}
		<p class="error">TMDB no tiene el IMDb id de este título: no puedo buscar torrents.</p>
	{:else if !isTv}
		<h2>Opciones en TorBox</h2>
		<Torrents imdb={t.imdb} name={t.title} />
	{:else}
		<SeasonChart imdb={t.imdb} status={t.status} next={t.next} current={season} onpick={pickSeason} />
		<div class="season-row">
			<h2>Episodios</h2>
			{#if t.seasons.length > 1}
				<label class="chip pick">
					{t.seasons.find((/** @type {{n: number}} */ x) => x.n === season)?.name}<Icon name="chev" size={14} />
					<select id="season" aria-label="Temporada" value={season} onchange={(e) => pickSeason(Number(e.currentTarget.value))}>
						{#each t.seasons as x (x.n)}<option value={x.n}>{x.name} ({x.count})</option>{/each}
					</select>
				</label>
			{/if}
		</div>
		{#if epError}
			<p class="error">{epError}</p>
		{:else if !episodes}
			{#each Array(4) as _, i (i)}<div class="ep-skel skel"></div>{/each}
		{:else}
			<ul class="eps">
				{#each episodes as ep (ep.n)}
					{@const future = ep.date && ep.date > today}
					<li>
						<a id="ep-{ep.n}" class="ep" class:future href="/t/tv/{t.id}/{season}/{ep.n}" data-sveltekit-preload-data="tap">
							{#if ep.still}<img src={ep.still} alt="" loading="lazy" width="300" height="169" />{:else}<span class="still-empty"></span>{/if}
							<span class="ep-text">
								<span class="ep-name">{ep.n}. {ep.name}</span>
								<span class="muted small">{ep.date ? (future ? `Sale el ${fecha(ep.date)}` : fecha(ep.date)) : ''}</span>
							</span>
							<span class="chev"><Icon name="next" size={18} /></span>
						</a>
					</li>
				{/each}
			</ul>
		{/if}
	{/if}
</main>

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
	.hero { position: relative; overflow: hidden; }
	.hero::before {
		content: '';
		position: absolute;
		inset: 0;
		background: var(--bd) center / cover;
		filter: blur(2px) saturate(1.1);
		opacity: 0.35;
		mask-image: linear-gradient(to bottom, #000 40%, transparent);
	}
	.hero-in { position: relative; display: flex; gap: 14px; align-items: flex-end; padding: 18px 16px 8px; }
	.poster { width: 110px; height: auto; aspect-ratio: 2 / 3; border-radius: 10px; box-shadow: 0 8px 24px var(--shadow-lg); object-fit: cover; flex: none; }
	@media (min-width: 720px) { .poster { width: 170px; } }
	.facts { min-width: 0; padding-bottom: 4px; }
	.name { margin: 0 0 4px; font-size: 24px; line-height: 1.15; letter-spacing: -0.015em; text-wrap: balance; }
	.line { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin: 0; font-size: 13.5px; }
	.small { font-size: 12.5px; }
	.rate { display: inline-flex; align-items: center; gap: 3px; color: var(--yellow); font-weight: 650; }
	main { padding: 4px 16px calc(32px + var(--safe-bottom)); }
	.overview { display: block; width: 100%; text-align: left; border: 0; background: none; padding: 6px 0; margin: 4px 0 0; font-size: 14px; cursor: default; }
	.overview:not(:disabled) { cursor: pointer; }
	.overview:disabled { opacity: 1; }
	.ov-text {
		display: -webkit-box;
		-webkit-line-clamp: 3;
		line-clamp: 3;
		-webkit-box-orient: vertical;
		overflow: hidden;
		color: var(--muted);
	}
	.ov-text.more { -webkit-line-clamp: unset; line-clamp: unset; }
	.ov-more { display: inline-block; margin-top: 4px; font-weight: 650; color: var(--accent-fg); }
	h2 { margin: 18px 0 4px; font-size: 17px; }
	.season-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-top: 18px; }
	.season-row h2 { margin: 0; }
	.eps { list-style: none; margin: 10px 0 0; padding: 0; }
	.eps li { border-bottom: 1px solid var(--border); padding-bottom: 6px; margin-bottom: 6px; }
	.ep { display: flex; gap: 12px; align-items: center; width: 100%; padding: 6px 0; text-decoration: none; border-radius: 10px; }
	.ep:active { background: var(--surface-2); }
	.ep.future { opacity: 0.6; }
	.ep img, .still-empty { width: 120px; height: auto; aspect-ratio: 16 / 9; border-radius: 8px; object-fit: cover; background: var(--surface-2); flex: none; }
	.ep-text { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
	.ep-name { font-weight: 600; font-size: 14px; }
	.chev { color: var(--muted); }
	.tags { display: flex; flex-wrap: wrap; gap: 8px; padding: 10px 16px 2px; }
	.tag { display: inline-flex; align-items: center; gap: 6px; min-height: 32px; padding: 0 12px; border-radius: 999px; background: var(--surface-2); font-size: 13.5px; font-weight: 650; }
	.tag.provider { padding-left: 6px; color: var(--accent-fg); background: color-mix(in srgb, var(--accent) 10%, transparent); box-shadow: inset 0 0 0 1.5px color-mix(in srgb, var(--accent-fg) 55%, transparent); }
	.tag.provider:not(:has(img)) { padding-left: 12px; }
	.tag img { width: 20px; height: 20px; border-radius: 5px; }
	.info { display: grid; grid-template-columns: auto 1fr; gap: 6px 16px; margin: 10px 0 0; padding-bottom: 14px; border-bottom: 1px solid var(--border); font-size: 14px; }
	.info dt { color: var(--muted); }
	.info dd { margin: 0; }
	.ep-skel { height: 68px; border-radius: 8px; margin-top: 10px; }
</style>
