<script lang="ts">
	// Catálogo compartido (web y desktop): buscador + sugerencias de personas, tipo, orden, "Estrenos desde", hoja de filtros y
	// la grilla con scroll infinito. Los datos y el estado viven en `store` (`catalog.svelte.ts`); abrir un título es `onopen`.
	import type { Snippet } from 'svelte';
	import { onMount } from 'svelte';
	import Icon from '../components/Icon.svelte';
	import { t } from '../i18n/runtime.ts';
	import type { CatalogItem, PersonHit } from '../types.ts';
	import FiltersSheet from './FiltersSheet.svelte';
	import { changedCount, DEFAULTS, KINDS, LANGS, SORTS, backLabel, votesLabel, type Filters } from './filters.ts';
	import Grid from './Grid.svelte';
	import Search from './Search.svelte';
	import Segmented from './Segmented.svelte';
	import Since from './Since.svelte';
	import type { CatalogStore } from './store.ts';

	interface Props {
		store: CatalogStore;
		onopen: (item: CatalogItem) => void;
		href?: (item: CatalogItem) => string;
		/** Arriba de la barra de búsqueda (la web pone ahí su marca y sus botones). */
		header?: Snippet;
		/** Arriba de la grilla; recibe si se está buscando (el desktop pone ahí "Pegados"). */
		top?: Snippet<[boolean]>;
		/** Un magnet pegado en el buscador va a su pantalla en vez de buscarse como texto. */
		onmagnet?: (magnet: string) => void;
		/** Registro de uso (web): 'buscar' | 'filtro' | 'actor' | 'director' con un texto legible en español. */
		onlog?: (event: 'buscar' | 'filtro' | 'actor' | 'director', detail: string) => void;
		/** Ir a Ajustes (error de carga). */
		onsettings?: () => void;
		/** Sin key de TMDB (la lista ignora los filtros): invita a cargarla. */
		onneedskey?: () => void;
		/** La barra de búsqueda queda siempre a la vista al scrollear (desktop); si no, solo la de chips. */
		pinned?: boolean;
		cardMin?: number;
		/** Degradado al pie de la ventana (la web). */
		fade?: boolean;
	}
	let { store, onopen, href, header, top, onmagnet, onlog, onsettings, onneedskey, pinned = false, cardMin, fade = false }: Props = $props();
	const st = $derived(store.st);

	let filtersOpen = $state(false);
	/** Alto de lo que se va al scrollear (marca, buscador, tipo): la barra de chips queda pegada arriba. */
	let topH = $state(0);
	let sentinel = $state<HTMLElement>();
	let root = $state<HTMLElement>();
	/** Lo que scrollea (null = la ventana). */
	let scroller = $state<HTMLElement | null>(null);
	let loggedSearch: ReturnType<typeof setTimeout> | undefined;
	let loggedFilter: ReturnType<typeof setTimeout> | undefined;
	/** Último 'filtro' registrado: el mismo no se manda dos veces. */
	let lastFilter = '';
	/** Tipo recién tocado: solo ese hace el "pop" (al cargar la página no rebota). */
	let popped = $state<'movie' | 'tv' | ''>('');
	/** La portada entra al terminar la bienvenida: barra de arriba que sube. */
	let intro = $state(false);

	const mode = $derived(store.mode());
	/** Buscando por texto o viendo lo de un actor: los filtros no aplican y se esconden. */
	const searching = $derived(mode !== 'browse');
	/** Sin key de TMDB: tendencias sin filtros. */
	const trendingOnly = $derived(!st.filtered && !searching);
	const genres = $derived(st.genreList[st.f.kind] ?? []);
	/** Resumen de lo aplicado, debajo de los chips (ni el idioma ni las fechas, que ya muestra el selector de años). */
	const summary = $derived([st.f.votes ? votesLabel(st.f.votes) : '', genres.filter((g) => st.f.genres.includes(g.id)).map((g) => g.name).join(', ')].filter(Boolean));
	const changed = $derived(changedCount(st.f));

	const toTop = () => (scroller ?? window).scrollTo({ top: 0 });
	const setF = (changes: Partial<Filters>) => (store.setFilters(changes), toTop(), logFilters());
	const afterFilter = () => (toTop(), logFilters());

	onMount(() => {
		for (let p = root?.parentElement; p; p = p.parentElement) {
			if (/(auto|scroll)/.test(getComputedStyle(p).overflowY)) {
				scroller = p;
				break;
			}
		}
		store.start();
		const off = store.connect();
		return () => (off(), clearTimeout(loggedSearch), clearTimeout(loggedFilter));
	});

	// Scroll infinito: el final está a menos de ~2 pantallas. Se pide mientras siga cerca, no solo al cruzar el
	// borde: si la página nueva no lo alejó, el observer no vuelve a avisar.
	let near = $state(false);
	$effect(() => {
		if (!sentinel) return;
		const io = new IntersectionObserver((es) => (near = es[0]?.isIntersecting ?? false), { root: scroller, rootMargin: '0px 0px 1600px 0px' });
		io.observe(sentinel);
		return () => io.disconnect();
	});
	$effect(() => {
		if (!near || st.loading || st.done || st.pending || !sentinel) return;
		// `near` se actualiza un cuadro después de pintar la página nueva: se confirma con la posición real.
		const bottom = scroller ? scroller.getBoundingClientRect().bottom : innerHeight;
		if (sentinel.getBoundingClientRect().top < bottom + 1600) void store.loadMore();
	});
	let wasCovered = false;
	$effect(() => {
		if (st.covered) return void (wasCovered = true);
		if (!wasCovered) return;
		wasCovered = false;
		intro = true;
		setTimeout(() => (intro = false), 1500);
	});

	/** Registra los filtros cuando deja de tocarlos un rato (como la búsqueda), con un texto legible en español para /admin
	 * (los géneros salen en el idioma de la app). */
	function logFilters() {
		if (!onlog) return;
		clearTimeout(loggedFilter);
		loggedFilter = setTimeout(() => {
			const f = st.f;
			const meses = (m: number) => (m === 0 ? 'hoy' : m < 12 ? `hace ${m} ${m === 1 ? 'mes' : 'meses'}` : `hace ${m / 12} ${m === 12 ? 'año' : 'años'}`);
			const names = genres.filter((g) => f.genres.includes(g.id)).map((g) => g.name);
			const dato = [
				KINDS.find((k) => k.v === f.kind)?.label ?? '',
				names.length ? `Género: ${names.join(', ')}` : '',
				`Orden: ${SORTS.find((s) => s.v === f.sort)?.label ?? f.sort}`,
				`Idioma: ${LANGS.find((l) => l.v === f.lang)?.label ?? f.lang}`,
				`Votos: ${f.votes ? `${f.votes / 1000}k+` : 'cualquiera'}`,
				`Fechas: desde ${meses(f.from)} hasta ${meses(f.to)}`
			].filter(Boolean).join(' · ');
			if (dato !== lastFilter) onlog('filtro', (lastFilter = dato));
		}, 1500);
	}
	function onquery(raw: string) {
		if (onmagnet && /^\s*magnet:\?/i.test(raw)) {
			store.setQuery('');
			onmagnet(raw.trim());
			return;
		}
		store.setQuery(raw);
		if (store.mode() !== 'browse') toTop();
		// La búsqueda se registra recién cuando deja de escribir un rato (no cada letra).
		clearTimeout(loggedSearch);
		loggedSearch = setTimeout(() => st.q.trim() && onlog?.('buscar', st.q.trim()), 1500);
	}
	function clear() {
		clearTimeout(loggedSearch);
		store.clearSearch();
		toTop();
	}
	function pick(p: PersonHit) {
		clearTimeout(loggedSearch);
		store.pickPerson({ id: p.id, name: p.name, photo: p.photo, role: p.role });
		toTop();
		onlog?.(p.role === 'director' ? 'director' : 'actor', p.name);
	}
</script>

<div bind:this={root} class="catalog-root">
	<header class="head" class:intro class:pinned style:--hide="{pinned ? 0 : topH}px">
		<div class="inner">
			<div class="head-top" bind:clientHeight={topH}>
				{@render header?.()}
				<Search {store} onclear={clear} {onquery} onpick={pick} />
				{#if !searching}
					<Segmented id="cat-kind" label={t('Tipo')} items={KINDS} value={st.f.kind} {popped} onpick={(v) => ((popped = v), setF({ kind: v }))} />
					{#if trendingOnly}
						<span id="cat-trending" class="trending">{t('En tendencia ahora')}</span>
						{#if onneedskey}
							<button id="cat-tmdb-cta" type="button" class="tmdb-cta" onclick={onneedskey}>
								<Icon name="lock" size={13} />{t('Filtrá por fecha, votos, idioma y géneros')}<span class="tmdb-key">{t('key gratis de TMDB')}</span><Icon name="arrow" size={13} />
							</button>
						{/if}
					{:else}
						<Since {store} onset={setF} />
						<div class="sort" role="radiogroup" aria-label={t('Orden')}>
							{#each SORTS as s (s.v)}
								<button id="sort-{s.v}" type="button" role="radio" class="marquee" aria-checked={st.f.sort === s.v} onclick={() => st.f.sort !== s.v && setF({ sort: s.v })}>
									<Icon name={s.icon} size={14} />{t(s.label)}
								</button>
							{/each}
						</div>
					{/if}
				{/if}
			</div>
			{#if !searching && !trendingOnly}
				<div class="filters" role="toolbar" aria-label={t('Filtros')}>
					{#if summary.length}
						<button id="filters-summary" type="button" class="summary" onclick={() => (filtersOpen = true)} aria-label={t('Filtros aplicados: {f}. Cambiar', { f: summary.join(', ') })}>
							{#each summary as part, i (i)}{#if i}<span class="sep" aria-hidden="true"></span>{/if}<span>{part}</span>{/each}
						</button>
					{/if}
					<button id="open-filters" type="button" class="trigger" class:on={changed} onclick={() => (filtersOpen = true)}>
						<Icon name="sliders" size={16} />{t('Filtros')}{#if changed}{#key changed}<span class="n">{changed}</span>{/key}{/if}
					</button>
				</div>
			{/if}
		</div>
	</header>

	<div class="body inner">
		{@render top?.(searching)}
		<Grid {store} {onopen} {href} {onsettings} {cardMin} {fade} bind:sentinel />
	</div>
</div>

<FiltersSheet {store} open={filtersOpen} onclose={() => (filtersOpen = false)} onchange={afterFilter} />

<style>
	/* Se pega arriba corrido hacia arriba lo que mide la parte de arriba: al scrollear queda solo la barra de chips. */
	.head {
		position: sticky;
		top: calc(-1 * (var(--hide) + 6px));
		z-index: 20;
		padding: calc(var(--safe-top) + 6px) calc(16px + var(--bleed-x, 0px)) 0;
		margin: var(--bleed-top, 0px) calc(-1 * var(--bleed-x, 0px)) 0;
		/* Casi opaco y sin blur: el backdrop-filter sobre la grilla animada era lo más caro al scrollear en el celu. */
		background: color-mix(in srgb, var(--bg) 96%, transparent);
		border-bottom: 1px solid var(--border);
	}
	/* El scroller del desktop tiene `--bleed-top` de padding: la barra se pega arriba de todo (si no, deja un hueco por donde asoman las tarjetas). */
	.head.pinned { top: var(--bleed-top, 0px); background: var(--bg); }
	.inner { max-width: 1200px; margin: 0 auto; }
	.head-top { padding-bottom: 2px; }
	/* Entrada después de la bienvenida: cada bloque de arriba sube escalonado. */
	.intro .head-top > *, .intro .filters { animation: rise 0.7s var(--out) backwards; }
	.intro .head-top > :nth-child(2) { animation-delay: 60ms; }
	.intro .head-top > :nth-child(3) { animation-delay: 120ms; }
	.intro .head-top > :nth-child(4) { animation-delay: 180ms; }
	.intro .head-top > :nth-child(5) { animation-delay: 240ms; }
	.intro .filters { animation-delay: 300ms; }
	@keyframes rise { from { opacity: 0; transform: translateY(24px); } }

	/* Orden: switch-píldora compacto (distinto al seg). Un pulgar-marquesina se desliza entre las dos: telón y foquitos. */
	.sort {
		position: relative;
		display: inline-grid;
		grid-template-columns: 1fr 1fr;
		margin-top: 10px;
		border: 1px solid var(--border);
		border-radius: var(--r-pill);
		background: color-mix(in srgb, var(--text) 5%, transparent);
	}
	/* Píldora que se estira al viajar (como una gota) y toma el color de la opción: dorado para puntaje, fuego para populares. */
	.sort::before {
		--c: var(--yellow);
		content: '';
		position: absolute;
		top: 4px;
		bottom: 4px;
		left: 4px;
		width: calc(50% - 4px);
		border-radius: inherit;
		pointer-events: none;
		background: linear-gradient(135deg, color-mix(in srgb, var(--c) 30%, var(--surface-3)), color-mix(in srgb, var(--c) 12%, var(--surface-2)));
		box-shadow: 0 4px 14px color-mix(in srgb, var(--c) 28%, transparent), inset 0 1px 0 rgb(255 255 255 / 0.08), inset 0 0 0 1px color-mix(in srgb, var(--c) var(--tint-3), transparent);
		transform-origin: left center;
		transition: transform 0.5s cubic-bezier(0.34, 1.4, 0.64, 1), --c 0.4s;
		animation: goo 0.5s var(--out);
	}
	.sort:has(#sort-popular[aria-checked='true'])::before { --c: var(--red); transform: translateX(100%); transform-origin: right center; animation-name: goo-b; }
	.marquee {
		position: relative;
		z-index: 1;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 5px;
		min-height: 44px;
		padding: 0 14px;
		border: 0;
		border-radius: var(--r-pill);
		background: none;
		font-size: 13px;
		font-weight: 600;
		color: var(--muted);
		white-space: nowrap;
		transition: color 0.2s var(--ease);
	}
	.marquee[aria-checked='true'] { color: var(--text); }
	.marquee :global(svg) { transition: color 0.2s var(--ease); }
	.marquee[aria-checked='true'] :global(svg) { color: var(--yellow); animation: spin-in 0.5s cubic-bezier(0.34, 1.56, 0.64, 1); }
	#sort-popular[aria-checked='true'] :global(svg) { color: var(--red); animation-name: flare; }
	/* Copias -b: cambiar el nombre de la animación al deslizar la reinicia. El estirón es sobre `scale`, aparte del `transform` que la desliza. */
	@property --c { syntax: '<color>'; inherits: false; initial-value: transparent; }
	@keyframes goo { 35% { scale: 1.35 0.86; } 65% { scale: 0.94 1.05; } }
	@keyframes goo-b { 35% { scale: 1.35 0.86; } 65% { scale: 0.94 1.05; } }
	@keyframes spin-in { from { opacity: 0; transform: scale(0.3) rotate(-160deg); } }
	@keyframes flare { from { opacity: 0; transform: translateY(6px) scale(0.4, 0.2); } 60% { transform: scale(1.1, 1.3); } }


	/* Una línea: lo aplicado (se scrollea, se desvanece al final) y un disparador discreto. */
	.filters {
		display: flex;
		align-items: center;
		margin: 0 -16px;
		padding: 0 6px 4px 0;
	}
	.summary {
		flex: 1;
		min-width: 0;
		min-height: 44px;
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 0 12px 0 16px;
		border: 0;
		background: none;
		overflow-x: auto;
		scrollbar-width: none;
		white-space: nowrap;
		font-size: 12.5px;
		color: var(--muted);
		text-align: left;
		mask-image: linear-gradient(to right, #000 calc(100% - 24px), transparent);
	}
	.summary::-webkit-scrollbar { display: none; }
	.summary:focus-visible { outline-offset: -2px; }
	.trigger {
		flex: none;
		margin-left: auto;
		display: inline-flex;
		align-items: center;
		gap: 6px;
		min-height: 44px;
		padding: 0 10px;
		border: 0;
		border-radius: var(--r-sm);
		background: none;
		color: var(--text);
		font-size: 13px;
		font-weight: 600;
		transition: background 0.2s var(--ease);
	}
	.trigger:active { background: var(--surface-2); }
	.trigger.on { color: var(--accent-fg); }
	.trigger .n {
		min-width: 17px;
		height: 17px;
		padding: 0 5px;
		border-radius: var(--r-pill);
		background: var(--accent);
		color: var(--accent-text);
		font-size: 11px;
		line-height: 17px;
		text-align: center;
		animation: pop 0.35s var(--out);
	}
	@keyframes pop { from { transform: scale(0.4); opacity: 0; } }
	.sep { flex: none; width: 3px; height: 3px; border-radius: 50%; background: currentColor; opacity: 0.6; }


	.body { padding: 14px 16px calc(24px + var(--safe-bottom)); }
	.trending { display: block; margin-top: 12px; font-size: 13px; font-weight: 650; color: var(--muted); }
	.tmdb-cta { display: inline-flex; align-items: center; gap: 6px; margin: 8px 0 10px; padding: 8px 12px; border: 1px solid color-mix(in srgb, var(--accent) var(--tint-3), transparent); border-radius: var(--r-pill); background: color-mix(in srgb, var(--accent) 12%, var(--surface)); color: var(--text); font-size: 13px; }
	.tmdb-key { color: var(--accent-fg); font-weight: 650; }
</style>
