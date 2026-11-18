<script>
	import { onMount } from 'svelte';
	import Icon from '#lib/Icon.svelte';
	import Sheet from '#lib/Sheet.svelte';
	import { BACK, DEFAULTS, KINDS, LANGS, SORTS, VOTES, backLabel, cat, loadGenres, loadMore, reset, votesLabel } from '#lib/catalog.svelte.js';

	/** @type {{tmdb: boolean, torbox: boolean} | null} */
	let keys = $state(null);
	let filtersOpen = $state(false);
	/** Alto de lo que se va al scrollear (marca, buscador, tipo): la barra de chips queda pegada arriba. */
	let topH = $state(0);
	/** @type {HTMLElement | undefined} */
	let sentinel = $state();
	/** @type {ReturnType<typeof setTimeout>} */
	let typing;

	const kind = $derived(KINDS.find((k) => k.v === cat.f.kind) ?? KINDS[0]);
	const kindIdx = $derived(Math.max(0, KINDS.indexOf(kind)));
	const genres = $derived(cat.genreList[kind.kind] ?? []);
	const searching = $derived(cat.q.trim() !== '');
	/** Resumen de lo aplicado, debajo de los chips (el idioma no se muestra). */
	const summary = $derived(
		[
			`${backLabel(cat.f.from).replace(/^./, (c) => c.toUpperCase())} → ${backLabel(cat.f.to)}`,
			cat.f.votes ? votesLabel(cat.f.votes) : '',
			genres.filter((/** @type {{id: string}} */ g) => cat.f.genres.includes(g.id)).map((/** @type {{name: string}} */ g) => g.name).join(', ')
		].filter(Boolean)
	);
	/** Filtros de la hoja que no están en su valor por defecto. */
	const changed = $derived(
		[cat.f.from !== DEFAULTS.from, cat.f.to !== DEFAULTS.to, cat.f.votes !== DEFAULTS.votes, cat.f.lang !== DEFAULTS.lang].filter(Boolean).length + cat.f.genres.length
	);

	onMount(() => {
		fetch('/api/keys').then((r) => r.json()).then((k) => {
			keys = k;
			if (k.tmdb) {
				loadGenres(kind.kind);
				if (!cat.items.length && !cat.loading) loadMore();
			}
		});
	});

	// Scroll infinito: pide la página siguiente cuando el final se acerca.
	$effect(() => {
		if (!sentinel) return;
		const io = new IntersectionObserver((es) => es[0].isIntersecting && keys?.tmdb && loadMore(), { rootMargin: '800px' });
		io.observe(sentinel);
		return () => io.disconnect();
	});

	/** @param {Partial<typeof cat.f>} changes */
	function setF(changes) {
		Object.assign(cat.f, changes);
		if (changes.kind) {
			cat.f.genres = [];
			loadGenres(kind.kind);
		}
		reset();
		scrollTo({ top: 0 });
	}
	/** Vuelve al catálogo con los filtros, arriba de todo. */
	function clearSearch() {
		clearTimeout(typing);
		cat.q = '';
		reset();
		scrollTo({ top: 0 });
	}
	function onSearch() {
		clearTimeout(typing);
		typing = setTimeout(reset, 350);
	}
	/** @param {string} id */
	function toggleGenre(id) {
		cat.f.genres = cat.f.genres.includes(id) ? cat.f.genres.filter((/** @type {string} */ g) => g !== id) : [...cat.f.genres, id];
		reset();
	}
	function resetFilters() {
		setF({ from: DEFAULTS.from, to: DEFAULTS.to, votes: DEFAULTS.votes, lang: DEFAULTS.lang, genres: [] });
	}
</script>

<header class="head" style:--hide="{topH}px">
	<div class="wrap">
		<div class="head-top" bind:clientHeight={topH}>
			<div class="row">
				<h1 class="brand">Streamonte</h1>
				<a id="go-settings" class="icon-btn" href="/ajustes" aria-label="Ajustes"><Icon name="gear" /></a>
			</div>
			<label class="search">
				<Icon name="search" size={18} />
				<input id="cat-q" type="search" placeholder="Buscar película o serie" autocomplete="off" enterkeyhint="search" bind:value={cat.q} oninput={onSearch} onkeydown={(e) => e.key === 'Escape' && cat.q && clearSearch()} />
				{#if cat.q}
					<button id="cat-q-clear" type="button" class="clear-q" aria-label="Limpiar búsqueda" onclick={clearSearch}><Icon name="close" size={14} /></button>
				{/if}
			</label>
			{#if !searching}
				<div class="seg" role="radiogroup" aria-label="Tipo" style:--i={kindIdx}>
					<span class="seg-thumb" aria-hidden="true"></span>
					{#each KINDS as k (k.v)}
						<button id="kind-{k.v}" type="button" role="radio" aria-checked={cat.f.kind === k.v} onclick={() => cat.f.kind !== k.v && setF({ kind: k.v })}>
							{k.v === 'doc' ? 'Docs' : k.label}
						</button>
					{/each}
				</div>
			{/if}
		</div>
		{#if !searching}
			<div class="filters" role="toolbar" aria-label="Filtros">
				<button id="open-filters" type="button" class="chip" class:on={changed} onclick={() => (filtersOpen = true)}>
					<Icon name="sliders" size={15} />Filtros{#if changed}<span class="n">{changed}</span>{/if}
				</button>
				<label class="chip pick">
					{SORTS.find(([v]) => v === cat.f.sort)?.[1]}<Icon name="chev" size={14} />
					<select id="f-sort" aria-label="Orden" value={cat.f.sort} onchange={(e) => setF({ sort: e.currentTarget.value })}>
						{#each SORTS as [v, l] (v)}<option value={v}>{l}</option>{/each}
					</select>
				</label>
			</div>
			<button id="filters-summary" type="button" class="summary" onclick={() => (filtersOpen = true)} aria-label="Filtros aplicados: {summary.join(', ')}. Cambiar">
				{#each summary as part, i (i)}{#if i}<span class="sep" aria-hidden="true"></span>{/if}<span>{part}</span>{/each}
			</button>
		{/if}
	</div>
</header>

<main class="wrap">
	{#if keys && (!keys.tmdb || !keys.torbox)}
		<a id="keys-cta" class="cta" href="/ajustes">
			<strong>Faltan keys</strong>
			<span>{!keys.tmdb ? 'TMDB (catálogo)' : ''}{!keys.tmdb && !keys.torbox ? ' y ' : ''}{!keys.torbox ? 'TorBox (torrents)' : ''}: cargalas en Ajustes.</span>
		</a>
	{/if}

	<ul class="grid" aria-busy={cat.loading}>
		{#each cat.items as it (`${it.kind}${it.id}`)}
			<li>
				<a class="card" href="/t/{it.kind}/{it.id}" data-sveltekit-preload-data="tap">
					{#if it.poster}
						<img src={it.poster} alt="" loading="lazy" decoding="async" width="342" height="513" />
					{:else}
						<div class="noposter">{it.title}</div>
					{/if}
					<div class="meta">
						<span class="title">{it.title}</span>
						<span class="sub">
							{it.year}{#if it.rating}<span class="rate"><Icon name="star" size={11} />{it.rating}</span>{/if}
						</span>
					</div>
				</a>
			</li>
		{/each}
		{#if cat.loading}
			{#each Array(cat.items.length ? 6 : 12) as _, i (i)}
				<li><div class="card"><div class="poster-skel skel"></div></div></li>
			{/each}
		{/if}
	</ul>

	{#if cat.error}
		<div class="state">
			<p class="error" role="alert">{cat.error}</p>
			<div class="state-actions">
				<button id="cat-retry" type="button" class="btn" onclick={reset}>Reintentar</button>
				<a id="cat-settings" class="btn" href="/ajustes">Ir a Ajustes</a>
			</div>
		</div>
	{:else if cat.done && !cat.items.length}
		<div class="state">
			<p class="muted">No hay títulos con estos filtros.</p>
			{#if changed}<button id="empty-reset" type="button" class="btn" onclick={resetFilters}>Restablecer filtros</button>{/if}
		</div>
	{/if}
	<div bind:this={sentinel} class="sentinel"></div>
</main>

<Sheet id="filters-sheet" title="Filtros" open={filtersOpen} onclose={() => (filtersOpen = false)}>
	<div class="group">
		<label class="frow">
			<span>Desde</span><span class="val">{backLabel(cat.f.from)}<Icon name="chev" size={16} /></span>
			<select id="f-from" value={cat.f.from} onchange={(e) => { const v = Number(e.currentTarget.value); setF({ from: v, to: Math.min(cat.f.to, v - 1) }); }}>
				{#each BACK.slice(1) as m (m)}<option value={m}>{backLabel(m)}</option>{/each}
			</select>
		</label>
		<label class="frow">
			<span>Hasta</span><span class="val">{backLabel(cat.f.to)}<Icon name="chev" size={16} /></span>
			<select id="f-to" value={cat.f.to} onchange={(e) => { const v = Number(e.currentTarget.value); setF({ to: v, from: Math.max(cat.f.from, v + 1) }); }}>
				{#each BACK.slice(0, -1) as m (m)}<option value={m}>{backLabel(m)}</option>{/each}
			</select>
		</label>
		<label class="frow">
			<span>Votos</span><span class="val">{cat.f.votes ? votesLabel(cat.f.votes) : 'Cualquiera'}<Icon name="chev" size={16} /></span>
			<select id="f-votes" value={cat.f.votes} onchange={(e) => setF({ votes: Number(e.currentTarget.value) })}>
				{#each VOTES as v (v)}<option value={v}>{votesLabel(v)}</option>{/each}
			</select>
		</label>
		<label class="frow">
			<span>Idioma original</span><span class="val">{LANGS.find(([v]) => v === cat.f.lang)?.[1]}<Icon name="chev" size={16} /></span>
			<select id="f-lang" value={cat.f.lang} onchange={(e) => setF({ lang: e.currentTarget.value })}>
				{#each LANGS as [v, l] (v)}<option value={v}>{l}</option>{/each}
			</select>
		</label>
	</div>

	<h3 class="gh">Géneros</h3>
	<div class="genre-chips">
		{#each genres as g (g.id)}
			<button id="genre-{g.id}" type="button" class="chip" class:on={cat.f.genres.includes(g.id)} aria-pressed={cat.f.genres.includes(g.id)} onclick={() => toggleGenre(g.id)}>{g.name}</button>
		{/each}
	</div>

	<div class="sheet-actions">
		<button id="filters-reset" type="button" class="btn" disabled={!changed} onclick={resetFilters}>Restablecer</button>
		<button id="filters-done" type="button" class="btn primary" onclick={() => (filtersOpen = false)}>Ver resultados</button>
	</div>
</Sheet>

<style>
	/* Se pega arriba corrido hacia arriba lo que mide la parte de arriba: al scrollear queda solo la barra de chips. */
	.head {
		position: sticky;
		top: calc(-1 * (var(--hide) + 6px));
		z-index: 20;
		padding: calc(var(--safe-top) + 6px) 16px 0;
		background: color-mix(in srgb, var(--bg) 84%, transparent);
		backdrop-filter: saturate(1.6) blur(16px);
		-webkit-backdrop-filter: saturate(1.6) blur(16px);
		border-bottom: 1px solid var(--border);
	}
	.head-top { padding-bottom: 2px; }
	.row { display: flex; align-items: center; justify-content: space-between; margin-right: -10px; }
	.brand { margin: 0; font-size: 28px; font-weight: 750; letter-spacing: -0.025em; }
	.search {
		display: flex;
		align-items: center;
		gap: 8px;
		margin-top: 6px;
		padding: 0 12px;
		height: 44px;
		border-radius: 12px;
		background: var(--surface-2);
		color: var(--muted);
	}
	.search input { flex: 1; min-width: 0; border: 0; background: none; outline: none; color: var(--text); font-size: 16px; }
	.search input::placeholder { color: var(--muted); }
	/* Sin la cruz nativa: va la propia, igual en todos los navegadores. */
	.search input::-webkit-search-cancel-button { display: none; }
	.clear-q {
		position: relative;
		flex: none;
		display: grid;
		place-items: center;
		width: 22px;
		height: 22px;
		margin-right: -2px;
		padding: 0;
		border: 0;
		border-radius: 999px;
		background: color-mix(in srgb, var(--muted) 55%, transparent);
		color: var(--bg);
	}
	/* Se ve de 22px, se toca en 44px. */
	.clear-q::after { content: ''; position: absolute; inset: -11px; }

	/* Control segmentado (iOS/Android): la píldora se desliza al tipo elegido. */
	.seg {
		position: relative;
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		max-width: 420px;
		margin-top: 10px;
		padding: 3px;
		border-radius: 12px;
		background: var(--surface-2);
	}
	.seg-thumb {
		position: absolute;
		top: 3px;
		bottom: 3px;
		left: 3px;
		width: calc((100% - 6px) / 3);
		border-radius: 9px;
		background: var(--raised);
		box-shadow: 0 1px 2px var(--shadow), 0 2px 8px var(--shadow);
		transform: translateX(calc(100% * var(--i)));
		transition: transform 0.32s var(--out);
	}
	.seg button {
		position: relative;
		min-height: 38px;
		border: 0;
		border-radius: 9px;
		background: none;
		font-size: 14px;
		font-weight: 600;
		color: var(--muted);
		transition: color 0.2s var(--ease);
	}
	.seg button[aria-checked='true'] { color: var(--text); }

	.filters {
		display: flex;
		align-items: center;
		gap: 8px;
		margin: 0 -16px;
		padding: 10px 16px;
		overflow-x: auto;
		scrollbar-width: none;
		scroll-padding: 0 16px;
	}
	.filters::-webkit-scrollbar { display: none; }
	.filters .chip { min-height: 36px; }
	.summary {
		display: flex;
		align-items: center;
		gap: 8px;
		width: calc(100% + 32px);
		margin: -4px -16px 0;
		padding: 0 16px 10px;
		border: 0;
		background: none;
		overflow-x: auto;
		scrollbar-width: none;
		white-space: nowrap;
		font-size: 12.5px;
		color: var(--muted);
		text-align: left;
	}
	.summary::-webkit-scrollbar { display: none; }
	.sep { flex: none; width: 3px; height: 3px; border-radius: 50%; background: currentColor; opacity: 0.6; }

	main { padding: 14px 16px calc(24px + var(--safe-bottom)); }
	.cta {
		display: flex;
		flex-direction: column;
		gap: 2px;
		padding: 12px 14px;
		margin-bottom: 12px;
		border-radius: var(--radius-card);
		background: color-mix(in srgb, var(--accent) 14%, var(--surface));
		border: 1px solid color-mix(in srgb, var(--accent) 35%, transparent);
		text-decoration: none;
		font-size: 14px;
	}
	.grid {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 14px 10px;
	}
	@media (min-width: 640px) { .grid { grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 20px 14px; } }
	.card { display: block; text-decoration: none; }
	.card img, .noposter, .poster-skel {
		width: 100%;
		height: auto;
		aspect-ratio: 2 / 3;
		border-radius: 10px;
		background: var(--surface-2);
		object-fit: cover;
		box-shadow: 0 1px 3px var(--shadow);
	}
	.card:active img { transform: scale(0.97); }
	.card img { transition: transform 0.15s var(--ease); }
	.noposter { display: grid; place-items: center; padding: 8px; text-align: center; font-size: 13px; color: var(--muted); }
	.meta { display: flex; flex-direction: column; padding: 6px 2px 0; }
	.title { font-size: 13px; font-weight: 600; line-height: 1.25; display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
	.sub { display: flex; gap: 6px; align-items: center; font-size: 12px; color: var(--muted); }
	.rate { display: inline-flex; align-items: center; gap: 2px; color: var(--yellow); }
	.state { display: flex; flex-direction: column; align-items: center; gap: 12px; padding: 32px 0; text-align: center; }
	.state p { margin: 0; }
	.state-actions { display: flex; gap: 8px; }
	.sentinel { height: 1px; }

	/* Hoja de filtros: lista agrupada como los ajustes del sistema. */
	.group { border-radius: var(--radius-card); background: var(--surface-2); overflow: hidden; }
	.frow { position: relative; display: flex; align-items: center; justify-content: space-between; gap: 12px; min-height: 48px; padding: 0 12px 0 14px; font-size: 15px; }
	.frow + .frow { border-top: 1px solid var(--border); }
	.frow:active { background: var(--surface-3); }
	.val { display: inline-flex; align-items: center; gap: 4px; color: var(--muted); text-align: right; }
	.frow select { position: absolute; inset: 0; opacity: 0; width: 100%; font-size: 16px; }
	.gh { margin: 20px 0 10px; font-size: 13px; font-weight: 650; color: var(--muted); }
	.genre-chips { display: flex; flex-wrap: wrap; gap: 10px 8px; }
	.sheet-actions {
		position: sticky;
		bottom: -16px;
		display: grid;
		grid-template-columns: 1fr 1.6fr;
		gap: 8px;
		margin: 20px -16px -16px;
		padding: 12px 16px 16px;
		background: var(--surface);
		border-top: 1px solid var(--border);
	}
</style>
