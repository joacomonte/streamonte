<script lang="ts">
	// Catálogo compartido (web y desktop): buscador + sugerencias de personas, tipo, orden, "Estrenos desde", votos, géneros y
	// la grilla con scroll infinito. Los datos y el estado viven en `store` (`catalog.svelte.ts`); abrir un título es `onopen`.
	import type { Snippet } from 'svelte';
	import { onMount } from 'svelte';
	import Icon from '../components/Icon.svelte';
	import { t } from '../i18n/runtime.ts';
	import type { CatalogItem, PersonHit } from '../types.ts';
	import { KINDS, SORTS, backLabel, votesLabel, type Filters } from './filters.ts';
	import GenrePicker from './GenrePicker.svelte';
	import Grid from './Grid.svelte';
	import RecentRow from './RecentRow.svelte';
	import type { EpisodeRef, RecentItem } from './recent.ts';
	import Search from './Search.svelte';
	import Segmented from './Segmented.svelte';
	import Since from './Since.svelte';
	import Votes from './Votes.svelte';
	import type { CatalogStore } from './store.ts';
	import { categoryOf } from './subgenres.ts';

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
		/** Buscando, la barra de búsqueda queda a la vista al scrollear (desktop), con fondo opaco. */
		pinned?: boolean;
		/** Degradado al pie de la ventana (la web). */
		fade?: boolean;
		/** Abre un título de "Vistos recientemente" (`ep`: capítulo a abrir; null = la ficha). Sin esto no se muestra la fila. */
		onresume?: (item: RecentItem, ep: EpisodeRef | null) => void;
	}
	let { store, onopen, href, header, top, onmagnet, onlog, onsettings, onneedskey, pinned = false, fade = false, onresume }: Props = $props();
	const st = $derived(store.st);

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
	/** "Terror" o "Terror: Folk, Slasher". */
	const genreText = (f: Filters): string => {
		const c = categoryOf(f.genre);
		if (!c) return '';
		const subs = c.subs.filter((x) => f.subs.includes(x.id)).map((x) => x.label);
		return subs.length ? `${c.label}: ${subs.join(', ')}` : c.label;
	};
	/** Orden elegido y el otro (un solo botón que alterna). */
	/** Orden como segmentado: nombre corto ("Puntaje" / "Populares") con su ícono. */
	const SORT_ITEMS = SORTS.map((s) => ({ v: s.v, label: s.short, icon: s.icon }));
	let sortPopped = $state<Filters['sort'] | ''>('');
	/** Desplegable del buscador abierto. */
	let searchOpen = $state(false);
	/** Con filtros a la vista (no buscando ni sin key): al scrollear se compactan en una línea (2026-11-23, variante 1A). */
	const compactable = $derived(!searching && !trendingOnly);
	/** Ya se scrolleó más allá de los filtros: se ve la barra de una línea. */
	let stuck = $state(false);
	/** Barra tocada: los filtros completos se despliegan arriba de la grilla. */
	let expanded = $state(false);
	const YEAR = new Date().getFullYear();
	const ago = (m: number) => (m < 12 ? backLabel(m) : String(YEAR - m / 12));
	/** "Películas · 2020 – hoy · ★ Mejor puntaje · 10.000+ votos · Drama". */
	const compactText = $derived(
		[
			t(KINDS.find((k) => k.v === st.f.kind)?.label ?? ''),
			`${ago(st.f.from)} – ${st.f.to ? ago(st.f.to) : t('hoy')}`,
			t(SORTS.find((s) => s.v === st.f.sort)?.label ?? ''),
			st.f.votes ? votesLabel(st.f.votes) : '',
			genreText(st.f)
		].filter(Boolean)
	);
	/** Cuánto se esconde al quedar pegada: todo lo de arriba, salvo desplegada o (desktop) buscando. */
	const hide = $derived(expanded || (pinned && !compactable) ? 0 : topH);

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
		// Pegada = ya pasó lo de arriba; al volver arriba se pliega sola.
		const target = scroller ?? window;
		const onScroll = () => {
			stuck = (scroller ? scroller.scrollTop : scrollY) > topH;
			if (!stuck) expanded = false;
		};
		target.addEventListener('scroll', onScroll, { passive: true });
		store.start();
		const off = store.connect();
		return () => (off(), target.removeEventListener('scroll', onScroll), clearTimeout(loggedSearch), clearTimeout(loggedFilter));
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
			const genre = genreText(f);
			const dato = [
				KINDS.find((k) => k.v === f.kind)?.label ?? '',
				genre ? `Género: ${genre}` : '',
				`Orden: ${SORTS.find((s) => s.v === f.sort)?.label ?? f.sort}`,
				`Votos: ${f.votes / 1000}k+`,
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
	{#if expanded}<button id="cat-compact-close" type="button" class="backdrop" aria-label={t('Cerrar filtros')} onclick={() => (expanded = false)}></button>{/if}
	<header class="head" class:intro class:pinned class:expanded class:stuck={stuck && compactable} style:--hide="{hide}px">
		<div class="inner">
			<div class="head-top" bind:clientHeight={topH}>
				{@render header?.()}
				<Search {store} onclear={clear} {onquery} onpick={pick} {onopen} {href} bind:open={searchOpen} />
				{#if !searching}
					<!-- Tipo (2026-11-24: el orden pasó a la fila de géneros, como segmentado). -->
					<div class="ks">
						<Segmented id="cat-kind" label={t('Tipo')} items={KINDS} value={st.f.kind} {popped} onpick={(v) => ((popped = v), setF({ kind: v }))} />
					</div>
					{#if trendingOnly}
						<span id="cat-trending" class="trending">{t('En tendencia ahora')}</span>
						{#if onneedskey}
							<button id="cat-tmdb-cta" type="button" class="tmdb-cta" onclick={onneedskey}>
								<Icon name="lock" size={13} />{t('Filtrá por fecha, votos, idioma y géneros')}<span class="tmdb-key">{t('key gratis de TMDB')}</span><Icon name="arrow" size={13} />
							</button>
						{/if}
					{:else}
						<Since {store} onset={setF} />
						<Votes {store} onset={setF} />
						<!-- Orden (segmentado, primero) y géneros en la misma fila. -->
						<div class="sort-row">
							<div class="ks ks-sort">
								<Segmented id="cat-sort" label={t('Orden')} items={SORT_ITEMS} value={st.f.sort} popped={sortPopped} onpick={(v) => ((sortPopped = v), setF({ sort: v }))} />
							</div>
							<GenrePicker {store} onpick={(genre, subs) => (store.setGenre(genre, subs), afterFilter())} />
						</div>
					{/if}
				{/if}
			</div>
			{#if compactable && stuck && !expanded}
				<button id="cat-compact" type="button" class="compact" aria-expanded="false" aria-label={t('Filtros aplicados: {f}. Cambiar', { f: compactText.join(', ') })} onclick={() => (expanded = true)}>
					<Icon name="search" size={16} />
					<span class="compact-text">{#each compactText as part, i (i)}{#if i}<span class="dot" aria-hidden="true">·</span>{/if}{#if i === 1}<span class="amber">{part}</span>{:else}{part}{/if}{/each}</span>
					<Icon name="chev" size={16} />
				</button>
			{/if}
		</div>
	</header>

	<div class="body inner">
		{@render top?.(searching)}
		{#if onresume && !searching}<RecentRow {onresume} />{/if}
		<!-- Buscando por texto los resultados van en el desplegable del buscador (2026-11-24): la grilla queda solo de fondo,
		     desenfocada detrás del desplegable abierto; con el desplegable cerrado no se muestra. -->
		{#if mode !== 'search' || searchOpen}<Grid {store} {onopen} {href} {onsettings} {fade} bind:sentinel />{/if}
	</div>
</div>

<style>
	/* Se pega arriba corrido hacia arriba lo que mide la parte de arriba: al scrollear queda solo la barra de chips. */
	.head {
		position: sticky;
		/* `--bleed-top`: el scroller del desktop tiene padding arriba (-20 px); sin compensarlo asomaba lo de arriba (2026-11-23). */
		top: calc(var(--bleed-top, 0px) - var(--hide) - 6px);
		z-index: 20;
		padding: calc(var(--safe-top) + 6px) calc(16px + var(--bleed-x, 0px)) 0;
		margin: var(--bleed-top, 0px) calc(-1 * var(--bleed-x, 0px)) 0;
		/* Casi opaco y sin blur: el backdrop-filter sobre la grilla animada era lo más caro al scrollear en el celu. */
		background: color-mix(in srgb, var(--bg) 96%, transparent);
		border-bottom: 1px solid var(--border);
	}
	.head.pinned, .head.stuck { background: var(--bg); }
	/* Lo de arriba queda fuera de pantalla al compactarse; oculto, para que no asome el brillo del orden por encima de la barra. */
	.head.stuck:not(.expanded) .head-top { visibility: hidden; }
	/* Desplegada desde la barra de una línea: baja entera sobre la grilla, con sombra y el resto oscurecido. */
	.head.expanded { z-index: 22; box-shadow: 0 18px 40px var(--shadow-lg); animation: drop 0.3s var(--out); }
	@keyframes drop { from { opacity: 0; transform: translateY(-8px); } }
	.backdrop { position: fixed; inset: 0; z-index: 21; border: 0; padding: 0; background: rgb(0 0 0 / 0.5); animation: fade 0.25s var(--ease); cursor: default; }
	@keyframes fade { from { opacity: 0; } }
	/* La barra de una línea: el estado de los filtros y un chevron; tocarla despliega todo. */
	.compact { display: flex; align-items: center; gap: 8px; width: calc(100% + 32px); min-height: 48px; margin: 0 -16px; padding: 0 16px; border: 0; background: none; color: var(--text); font: inherit; font-size: 13.5px; font-weight: 600; text-align: left; white-space: nowrap; cursor: pointer; animation: fade 0.2s var(--ease); }
	.compact :global(svg) { flex: none; color: var(--muted); }
	.compact :global(svg:last-child) { margin-left: auto; }
	.compact-text { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
	.compact .dot { margin: 0 6px; color: var(--dim, var(--muted)); }
	.compact .amber { color: var(--amber); font-variant-numeric: tabular-nums; }
	.inner { max-width: 1200px; margin: 0 auto; }
	.head-top { padding-bottom: 2px; }
	/* Entrada después de la bienvenida: cada bloque de arriba sube escalonado. */
	.intro .head-top > * { animation: rise 0.7s var(--out) backwards; }
	.intro .head-top > :nth-child(2) { animation-delay: 60ms; }
	.intro .head-top > :nth-child(3) { animation-delay: 120ms; }
	.intro .head-top > :nth-child(4) { animation-delay: 180ms; }
	.intro .head-top > :nth-child(5) { animation-delay: 240ms; }
	.intro .head-top > :nth-child(6) { animation-delay: 300ms; }
	@keyframes rise { from { opacity: 0; transform: translateY(24px); } }

	/* Cápsula del tipo (ancho completo, 2026-11-24) y la del orden en la fila de géneros: fondo propio y el pulgar que se desliza. */
	.ks { display: flex; align-items: stretch; gap: 2px; margin-top: 12px; padding: 4px; border-radius: var(--r-pill); background: var(--surface-2); }
	/* Orden primero y géneros al lado; el orden no se achica por debajo de lo que entra en celu. */
	.sort-row { display: flex; align-items: center; gap: 8px; min-width: 0; }
	.ks-sort { flex: 0 1 280px; min-width: 168px; margin: 6px 0 10px; padding: 3px; }


	.body { padding: 14px 16px calc(24px + var(--safe-bottom)); }
	.trending { display: block; margin-top: 12px; font-size: 13px; font-weight: 650; color: var(--muted); }
	.tmdb-cta { display: inline-flex; align-items: center; gap: 6px; margin: 8px 0 10px; padding: 8px 12px; border: 1px solid color-mix(in srgb, var(--accent) var(--tint-3), transparent); border-radius: var(--r-pill); background: color-mix(in srgb, var(--accent) 12%, var(--surface)); color: var(--text); font-size: 13px; }
	.tmdb-key { color: var(--accent-fg); font-weight: 650; }
</style>
