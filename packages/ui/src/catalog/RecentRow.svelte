<script lang="ts">
	// "Vistos recientemente" (2026-11-23, variante D1 de docs/mockups/vistos-recientes): fila arriba de la grilla con lo
	// último que el apodo copió (web) o reprodujo (desktop), de lo más nuevo a lo más viejo. Tarjetas apaisadas con la escena
	// de fondo y un fundido oscuro desde la izquierda. Tocar una pregunta "¿Lo terminaste?": en series, Sí abre el capítulo
	// siguiente y No el mismo; en películas abre la ficha (Sí además la saca de la fila). La X ofrece "Ya lo vi" (sale como
	// terminado) o "No lo vi" (se borra), con Deshacer. Datos: `getApi().recent`; siguiente capítulo: `recent.ts`.
	import { onMount } from 'svelte';
	import Icon from '../components/Icon.svelte';
	import { getApi } from '../context.ts';
	import { t } from '../i18n/runtime.ts';
	import { nextEpisode, type EpisodeRef, type RecentItem } from './recent.ts';

	interface Props {
		/** Abrir el título (`ep`: el capítulo a abrir en series; null = la ficha). */
		onresume: (item: RecentItem, ep: EpisodeRef | null) => void;
	}
	let { onresume }: Props = $props();
	const api = getApi();

	let items = $state<RecentItem[]>([]);
	/** Tarjeta con la pregunta abierta: qué pregunta. */
	let asking = $state<{ key: string; what: 'done' | 'x' } | null>(null);
	let busy = $state<string | null>(null);
	/** Lo último que se sacó, para Deshacer. */
	let undo = $state<{ item: RecentItem; how: 'visto' | 'olvidar' } | null>(null);
	let undoTimer: ReturnType<typeof setTimeout> | undefined;
	/** Escritorio: la fila no entra entera; hay más hacia ese lado (flechas y fundidos). */
	let rail = $state<HTMLDivElement | null>(null);
	let more = $state({ left: false, right: false });

	const keyOf = (i: RecentItem) => `${i.kind}-${i.imdb}`;
	const epText = (i: RecentItem) => (i.kind === 'tv' && i.season && i.episode ? t('T{s} · E{e}', { s: i.season, e: i.episode }) : t('Película'));

	onMount(() => {
		api.recent.list().then((l) => (items = l)).catch(() => {});
		return () => clearTimeout(undoTimer);
	});

	function measure() {
		if (!rail) return;
		more = { left: rail.scrollLeft > 4, right: rail.scrollLeft + rail.clientWidth < rail.scrollWidth - 4 };
	}
	// Al cambiar la cantidad (o el ancho) se vuelve a medir; otra vez al terminar la animación de salida de la tarjeta.
	$effect(() => {
		if (!rail) return;
		void items.length;
		measure();
		const later = setTimeout(measure, 320);
		const resize = new ResizeObserver(measure);
		resize.observe(rail);
		return () => (clearTimeout(later), resize.disconnect());
	});
	/** Una "página": casi todo el ancho visible, dejando asomar la siguiente tarjeta. */
	function page(dir: 1 | -1) {
		if (!rail) return;
		const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;
		rail.scrollBy({ left: dir * (rail.clientWidth - 64), behavior: calm ? 'auto' : 'smooth' });
	}
	/** Escape, o un click/toque fuera de la tarjeta abierta, cierra la pregunta. */
	function dismiss(e: Event) {
		if (!asking) return;
		if (e instanceof KeyboardEvent ? e.key === 'Escape' : !(e.target instanceof Element && e.target.closest('.c.open'))) asking = null;
	}

	async function answer(i: RecentItem, finished: boolean) {
		asking = null;
		if (i.kind === 'movie') {
			if (finished) remove(i, 'visto', false);
			onresume(i, null);
			return;
		}
		if (!i.season || !i.episode) return onresume(i, null);
		if (!finished) return onresume(i, { season: i.season, episode: i.episode });
		busy = keyOf(i);
		const next = await api.title.details(i.kind, i.id).then((d) => nextEpisode(d.seasons, i.season ?? 0, i.episode ?? 0)).catch(() => null);
		busy = null;
		// Último capítulo de todo: la serie terminó, sale de la fila y abre la ficha.
		if (!next) remove(i, 'visto', false);
		onresume(i, next);
	}

	function remove(i: RecentItem, how: 'visto' | 'olvidar', offerUndo = true) {
		asking = null;
		items = items.filter((x) => keyOf(x) !== keyOf(i));
		void api.recent.dismiss(i.kind, i.imdb, how).catch(() => {});
		if (!offerUndo) return;
		clearTimeout(undoTimer);
		undo = { item: i, how };
		undoTimer = setTimeout(() => (undo = null), 6000);
	}
	function restore() {
		if (!undo) return;
		const { item } = undo;
		undo = null;
		clearTimeout(undoTimer);
		items = [...items, item].sort((a, b) => b.at.localeCompare(a.at));
		void api.recent.restore(item).catch(() => {});
	}
</script>

<svelte:window onkeydown={dismiss} onpointerdown={dismiss} />
{#if items.length}
	<section id="recent-row" class="recent" aria-labelledby="recent-h">
		<h2 id="recent-h">{t('Vistos recientemente')}</h2>
		<div class="railwrap" class:more-l={more.left} class:more-r={more.right}>
		<div id="recent-rail" class="rail" bind:this={rail} onscroll={measure}>
			{#each items as i (keyOf(i))}
				{@const k = keyOf(i)}
				{@const img = i.backdrop ?? i.poster}
				<div class="c" class:open={asking?.key === k} animate:slide out:leave>
					<button id="recent-{k}" type="button" class="hit" aria-label={`${i.title} · ${epText(i)}`} onclick={() => (asking = asking?.key === k ? null : { key: k, what: 'done' })}>
						<span class="art fade-side">{#if img}<img src={img} alt="" loading="lazy" draggable="false" />{/if}</span>
						<span class="tx">
							<span class="ttl">{i.title}</span>
							<span class="sub">{epText(i)}{#if busy === k}<span class="dots" aria-hidden="true">···</span>{/if}</span>
						</span>
					</button>
					<button id="recent-x-{k}" type="button" class="x" aria-label={asking?.key === k ? t('Cancelar') : t('Sacar de vistos')} onclick={() => (asking = asking?.key === k ? null : { key: k, what: 'x' })}><Icon name="close" size={14} /></button>
					{#if asking?.key === k}
						<div class="ask" role="group" aria-label={asking.what === 'x' ? t('Sacar de vistos') : t('¿Lo terminaste?')}>
							{#if asking.what === 'done'}
								<span class="q">{i.kind === 'tv' ? t('¿Terminaste el {e}?', { e: `E${i.episode}` }) : t('¿La terminaste?')}</span>
								<button id="recent-yes-{k}" type="button" class="pill go" onclick={() => answer(i, true)}>{t('Sí')}</button>
								<button id="recent-no-{k}" type="button" class="pill" onclick={() => answer(i, false)}>{t('No')}</button>
							{:else}
								<button id="recent-seen-{k}" type="button" class="pill go" onclick={() => remove(i, 'visto')}>{t('Ya lo vi')}</button>
								<button id="recent-forget-{k}" type="button" class="pill" onclick={() => remove(i, 'olvidar')}>{t('No lo vi')}</button>
							{/if}
						</div>
					{/if}
				</div>
			{/each}
		</div>
		{#if more.left}<button id="recent-prev" type="button" class="nav prev" aria-label={t('Anteriores')} onclick={() => page(-1)}><Icon name="back" size={18} /></button>{/if}
		{#if more.right}<button id="recent-next" type="button" class="nav next" aria-label={t('Siguientes')} onclick={() => page(1)}><Icon name="back" size={18} /></button>{/if}
		</div>
	</section>
{/if}
{#if undo}
	<div id="recent-toast" class="toast" role="status">
		<span>{undo.how === 'visto' ? t('{t}: marcado como visto', { t: undo.item.title }) : t('Sacaste {t}', { t: undo.item.title })}</span>
		<button id="recent-undo" type="button" onclick={restore}>{t('Deshacer')}</button>
	</div>
{/if}

<script module lang="ts">
	import { flip } from 'svelte/animate';
	/** Las demás se corren a ocupar el lugar. */
	export const slide = (node: Element, fromTo: { from: DOMRect; to: DOMRect }) => flip(node, fromTo, { duration: 280 });
	/** Sale hacia la izquierda, achicándose. */
	export const leave = (_node: Element) => ({ duration: 240, css: (u: number) => `opacity: ${u}; transform: translateX(${(1 - u) * -40}px) scale(${0.9 + u * 0.1})` });
</script>

<style>
	.recent { margin: 2px 0 14px; }
	.recent h2 { margin: 0 0 8px; font-size: 15px; font-weight: 700; }
	.railwrap { position: relative; margin: 0 -16px; }
	.rail { display: flex; gap: 8px; padding: 2px 16px 6px; overflow-x: auto; overscroll-behavior-x: contain; scroll-snap-type: x proximity; scroll-padding-inline: 16px; scrollbar-width: none; }
	.rail::-webkit-scrollbar { display: none; }
	.c { position: relative; flex: none; width: 256px; scroll-snap-align: start; animation: rise 0.45s var(--out) both; }
	@media (min-width: 760px) { .c { width: 304px; } }
	.hit { position: relative; display: block; width: 100%; height: 72px; padding: 0; border: 0; border-radius: 14px; overflow: hidden; isolation: isolate; background: #11151a; box-shadow: 0 0 0 1px var(--border), 0 3px 10px var(--shadow, rgb(0 0 0 / 0.2)); text-align: left; transition: transform 0.15s var(--out); }
	@media (min-width: 760px) { .hit { height: 84px; } }
	.hit:active { transform: scale(0.98); }
	.hit:focus-visible { outline: 2px solid var(--accent-fg); outline-offset: 2px; }
	.art { position: absolute; inset: 0; }
	.art img { width: 100%; height: 100%; object-fit: cover; object-position: 70% 30%; transition: transform 0.4s var(--out); }
	@media (hover: hover) { .hit:hover .art img { transform: scale(1.06); } }
	/* D1: fundido oscuro desde la izquierda (la variante lateral de la convención `--fade-dark`): texto legible, escena nítida a la derecha. */
	.fade-side::after { content: ''; position: absolute; inset: 0; background: linear-gradient(90deg, rgb(8 10 14 / 0.94) 0%, rgb(8 10 14 / 0.78) 38%, rgb(8 10 14 / 0.2) 72%, rgb(8 10 14 / 0.05)); }
	.tx { position: absolute; inset: 0; z-index: 2; display: flex; flex-direction: column; justify-content: center; padding: 0 44px 0 14px; color: #fff; }
	.ttl { max-width: 78%; overflow: hidden; font-size: 14px; font-weight: 700; line-height: 1.2; white-space: nowrap; text-overflow: ellipsis; text-shadow: 0 1px 8px rgb(0 0 0 / 0.45); }
	@media (min-width: 760px) { .ttl { font-size: 15px; } }
	.sub { display: flex; gap: 4px; margin-top: 3px; font-size: 12px; color: rgb(255 255 255 / 0.8); font-variant-numeric: tabular-nums; }
	.dots { animation: blink 1s infinite; }
	.x { position: absolute; top: 50%; right: 8px; z-index: 5; display: grid; place-items: center; width: 28px; height: 28px; margin-top: -14px; padding: 0; border: 0; border-radius: 50%; color: #fff; background: rgb(10 12 16 / 0.4); backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px); box-shadow: inset 0 0 0 0.5px rgb(255 255 255 / 0.22); transition: background 0.15s, transform 0.15s var(--out); }
	@media (hover: hover) { .x:hover { background: rgb(10 12 16 / 0.7); transform: scale(1.08); } }
	.x:focus-visible { outline: 2px solid var(--accent-fg); outline-offset: 2px; }
	/* La pregunta tapa la tarjeta con vidrio oscuro; la X (z-index 5) queda encima y cancela, por eso el padding derecho. */
	.ask { position: absolute; inset: 0; z-index: 4; display: flex; align-items: center; gap: 6px; padding: 0 44px 0 14px; border-radius: 14px; background: rgb(10 12 16 / 0.72); backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px); color: #fff; animation: fade 0.2s var(--out); }
	.q { flex: 1; min-width: 0; overflow: hidden; font-size: 13px; font-weight: 650; text-overflow: ellipsis; white-space: nowrap; }
	.pill { flex: none; height: 32px; padding: 0 12px; border: 0; border-radius: 999px; background: rgb(255 255 255 / 0.14); color: #fff; font-size: 13px; font-weight: 700; }
	.pill.go { background: var(--accent); }
	.pill:focus-visible { outline: 2px solid var(--accent-fg); outline-offset: 2px; }
	/* Escritorio (mouse): flechas y fundidos en los bordes cuando la fila no entra; en el celu se desliza con el dedo. */
	.nav { display: none; }
	@media (min-width: 760px) and (hover: hover) and (pointer: fine) {
		.railwrap::before, .railwrap::after { content: ''; position: absolute; top: 0; bottom: 0; z-index: 2; width: 72px; pointer-events: none; opacity: 0; transition: opacity 0.2s; }
		.railwrap::before { left: 0; background: linear-gradient(90deg, var(--bg), transparent); }
		.railwrap::after { right: 0; background: linear-gradient(270deg, var(--bg), transparent); }
		.more-l::before, .more-r::after { opacity: 1; }
		.nav { position: absolute; top: 27px; z-index: 3; display: grid; place-items: center; width: 34px; height: 34px; padding: 0; border: 0; border-radius: 50%; color: var(--text); background: var(--surface); box-shadow: 0 0 0 1px var(--border), 0 3px 10px var(--shadow); transition: background 0.15s, transform 0.15s var(--out); }
		.nav:hover { background: var(--surface-2); transform: scale(1.06); }
		.nav:focus-visible { outline: 2px solid var(--accent-fg); outline-offset: 2px; }
		.prev { left: 22px; }
		.next { right: 22px; }
		.next :global(svg) { transform: scaleX(-1); }
	}
	.toast { position: fixed; left: 50%; bottom: calc(18px + var(--safe-bottom, 0px)); z-index: 70; display: flex; align-items: center; gap: 14px; max-width: calc(100vw - 32px); padding: 10px 10px 10px 16px; border-radius: 999px; background: var(--surface-3); color: var(--text); font-size: 13.5px; box-shadow: 0 12px 30px rgb(0 0 0 / 0.35); transform: translateX(-50%); animation: toast-in 0.3s var(--out); }
	.toast span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.toast button { flex: none; height: 32px; padding: 0 14px; border: 0; border-radius: 999px; background: var(--accent); color: #fff; font-weight: 700; }
	@keyframes rise { from { opacity: 0; transform: translateY(8px); } }
	@keyframes fade { from { opacity: 0; } }
	@keyframes blink { 50% { opacity: 0.3; } }
	@keyframes toast-in { from { opacity: 0; transform: translate(-50%, 12px); } }
	@media (prefers-reduced-motion: reduce) { .c, .ask, .toast, .dots { animation: none; } }
</style>
