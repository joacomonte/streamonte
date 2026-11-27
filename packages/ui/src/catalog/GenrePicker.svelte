<script lang="ts">
	// Géneros del catálogo (2026-11-24; tarjetas S1 v3 de docs/mockups/generos-fade, botón B3, panel negro sólido): un botón con
	// collage de pósters que abre una hoja negra abajo (celu) o un desplegable bajo el botón (PC), con el mismo flujo en los dos.
	// Nivel 1: géneros en tarjetas de a una por fila, con un botón "Todos" a la derecha (todo el género: aplica
	// y cierra); tocar la tarjeta entra al nivel 2. Nivel 2: los subgéneros del elegido, uno solo (sin tildes); tocar uno aplica y cierra.
	// Ejemplos (títulos y pósters de IMDb): `store.loadExamples`. Géneros y subgéneros: `subgenres.ts`.
	import { onDestroy } from 'svelte';
	import Icon from '../components/Icon.svelte';
	import { t } from '../i18n/runtime.ts';
	import type { InterestExample } from '../types.ts';
	import { genreArt } from './genre-art.ts';
	import { categoriesFor, categoryOf, type Category } from './subgenres.ts';
	import type { CatalogStore } from './store.ts';

	interface Props {
		store: CatalogStore;
		/** Aplica la elección (`subs` vacío = todos los subgéneros; `genre` null = sin género). */
		onpick: (genre: string | null, subs: string[]) => void;
	}
	let { store, onpick }: Props = $props();
	const st = $derived(store.st);

	const applied = $derived(categoryOf(st.f.genre));
	const appliedSubs = $derived(applied ? applied.subs.filter((x) => st.f.subs.includes(x.id)).map((x) => x.label) : []);
	/** Segundo renglón del botón: "Todos los géneros", "Todos los subgéneros", "Folk" (o "Folk y 3 más" en filtros guardados de antes). */
	const subText = $derived.by(() => {
		if (!applied) return t('Todos los géneros');
		if (!appliedSubs.length || appliedSubs.length === applied.subs.length) return t('Todos los subgéneros');
		if (appliedSubs.length <= 2) return appliedSubs.join(', ');
		return `${appliedSubs[0]} ${t('y {n} más', { n: appliedSubs.length - 1 })}`;
	});

	let open = $state(false);
	/** Género elegido (nivel 2). */
	let cat = $state<string | null>(null);
	/** 1 = géneros, 2 = subgéneros de `cat`. */
	let level = $state<1 | 2>(1);
	/** Cambió de nivel hacia atrás (la animación entra desde la izquierda). */
	let backwards = $state(false);
	let wide = $state(false);
	let btn = $state<HTMLElement>();
	/** Posición del desplegable de PC (fijo, bajo el botón). */
	let at = $state({ top: 0, left: 0, width: 600, height: 640 });

	const cats = $derived(categoriesFor(st.f.kind));
	const c = $derived(categoryOf(cat));

	const ex = (id: string): InterestExample[] | undefined => st.examples[`${st.f.kind}:${id}`];
	/** Pósters por tarjeta (2026-11-24: de 3 a 6; los de la izquierda quedan bajo el fade, detrás del texto). */
	const PER_CARD = 6;
	/** Ejemplos para cada tarjeta sin repetir títulos entre tarjetas (si alcanza): `null` mientras cargan. */
	function deal(ids: string[]): (InterestExample[] | null)[] {
		const used = new Set<string>();
		return ids.map((id) => {
			const list = ex(id);
			if (!list) return null;
			const fresh = list.filter((x) => !used.has(x.title));
			const pick = [...fresh, ...list.filter((x) => used.has(x.title))].slice(0, PER_CARD);
			for (const x of pick.slice(0, 2)) used.add(x.title);
			return pick;
		});
	}
	const level1 = $derived(deal(cats.map((x) => x.all[0])));
	const level2 = $derived(c ? deal(c.subs.map((x) => x.id)) : []);
	/** Pósters del botón: los del género aplicado o el primero de cada una de las 3 primeras categorías (precargados; vacío hasta que llegan). */
	const stack = $derived(
		(applied ? (ex(applied.all[0]) ?? []).slice(0, 3) : level1.slice(0, 3).map((l) => l?.[0]))
			.map((x) => x?.poster)
			.filter((x): x is string => !!x),
	);
	/** Subgénero aplicado (marcado en el nivel 2). */
	const isApplied = (id: string) => applied?.key === c?.key && st.f.subs.includes(id);

	function place() {
		if (!btn) return;
		const r = btn.getBoundingClientRect();
		const width = Math.min(600, innerWidth - 32);
		const height = Math.min(640, innerHeight - 32);
		// Bajo el botón; si no entra, sube lo justo para que quede entero en pantalla.
		const top = Math.max(16, Math.min(r.bottom + 8, innerHeight - height - 16));
		at = { top, left: Math.max(16, Math.min(r.left, innerWidth - width - 16)), width, height };
	}
	function show() {
		wide = matchMedia('(min-width: 760px)').matches;
		cat = applied?.key ?? null;
		level = applied && st.f.subs.length ? 2 : 1;
		backwards = false;
		place();
		open = true;
		void store.loadExamples(st.f.kind, cats.map((x) => x.all[0]));
	}
	const close = () => (open = false);
	function pickAll(key: string) {
		onpick(key, []);
		close();
	}
	function enter(key: string) {
		cat = key;
		backwards = false;
		level = 2;
	}
	function back() {
		backwards = true;
		level = 1;
	}
	function pickSub(id: string) {
		if (!c) return;
		onpick(c.key, [id]);
		close();
	}
	// Pósters del collage del botón desde el arranque (2026-11-24: pedido del usuario; antes solo al abrir). `loadExamples`
	// no repite pedidos ya hechos, así que abrir el selector después no vuelve a pedir.
	$effect(() => {
		void store.loadExamples(st.f.kind, cats.map((x) => x.all[0]));
	});
	$effect(() => {
		if (open && level === 2 && c) void store.loadExamples(st.f.kind, c.subs.map((x) => x.id));
	});

	function onkey(e: KeyboardEvent) {
		if (open && e.key === 'Escape') close();
	}
	function onmove() {
		if (open && wide) place();
	}
	/** La hoja va al final de `body`: arriba de todo y fuera del encabezado pegajoso. */
	function portal(node: HTMLElement) {
		document.body.appendChild(node);
		return { destroy: () => node.remove() };
	}
	onDestroy(() => (open = false));
</script>

<svelte:window onkeydown={onkey} onresize={onmove} onscrollcapture={onmove} />

<div class="pick-row">
	<button bind:this={btn} id="cat-genre" type="button" class="trigger nu-lift" class:on={!!applied} aria-haspopup="dialog" aria-expanded={open} onclick={show}>
		<span class="stack" aria-hidden="true">
			{#each stack as src (src)}
				<span class="mini" style:background-image="url('{src}')"></span>
			{:else}
				<span class="mini art" style:--h={applied ? genreArt(applied.art).hue : null}>
					{#if applied}<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">{@html genreArt(applied.art).svg}</svg>{:else}<Icon name="tag" size={16} />{/if}
				</span>
			{/each}
		</span>
		<span class="lbl">{applied?.label ?? subText}{#if applied}<em>{subText}</em>{/if}</span>
		<span class="chev"><Icon name="chev" size={16} /></span>
	</button>
	{#if applied}
		<button id="cat-genre-clear" type="button" class="clear" aria-label={t('Sacar el género')} onclick={() => onpick(null, [])}><Icon name="close" size={14} /></button>
	{/if}
</div>

{#snippet posters(list: InterestExample[] | null)}
	<span class="col" aria-hidden="true">
		{#each list ?? Array(PER_CARD).fill(null) as x, i (i)}
			<span class="p" class:ghost={!x?.poster} style:background-image={x?.poster ? `url('${x.poster}')` : null}></span>
		{/each}
	</span>
{/snippet}

{#snippet art(list: InterestExample[] | null)}
	<!-- Fondo de toda la tarjeta: el primer póster ampliado y desenfocado + los pósters a la derecha, bajo el fade a negro. -->
	<span class="art" aria-hidden="true">
		<span class="bg" style:background-image={list?.[0]?.poster ? `url('${list[0].poster}')` : null}></span>
		{@render posters(list)}
	</span>
{/snippet}

{#snippet genres()}
	<div class="list">
		{#each cats as g, k (g.key)}
			{@const list = level1[k] ?? null}
			{@const all = applied?.key === g.key && !st.f.subs.length}
			<div class="card g-card" class:cur={applied?.key === g.key} style:--h={genreArt(g.art).hue} style:--k={k}>
				{@render art(list)}
				<!-- Toda la tarjeta elige subgénero; los botones de la derecha van encima. -->
				<button id="genre-{g.key}" type="button" class="g-head" aria-label="{g.label}: {t('Elegir subgénero')}" onclick={() => enter(g.key)}>
					<span class="gic"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{@html genreArt(g.art).svg}</svg></span>
					<span class="fr">
						<b>{g.label}</b>
						{#if list?.[0]}<span class="ex">{list[0].title}</span>{/if}
					</span>
				</button>
				<div class="acts">
					<button id="genre-{g.key}-all" type="button" class="act nu-solid" class:cur={all} aria-label={t('Todo {g}', { g: g.label })} onclick={() => pickAll(g.key)}>{#if all}<Icon name="check" size={13} />{/if}{t('Todos')}</button>
					<span class="go" aria-hidden="true"><Icon name="next" size={16} /></span>
				</div>
			</div>
		{/each}
	</div>
{/snippet}

{#snippet subs(g: Category)}
	<div class="list">
		{#each g.subs as s, k (s.id)}
			{@const on = isApplied(s.id)}
			{@const list = level2[k] ?? null}
			<button id="sub-{s.id}" type="button" class="card s-tile" class:on aria-pressed={on} style:--k={k} onclick={() => pickSub(s.id)}>
				{@render art(list)}
				<span class="fr">
					<b>{s.label}</b>
					<span class="d">{s.desc}</span>
					{#if list?.[0]}<span class="ex">{list[0].title}</span>{/if}
				</span>
			</button>
		{/each}
	</div>
{/snippet}

{#if open}
	<div use:portal class="layer" class:wide>
		<button id="genre-backdrop" type="button" class="scrim" aria-label={t('Cerrar')} onclick={close}></button>
		<div id="genre-sheet" class={wide ? 'menu panel' : 'sheet panel'} role="dialog" aria-modal="true" aria-label={c && level === 2 ? c.label : t('Géneros')} style:top={wide ? `${at.top}px` : null} style:left={wide ? `${at.left}px` : null} style:width={wide ? `${at.width}px` : null} style:height={wide ? `${at.height}px` : null}>
			{#if !wide}<div class="grab" aria-hidden="true"></div>{/if}
			<div class="hd">
				{#if level === 2}
					<span class="nu-ring"><button id="genre-back" type="button" class="round nu-round" aria-label={t('Volver a los géneros')} onclick={back}><Icon name="back" size={18} /></button></span>
				{/if}
				<h3>{c && level === 2 ? c.label : t('Géneros')}</h3>
				<span class="nu-ring"><button id="genre-close" type="button" class="round nu-round" aria-label={t('Cerrar')} onclick={close}><Icon name="close" size={16} /></button></span>
			</div>
			{#key level}
				<div class="pane" class:enter={!backwards} class:back={backwards}>
					{#if level === 2 && c}{@render subs(c)}{:else}{@render genres()}{/if}
				</div>
			{/key}
		</div>
	</div>
{/if}

<style>
	/* ── Botón: pastilla elevada como las demás de los filtros (C1 2026-11-27, `.nu-lift`): pósters apilados + rótulo + chevron ── */
	/* `min-width: 0`: en la fila de pastillas se achica (el rótulo se corta con …) en vez de desbordar. */
	.pick-row { display: flex; flex: none; align-items: center; gap: 4px; min-width: 0; }
	.trigger { display: inline-flex; align-items: center; gap: 8px; min-width: 0; max-width: 100%; height: 40px; padding: 0 12px 0 10px; border-radius: var(--nu-radius); font: inherit; font-size: 13px; font-weight: 600; white-space: nowrap; cursor: pointer; -webkit-tap-highlight-color: transparent; }
	/* Con género aplicado: el filo del elegido sobre la sombra del elevado (sin azul). */
	.trigger.on { box-shadow: var(--nu-on-edge), var(--nu-raise); }
	.stack { display: flex; flex: none; }
	.mini { flex: none; width: 20px; height: 26px; margin-left: -8px; border-radius: 4px; background: var(--nu-bg) center / cover; box-shadow: 0 0 0 1.5px #232428; }
	.mini:first-child { margin-left: 0; }
	.mini.art { display: grid; place-items: center; width: 26px; color: oklch(0.74 0.14 var(--h, 250)); }
	/* Un renglón: "Todos los géneros", o el género con su subgénero al lado en gris. */
	.lbl { min-width: 0; overflow: hidden; text-align: left; text-overflow: ellipsis; white-space: nowrap; }
	.lbl em { margin-left: 6px; font-style: normal; font-weight: 500; color: var(--muted); }
	.chev { display: flex; flex: none; color: var(--muted); }
	.clear { display: grid; place-items: center; width: 32px; height: 32px; flex: none; border: 0; border-radius: 50%; background: none; color: var(--muted); }
	.trigger:focus-visible, .clear:focus-visible { outline: 2px solid var(--accent-fg); outline-offset: 2px; }
	@media (hover: hover) { .clear:hover { color: var(--text); } }

	/* ── Capa: velo + hoja (celu) o desplegable (PC); mismo contenido ── */
	.layer { position: fixed; inset: 0; z-index: 60; }
	.scrim { position: absolute; inset: 0; border: 0; padding: 0; background: rgb(0 0 0 / 0.35); cursor: default; animation: fade 0.3s var(--out); }
	.wide .scrim { background: rgb(0 0 0 / 0.25); }
	/* Superficie neumórfica carbón que flota (--nu-float, variante B 2026-11-27): las tarjetas salen elevadas de ella. */
	.panel { display: flex; flex-direction: column; color: var(--text); background: var(--nu-tile), var(--nu-bg); box-shadow: var(--nu-float); }
	.sheet { position: absolute; left: 0; right: 0; bottom: 0; max-height: 92dvh; border-radius: 26px 26px 0 0; padding-bottom: var(--safe-bottom, 0px); animation: sheet-in 0.55s var(--out); }
	.menu { position: absolute; overflow: hidden; border-radius: 22px; animation: menu-in 0.4s var(--out); transform-origin: 40px 0; }
	.grab { flex: none; width: 38px; height: 5px; margin: 8px auto 4px; border-radius: 3px; background: rgb(255 255 255 / 0.3); }
	.hd { display: flex; align-items: center; gap: 12px; padding: 6px 16px 14px; }
	.menu .hd { padding: 18px 18px 14px; }
	.hd h3 { flex: 1; margin: 0; font-size: 20px; font-weight: 750; letter-spacing: -0.02em; }
	/* Cerrar y volver: botón redondo neu (`.nu-round`) en su aro hundido (`.nu-ring`). */
	.round { width: 36px; height: 36px; }
	.round :global(svg) { display: block; }
	.pane { flex: 1; min-height: 0; overflow-y: auto; overscroll-behavior: contain; scrollbar-width: none; padding: 6px 16px 24px; }
	.pane::-webkit-scrollbar { display: none; }
	.pane.enter { animation: push-in 0.5s var(--out); }
	.pane.back { animation: pop-in 0.5s var(--out); }

	/* ── Tarjetas (una por fila): tiles elevados (--nu-raise) con pósters a la derecha y fade a oscuro de izquierda a derecha ── */
	.list { display: grid; grid-template-columns: minmax(0, 1fr); gap: 12px; }
	.card { position: relative; isolation: isolate; display: block; width: 100%; border: 0; border-radius: var(--nu-radius); background: var(--nu-bg); color: #fff; text-align: left; box-shadow: var(--nu-raise); -webkit-tap-highlight-color: transparent; animation: tile-in 0.6s var(--out) both; animation-delay: calc(var(--k) * 40ms); transition: box-shadow 0.25s var(--out), transform 0.25s var(--out), scale 0.2s var(--out); }
	/* Hover: el tile sube (la sombra crece). */
	@media (hover: hover) { .card:hover { box-shadow: var(--nu-raise-hover); transform: translateY(-1px); } }
	.card:focus-visible, .g-head:focus-visible, .act:focus-visible, .round:focus-visible { outline: 2px solid var(--accent-fg); outline-offset: 2px; }
	.art { position: absolute; inset: 0; z-index: -1; isolation: isolate; overflow: hidden; border-radius: inherit; }
	/* Fondo de pósters con fade a oscuro de izquierda a derecha (la variante lateral de --fade-dark); el tile no le pone nada encima. */
	.art::after { content: ''; position: absolute; inset: 0; z-index: 2; background: linear-gradient(to right, #000 0%, rgb(0 0 0 / 0.95) 40%, rgb(0 0 0 / 0.75) 65%, rgb(0 0 0 / 0.4) 100%); }
	.bg { position: absolute; inset: -12px; z-index: 0; background: #121315 center 30% / cover; filter: blur(6px) saturate(1.2); }
	.col { position: absolute; top: -8px; bottom: -8px; right: 8px; z-index: 3; display: flex; flex-direction: row-reverse; align-items: center; gap: 6px; transform: rotate(-5deg); }
	.p { flex: none; width: 52px; aspect-ratio: 2 / 3; border-radius: 7px; background: var(--nu-bg) center / cover; box-shadow: 0 6px 16px rgb(0 0 0 / 0.45), inset 0 0 0 0.5px rgb(255 255 255 / 0.1); animation: deal 0.7s cubic-bezier(0.34, 1.56, 0.64, 1) both, drift 9s ease-in-out 1s infinite alternate; animation-delay: calc(var(--k) * 40ms + 200ms), 0s; }
	.p:nth-child(even) { margin-top: 18px; }
	.p.ghost { background: linear-gradient(160deg, #26272b, #18191c); }
	/* Pósters por encima del fade (2026-11-24: se veían apagados), con su propio fundido hacia el texto. */
	.col { mask-image: linear-gradient(to left, #000 0%, #000 55%, rgb(0 0 0 / 0.35) 80%, transparent 100%); }
	.fr { display: flex; flex-direction: column; min-width: 0; max-width: 68%; }
	.wide .fr { max-width: 76%; }
	.fr b { display: block; overflow: hidden; font-size: 17px; font-weight: 800; letter-spacing: -0.02em; line-height: 1.15; white-space: nowrap; text-overflow: ellipsis; }
	.fr .d { display: block; overflow: hidden; margin-top: 3px; font-size: 12px; line-height: 1.3; color: rgb(255 255 255 / 0.6); white-space: nowrap; text-overflow: ellipsis; }
	.fr .ex { display: block; overflow: hidden; margin-top: 4px; font-size: 11.5px; font-weight: 600; line-height: 1.35; color: rgb(255 255 255 / 0.72); white-space: nowrap; text-overflow: ellipsis; }

	/* Nivel 1: género; "Todos" (sólido ámbar) y la flecha a la derecha, sobre los pósters. */
	.g-card { padding: 0; }
	/* Género aplicado: filo de luz sobre el elevado (sin azul). */
	.g-card.cur { box-shadow: var(--nu-on-edge), var(--nu-raise); }
	.g-head { display: flex; align-items: center; gap: 12px; width: 100%; min-height: 72px; padding: 11px 14px; border: 0; border-radius: inherit; background: none; color: inherit; text-align: left; }
	.g-head:active { scale: 0.99; }
	.g-head .fr { flex: 1; max-width: none; padding-right: 104px; }
	/* Ícono en un pozo hundido; el color del género queda en el trazo. */
	.gic { display: grid; place-items: center; width: 36px; height: 36px; flex: none; border-radius: var(--r-md); background: var(--nu-well); box-shadow: var(--nu-press-sm); color: oklch(0.8 0.14 var(--h)); }
	/* Tocar la tarjeta = elegir subgénero (flecha a la derecha); "Todos" = el género entero (primario sólido ámbar, `.nu-solid`). */
	.acts { position: absolute; top: 50%; right: 10px; z-index: 1; display: flex; align-items: center; gap: 6px; translate: 0 -50%; pointer-events: none; }
	.act { gap: 4px; height: 32px; padding: 0 12px; font-size: 12.5px; white-space: nowrap; pointer-events: auto; }
	.go { display: grid; place-items: center; width: 24px; height: 24px; color: rgb(255 255 255 / 0.7); }
	@media (hover: hover) { .g-card:hover .go { color: #fff; } }

	/* Nivel 2: subgénero (uno solo: tocar aplica y cierra); el aplicado lleva el filo de luz. */
	.s-tile { display: flex; flex-direction: column; width: auto; height: 84px; padding: 11px 14px; }
	.s-tile:active { box-shadow: var(--nu-press); scale: 0.99; }
	.s-tile.on { box-shadow: var(--nu-on-edge), var(--nu-raise); }

	@keyframes fade { from { opacity: 0; } }
	@keyframes sheet-in { from { transform: translateY(100%); } }
	@keyframes menu-in { from { opacity: 0; transform: scale(0.96) translateY(-8px); } }
	@keyframes push-in { from { transform: translateX(40%); opacity: 0; } }
	@keyframes pop-in { from { transform: translateX(-25%); opacity: 0; } }
	@keyframes deal { from { transform: translateY(30px) rotate(8deg) scale(0.8); opacity: 0; } }
	@keyframes drift { to { transform: translateY(-14px); } }
	@keyframes tile-in { from { opacity: 0; transform: translateY(16px) scale(0.96); } }
	</style>
