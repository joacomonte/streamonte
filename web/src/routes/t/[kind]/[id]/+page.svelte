<script lang="ts">
	import Icon from '#lib/Icon.svelte';
	import SeasonChart from '#lib/SeasonChart.svelte';
	import Torrents from '#lib/Torrents.svelte';
	import { track } from '#lib/track.ts';
	import { onlyCinema } from '#lib/cinema.ts';
	import * as saved from '#lib/saved.ts';
	import { cat, reset } from '#lib/catalog.svelte.ts';
	import { loc, t as tr } from '#lib/i18n.svelte.ts';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import type { ApiError, Episodes, SeasonScore } from '#lib/types.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const t = $derived(data.t);
	const isTv = $derived(t.kind === 'tv');
	$effect(() => track('ver', `${isTv ? 'Serie' : 'Peli'}: ${t.title}`));

	// Series en dos pasos: lista de temporadas y, al tocar una, sus episodios. La temporada va en la URL (`?s=2`):
	// ← y el atrás del celu vuelven a la lista. Con una sola temporada se saltea la lista.
	const only = $derived(t.seasons?.length === 1 ? t.seasons[0].n : null);
	const season = $derived(Number(page.url.searchParams.get('s')) || only);
	/** Hacia dónde anima el cambio de paso (también con el atrás del navegador): 1 entra a una temporada, -1 vuelve. */
	const dir = $derived(season == null ? -1 : 1);
	/** IMDb por temporada (la misma respuesta guardada que usa el gráfico: no suma pedidos). */
	let scores = $state<Record<number, number>>({});
	let episodes = $state<{ n: number; name: string; date?: string | null; still: string | null }[] | null>(null);
	let epError = $state('');
	let more = $state(false);
	/** Pastilla de plataformas abierta: logos con nombre en vez de apilados. */
	let showProviders = $state(false);
	const today = new Date().toISOString().slice(0, 10);
	/** `d`: ISO (AAAA-MM-DD). */
	const fecha = (d: string) => new Date(`${d}T00:00`).toLocaleDateString(loc(), { day: 'numeric', month: 'short', year: 'numeric' });
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

	$effect(() => {
		t.id;
		more = false;
		showProviders = false;
	});
	$effect(() => {
		if (!isTv || !t.imdb) return;
		saved.json(fetch, `/api/scores/${t.imdb}`, saved.DAY).then((r) => {
			if (r.ok) scores = Object.fromEntries((r.data as SeasonScore[]).map((x) => [x.season, x.rating]));
		}).catch(() => {});
	});
	/** Tocar a alguien del reparto abre el catálogo con lo que actuó o dirigió (como elegirlo en el buscador).
	 */
	function openPerson(p: { id: number; name: string; photo: string | null; role: 'cast' | 'director' }) {
		cat.q = '';
		cat.person = { id: p.id, name: p.name, photo: p.photo, role: p.role };
		reset();
		track(p.role === 'director' ? 'director' : 'actor', p.name);
		goto('/');
	}
	/** Se entró a la temporada desde la lista de esta página: volver es ir atrás en el historial. */
	let fromList = false;
	function pickSeason(n: number) {
		fromList = true;
		goto(`?s=${n}`, { reset: false });
	}
	function backToSeasons() {
		if (fromList) history.back();
		else goto(`/t/tv/${t.id}`, { replace: true, reset: false });
		fromList = false;
	}
	const still = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
	/** Entra desde el lado hacia donde se avanza. */
	const slide = (_: Element, { dir }: { dir: number }) => ({
		duration: still() ? 0 : 360,
		css: (x: number) => {
			const e = 1 - Math.pow(1 - x, 4);
			return `transform: translateX(${(1 - e) * dir * 24}px); opacity: ${e};`;
		}
	});
	const seasonName = $derived(t.seasons?.find((x: { n: number }) => x.n === season)?.name ?? tr('Temporada {n}', { n: season ?? '' }));
	$effect(() => {
		if (!isTv || season == null) return;
		const n = season;
		episodes = null;
		epError = '';
		let alive = true;
		saved.json(fetch, `/api/season/${t.id}/${n}`, saved.DAY).then(({ ok, data }) => {
			if (!alive) return;
			if (!ok) epError = (data as ApiError).message;
			else episodes = data as Episodes;
		});
		return () => (alive = false);
	});
</script>

<svelte:head><title>{t.title} · Streamonte</title></svelte:head>

<header class="topbar" class:clear={!titleUp} bind:offsetHeight={barH}>
	<div class="wrap row">
		<a id="back" class="btn-icon" href="/" aria-label={tr('Volver al catálogo')} onclick={(e) => { if (history.length > 1) { e.preventDefault(); history.back(); } }}><Icon name="back" /></a>
		<span class="top-title" class:up={titleUp} aria-hidden="true">{t.title}</span>
	</div>
</header>

<div class="hero" style:--bar="{barH}px" style:--bd={t.backdrop ? `url(${t.backdrop})` : 'none'}>
	<div class="wrap hero-in">
		{#if t.poster}<img id="poster" class="poster" src={t.poster} alt="" width="342" height="513" />{/if}
		<div class="facts">
			<h1 class="name" bind:this={heroTitle}>{t.title}</h1>
			<p class="muted line">
				{[t.year, t.runtime ? `${t.runtime} min` : '', isTv ? tr(t.seasons.length === 1 ? '{n} temporada' : '{n} temporadas', { n: t.seasons.length }) : ''].filter(Boolean).join(' · ')}
				{#if t.rating}<span class="rate"><Icon name="star" size={13} />{t.rating}</span>{/if}
			</p>
			{#if t.genres.length}<p class="genres">{t.genres.join(' · ')}</p>{/if}
			{#if t.companies.length}<p class="companies">{t.companies.join(' · ')}</p>{/if}
		</div>
	</div>
</div>

{#if t.providers.length || t.trailer || t.imdb}
	<div class="wrap acts">
		<!-- IMDb y tráiler primero; las plataformas siguen (si no hay, no queda un hueco). -->
		{#if t.imdb}<a id="imdb-link" class="round imdb" href="https://www.imdb.com/title/{t.imdb}/" target="_blank" rel="noopener noreferrer" title="IMDb">IMDb</a>{/if}
		{#if t.trailer}<a id="trailer-link" class="round" href="https://www.youtube.com/watch?v={t.trailer}" target="_blank" rel="noopener noreferrer" aria-label={tr('Tráiler')} title={tr('Tráiler')}><Icon name="play" size={16} /></a>{/if}
		{#if t.providers.length}
			<!-- Dónde verla: logos apilados; al tocar se abre con los nombres. -->
			<button id="providers-toggle" type="button" class="providers" class:open={showProviders} aria-expanded={showProviders} aria-label={tr('Dónde verla')} title={tr('Para ver en Argentina')} onclick={() => (showProviders = !showProviders)}>
				{#each showProviders ? t.providers : t.providers.slice(0, 3) as p (p.name)}
					<span class="prov">
						{#if p.logo}<img src={p.logo} alt="" width="28" height="28" />{:else}<span class="prov-empty" aria-hidden="true">{p.name[0]}</span>{/if}
						{#if showProviders}<span class="prov-name">{p.name}</span>{/if}
					</span>
				{/each}
				{#if !showProviders && t.providers.length > 3}<span class="prov-more">+{t.providers.length - 3}</span>{/if}
			</button>
		{/if}
	</div>
{/if}

{#if t.people.length}
	<ul class="wrap people" aria-label={tr('Reparto')}>
		{#each t.people as p (p.role + p.id)}
			<li>
				<button id="person-{p.id}" type="button" class="person" onclick={() => openPerson(p)} title={tr(p.role === 'director' ? 'Ver lo que dirigió' : 'Ver lo que actuó')}>
					{#if p.photo}<img src={p.photo} alt="" width="56" height="56" loading="lazy" />{:else}<span class="face-empty" aria-hidden="true"><Icon name="user" size={22} /></span>{/if}
					<span class="p-name">{p.name}</span>
					<span class="p-note">{p.role === 'director' ? tr('Dirección') : p.note ?? ''}</span>
				</button>
			</li>
		{/each}
	</ul>
{/if}

{#if onlyCinema(t.released)}
	<div class="wrap cine-wrap"><p id="cine-note" class="cine-note"><Icon name="film" size={15} /><span>{tr('Probablemente todavía no haya torrents de buena calidad: se estrenó hace pocas semanas y por ahora suele haber solo copias filmadas en el cine.')}</span></p></div>
{/if}

<main class="wrap">
	<!-- Sinopsis plegada: una fila con la primera línea; al tocarla se despliega. -->
	{#if t.overview || t.lang}
		<section class="about" class:open={more}>
			<button id="about-toggle" type="button" class="about-head" aria-expanded={more} aria-controls="about-body" onclick={() => (more = !more)}>
				<span class="about-text">
					<b>{t.overview ? tr('Sinopsis') : tr('Idioma original')}</b>
					{#if t.overview}<span class="about-peek">{t.overview}</span>{/if}
				</span>
				<span class="about-chev" aria-hidden="true"><Icon name="chev" size={16} /></span>
			</button>
			<div id="about-body" class="about-body" inert={!more}>
				<div class="about-in">
					{#if t.overview}<p class="ov-text">{t.overview}</p>{/if}
					{#if t.lang}<dl class="info"><dt>{tr('Idioma original')}</dt><dd>{t.lang}</dd></dl>{/if}
				</div>
			</div>
		</section>
	{/if}

	{#if !t.imdb}
		<p class="error">{tr('TMDB no tiene el IMDb id de este título: no puedo buscar torrents.')}</p>
	{:else if !isTv}
		<Torrents imdb={t.imdb ?? ''} name={t.title ?? ''} orig={t.origLang} runtime={t.runtime} />
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
	/* Arriba de todo la barra es transparente y el fondo de la peli sube detrás del botón de volver. */
	.topbar { transition: background-color 0.2s var(--ease), border-color 0.2s var(--ease); }
	.topbar.clear { background: transparent; border-bottom-color: transparent; backdrop-filter: none; -webkit-backdrop-filter: none; }
	.hero { position: relative; overflow: hidden; margin-top: calc(-1 * var(--bar, 0px)); padding-top: var(--bar, 0px); }
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
	.poster { width: 110px; height: auto; aspect-ratio: 2 / 3; border-radius: var(--r-md); box-shadow: 0 8px 24px var(--shadow-lg); object-fit: cover; flex: none; }
	@media (min-width: 720px) { .poster { width: 170px; } }
	.facts { min-width: 0; padding-bottom: 4px; }
	.name { margin: 0 0 4px; font-size: 24px; line-height: 1.15; letter-spacing: -0.015em; text-wrap: balance; }
	.line { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin: 0; font-size: 13.5px; }
	.cine-wrap { padding: 12px 16px 0; }
	.cine-note { display: flex; gap: 8px; align-items: flex-start; margin: 0; padding: 9px 11px; border-radius: var(--r-card); background: color-mix(in srgb, var(--amber, #f5a524) 16%, transparent); color: var(--text); font-size: 13px; line-height: 1.35; }
	.cine-note :global(svg) { flex: none; margin-top: 1px; color: var(--amber, #f5a524); }
	.small { font-size: 12.5px; }
	.companies { margin: 4px 0 0; font-size: 12.5px; color: var(--muted); }
	/* Fila de acciones: plataformas a la izquierda, tráiler e IMDb redondos a la derecha. */
	.acts { display: flex; align-items: flex-start; gap: 8px; padding: 12px 16px 0; }
	.providers { display: flex; flex-wrap: wrap; align-items: center; gap: 0; min-height: 40px; padding: 4px; border: 0; border-radius: 22px; background: var(--surface-2); color: var(--text); font: inherit; text-align: left; cursor: pointer; transition: background 0.2s var(--ease); }
	.providers:has(.prov-more) { padding-right: 12px; }
	.providers:not(.open) .prov + .prov { margin-left: -10px; }
	.providers.open { gap: 6px 14px; padding: 6px 14px 6px 6px; border-radius: 20px; }
	.prov { display: inline-flex; align-items: center; gap: 8px; }
	.prov img, .prov-empty { width: 30px; height: 30px; border-radius: 50%; box-shadow: 0 0 0 2px var(--surface-2); object-fit: cover; }
	.providers.open .prov img, .providers.open .prov-empty { border-radius: var(--r-sm); }
	.prov-empty { display: grid; place-items: center; background: var(--border); font-size: 12px; font-weight: 700; }
	.prov-name { font-size: 13.5px; font-weight: 600; }
	.prov-more { margin-left: 8px; font-size: 13px; font-weight: 650; color: var(--muted); font-variant-numeric: tabular-nums; }
	.round { display: grid; place-items: center; flex: none; width: 40px; height: 40px; border-radius: 50%; background: var(--surface-2); color: var(--text); text-decoration: none; transition: background 0.2s var(--ease), transform 0.15s; }
	.round.imdb { font-size: 11px; font-weight: 800; letter-spacing: -0.02em; }
	.round:active, .providers:active { transform: scale(0.96); }
	@media (hover: hover) { .round:hover, .providers:hover { background: var(--surface-3, var(--border)); } }
	/* Quién la hizo: carrusel horizontal (en desktop entra entero). */
	.people { display: flex; gap: 4px; margin: 0 auto; padding: 14px 16px 2px; list-style: none; overflow-x: auto; scroll-snap-type: x proximity; scrollbar-width: none; }
	.people::-webkit-scrollbar { display: none; }
	.people li { flex: none; scroll-snap-align: start; }
	.person { display: flex; flex-direction: column; align-items: center; width: 84px; padding: 6px 2px; border: 0; border-radius: var(--r-card); background: none; color: var(--text); font: inherit; text-align: center; cursor: pointer; }
	.person img, .face-empty { width: 56px; height: 56px; border-radius: 50%; object-fit: cover; background: var(--surface-2); transition: transform 0.2s var(--out); }
	.face-empty { display: grid; place-items: center; color: var(--muted); }
	.person:active img { transform: scale(0.94); }
	@media (hover: hover) { .person:hover img { transform: scale(1.05); } }
	.p-name { margin-top: 6px; font-size: 12.5px; font-weight: 600; line-height: 1.2; display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
	.p-note { margin-top: 2px; font-size: 11.5px; color: var(--muted); line-height: 1.2; display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
	.rate { display: inline-flex; align-items: center; gap: 3px; color: var(--yellow); font-weight: 650; }
	main { padding: 4px 16px calc(32px + var(--safe-bottom)); }
	.genres { margin: 6px 0 0; font-size: 13px; color: var(--muted); letter-spacing: 0.01em; }
	/* Plegable: el cuerpo crece con grid-template-rows (0fr → 1fr), sin medir alturas. */
	.about { margin: 12px 0 0; border-bottom: 1px solid var(--border); }
	.about-head { display: flex; align-items: center; gap: 12px; width: 100%; min-height: 56px; padding: 10px 0; border: 0; background: none; color: var(--text); font: inherit; text-align: left; cursor: pointer; }
	.about-text { display: grid; gap: 2px; flex: 1; min-width: 0; }
	.about-text b { font-size: 14.5px; font-weight: 650; }
	.about-peek { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; font-size: 13.5px; color: var(--muted); transition: opacity 0.2s var(--ease); }
	.about.open .about-peek { display: none; }
	.about-chev { display: grid; place-items: center; flex: none; width: 32px; height: 32px; border-radius: var(--r-pill); background: var(--surface-2); color: var(--muted); transition: transform 0.35s var(--out), background 0.2s var(--ease); }
	.about.open .about-chev { transform: rotate(180deg); }
	.about-head:active .about-chev { background: var(--surface-3, var(--border)); }
	.about-body { display: grid; grid-template-rows: 0fr; transition: grid-template-rows 0.4s var(--out); }
	.about.open .about-body { grid-template-rows: 1fr; }
	.about-in { min-height: 0; overflow: hidden; }
	.ov-text { margin: 0 0 12px; font-size: 14px; line-height: 1.5; color: var(--muted); }
	@media (prefers-reduced-motion: reduce) { .about-body, .about-chev { transition: none; } }
	h2 { margin: 18px 0 4px; font-size: 17px; }
	main > :global(.torrents) { margin-top: 18px; }
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
		border-radius: var(--r-card);
		background: var(--surface);
		text-decoration: none;
		transition: background 0.2s, transform 0.15s;
	}
	.season:active { transform: scale(0.985); background: var(--surface-2); }
	.s-num { width: 42px; height: 42px; flex: none; display: grid; place-items: center; border-radius: var(--r-card); background: color-mix(in srgb, var(--accent) 14%, transparent); color: var(--accent-fg); font-size: 18px; font-weight: 750; font-variant-numeric: tabular-nums; }
	.s-text { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
	.s-name { font-weight: 650; font-size: 15px; }
	.s-score { display: inline-flex; align-items: center; gap: 3px; font-size: 13.5px; font-weight: 700; font-variant-numeric: tabular-nums; }
	.s-score :global(svg) { color: #e6b54a; fill: currentColor; }
	.crumbs { display: flex; align-items: center; gap: 4px; min-height: 44px; }
	.crumbs h2 { margin: 0; }
	.crumb { display: inline-flex; align-items: center; gap: 2px; min-height: 44px; margin-left: -6px; padding: 0 6px; border: 0; border-radius: var(--r-sm); background: none; color: var(--accent-fg); font-size: 15px; font-weight: 650; }
	.crumb:active { background: var(--surface-2); }
	.sep { color: var(--muted); }
	@media (hover: hover) { .season:hover { background: var(--surface-2); } }
	.eps { list-style: none; margin: 10px 0 0; padding: 0; }
	.eps li { border-bottom: 1px solid var(--border); padding-bottom: 6px; margin-bottom: 6px; }
	.ep { display: flex; gap: 12px; align-items: center; width: 100%; padding: 6px 0; text-decoration: none; border-radius: var(--r-md); }
	.ep:active { background: var(--surface-2); }
	.ep.future { opacity: 0.6; }
	.ep img, .still-empty { width: 120px; height: auto; aspect-ratio: 16 / 9; border-radius: var(--r-sm); object-fit: cover; background: var(--surface-2); flex: none; }
	.ep-text { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
	.ep-name { font-weight: 600; font-size: 14px; }
	.chev { color: var(--muted); }
	.info { display: grid; grid-template-columns: auto 1fr; gap: 6px 16px; margin: 0; padding-bottom: 14px; font-size: 14px; }
	.info dt { color: var(--muted); }
	.info dd { margin: 0; }
	.ep-skel { height: 68px; border-radius: var(--r-sm); margin-top: 10px; }
	/* Entrada: el fondo se enfoca desde un zoom y el texto sube en cascada mientras el póster llega volando. */
	.hero::before { animation: backdrop-in 0.9s var(--out) backwards; will-change: transform; }
	.name, .line, .genres, .companies, .acts, .people, main { animation: rise 0.7s var(--out) backwards; }
	.name { animation-delay: 0.12s; }
	.line { animation-delay: 0.2s; }
	.genres { animation-delay: 0.24s; }
	.companies { animation-delay: 0.26s; }
	.acts { animation-delay: 0.28s; }
	.people { animation-delay: 0.32s; }
	main { animation-delay: 0.36s; }
	@keyframes backdrop-in { from { opacity: 0; transform: scale(1.18); } }
	@keyframes rise { from { opacity: 0; transform: translateY(18px); } }
	@media (prefers-reduced-motion: reduce) {
		.hero::before, .name, .line, .genres, .companies, .acts, .people, main { animation: none; }
		.round, .providers, .person img { transition: none; }
	}
</style>
