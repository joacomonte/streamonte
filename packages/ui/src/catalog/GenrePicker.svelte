<script lang="ts">
	// Géneros del catálogo (2026-11-23, variante B3 de docs/mockups/generos-anidados): un botón que abre una hoja de vidrio
	// abajo (celu) o un desplegable grande (PC). Nivel 1: baldosas de género con collage de pósters. Nivel 2: los subgéneros
	// del elegido, con explicación y dos ejemplos populares; "Todos" es una baldosa más. Se elige un género por vez y dentro
	// uno, varios o todos los subgéneros; "Listo" aplica. En PC: géneros a la izquierda y subgéneros a la derecha.
	// Ejemplos (títulos y pósters de IMDb): `store.loadExamples`. Géneros y subgéneros: `subgenres.ts`.
	import { onDestroy } from 'svelte';
	import Icon from '../components/Icon.svelte';
	import { t } from '../i18n/runtime.ts';
	import type { InterestExample } from '../types.ts';
	import { ALL_ART, genreArt } from './genre-art.ts';
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
	/** Hasta 2 subgéneros con nombre; con más, el primero y el resto en un círculo ("Terror · Psicológico (+8)"). */
	const SHOWN = 2;
	const shownSubs = $derived(appliedSubs.length > SHOWN ? appliedSubs.slice(0, 1) : appliedSubs);
	const moreSubs = $derived(appliedSubs.length - shownSubs.length);
	/** Texto del botón: "Terror" o "Terror · Folk, Slasher". */
	const appliedText = $derived(applied ? [applied.label, shownSubs.join(', ')].filter(Boolean).join(' · ') : '');

	let open = $state(false);
	/** Género que se está mirando (el aplicado al abrir) y sus subgéneros marcados (borrador hasta "Listo"). */
	let cat = $state<string | null>(null);
	let sel = $state<string[]>([]);
	/** Celu: 1 = géneros, 2 = subgéneros. */
	let level = $state<1 | 2>(1);
	/** Cambió de nivel hacia atrás (la animación entra desde la izquierda). */
	let backwards = $state(false);
	let wide = $state(false);
	let btn = $state<HTMLElement>();
	/** Posición del desplegable de PC (fijo, bajo el botón). */
	let at = $state({ top: 0, left: 0, width: 820, height: 600 });
	const tiles: Record<string, HTMLElement> = {};

	const cats = $derived(categoriesFor(st.f.kind));
	const c = $derived(categoryOf(cat));
	const mark = $derived(!c ? 'none' : sel.length === c.subs.length ? 'all' : sel.length ? 'part' : 'none');

	const ex = (id: string): InterestExample[] | undefined => st.examples[`${st.f.kind}:${id}`];
	/** Ejemplos para cada baldosa sin repetir títulos entre baldosas (si alcanza): `null` mientras cargan. */
	function deal(ids: string[]): (InterestExample[] | null)[] {
		const used = new Set<string>();
		return ids.map((id) => {
			const list = ex(id);
			if (!list) return null;
			const fresh = list.filter((x) => !used.has(x.title));
			const pick = [...fresh, ...list.filter((x) => used.has(x.title))].slice(0, 3);
			for (const x of pick.slice(0, 2)) used.add(x.title);
			return pick;
		});
	}
	const level1 = $derived(deal(cats.map((x) => x.all[0])));
	const level2 = $derived(c ? deal([c.all[0], ...c.subs.map((x) => x.id)]) : []);

	function place() {
		if (!btn) return;
		const r = btn.getBoundingClientRect();
		const width = Math.min(860, innerWidth - 32);
		const height = Math.min(600, innerHeight - 32);
		// Bajo el botón; si no entra, sube lo justo para que quede entero en pantalla.
		const top = Math.max(16, Math.min(r.bottom + 8, innerHeight - height - 16));
		at = { top, left: Math.max(16, Math.min(r.left, innerWidth - width - 16)), width, height };
	}
	function show() {
		wide = matchMedia('(min-width: 760px)').matches;
		cat = applied?.key ?? (wide ? cats[0]?.key ?? null : null);
		const now = categoryOf(cat);
		sel = now ? (applied && st.f.subs.length ? [...st.f.subs] : now.subs.map((x) => x.id)) : [];
		level = applied ? 2 : 1;
		backwards = false;
		place();
		open = true;
		void store.loadExamples(st.f.kind, cats.map((x) => x.all[0]));
	}
	const close = () => (open = false);
	function enter(key: string) {
		const next = categoryOf(key);
		if (!next) return;
		cat = key;
		sel = key === applied?.key && st.f.subs.length ? [...st.f.subs] : next.subs.map((x) => x.id);
		backwards = false;
		level = 2;
	}
	$effect(() => {
		if (open && c) void store.loadExamples(st.f.kind, [c.all[0], ...c.subs.map((x) => x.id)]);
	});

	/** Rebote al elegir (con tilde que salta) o hundida al sacar; `w`: demora, para la ola de "Todos". */
	function fx(id: string, kind: 'pick' | 'drop', w = 0) {
		const el = tiles[id];
		if (!el) return;
		el.classList.remove('pick', 'drop');
		void el.offsetWidth;
		el.style.setProperty('--w', `${w}ms`);
		el.classList.add(kind);
	}
	function toggle(id: string) {
		if (!c) return;
		const on = !sel.includes(id);
		sel = c.subs.map((x) => x.id).filter((x) => (x === id ? on : sel.includes(x)));
		fx(id, on ? 'pick' : 'drop');
		fx('all', mark === 'none' ? 'drop' : 'pick');
	}
	function toggleAll() {
		if (!c) return;
		const prev = sel;
		sel = mark === 'all' ? [] : c.subs.map((x) => x.id);
		let wave = 0;
		for (const x of c.subs) if (prev.includes(x.id) !== sel.includes(x.id)) fx(x.id, sel.includes(x.id) ? 'pick' : 'drop', wave++ * 45);
		fx('all', mark === 'none' ? 'drop' : 'pick');
	}
	function done() {
		if (!c || mark === 'none') return;
		onpick(c.key, mark === 'all' ? [] : sel);
		close();
	}

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
	<button bind:this={btn} id="cat-genre" type="button" class="trigger" class:on={!!applied} aria-haspopup="dialog" aria-expanded={open} onclick={show}>
		{#if applied}
			<span class="art" style:--h={genreArt(applied.art).hue} aria-hidden="true"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">{@html genreArt(applied.art).svg}</svg></span>
			<span class="t-text">{appliedText}</span>
			{#if moreSubs}<span id="cat-genre-more" class="more" aria-label={t('{n} más', { n: moreSubs })}>+{moreSubs}</span>{/if}
		{:else}
			<Icon name="tag" size={16} /><span class="t-text">{t('Géneros')}</span>
		{/if}
		<Icon name="chev" size={14} />
	</button>
	{#if applied}
		<button id="cat-genre-clear" type="button" class="clear" aria-label={t('Sacar el género')} onclick={() => onpick(null, [])}><Icon name="close" size={14} /></button>
	{/if}
</div>

{#snippet posters(list: InterestExample[] | null)}
	<span class="col" aria-hidden="true">
		{#each list ?? [null, null, null] as x, i (i)}
			<span class="p" class:ghost={!x?.poster} style:background-image={x?.poster ? `url('${x.poster}')` : null}></span>
		{/each}
	</span>
{/snippet}

{#snippet glyph(svg: string, size = 17)}
	<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{@html svg}</svg>
{/snippet}

{#snippet genreTile(g: Category, k: number)}
	<button id="genre-{g.key}" type="button" class="tile g-tile fade-dark" style:--h={genreArt(g.art).hue} style:--k={k} onclick={() => enter(g.key)}>
		{@render posters(level1[k] ?? null)}
		<span class="ic">{@render glyph(genreArt(g.art).svg)}</span>
		<b>{g.label}</b>
	</button>
{/snippet}

{#snippet subs(g: Category)}
	{@const all = level2[0] ?? null}
	<div class="grid sub">
		<button bind:this={tiles.all} id="sub-all" type="button" class="tile s-tile fade-dark" class:part={mark === 'part'} class:off={mark === 'none'} aria-pressed={mark === 'all'} style:--k={0} onclick={toggleAll}>
			<span class="chk" aria-hidden="true"><Icon name="check" size={14} /><i class="dash"></i></span>
			{@render posters(all)}
			<span class="ic">{@render glyph(ALL_ART.svg, 16)}</span>
			<span class="fr">
				<b>{t('Todos')}</b>
				<span class="d">{mark === 'all' ? t('Todo {g}, sin filtrar', { g: g.label }) : mark === 'part' ? t('{n} de {m} elegidos', { n: sel.length, m: g.subs.length }) : t('Ninguno elegido')}</span>
				{#if all?.length}<span class="ej"><i>{t('Ej.:')}</i> {all.slice(0, 2).map((x) => x.title).join(' · ')}</span>{/if}
			</span>
		</button>
		{#each g.subs as s, k (s.id)}
			{@const on = sel.includes(s.id)}
			{@const list = level2[k + 1] ?? null}
			<button bind:this={tiles[s.id]} id="sub-{s.id}" type="button" class="tile s-tile fade-dark" class:off={!on} aria-pressed={on} style:--k={k + 1} onclick={() => toggle(s.id)}>
				<span class="chk" aria-hidden="true"><Icon name="check" size={14} /></span>
				{@render posters(list)}
				<span class="fr">
					<b>{s.label}</b>
					<span class="d">{s.desc}</span>
					{#if list?.length}<span class="ej"><i>{t('Ej.:')}</i> {list.slice(0, 2).map((x) => x.title).join(' · ')}</span>{/if}
				</span>
			</button>
		{/each}
	</div>
{/snippet}

{#snippet foot(g: Category)}
	<div class="foot">
		<button id="genre-done" type="button" class="done" disabled={mark === 'none'} onclick={done}>{t('Listo')}</button>
		<small>{mark === 'all' ? t('Todos los subgéneros') : mark === 'part' ? g.subs.filter((x) => sel.includes(x.id)).map((x) => x.label).join(', ') : t('Elegí al menos uno')}</small>
	</div>
{/snippet}

{#if open}
	<div use:portal class="layer" class:wide>
		<button id="genre-backdrop" type="button" class="scrim" aria-label={t('Cerrar')} onclick={close}></button>
		{#if wide}
			<div id="genre-sheet" class="menu glass" role="dialog" aria-modal="true" aria-label={t('Géneros')} style:top="{at.top}px" style:left="{at.left}px" style:width="{at.width}px" style:height="{at.height}px">
				<nav class="col1" aria-label={t('Géneros')}>
					{#each cats as g (g.key)}
						<button id="genre-{g.key}" type="button" class="g1" class:on={g.key === cat} style:--h={genreArt(g.art).hue} onclick={() => enter(g.key)}>
							<span class="ic">{@render glyph(genreArt(g.art).svg)}</span>{g.label}
						</button>
					{/each}
				</nav>
				<div class="col2">
					{#if c}
						{#key c.key}<div class="pane">{@render subs(c)}</div>{/key}
						{@render foot(c)}
					{/if}
				</div>
			</div>
		{:else}
			<div id="genre-sheet" class="sheet glass" role="dialog" aria-modal="true" aria-label={c && level === 2 ? c.label : t('Géneros')}>
				<div class="grab" aria-hidden="true"></div>
				<div class="hd">
					{#if level === 2}
						<button id="genre-back" type="button" class="round" aria-label={t('Volver a los géneros')} onclick={() => ((backwards = true), (level = 1))}><Icon name="back" size={18} /></button>
					{/if}
					<h3>{c && level === 2 ? c.label : t('Géneros')}</h3>
					<button id="genre-close" type="button" class="round" aria-label={t('Cerrar')} onclick={close}><Icon name="close" size={16} /></button>
				</div>
				{#key `${level}:${cat}`}
					<div class="pane" class:enter={!backwards} class:back={backwards} class:has-foot={level === 2}>
						{#if level === 2 && c}
							{@render subs(c)}
						{:else}
							<div class="grid">{#each cats as g, k (g.key)}{@render genreTile(g, k)}{/each}</div>
						{/if}
					</div>
				{/key}
				{#if level === 2 && c}{@render foot(c)}{/if}
			</div>
		{/if}
	</div>
{/if}

<style>
	/* ── Botón ── */
	.pick-row { display: flex; align-items: center; gap: 6px; margin-top: 8px; }
	.trigger { display: inline-flex; align-items: center; gap: 8px; min-width: 0; max-width: 100%; height: 38px; padding: 0 12px 0 13px; border: 0; border-radius: var(--r-pill); background: var(--surface-2); color: var(--muted); font-size: 14px; font-weight: 650; -webkit-tap-highlight-color: transparent; transition: background 0.25s var(--out), color 0.25s var(--out), scale 0.2s var(--out); }
	.trigger:active { scale: 0.96; }
	.trigger.on { color: var(--text); background: color-mix(in srgb, var(--accent) 16%, var(--surface-2)); box-shadow: inset 0 0 0 1.5px color-mix(in srgb, var(--accent-fg) 60%, transparent); }
	.t-text { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.more { flex: none; display: grid; place-items: center; min-width: 22px; height: 22px; padding: 0 6px; border-radius: 11px; background: var(--accent); color: #fff; font-size: 11.5px; font-weight: 750; font-variant-numeric: tabular-nums; animation: more-pop 0.4s cubic-bezier(0.34, 1.56, 0.64, 1); }
	@keyframes more-pop { from { transform: scale(0); } }
	.art { display: inline-flex; color: oklch(0.74 0.14 var(--h)); }
	@media (prefers-color-scheme: light) { .art { color: oklch(0.52 0.15 var(--h)); } }
	.clear { display: grid; place-items: center; width: 30px; height: 30px; flex: none; border: 0; border-radius: 50%; background: var(--surface-2); color: var(--muted); }
	.trigger:focus-visible, .clear:focus-visible { outline: 2px solid var(--accent-fg); outline-offset: 2px; }
	@media (hover: hover) { .trigger:hover, .clear:hover { color: var(--text); } }

	/* ── Capa: velo + hoja (celu) o desplegable (PC) ── */
	.layer { position: fixed; inset: 0; z-index: 60; }
	.scrim { position: absolute; inset: 0; border: 0; padding: 0; background: rgb(0 0 0 / 0.35); cursor: default; animation: fade 0.3s var(--out); }
	.wide .scrim { background: rgb(0 0 0 / 0.25); }
	/* Vidrio esmerilado (oscuro también en tema claro: las baldosas son pósters). */
	.glass { --acc: #2563eb; --acc-fg: #7ab0ff; color: #e7eaee; background: rgb(22 26 32 / 0.66); backdrop-filter: blur(28px) saturate(1.6); -webkit-backdrop-filter: blur(28px) saturate(1.6); box-shadow: 0 -20px 60px rgb(0 0 0 / 0.45), inset 0 1px 0 rgb(255 255 255 / 0.1); }
	.sheet { position: absolute; left: 0; right: 0; bottom: 0; display: flex; flex-direction: column; max-height: 92dvh; border-radius: 26px 26px 0 0; padding-bottom: var(--safe-bottom, 0px); animation: sheet-in 0.55s var(--out); }
	.grab { flex: none; width: 38px; height: 5px; margin: 8px auto 4px; border-radius: 3px; background: rgb(255 255 255 / 0.3); }
	.hd { display: flex; align-items: center; gap: 10px; padding: 4px 16px 12px; }
	.hd h3 { flex: 1; margin: 0; font-size: 20px; font-weight: 750; letter-spacing: -0.02em; }
	.round { display: grid; place-items: center; width: 34px; height: 34px; flex: none; border: 0; border-radius: 50%; background: rgb(255 255 255 / 0.1); color: inherit; }
	.pane { min-height: 0; overflow-y: auto; overscroll-behavior: contain; scrollbar-width: none; padding: 2px 16px 20px; }
	.pane::-webkit-scrollbar { display: none; }
	.pane.has-foot { padding-bottom: 104px; }
	.pane.enter { animation: push-in 0.5s var(--out); }
	.pane.back { animation: pop-in 0.5s var(--out); }

	/* PC: géneros a la izquierda, subgéneros a la derecha. */
	.menu { position: absolute; display: grid; grid-template-columns: 220px 1fr; border-radius: 22px; overflow: hidden; box-shadow: 0 30px 80px rgb(0 0 0 / 0.55), inset 0 0 0 1px rgb(255 255 255 / 0.1); animation: menu-in 0.4s var(--out); transform-origin: 40px 0; }
	.col1 { overflow-y: auto; padding: 10px; border-right: 1px solid rgb(255 255 255 / 0.08); scrollbar-width: thin; }
	.g1 { display: flex; align-items: center; gap: 10px; width: 100%; padding: 7px 10px; border: 0; border-radius: 12px; background: none; color: rgb(231 234 238 / 0.7); font-size: 14px; font-weight: 600; text-align: left; transition: background 0.2s, color 0.2s; }
	.g1 .ic { display: grid; place-items: center; width: 30px; height: 30px; flex: none; border-radius: 9px; background: color-mix(in oklch, oklch(0.7 0.14 var(--h)) 18%, rgb(255 255 255 / 0.04)); color: oklch(0.78 0.13 var(--h)); }
	.g1.on { background: rgb(255 255 255 / 0.09); color: #fff; }
	@media (hover: hover) { .g1:hover { color: #fff; } }
	.col2 { position: relative; display: flex; flex-direction: column; min-height: 0; }
	.col2 .pane { flex: 1; padding: 14px 18px 104px; animation: fade 0.35s var(--out); }
	.wide .s-tile { height: 160px; }

	/* ── Baldosas ── */
	.grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; }
	.wide .grid { grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)); }
	.tile { position: relative; isolation: isolate; display: flex; flex-direction: column; justify-content: flex-end; overflow: hidden; padding: 12px; border: 0; border-radius: 20px; background: #11151a; color: #fff; text-align: left; -webkit-tap-highlight-color: transparent; }
	.tile:focus-visible { outline: 2px solid var(--acc-fg); outline-offset: 2px; }
	.col { position: absolute; inset: 0; z-index: -2; display: flex; justify-content: flex-end; gap: 6px; padding: 10px; transform: rotate(-8deg) translate(20px, -26px) scale(1.15); }
	.p { flex: none; width: 62px; aspect-ratio: 2 / 3; border-radius: 7px; background: #1a1f27 center / cover; box-shadow: 0 6px 16px rgb(0 0 0 / 0.45), inset 0 0 0 0.5px rgb(255 255 255 / 0.1); animation: drift 9s ease-in-out infinite alternate; }
	.p:nth-child(2) { margin-top: 26px; animation-delay: -3s; }
	.p:nth-child(3) { margin-top: -10px; animation-delay: -6s; }
	.p.ghost { background: linear-gradient(160deg, #222a35, #151a21); }
	.ic { display: grid; place-items: center; width: 32px; height: 32px; margin-bottom: auto; border-radius: 10px; background: rgb(255 255 255 / 0.12); backdrop-filter: blur(8px); color: #fff; }
	.g-tile .ic { color: oklch(0.8 0.14 var(--h)); background: color-mix(in oklch, oklch(0.7 0.14 var(--h)) 22%, rgb(255 255 255 / 0.06)); }
	.tile b { font-size: 16px; font-weight: 750; }

	/* Nivel 1: fade a oscuro (.fade-dark); el color del género queda en el ícono. */
	.g-tile { height: 120px; animation: pop 0.55s var(--out) both; animation-delay: calc(var(--k) * 40ms); }
	.g-tile:active { scale: 0.97; }

	/* Nivel 2: subgéneros con fade a oscuro (sin panel de vidrio: el fade ya da el contraste); elegido = borde azul, sacado = gris y hundido. */
	.s-tile { height: 178px; padding: 8px; box-shadow: inset 0 0 0 2px var(--acc), 0 6px 22px rgb(37 99 235 / 0.22); animation: tile-in 0.7s var(--out) both; animation-delay: calc(var(--k) * 60ms + 80ms); transition: filter 0.5s var(--w, 0ms), opacity 0.5s var(--w, 0ms), scale 0.5s var(--out) var(--w, 0ms), box-shadow 0.35s; }
	.s-tile .col { transform: rotate(-6deg) translate(6px, -18px) scale(1.2); }
	.s-tile .p { width: 70px; animation: deal 0.7s cubic-bezier(0.34, 1.56, 0.64, 1) both, drift 9s ease-in-out 1s infinite alternate; animation-delay: calc(var(--k) * 60ms + 240ms), 0s; }
	.s-tile .ic { position: absolute; top: 9px; left: 9px; background: rgb(14 17 22 / 0.45); backdrop-filter: blur(10px); box-shadow: inset 0 0 0 0.5px rgb(255 255 255 / 0.2); }
	.s-tile.off { filter: grayscale(1) brightness(0.6); opacity: 0.7; scale: 0.96; box-shadow: inset 0 0 0 1px rgb(255 255 255 / 0.08); }
	.fr { display: block; padding: 4px 6px 6px; text-shadow: 0 1px 6px rgb(0 0 0 / 0.8); animation: frost-in 0.6s var(--out) both; animation-delay: calc(var(--k) * 60ms + 300ms); }
	.fr b { display: block; font-size: 15px; }
	.fr .d { display: block; margin-top: 2px; font-size: 11.5px; line-height: 1.3; color: rgb(255 255 255 / 0.8); }
	.fr .ej { display: -webkit-box; margin-top: 6px; overflow: hidden; font-size: 11px; font-weight: 600; color: #9cc4ff; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical; }
	.fr .ej i { font-style: normal; font-weight: 500; color: rgb(255 255 255 / 0.55); }
	.chk { position: absolute; top: 10px; right: 10px; display: grid; place-items: center; width: 24px; height: 24px; border-radius: 50%; background: var(--acc); color: #fff; box-shadow: 0 2px 8px rgb(37 99 235 / 0.5); transition: background 0.3s; }
	.chk :global(svg) { transition: transform 0.35s cubic-bezier(0.34, 1.56, 0.64, 1); }
	.chk .dash { position: absolute; width: 11px; height: 2.5px; border-radius: 2px; background: #fff; transform: scale(0); transition: transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1); }
	.part .chk :global(svg), .off .chk :global(svg) { transform: scale(0); }
	.part .chk .dash { transform: none; }
	.off .chk { background: rgb(14 17 22 / 0.5); box-shadow: inset 0 0 0 1.5px rgb(255 255 255 / 0.45); }
	/* Tocar: rebota y el tilde salta con un anillo azul; sacar: se hunde con un temblor. `--w`: la ola de "Todos". */
	.s-tile:global(.pick) { animation: pick 0.55s cubic-bezier(0.34, 1.56, 0.64, 1) var(--w, 0ms) both; }
	.s-tile:global(.pick) .chk { animation: chk-pop 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) var(--w, 0ms) both; }
	.s-tile:global(.pick)::after { content: ''; position: absolute; inset: 0; border-radius: inherit; box-shadow: 0 0 0 2px var(--acc); animation: ring 0.7s var(--out) var(--w, 0ms) both; pointer-events: none; }
	.s-tile:global(.drop) { animation: sink 0.5s var(--out) var(--w, 0ms) both; }
	.s-tile:global(.pick) .fr, .s-tile:global(.drop) .fr, .s-tile:global(.pick) .p, .s-tile:global(.drop) .p { animation-delay: 0s; }

	/* ── "Listo": pastilla de vidrio flotante con un brillo que pasa ── */
	.foot { position: absolute; left: 0; right: 0; bottom: 0; z-index: 3; padding: 26px 16px calc(16px + var(--safe-bottom, 0px)); background: linear-gradient(to top, rgb(14 17 22 / 0.85) 45%, transparent); pointer-events: none; }
	.wide .foot { padding-bottom: 16px; }
	.done { position: relative; overflow: hidden; display: block; width: 100%; height: 50px; border: 0; border-radius: 999px; pointer-events: auto; background: linear-gradient(180deg, rgb(255 255 255 / 0.2), rgb(255 255 255 / 0.07)), rgb(122 176 255 / 0.18); backdrop-filter: blur(18px) saturate(1.8); -webkit-backdrop-filter: blur(18px) saturate(1.8); color: #fff; font-size: 16px; font-weight: 750; letter-spacing: 0.01em; box-shadow: inset 0 1px 0 rgb(255 255 255 / 0.35), inset 0 0 0 1px rgb(255 255 255 / 0.16), 0 10px 30px rgb(37 99 235 / 0.28); transition: opacity 0.25s, scale 0.2s var(--out); }
	.done::after { content: ''; position: absolute; inset: 0; background: linear-gradient(110deg, transparent 35%, rgb(255 255 255 / 0.22) 50%, transparent 65%); transform: translateX(-120%); animation: shine 3.2s ease-in-out 1s infinite; }
	.done:active { scale: 0.97; }
	.done:disabled { opacity: 0.4; }
	.done:disabled::after { animation: none; }
	.done:focus-visible { outline: 2px solid var(--acc-fg); outline-offset: 2px; }
	.foot small { display: block; margin-top: 6px; overflow: hidden; font-size: 12px; color: rgb(231 234 238 / 0.75); text-align: center; text-overflow: ellipsis; white-space: nowrap; text-shadow: 0 1px 8px rgb(0 0 0 / 0.8); }

	@keyframes fade { from { opacity: 0; } }
	@keyframes sheet-in { from { transform: translateY(100%); } }
	@keyframes menu-in { from { opacity: 0; transform: scale(0.96) translateY(-8px); } }
	@keyframes push-in { from { transform: translateX(40%); opacity: 0; } }
	@keyframes pop-in { from { transform: translateX(-25%); opacity: 0; } }
	@keyframes pop { from { transform: scale(0.85); opacity: 0; } }
	@keyframes deal { from { transform: translateY(30px) rotate(8deg) scale(0.8); opacity: 0; } }
	@keyframes drift { to { transform: translateY(-14px); } }
	@keyframes tile-in { from { opacity: 0; transform: translateY(22px) scale(0.9) rotate(-2deg); filter: blur(8px); } }
	@keyframes frost-in { from { opacity: 0; transform: translateY(10px); } }
	@keyframes pick { 0% { transform: scale(0.96); } 40% { transform: scale(1.04); } 100% { transform: none; } }
	@keyframes chk-pop { 0% { transform: scale(0) rotate(-90deg); } 60% { transform: scale(1.3) rotate(10deg); } 100% { transform: none; } }
	@keyframes ring { from { opacity: 0.9; transform: scale(1); } to { opacity: 0; transform: scale(1.08); } }
	@keyframes sink { 0% { transform: none; } 25% { transform: scale(0.95) rotate(-1.5deg); } 50% { transform: scale(0.95) rotate(1deg); } 100% { transform: none; } }
	@keyframes shine { 40%, 100% { transform: translateX(120%); } }
</style>
