<script>
	import Icon from '#lib/Icon.svelte';
	import SeasonChart from '#lib/SeasonChart.svelte';
	import Torrents from '#lib/Torrents.svelte';
	import * as saved from '#lib/saved.js';
	import { loc, t as tr } from '#lib/i18n.svelte.js';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';

	let { data } = $props();
	const t = $derived(data.t);
	const isTv = $derived(t.kind === 'tv');

	// Series en dos pasos: lista de temporadas y, al tocar una, sus episodios. La temporada va en la URL (`?s=2`):
	// ← y el atrás del celu vuelven a la lista. Con una sola temporada se saltea la lista.
	const only = $derived(t.seasons?.length === 1 ? t.seasons[0].n : null);
	const season = $derived(Number(page.url.searchParams.get('s')) || only);
	/** Hacia dónde anima el cambio de paso (también con el atrás del navegador): 1 entra a una temporada, -1 vuelve. */
	const dir = $derived(season == null ? -1 : 1);
	/** IMDb por temporada (la misma respuesta guardada que usa el gráfico: no suma pedidos). */
	let scores = $state(/** @type {Record<number, number>} */ ({}));
	/** @type {{n: number, name: string, date: string | null, still: string | null}[] | null} */
	let episodes = $state(null);
	let epError = $state('');
	let more = $state(false);
	const today = new Date().toISOString().slice(0, 10);
	/** @param {string} d ISO (AAAA-MM-DD) */
	const fecha = (d) => new Date(`${d}T00:00`).toLocaleDateString(loc(), { day: 'numeric', month: 'short', year: 'numeric' });
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

	$effect(() => {
		t.id;
		more = false;
	});
	$effect(() => {
		if (!isTv || !t.imdb) return;
		saved.json(fetch, `/api/scores/${t.imdb}`, saved.DAY).then((r) => {
			if (r.ok) scores = Object.fromEntries(r.data.map((/** @type {{season: number, rating: number}} */ x) => [x.season, x.rating]));
		}).catch(() => {});
	});
	/** Se entró a la temporada desde la lista de esta página: volver es ir atrás en el historial. */
	let fromList = false;
	/** @param {number} n */
	function pickSeason(n) {
		fromList = true;
		goto(`?s=${n}`, { reset: false });
	}
	function backToSeasons() {
		if (fromList) history.back();
		else goto(`/t/tv/${t.id}`, { replace: true, reset: false });
		fromList = false;
	}
	const still = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
	/** Entra desde el lado hacia donde se avanza. @param {Element} _ @param {{dir: number}} p */
	const slide = (_, { dir }) => ({
		duration: still() ? 0 : 360,
		css: (/** @type {number} */ x) => {
			const e = 1 - Math.pow(1 - x, 4);
			return `transform: translateX(${(1 - e) * dir * 24}px); opacity: ${e};`;
		}
	});
	const seasonName = $derived(t.seasons?.find((/** @type {{n: number}} */ x) => x.n === season)?.name ?? tr('Temporada {n}', { n: season ?? '' }));
	$effect(() => {
		if (!isTv || season == null) return;
		const n = season;
		episodes = null;
		epError = '';
		let alive = true;
		saved.json(fetch, `/api/season/${t.id}/${n}`, saved.DAY).then(({ ok, data }) => {
			if (!alive) return;
			if (!ok) epError = data.message;
			else episodes = data;
		});
		return () => (alive = false);
	});
</script>

<svelte:head><title>{t.title} · Streamonte</title></svelte:head>

<header class="topbar">
	<div class="wrap row">
		<a id="back" class="icon-btn" href="/" aria-label={tr('Volver al catálogo')} onclick={(e) => { if (history.length > 1) { e.preventDefault(); history.back(); } }}><Icon name="back" /></a>
		<span class="top-title" class:up={titleUp} aria-hidden="true">{t.title}</span>
	</div>
</header>

<div class="hero" style:--bd={t.backdrop ? `url(${t.backdrop})` : 'none'}>
	<div class="wrap hero-in">
		{#if t.poster}<img class="poster" src={t.poster} alt="" width="342" height="513" />{/if}
		<div class="facts">
			<h1 class="name" bind:this={heroTitle}>{t.title}</h1>
			<p class="muted line">
				{[t.year, t.runtime ? `${t.runtime} min` : '', isTv ? tr(t.seasons.length === 1 ? '{n} temporada' : '{n} temporadas', { n: t.seasons.length }) : ''].filter(Boolean).join(' · ')}
				{#if t.rating}<span class="rate"><Icon name="star" size={13} />{t.rating}</span>{/if}
			</p>
		</div>
	</div>
</div>

{#if t.providers.length || t.genres.length}
	<div class="wrap tags" aria-label={tr('Dónde verla y géneros')}>
		{#each t.providers as p (p.name)}
			<span class="tag provider" title={tr('Para ver en Argentina')}>{#if p.logo}<img src={p.logo} alt="" width="20" height="20" />{/if}{p.name}</span>
		{/each}
		{#each t.genres as g (g)}<span class="tag">{g}</span>{/each}
	</div>
{/if}

<main class="wrap">
	{#if t.overview}
		<button id="overview" type="button" class="overview" onclick={() => (more = !more)} aria-expanded={more} disabled={!clamped && !more}>
			<span class="ov-text" class:more bind:this={overviewEl}>{t.overview}</span>
			{#if clamped || more}<span class="ov-more">{more ? tr('Ver menos') : tr('Ver más')}</span>{/if}
		</button>
	{/if}
	{#if t.cast.length || t.lang}
		<dl class="info">
			{#if t.cast.length}<dt>{tr('Reparto')}</dt><dd>{t.cast.join(', ')}</dd>{/if}
			{#if t.lang}<dt>{tr('Idioma original')}</dt><dd>{t.lang}</dd>{/if}
		</dl>
	{/if}

	{#if !t.imdb}
		<p class="error">{tr('TMDB no tiene el IMDb id de este título: no puedo buscar torrents.')}</p>
	{:else if !isTv}
		<h2>{tr('Opciones en TorBox')}</h2>
		<Torrents imdb={t.imdb} name={t.title} orig={t.origLang} runtime={t.runtime} />
	{:else}
		<SeasonChart imdb={t.imdb} status={t.status} next={t.next} current={season} onpick={pickSeason} />
		{#key season}
			<section class="step" in:slide={{ dir }}>
				{#if season == null}
					<h2>{tr('Temporadas')}</h2>
					<ul class="seasons">
						{#each t.seasons as x (x.n)}
							<li>
								<a id="season-{x.n}" class="season" href="?s={x.n}" onclick={(e) => { e.preventDefault(); pickSeason(x.n); }}>
									<span class="s-num" aria-hidden="true">{x.n}</span>
									<span class="s-text">
										<span class="s-name">{x.name}</span>
										<span class="muted small">{[tr(x.count === 1 ? '{n} episodio' : '{n} episodios', { n: x.count }), x.year].filter(Boolean).join(' · ')}</span>
									</span>
									{#if scores[x.n]}<span class="s-score" title={tr('Puntaje de IMDb de la temporada')}><Icon name="star" size={13} />{scores[x.n].toLocaleString(loc(), { minimumFractionDigits: 1, maximumFractionDigits: 1 })}</span>{/if}
									<span class="chev"><Icon name="next" size={18} /></span>
								</a>
							</li>
						{/each}
					</ul>
				{:else}
					<nav class="crumbs" aria-label={tr('Ruta')}>
						{#if only == null}
							<button id="crumb-seasons" type="button" class="crumb" onclick={backToSeasons}><Icon name="back" size={16} />{tr('Temporadas')}</button>
							<span class="sep" aria-hidden="true">›</span>
						{/if}
						<h2 aria-current="page">{seasonName}</h2>
					</nav>
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
											<span class="muted small">{ep.date ? (future ? tr('Sale el {d}', { d: fecha(ep.date) }) : fecha(ep.date)) : ''}</span>
										</span>
										<span class="chev"><Icon name="next" size={18} /></span>
									</a>
								</li>
							{/each}
						</ul>
					{/if}
				{/if}
			</section>
		{/key}
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
	.step { margin-top: 18px; }
	.step > h2 { margin: 0; }
	.seasons { list-style: none; margin: 10px 0 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
	.season {
		display: flex;
		align-items: center;
		gap: 14px;
		min-height: 64px;
		padding: 10px 12px 10px 10px;
		border: 1px solid var(--border);
		border-radius: 14px;
		background: var(--surface);
		text-decoration: none;
		transition: background 0.2s, transform 0.15s;
	}
	.season:active { transform: scale(0.985); background: var(--surface-2); }
	.s-num { width: 42px; height: 42px; flex: none; display: grid; place-items: center; border-radius: 12px; background: color-mix(in srgb, var(--accent) 14%, transparent); color: var(--accent-fg); font-size: 18px; font-weight: 750; font-variant-numeric: tabular-nums; }
	.s-text { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
	.s-name { font-weight: 650; font-size: 15px; }
	.s-score { display: inline-flex; align-items: center; gap: 3px; font-size: 13.5px; font-weight: 700; font-variant-numeric: tabular-nums; }
	.s-score :global(svg) { color: #e6b54a; fill: currentColor; }
	.crumbs { display: flex; align-items: center; gap: 4px; min-height: 44px; }
	.crumbs h2 { margin: 0; }
	.crumb { display: inline-flex; align-items: center; gap: 2px; min-height: 44px; margin-left: -6px; padding: 0 6px; border: 0; border-radius: 8px; background: none; color: var(--accent-fg); font-size: 15px; font-weight: 650; }
	.crumb:active { background: var(--surface-2); }
	.sep { color: var(--muted); }
	@media (hover: hover) { .season:hover { background: var(--surface-2); } }
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
