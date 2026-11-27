<script lang="ts">
	// "Tendencias": la única fila de "Novedades" en la home, debajo de "Vistos recientemente" (variante D de
	// docs/mockups/novedades/index.html): ranking numerado con el número grande detrás del póster. Tocar abre la ficha.
	// Antes, en el mismo rail, el grupo "Novedades" (variante A de docs/mockups/novedades/card.html): una card con el
	// abanico de las últimas novedades que abre el diálogo; sin novedades no sale.
	import Icon from '../components/Icon.svelte';
	import { t } from '../i18n/runtime.ts';
	import type { NewsItem } from './news.ts';
	import { compactVotes, newsCountText, ratingText } from './news-ui.ts';

	interface Props {
		items: NewsItem[];
		onopen: (item: NewsItem) => void;
		/** Novedades (`NewsList.fresh`): con alguna, va la card antes de Tendencias. */
		fresh?: NewsItem[];
		/** Abre el diálogo de Novedades. */
		onnews?: () => void;
	}
	let { items, onopen, fresh = [], onnews }: Props = $props();
	/** Abanico: hasta 4 pósters de las más recientes, de atrás (la 4ª) hacia adelante (la 1ª). */
	const fan = $derived(fresh.filter((i) => i.poster).slice(0, 4).reverse());
	const newsCount = $derived(newsCountText(fresh));

	/** Escritorio: la fila no entra entera; hay más hacia ese lado (flechas y fundidos). */
	let rail = $state<HTMLDivElement | null>(null);
	let more = $state({ left: false, right: false });

	function measure() {
		if (!rail) return;
		more = { left: rail.scrollLeft > 4, right: rail.scrollLeft + rail.clientWidth < rail.scrollWidth - 4 };
	}
	$effect(() => {
		if (!rail) return;
		void items.length;
		void fresh.length;
		measure();
		const resize = new ResizeObserver(measure);
		resize.observe(rail);
		return () => resize.disconnect();
	});
	function page(dir: 1 | -1) {
		if (!rail) return;
		const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;
		rail.scrollBy({ left: dir * (rail.clientWidth - 64), behavior: calm ? 'auto' : 'smooth' });
	}
</script>

<section id="trending-row" class="trend" aria-labelledby={items.length ? 'trending-h' : 'news-h'}>
	<div class="railwrap" class:more-l={more.left} class:more-r={more.right}>
		<div class="rail" bind:this={rail} onscroll={measure}>
			{#if fresh.length && onnews}
				<div class="grp">
					<h2 id="news-h">{t('Novedades')}</h2>
					<button id="news-card" type="button" class="nc" aria-haspopup="dialog" aria-label={t('Novedades: {c}. Abre la ventana de novedades', { c: newsCount })} onclick={onnews}>
						<span class="box">
							<span class="stack">
								{#each fan as it (it.imdb)}<span class="card-p"><img src={it.poster} alt="" draggable="false" /></span>{/each}
							</span>
						</span>
						<span class="cnt">{newsCount}</span>
					</button>
				</div>
			{/if}
			{#if items.length}
			<div class="grp">
			<h2 id="trending-h">{t('Tendencias')}</h2>
			<div class="grp-items">
			{#each items as it, i (it.imdb)}
				{@const rating = ratingText(it)}
				<button id="trending-{it.imdb}" type="button" class="rk" class:wide={i >= 9} style:--i={i} aria-label={t('Puesto {n}: {t}', { n: i + 1, t: it.title })} onclick={() => onopen(it)}>
					<span class="num" aria-hidden="true">{i + 1}</span>
					<span class="in">
						<span class="pst">
							{#if it.poster}<img src={it.poster} alt="" loading="lazy" draggable="false" />{:else}<span class="pt">{it.title}</span>{/if}
						</span>
						<span class="m">
							<span class="mt">{it.title}</span>
							<span class="ms">
								{#if it.year}<span>{it.year}</span>{/if}
								{#if rating}<span class="rt"><Icon name="star" size={11} />{rating}</span>{/if}
								{#if it.imdbVotes}<span class="vt">{compactVotes(it.imdbVotes)}</span>{/if}
							</span>
						</span>
					</span>
				</button>
			{/each}
			</div>
			</div>
			{/if}
		</div>
		{#if more.left}<button id="trending-prev" type="button" class="nav prev" aria-label={t('Anteriores')} onclick={() => page(-1)}><Icon name="back" size={18} /></button>{/if}
		{#if more.right}<button id="trending-next" type="button" class="nav next" aria-label={t('Siguientes')} onclick={() => page(1)}><Icon name="back" size={18} /></button>{/if}
	</div>
</section>

<style>
	.trend { margin: 2px 0 18px; }
	.trend h2 { margin: 0 0 8px; font-size: 15px; font-weight: 700; }
	.railwrap { position: relative; margin: -12px -16px -18px; }
	.rail { display: flex; align-items: flex-start; gap: 12px; padding: 14px 16px 24px; overflow-x: auto; overscroll-behavior-x: contain; scroll-snap-type: x proximity; scroll-padding-inline: 16px; scrollbar-width: none; }
	.rail::-webkit-scrollbar { display: none; }
	/* Grupos del rail: "Novedades" (la card) y "Tendencias", cada uno con su título encima. */
	.grp { flex: none; display: flex; flex-direction: column; }
	.grp h2 { margin: 0 0 8px; }
	.grp-items { display: flex; align-items: flex-start; gap: 12px; }
	/* Card "Novedades" (variante A): mismo alto que los pósters (104×156 / 132×198), abanico de pósters y expandir arriba
	   a la derecha. Relieve neumórfico; en hover sube y se aclara la luz (nada de azul sólido). El margen la separa del "1". */
	.nc { --ph: 156px; flex: none; display: block; width: 132px; margin-right: 6px; padding: 0; border: 0; background: none; color: var(--text); font: inherit; text-align: left; cursor: pointer; scroll-snap-align: start; -webkit-tap-highlight-color: transparent; animation: rise 0.45s var(--out) both; }
	@media (min-width: 760px) { .nc { --ph: 198px; width: 168px; } }
	.nc:focus-visible { outline: 2px solid var(--accent-fg); outline-offset: 3px; border-radius: var(--r-card); }
	.box { position: relative; display: block; height: var(--ph); border-radius: var(--r-card); overflow: visible; isolation: isolate; background: none; transition: transform 0.25s var(--out), box-shadow 0.35s var(--out), background-color 0.35s; }
	.stack { position: absolute; inset: 0; }
	.card-p { position: absolute; left: 19%; bottom: 4%; width: 62%; aspect-ratio: 2 / 3; border-radius: 7px; overflow: hidden; background: var(--surface-3); box-shadow: 0 6px 16px rgb(0 0 0 / 0.55); transform-origin: 50% 110%; transition: transform 0.45s var(--out); }
	.card-p img { width: 100%; height: 100%; object-fit: cover; }
	.card-p:nth-child(1) { transform: rotate(-9deg); }
	.card-p:nth-child(2) { transform: rotate(-3deg); }
	.card-p:nth-child(3) { transform: rotate(3deg); }
	.card-p:nth-child(4) { transform: rotate(9deg); }
	.cnt { display: block; padding: 7px 2px 0; font-size: 12px; font-weight: 600; color: var(--muted); font-variant-numeric: tabular-nums; }
	@media (hover: hover) {
		.nc:hover .box { transform: translateY(-3px); }
		.nc:hover .card-p:nth-child(1) { transform: rotate(-14deg) translateY(-4%); }
		.nc:hover .card-p:nth-child(2) { transform: rotate(-5deg) translateY(-7%); }
		.nc:hover .card-p:nth-child(3) { transform: rotate(5deg) translateY(-7%); }
		.nc:hover .card-p:nth-child(4) { transform: rotate(14deg) translateY(-4%); }
	}
	.nc:active .box { transform: scale(0.98); }
	.rk { flex: none; display: flex; align-items: flex-start; padding: 0; border: 0; background: none; color: var(--text); font: inherit; text-align: left; cursor: pointer; scroll-snap-align: start; animation: rise 0.45s var(--out) both; animation-delay: calc(min(var(--i), 8) * 40ms); }
	.rk:focus-visible { outline: 2px solid var(--accent-fg); outline-offset: 3px; border-radius: var(--r-md); }
	/* El número detrás, hueco (solo el trazo), asomando por la izquierda del póster. */
	.num { flex: none; display: flex; align-items: flex-end; justify-content: flex-end; width: 46px; height: 156px; margin-right: -10px; font-size: 84px; font-weight: 800; line-height: 0.74; letter-spacing: -0.04em; color: var(--bg); -webkit-text-stroke: 4px var(--track); paint-order: stroke fill; font-variant-numeric: tabular-nums; }
	.wide .num { width: 64px; }
	.in { position: relative; z-index: 1; width: 104px; }
	@media (min-width: 760px) {
		.num { width: 58px; height: 198px; margin-right: -14px; font-size: 112px; }
		.wide .num { width: 82px; }
		.in { width: 132px; }
	}
	.pst { position: relative; display: block; aspect-ratio: 2 / 3; border-radius: var(--r-md); overflow: hidden; background: var(--surface-2); box-shadow: 0 1px 3px var(--shadow); transition: transform 0.25s var(--out), box-shadow 0.25s var(--out); }
	.pst img { width: 100%; height: 100%; object-fit: cover; }
	.pt { position: absolute; inset: 0; display: grid; place-items: center; padding: 10px; font-size: 13px; font-weight: 700; text-align: center; color: var(--muted); }
	@media (hover: hover) { .rk:hover .pst { transform: translateY(-3px); box-shadow: 0 10px 22px rgb(0 0 0 / 0.5); } }
	.rk:active .pst { transform: scale(0.98); }
	.m { display: flex; flex-direction: column; gap: 1px; padding: 7px 2px 0; }
	.mt { overflow: hidden; font-size: 13px; font-weight: 600; white-space: nowrap; text-overflow: ellipsis; }
	.ms { display: flex; align-items: center; gap: 5px; font-size: 12px; color: var(--muted); white-space: nowrap; font-variant-numeric: tabular-nums; }
	.rt { display: inline-flex; align-items: center; gap: 3px; color: var(--yellow); font-weight: 650; }
	.vt { color: var(--dim); }
	.nav { display: none; }
	@media (min-width: 760px) and (hover: hover) and (pointer: fine) {
		.railwrap::before, .railwrap::after { content: ''; position: absolute; top: 0; bottom: 0; z-index: 2; width: 72px; pointer-events: none; opacity: 0; transition: opacity 0.2s; }
		.railwrap::before { left: 0; background: linear-gradient(90deg, var(--bg), transparent); }
		.railwrap::after { right: 0; background: linear-gradient(270deg, var(--bg), transparent); }
		.more-l::before, .more-r::after { opacity: 1; }
		.nav { position: absolute; top: 108px; z-index: 3; display: grid; place-items: center; width: 34px; height: 34px; padding: 0; border: 0; border-radius: 50%; color: var(--text); background: var(--surface); box-shadow: 0 0 0 1px var(--border), 0 3px 10px var(--shadow); transition: background 0.15s, transform 0.15s var(--out); }
		.nav:hover { background: var(--surface-2); transform: scale(1.06); }
		.nav:focus-visible { outline: 2px solid var(--accent-fg); outline-offset: 2px; }
		.prev { left: 22px; }
		.next { right: 22px; }
		.next :global(svg) { transform: scaleX(-1); }
	}
	@keyframes rise { from { opacity: 0; transform: translateY(8px); } }
	@media (prefers-reduced-motion: reduce) { .rk, .nc { animation: none; } .pst, .box, .card-p { transition: none; } }
</style>
