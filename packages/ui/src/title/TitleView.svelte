<script lang="ts">
	// Ficha de un título, la misma en la web (ruta) y en el desktop (panel lateral): cabecera, acciones, reparto, sinopsis, similares,
	// temporadas/episodios y, donde van los torrents, el snippet `options` (cada app pone el suyo). Datos solo por `getApi().title.*`;
	// qué pasa al tocar algo (abrir una persona, una temporada, un episodio…) lo deciden los callbacks de la app.
	import type { Snippet } from 'svelte';
	import Icon from '../components/Icon.svelte';
	import { getApi } from '../context.ts';
	import { t } from '../i18n/runtime.ts';
	import type { Episode, Kind, Person, SeasonRatings, SimilarItem, TitleDetails } from '../types.ts';
	import SeasonChart from './SeasonChart.svelte';
	import { episodeRows, MAX_ACTORS, outlookOf, pickPeople, providerView, seasonTiles, showCineNote, WEB_IDS } from './title-state.ts';
	import type { SeasonTile, TitleIds } from './title-state.ts';

	interface Props {
		kind: Kind;
		id: string;
		/** Ficha ya pedida (la web la trae en `load`, con su caché); sin ella se pide con `getApi().title.details`. */
		details?: TitleDetails;
		/** Temporada elegida (null = la lista de temporadas) y episodio elegido (null = la lista de episodios). */
		season?: number | null;
		episode?: number | null;
		onSeason: (season: number | null) => void;
		onEpisode: (ep: Episode) => void;
		/** Con link, la fila es un `<a>` (la web navega); sin él, un botón. */
		seasonHref?: (season: number) => string;
		episodeHref?: (ep: Episode) => string;
		onPerson: (p: Person) => void;
		onOpenTitle?: (kind: Kind, id: string, name: string) => void;
		/** Abrir fuera de la app (el desktop no puede con un `<a target>`): con handler se frena el link. */
		onOpenImdb?: (imdb: string) => void;
		onOpenTrailer?: (youtube: string) => void;
		/** Dónde van los torrents: películas y, en el desktop, el episodio elegido. */
		options: Snippet;
		/** Entre la cabecera y el cuerpo (el desktop pone ahí sus migas fijas). */
		between?: Snippet;
		/** Reemplaza a "Similares" (el desktop ofrece configurar la key de TMDB). */
		teaser?: Snippet;
		/** Pide y muestra "Similares" (un pedido a TMDB cada uno: la web no los tiene). */
		similar?: boolean;
		/** La cabecera y la ficha se pliegan (elegida una temporada en el desktop). */
		collapsed?: boolean;
		/** Alto de la barra fija de arriba: el fondo sube por detrás (px). */
		topInset?: number;
		/** El `<h1>` del título (la web lo observa para pasarlo a su barra). */
		titleEl?: HTMLElement;
		/** Migas "← Temporadas › Temporada N" arriba de los episodios. */
		crumbs?: boolean;
		/** Miniatura de cada episodio (el desktop no, puede spoilear). */
		stills?: boolean;
		/** Episodios que todavía no salieron no se pueden abrir. */
		lockUnaired?: boolean;
		genreLabel?: (genre: string) => string;
		ids?: TitleIds;
		/** Locale BCP 47 para números y fechas. */
		locale: string;
	}
	let {
		kind, id, details, season = null, episode = null, onSeason, onEpisode, seasonHref, episodeHref, onPerson, onOpenTitle, onOpenImdb, onOpenTrailer,
		options, between, teaser, similar = false, collapsed = false, topInset = 0, titleEl = $bindable(), crumbs = true, stills = true, lockUnaired = false,
		genreLabel = (g: string) => g, ids = WEB_IDS, locale
	}: Props = $props();

	const api = getApi();
	const fail = (e: unknown) => (e instanceof Error ? e.message : String(e));
	const cap = (s: string | null) => (s ? s[0]?.toUpperCase() + s.slice(1) : '');
	const fmtDate = (iso: string) => new Date(`${iso.slice(0, 10)}T12:00:00`).toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' });
	const fmtScore = (x: number) => x.toLocaleString(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
	const hide = (e: Event) => void (e.currentTarget instanceof HTMLElement && (e.currentTarget.hidden = true));
	const today = new Date().toISOString().slice(0, 10);

	let fetched = $state<TitleDetails | null>(null);
	let loadError = $state('');
	const d = $derived(details ?? fetched);
	let ratings = $state<SeasonRatings | null | undefined>(undefined);
	let episodes = $state<Episode[] | null>(null);
	let epError = $state('');
	let more = $state(false);
	let providersOpen = $state(false);
	let castOpen = $state(false);
	let similarOpen = $state(false);
	let similarList = $state<SimilarItem[] | null | undefined>(undefined);

	$effect(() => {
		const [k, i] = [kind, id];
		more = providersOpen = castOpen = similarOpen = false;
		similarList = undefined;
		if (details) return;
		fetched = null;
		loadError = '';
		let alive = true;
		api.title.details(k, i).then((x) => alive && (fetched = x)).catch((e: unknown) => alive && (loadError = fail(e)));
		return () => (alive = false);
	});
	// Puntaje por temporada: lo piden el gráfico y la lista (una sola vez).
	$effect(() => {
		const imdb = d?.kind === 'tv' ? d.imdb : null;
		ratings = imdb ? undefined : null;
		if (!imdb) return;
		let alive = true;
		api.title.seasonRatings(imdb).then((r) => alive && (ratings = r)).catch(() => alive && (ratings = null));
		return () => (alive = false);
	});
	$effect(() => {
		const [n, tvId] = [season, d?.kind === 'tv' ? d.id : null];
		episodes = null;
		epError = '';
		if (n == null || !tvId) return;
		let alive = true;
		api.title.episodes(tvId, n).then((x) => alive && (episodes = x)).catch((e: unknown) => alive && (epError = fail(e)));
		return () => (alive = false);
	});
	function toggleSimilar() {
		similarOpen = !similarOpen;
		if (!similarOpen || similarList !== undefined || !d) return;
		similarList = null;
		api.title.similar(d.kind, d.imdb ?? d.id).then((l) => (similarList = l)).catch(() => (similarList = []));
	}

	const people = $derived(d ? pickPeople(d.people) : []);
	// El director va junto al título ("Film de …"); los actores, como texto: "Con A, B, C y N más" (2026-11-23, variante 2D).
	const director = $derived(people.find((p) => p.role === 'director'));
	const cast = $derived((d?.people ?? []).filter((p) => p.role === 'cast'));
	const castShown = $derived(castOpen ? cast : cast.slice(0, MAX_ACTORS));
	const provs = $derived(d ? providerView(d.providers, providersOpen) : { shown: [], more: 0 });
	const tiles = $derived(d ? seasonTiles(d.seasons, ratings) : []);
	const outlook = $derived(d ? outlookOf(d, ratings) : null);
	const nextSeason = $derived.by(() => {
		const o = outlook;
		if (!o) return null;
		const end = o.tone === 'done' || o.tone === 'stop';
		const title = end ? t(o.tone === 'done' ? 'Serie terminada' : 'Serie cancelada') : o.tone === 'go' && o.episode > 1 ? `T${o.season} E${o.episode}` : t('Temporada {n}', { n: o.season });
		const detail = end ? t('No hay más temporadas')
			: o.tone === 'go' ? `${o.days <= 1 ? t(o.days ? 'Se estrena mañana' : 'Se estrena hoy') : t('Se estrena en {n} días', { n: o.days })} · ${fmtDate(o.date)}` : t('{s} · sin fecha anunciada', { s: t(o.label) });
		return { tone: o.tone, num: end ? null : String(o.season), flag: o.tone === 'done' ? ('flag' as const) : ('ban' as const), title, detail };
	});
	const rows = $derived(episodeRows(episodes ?? [], today));
	const heroLine = $derived(d ? [d.year, d.runtimeMin ? `${d.runtimeMin} min` : '', d.kind === 'tv' && d.seasons.length ? t(d.seasons.length === 1 ? '{n} temporada' : '{n} temporadas', { n: d.seasons.length }) : ''].filter(Boolean).join(' · ') : '');
	const genres = $derived((d?.genres ?? []).map(genreLabel));
	const seasonName = (n: number, name: string | null) => name || (n === 0 ? t('Especiales') : t('Temporada {n}', { n }));
	const aboutTitle = $derived(d?.overview ? t('Sinopsis') : t('Idioma original'));

	const still = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
	/** Entra desde el lado hacia donde se avanza (a una temporada: 1; a la lista: -1). */
	const slide = (_: Element, { dir }: { dir: number }) => ({
		duration: still() ? 0 : 360,
		css: (x: number) => {
			const e = 1 - Math.pow(1 - x, 4);
			return `transform: translateX(${(1 - e) * dir * 24}px); opacity: ${e};`;
		}
	});
	const dir = $derived(season == null ? -1 : 1);
	/** Un link normal: la app lo maneja (sin recargar) con `onpick`; con ctrl/cmd o botón del medio, el navegador. */
	const plain = (e: MouseEvent) => !(e.metaKey || e.ctrlKey || e.shiftKey || e.button);
</script>

{#snippet seasonRow(x: SeasonTile)}
	<span class="s-num" aria-hidden="true">{x.number === 0 ? '★' : x.number}</span>
	<span class="s-text">
		<span class="s-name">{seasonName(x.number, x.name)}</span>
		<span class="muted small">{[t(x.episodeCount === 1 ? '{n} episodio' : '{n} episodios', { n: x.episodeCount }), x.year].filter(Boolean).join(' · ')}</span>
	</span>
	{#if x.score}<span class="s-score" title={t('Puntaje de IMDb de la temporada')}><Icon name="star" size={13} />{fmtScore(x.score)}</span>{/if}
	<span class="chev"><Icon name="next" size={18} /></span>
{/snippet}

{#snippet epRow(ep: Episode, future: boolean)}
	{#if stills}{#if ep.still}<img src={ep.still} alt="" loading="lazy" width="300" height="169" referrerpolicy="no-referrer" />{:else}<span class="still-empty"></span>{/if}{/if}
	<span class="ep-text">
		<span class="ep-name">{ep.number}. {ep.title || t('Episodio {n}', { n: ep.number })}</span>
		<span class="muted small">{ep.date ? (future ? t('Sale el {d}', { d: fmtDate(ep.date) }) : fmtDate(ep.date)) : ''}</span>
		{#if ep.overview}<span class="ep-overview">{ep.overview}</span>{/if}
	</span>
	<span class="chev"><Icon name="next" size={18} /></span>
{/snippet}

<div class="title-view" style:--inset="{topInset}px">
	{#if !d}
		{#if loadError}
			<p class="err inner">{loadError}</p>
		{:else}
			<div class="inner skeleton" aria-busy="true">{#each Array(5) as _, i (i)}<span class="skel"></span>{/each}</div>
		{/if}
	{:else}
		<div class="intro" class:collapsed inert={collapsed} aria-hidden={collapsed ? 'true' : undefined}>
			<div class="intro-in">
				<div class="hero" style:--bd={d.backdrop ? `url("${encodeURI(d.backdrop)}")` : 'none'}>
					<div class="inner hero-in">
						{#if d.poster}<img id={ids.poster} class="poster" src={d.poster} alt="" width="342" height="513" referrerpolicy="no-referrer" onerror={hide} />{/if}
						<div class="facts">
							<h1 class="name" bind:this={titleEl}>{d.title}</h1>
							{#if director}
								{@const dir = director}
								<p class="by">{t(d.kind === 'tv' ? 'Serie de' : 'Film de')} <button id={ids.person(dir)} type="button" class="by-link" title={t('Ver lo que dirigió')} onclick={() => onPerson(dir)}>{dir.name}</button></p>
							{/if}
							<p class="muted line">
								<span>{heroLine}{#if genres.length}<span class="genres-txt">{` · ${genres.join(', ')}`}</span>{/if}</span>
								<!-- IMDb (con su puntaje) y tráiler como píldoras junto a los datos; sin IMDb, la estrella sola. -->
								{#if d.imdb}
									{@const imdb = d.imdb}
									<a id={ids.imdb} class="ext" href="https://www.imdb.com/title/{imdb}/" target="_blank" rel="noopener noreferrer" title={t('Ver en IMDb')} onclick={(e) => { if (onOpenImdb) { e.preventDefault(); onOpenImdb(imdb); } }}><span class="imdb-seal">IMDb</span>{d.rating ?? ''}</a>
								{:else if d.rating}
									<span class="rate"><Icon name="star" size={13} />{d.rating}</span>
								{/if}
								{#if d.trailer}
									{@const yt = d.trailer}
									<a id={ids.trailer} class="ext" href="https://www.youtube.com/watch?v={yt}" target="_blank" rel="noopener noreferrer" title={t('Ver el tráiler en YouTube')} onclick={(e) => { if (onOpenTrailer) { e.preventDefault(); onOpenTrailer(yt); } }}><Icon name="play" size={11} />{t('Tráiler')}</a>
								{/if}
							</p>
							{#if d.companies.length}<p class="companies">{d.companies.join(' · ')}</p>{/if}
							<!-- Reparto como texto; con mouse, la cara de cada uno aparece en un globito. -->
							{#if cast.length}
								<p class="cast-txt">
									{t('Con')}
									{#each castShown as p, i (p.id)}{#if i}{i === castShown.length - 1 && castOpen ? ` ${t('y')} ` : ', '}{/if}<button id={ids.person(p)} type="button" class="who" title={p.note ? `${p.name} · ${p.note}` : t('Ver lo que actuó')} onclick={() => onPerson(p)}>{p.name}{#if p.photo}<img class="who-face" src={p.photo} alt="" width="56" height="56" loading="lazy" referrerpolicy="no-referrer" onerror={hide} />{/if}</button>{/each}
									{#if cast.length > MAX_ACTORS}
										<button id={ids.cast} type="button" class="who-more" aria-expanded={castOpen} onclick={() => (castOpen = !castOpen)}>{castOpen ? t('ver menos') : t('y {n} más', { n: cast.length - MAX_ACTORS })}</button>
									{/if}
								</p>
							{/if}
						</div>
					</div>
				</div>

				{#if d.providers.length}
					<div class="inner acts">
						{#if d.providers.length}
						<!-- Dónde verla: logos apilados; al tocar se abre con los nombres. -->
						<button id={ids.providers} type="button" class="providers" class:open={providersOpen} aria-expanded={providersOpen} aria-label={t('Dónde verla')} title={t('Para ver en Argentina')} onclick={() => (providersOpen = !providersOpen)}>
							{#each provs.shown as p, i (p.name)}
								<span id={ids.provider(i)} class="prov">
									{#if p.logo}<img src={p.logo} alt="" width="28" height="28" referrerpolicy="no-referrer" onerror={hide} />{:else}<span class="prov-empty" aria-hidden="true">{p.name[0]}</span>{/if}
									{#if providersOpen}<span class="prov-name">{p.name}</span>{/if}
								</span>
							{/each}
							{#if provs.more}<span class="prov-more">+{provs.more}</span>{/if}
						</button>
						{/if}
					</div>
				{/if}

				{#if showCineNote(d)}
					<div class="inner cine-wrap"><p id={ids.cine} class="cine-note"><Icon name="film" size={15} /><span>{t('Probablemente todavía no haya torrents de buena calidad: se estrenó hace pocas semanas y por ahora suele haber solo copias filmadas en el cine.')}</span></p></div>
				{/if}

				{#if d.networks.length}<div class="inner networks">{#each d.networks as n (n)}<span class="network">{n}</span>{/each}</div>{/if}

				<!-- Sinopsis plegada: una fila con la primera línea; al tocarla se despliega. -->
				{#if d.overview || d.languageName}
					<section class="inner about" class:open={more}>
						<button id={ids.about} type="button" class="about-head" aria-expanded={more} aria-controls={ids.aboutBody} onclick={() => (more = !more)}>
							<span class="about-text">
								<b>{aboutTitle}</b>
								{#if d.overview}<span class="about-peek">{d.overview}</span>{/if}
							</span>
							<span class="about-chev" aria-hidden="true"><Icon name="chev" size={16} /></span>
						</button>
						<div id={ids.aboutBody} class="about-body" inert={!more}>
							<div class="about-in">
								{#if d.overview}<p class="ov-text">{d.overview}</p>{/if}
								{#if d.languageName}<dl class="info"><dt>{t('Idioma original')}</dt><dd>{cap(d.languageName)}</dd></dl>{/if}
							</div>
						</div>
					</section>
				{/if}

				{#if teaser}
					<div class="inner">{@render teaser()}</div>
				{:else if similar}
					<div class="inner similar" class:open={similarOpen}>
						<button id={ids.similarToggle} type="button" class="similar-head" aria-expanded={similarOpen} onclick={toggleSimilar}>
							<span>{t('Similares')}</span><Icon name="chev" size={16} />
						</button>
						{#if similarOpen}
							{#if similarList == null}
								<div class="similar-grid" aria-busy="true">{#each Array(5) as _, i (i)}<span class="skel similar-skel"></span>{/each}</div>
							{:else if !similarList.length}
								<p class="muted small">{t('TMDB no tiene recomendaciones para este título.')}</p>
							{:else}
								<div class="similar-grid">
									{#each similarList as x (x.id)}
										<button id={ids.similar(x.id)} type="button" class="similar-card" title={x.year ? `${x.title} (${x.year})` : x.title} onclick={() => onOpenTitle?.(d.kind, x.id, x.title)}>
											{#if x.poster}<img src={x.poster} alt="" loading="lazy" referrerpolicy="no-referrer" onerror={hide} />{/if}
											{#if x.rating}<span class="similar-score {x.rating >= 8.5 ? 'great' : x.rating >= 7.5 ? 'good' : x.rating >= 6.5 ? 'meh' : 'bad'}">★ {fmtScore(x.rating)}</span>{/if}
											<span class="similar-name">{x.title}</span>
										</button>
									{/each}
								</div>
							{/if}
						{/if}
					</div>
				{/if}
			</div>
		</div>

		{@render between?.()}

		<main class="inner body">
			{#if !d.imdb}
				<p class="err">{t(d.kind === 'tv' ? 'TMDB no tiene el IMDb id de esta serie: no puedo buscar torrents.' : 'TMDB no tiene el IMDb id de este título: no puedo buscar torrents.')}</p>
			{:else if d.kind === 'movie' || episode != null}
				{@render options()}
			{:else}
				<SeasonChart {ratings} {outlook} current={season} onpick={(n) => onSeason(n)} {ids} {locale} />
				{#key season}
					<section class="step" in:slide={{ dir }}>
						{#if season == null}
							<h2>{t('Temporadas')}</h2>
							<ul class="seasons">
								{#each tiles as x (x.number)}
									<li>
										{#if seasonHref}
											<a id={ids.season(x.number)} class="season" href={seasonHref(x.number)} onclick={(e) => { if (plain(e)) { e.preventDefault(); onSeason(x.number); } }}>{@render seasonRow(x)}</a>
										{:else}
											<button id={ids.season(x.number)} type="button" class="season" onclick={() => onSeason(x.number)}>{@render seasonRow(x)}</button>
										{/if}
									</li>
								{/each}
								{#if nextSeason}
									<li>
										<div id={ids.nextSeason} class="season next {nextSeason.tone}">
											<span class="s-num" aria-hidden="true">{#if nextSeason.num}{nextSeason.num}{:else}<Icon name={nextSeason.flag} size={20} />{/if}</span>
											<span class="s-text"><span class="s-name">{nextSeason.title}</span><span class="muted small">{nextSeason.detail}</span></span>
										</div>
									</li>
								{/if}
							</ul>
						{:else}
							{#if crumbs}
								<nav class="crumbs" aria-label={t('Ruta')}>
									{#if d.seasons.length !== 1}
										<button id={ids.crumbSeasons} type="button" class="crumb" onclick={() => onSeason(null)}><Icon name="back" size={16} />{t('Temporadas')}</button>
										<span class="sep" aria-hidden="true">›</span>
									{/if}
									<h2 aria-current="page">{seasonName(season, d.seasons.find((x) => x.number === season)?.name ?? null)}</h2>
								</nav>
							{/if}
							{#if epError}
								<p class="err">{epError}</p>
							{:else if !episodes}
								{#each Array(4) as _, i (i)}<div class="ep-skel skel"></div>{/each}
							{:else}
								<ul class="eps">
									{#each rows as { ep, future } (ep.number)}
										{@const locked = lockUnaired && future}
										<li>
											{#if episodeHref && !locked}
												<a id={ids.episode(ep.season, ep.number)} class="ep" class:future href={episodeHref(ep)} data-sveltekit-preload-data="tap" onclick={(e) => { if (plain(e)) { e.preventDefault(); onEpisode(ep); } }}>{@render epRow(ep, future)}</a>
											{:else}
												<button id={ids.episode(ep.season, ep.number)} type="button" class="ep" class:future disabled={locked} onclick={() => onEpisode(ep)}>{@render epRow(ep, future)}</button>
											{/if}
										</li>
									{/each}
								</ul>
							{/if}
						{/if}
					</section>
				{/key}
			{/if}
		</main>
	{/if}
</div>

<style>
	.title-view { --accent-chip: var(--accent-fg, var(--accent)); }
	.inner { width: 100%; max-width: 1200px; margin: 0 auto; padding-inline: 16px; box-sizing: border-box; }
	.muted { color: var(--muted); }
	.err { color: var(--red); }
	.small { font-size: 12.5px; }
	.skeleton { display: grid; gap: 12px; padding-block: 16px; }
	.skeleton .skel { height: 72px; border-radius: var(--r-card, 14px); }
	/* Plegado (desktop): crece/encoge con grid-template-rows, sin medir alturas. El fondo sube por detrás de la barra con --inset. */
	.intro { display: grid; grid-template-rows: 1fr; margin-top: calc(-1 * var(--inset, 0px)); transition: grid-template-rows 0.36s var(--out), opacity 0.3s var(--ease); }
	.intro.collapsed { grid-template-rows: 0fr; opacity: 0; }
	.intro-in { min-height: 0; overflow: hidden; }
	.hero { position: relative; overflow: hidden; padding-top: var(--inset, 0px); }
	.hero::before {
		content: '';
		position: absolute;
		inset: 0;
		background: var(--bd) center / cover;
		filter: blur(2px) saturate(1.1);
		opacity: 0.35;
		mask-image: linear-gradient(to bottom, #000 40%, transparent);
	}
	.hero-in { position: relative; display: flex; gap: 14px; align-items: flex-end; padding-top: 18px; padding-bottom: 8px; }
	.poster { width: 110px; height: auto; aspect-ratio: 2 / 3; border-radius: var(--r-md, 12px); box-shadow: 0 8px 24px var(--shadow-lg); object-fit: cover; flex: none; }
	@media (min-width: 720px) { .poster { width: 170px; } }
	.facts { min-width: 0; padding-bottom: 4px; }
	.name { margin: 0 0 4px; font-size: 24px; line-height: 1.15; letter-spacing: -0.015em; text-wrap: balance; }
	.line { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin: 0; font-size: 13.5px; }
	.rate { display: inline-flex; align-items: center; gap: 3px; color: var(--yellow); font-weight: 650; }
	.by { margin: 0 0 8px; font-size: 13.5px; color: var(--muted); }
	.by-link { padding: 0; border: 0; background: none; color: var(--text); font: inherit; font-weight: 650; cursor: pointer; }
	@media (hover: hover) { .by-link:hover { text-decoration: underline; } }
	/* Géneros y reparto como texto sutil (2026-11-23, variante 2D). */
	.genres-txt { color: var(--muted); }
	.cast-txt { margin: 8px 0 0; font-size: 13.5px; line-height: 1.6; color: var(--muted); }
	.who { position: relative; padding: 0; border: 0; background: none; color: var(--text); font: inherit; font-weight: 600; cursor: pointer; text-decoration: underline; text-decoration-color: var(--border-strong); text-underline-offset: 3px; }
	.who-more { padding: 0; border: 0; background: none; color: var(--accent-fg, var(--accent)); font: inherit; font-weight: 600; cursor: pointer; }
	/* La cara: solo con mouse (en táctil no hay globito). */
	.who-face { display: none; }
	@media (hover: hover) {
		.who:hover { color: var(--accent-fg, var(--accent)); text-decoration-color: currentColor; }
		.who-face { display: block; position: absolute; left: 50%; bottom: calc(100% + 8px); z-index: 5; width: 56px; height: 56px; border-radius: 50%; border: 2px solid var(--raised, var(--surface-3)); object-fit: cover; box-shadow: 0 8px 20px var(--shadow-lg); opacity: 0; pointer-events: none; translate: -50% 4px; transition: opacity 0.15s, translate 0.2s var(--out); }
		.who:hover .who-face, .who:focus-visible .who-face { opacity: 1; translate: -50% 0; }
	}
	.companies { margin: 4px 0 0; font-size: 12.5px; color: var(--muted); }
	.cine-wrap { padding-top: 12px; }
	.cine-note { display: flex; gap: 8px; align-items: flex-start; margin: 0; padding: 9px 11px; border-radius: var(--r-card, 14px); background: color-mix(in srgb, var(--amber, #f5a524) 16%, transparent); color: var(--text); font-size: 13px; line-height: 1.35; }
	.cine-note :global(svg) { flex: none; margin-top: 1px; color: var(--amber, #f5a524); }
	/* IMDb y tráiler: píldoras chicas en la línea de datos. */
	.ext { display: inline-flex; align-items: center; gap: 5px; height: 26px; padding: 0 10px 0 4px; border-radius: var(--r-pill, 999px); background: var(--surface-2); color: var(--text); font-size: 12.5px; font-weight: 700; font-variant-numeric: tabular-nums; text-decoration: none; transition: background 0.2s var(--ease); }
	.ext:not(:has(.imdb-seal)) { padding-left: 9px; }
	.imdb-seal { padding: 2px 4px; border-radius: 4px; background: #f5c518; color: #000; font-size: 10px; font-weight: 900; letter-spacing: -0.02em; line-height: 1.1; }
	@media (hover: hover) { .ext:hover { background: var(--surface-3, var(--border)); } }
	/* Fila de plataformas. */
	.acts { display: flex; flex-wrap: wrap; align-items: flex-start; gap: 8px; padding-top: 12px; }
	.providers { display: flex; flex-wrap: wrap; align-items: center; gap: 0; min-height: 40px; padding: 4px; border: 0; border-radius: 22px; background: var(--surface-2); color: var(--text); font: inherit; text-align: left; cursor: pointer; transition: background 0.2s var(--ease); }
	.providers:has(.prov-more) { padding-right: 12px; }
	.providers.on { background: var(--surface-3, var(--border)); }
	.providers:not(.open) .prov + .prov { margin-left: -10px; }
	.providers.open { gap: 6px 14px; padding: 6px 14px 6px 6px; border-radius: 20px; }
	.prov { display: inline-flex; align-items: center; gap: 8px; }
	.prov img, .prov-empty { width: 30px; height: 30px; border-radius: 50%; box-shadow: 0 0 0 2px var(--surface-2); object-fit: cover; }
	.providers.open .prov img, .providers.open .prov-empty { border-radius: var(--r-sm, 8px); }
	.prov-empty { display: grid; place-items: center; background: var(--border); font-size: 12px; font-weight: 700; }
	.prov-name { font-size: 13.5px; font-weight: 600; }
	.prov-more { margin-left: 8px; font-size: 13px; font-weight: 650; color: var(--muted); font-variant-numeric: tabular-nums; }
	.providers:active { transform: scale(0.96); }
	@media (hover: hover) { .providers:hover { background: var(--surface-3, var(--border)); } }
	.networks { display: flex; flex-wrap: wrap; gap: 6px; padding-top: 12px; }
	.network { display: inline-flex; align-items: center; height: 26px; padding: 0 11px; border-radius: var(--r-pill, 999px); border: 1px solid color-mix(in srgb, var(--accent) 55%, var(--border)); background: var(--surface-2); color: var(--accent-chip); font-size: 12.5px; font-weight: 600; }
	/* Plegable: el cuerpo crece con grid-template-rows (0fr → 1fr). */
	.about { margin-top: 12px; border-bottom: 1px solid var(--border); }
	.about-head { display: flex; align-items: center; gap: 12px; width: 100%; min-height: 56px; padding: 10px 0; border: 0; background: none; color: var(--text); font: inherit; text-align: left; cursor: pointer; }
	.about-text { display: grid; gap: 2px; flex: 1; min-width: 0; }
	.about-text b { font-size: 14.5px; font-weight: 650; }
	.about-peek { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; font-size: 13.5px; color: var(--muted); }
	.about.open .about-peek { display: none; }
	.about-chev { display: grid; place-items: center; flex: none; width: 32px; height: 32px; border-radius: var(--r-pill, 999px); background: var(--surface-2); color: var(--muted); transition: transform 0.35s var(--out), background 0.2s var(--ease); }
	.about.open .about-chev { transform: rotate(180deg); }
	.about-head:active .about-chev { background: var(--surface-3, var(--border)); }
	.about-body { display: grid; grid-template-rows: 0fr; transition: grid-template-rows 0.4s var(--out); }
	.about.open .about-body { grid-template-rows: 1fr; }
	.about-in { min-height: 0; overflow: hidden; }
	.ov-text { margin: 0 0 12px; font-size: 14px; line-height: 1.5; color: var(--muted); max-width: 68ch; }
	.info { display: grid; grid-template-columns: auto 1fr; gap: 6px 16px; margin: 0; padding-bottom: 14px; font-size: 14px; }
	.info dt { color: var(--muted); }
	.info dd { margin: 0; }
	/* Similares: plegado, se piden recién al abrirlo. */
	.similar { margin-top: 2px; padding-top: 2px; padding-bottom: 4px; display: grid; gap: 10px; }
	.similar.open { padding-bottom: 10px; }
	.similar-head { display: flex; align-items: center; justify-content: space-between; width: 100%; min-height: 44px; padding: 0 2px; border: 0; background: none; color: var(--text); font: inherit; font-size: 14.5px; font-weight: 650; cursor: pointer; }
	.similar-head :global(svg) { color: var(--muted); transform: rotate(-90deg); transition: transform 0.2s var(--out); }
	.similar.open .similar-head :global(svg) { transform: none; }
	.similar-skel { display: block; aspect-ratio: 2 / 3; border-radius: var(--r-sm, 8px); }
	.similar-grid { display: grid; grid-auto-flow: column; grid-auto-columns: calc((100% - 30px) / 4.3); gap: 10px; overflow-x: auto; overscroll-behavior-x: contain; scroll-snap-type: x mandatory; padding-bottom: 6px; scrollbar-width: thin; }
	.similar-card { position: relative; scroll-snap-align: start; display: grid; gap: 6px; padding: 0; border: 0; background: none; color: var(--text); font: inherit; font-size: 12px; font-weight: 600; text-align: left; cursor: pointer; }
	.similar-card img { width: 100%; aspect-ratio: 2 / 3; object-fit: cover; border-radius: var(--r-sm, 8px); background: var(--surface-2); transition: transform 0.2s var(--out); }
	.similar-card:not(:has(img))::before { content: ''; aspect-ratio: 2 / 3; border-radius: var(--r-sm, 8px); background: var(--surface-2); }
	@media (hover: hover) { .similar-card:hover img { transform: scale(1.03); } }
	.similar-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.similar-score { position: absolute; top: 6px; left: 6px; padding: 2px 7px; border-radius: var(--r-pill, 999px); font-size: 11.5px; font-weight: 800; font-variant-numeric: tabular-nums; background: rgb(0 0 0 / 0.72); backdrop-filter: blur(6px); color: #fff; }
	.similar-score.great { color: #6ee7a0; }
	.similar-score.good { color: #b6e86e; }
	.similar-score.meh { color: #f1d36a; }
	.similar-score.bad { color: #ff8a80; }
	.body { padding-top: 4px; padding-bottom: calc(32px + var(--safe-bottom, 0px)); }
	h2 { margin: 18px 0 4px; font-size: 17px; }
	.body > :global(.torrents) { margin-top: 18px; }
	.step { margin-top: 18px; }
	.step > h2 { margin: 0; }
	.seasons, .eps { list-style: none; margin: 10px 0 0; padding: 0; }
	.seasons { display: flex; flex-direction: column; gap: 8px; }
	.season { display: flex; align-items: center; gap: 14px; width: 100%; min-height: 64px; padding: 10px 12px 10px 10px; border: 1px solid var(--border); border-radius: var(--r-card, 14px); background: var(--surface); color: var(--text); font: inherit; text-align: left; text-decoration: none; cursor: pointer; transition: background 0.2s, transform 0.15s; box-sizing: border-box; }
	.season:active { transform: scale(0.985); background: var(--surface-2); }
	@media (hover: hover) { .season:hover { background: var(--surface-2); } }
	.season.next { cursor: default; border-style: dashed; background: none; }
	.season.next:active { transform: none; background: none; }
	.season.next.go { border-color: color-mix(in srgb, var(--green) 55%, var(--border)); }
	.season.next.wait { border-color: color-mix(in srgb, var(--yellow) 55%, var(--border)); }
	.season.next.stop { border-color: color-mix(in srgb, var(--red) 45%, var(--border)); }
	.s-num { width: 42px; height: 42px; flex: none; display: grid; place-items: center; border-radius: var(--r-card, 14px); background: color-mix(in srgb, var(--accent) 14%, transparent); color: var(--accent-chip); font-size: 18px; font-weight: 750; font-variant-numeric: tabular-nums; }
	.s-text { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
	.s-name { font-weight: 650; font-size: 15px; }
	.s-score { display: inline-flex; align-items: center; gap: 3px; font-size: 13.5px; font-weight: 700; font-variant-numeric: tabular-nums; }
	.s-score :global(svg) { color: #e6b54a; fill: currentColor; }
	.chev { color: var(--muted); }
	.crumbs { display: flex; align-items: center; gap: 4px; min-height: 44px; }
	.crumbs h2 { margin: 0; }
	.crumb { display: inline-flex; align-items: center; gap: 2px; min-height: 44px; margin-left: -6px; padding: 0 6px; border: 0; border-radius: var(--r-sm, 8px); background: none; color: var(--accent-chip); font: inherit; font-size: 15px; font-weight: 650; cursor: pointer; }
	.crumb:active { background: var(--surface-2); }
	.sep { color: var(--muted); }
	.eps li { border-bottom: 1px solid var(--border); padding-bottom: 6px; margin-bottom: 6px; }
	.ep { display: flex; gap: 12px; align-items: center; width: 100%; padding: 6px 0; border: 0; background: none; color: var(--text); font: inherit; text-align: left; text-decoration: none; border-radius: var(--r-md, 12px); cursor: pointer; }
	.ep:active { background: var(--surface-2); }
	.ep:disabled { cursor: default; }
	.ep.future { opacity: 0.6; }
	.ep img, .still-empty { width: 120px; height: auto; aspect-ratio: 16 / 9; border-radius: var(--r-sm, 8px); object-fit: cover; background: var(--surface-2); flex: none; }
	.ep-text { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
	.ep-name { font-weight: 600; font-size: 14px; }
	.ep-overview { font-size: 13px; color: var(--muted); line-height: 1.45; display: -webkit-box; -webkit-line-clamp: 3; line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
	.ep-skel { height: 68px; border-radius: var(--r-sm, 8px); margin-top: 10px; }
	/* Entrada: el fondo se enfoca desde un zoom y el texto sube en cascada. */
	.hero::before { animation: backdrop-in 0.9s var(--out) backwards; will-change: transform; }
	.name, .by, .line, .companies, .cast-txt, .acts, .body { animation: rise 0.7s var(--out) backwards; }
	.name { animation-delay: 0.12s; }
	.by { animation-delay: 0.16s; }
	.line { animation-delay: 0.2s; }
	.companies { animation-delay: 0.26s; }
	.acts { animation-delay: 0.28s; }
	.cast-txt { animation-delay: 0.26s; }
	.body { animation-delay: 0.36s; }
	@keyframes backdrop-in { from { opacity: 0; transform: scale(1.18); } }
	@keyframes rise { from { opacity: 0; transform: translateY(18px); } }
	@media (prefers-reduced-motion: reduce) {
		.hero::before, .name, .by, .line, .companies, .cast-txt, .acts, .body { animation: none; }
		.ext, .providers, .who-face, .about-body, .about-chev, .intro { transition: none; }
	}
</style>
