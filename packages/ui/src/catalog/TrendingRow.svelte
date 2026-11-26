<script lang="ts">
	// "Tendencias": la única fila de "Novedades" en la home, debajo de "Vistos recientemente" (variante D de
	// docs/mockups/novedades/index.html): ranking numerado con el número grande detrás del póster. Tocar abre la ficha.
	import Icon from '../components/Icon.svelte';
	import { t } from '../i18n/runtime.ts';
	import type { NewsItem } from './news.ts';
	import { compactVotes, ratingText } from './news-ui.ts';

	interface Props {
		items: NewsItem[];
		onopen: (item: NewsItem) => void;
	}
	let { items, onopen }: Props = $props();

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

<section id="trending-row" class="trend" aria-labelledby="trending-h">
	<h2 id="trending-h">{t('Tendencias')}</h2>
	<div class="railwrap" class:more-l={more.left} class:more-r={more.right}>
		<div class="rail" bind:this={rail} onscroll={measure}>
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
		{#if more.left}<button id="trending-prev" type="button" class="nav prev" aria-label={t('Anteriores')} onclick={() => page(-1)}><Icon name="back" size={18} /></button>{/if}
		{#if more.right}<button id="trending-next" type="button" class="nav next" aria-label={t('Siguientes')} onclick={() => page(1)}><Icon name="back" size={18} /></button>{/if}
	</div>
</section>

<style>
	.trend { margin: 2px 0 18px; }
	.trend h2 { margin: 0 0 8px; font-size: 15px; font-weight: 700; }
	.railwrap { position: relative; margin: 0 -16px; }
	.rail { display: flex; gap: 12px; padding: 2px 16px 6px; overflow-x: auto; overscroll-behavior-x: contain; scroll-snap-type: x proximity; scroll-padding-inline: 16px; scrollbar-width: none; }
	.rail::-webkit-scrollbar { display: none; }
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
		.nav { position: absolute; top: 82px; z-index: 3; display: grid; place-items: center; width: 34px; height: 34px; padding: 0; border: 0; border-radius: 50%; color: var(--text); background: var(--surface); box-shadow: 0 0 0 1px var(--border), 0 3px 10px var(--shadow); transition: background 0.15s, transform 0.15s var(--out); }
		.nav:hover { background: var(--surface-2); transform: scale(1.06); }
		.nav:focus-visible { outline: 2px solid var(--accent-fg); outline-offset: 2px; }
		.prev { left: 22px; }
		.next { right: 22px; }
		.next :global(svg) { transform: scaleX(-1); }
	}
	@keyframes rise { from { opacity: 0; transform: translateY(8px); } }
	@media (prefers-reduced-motion: reduce) { .rk { animation: none; } .pst { transition: none; } }
</style>
