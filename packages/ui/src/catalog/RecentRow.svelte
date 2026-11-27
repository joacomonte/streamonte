<script lang="ts">
	// "Vistos recientemente" (2026-11-23, variante D1 de docs/mockups/vistos-recientes): fila arriba de la grilla con lo
	// último que el apodo copió (web) o reprodujo (desktop), de lo más nuevo a lo más viejo. Tarjetas apaisadas con la escena
	// de fondo y un fundido oscuro desde la izquierda. Tocar la tarjeta (o su chevron) abre dos opciones: la primaria en series
	// es "Ver T3 · E4" (marca visto y abre el capítulo siguiente; en el final de la serie, "Ya la terminé": solo marca visto,
	// con Deshacer) y en películas "Ver de nuevo" (abre la ficha); la secundaria, "Ocultar", la borra de la fila (con
	// Deshacer). Datos: `getApi().recent`; siguiente capítulo: `recent.ts`.
	import { onMount } from 'svelte';
	import Icon from '../components/Icon.svelte';
	import { getApi } from '../context.ts';
	import { t } from '../i18n/runtime.ts';
	import { nextEpisode, RECENT_CHANGED, type EpisodeRef, type RecentItem } from './recent.ts';

	interface Props {
		/** Abrir el título (`ep`: el capítulo a abrir en series; null = la ficha). */
		onresume: (item: RecentItem, ep: EpisodeRef | null) => void;
	}
	let { onresume }: Props = $props();
	const api = getApi();

	let items = $state<RecentItem[]>([]);
	/** Tarjeta con las opciones abiertas. */
	let asking = $state<string | null>(null);
	/** Series: el capítulo siguiente de cada tarjeta (null = era el último; sin clave = cargando o no se pudo saber). */
	let nexts = $state<Record<string, EpisodeRef | null>>({});
	const pending = new Map<string, Promise<EpisodeRef | null | undefined>>();
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
		const load = () => void api.recent.list().then((l) => (items = l)).catch(() => {});
		load();
		// Desktop: al reproducir algo se avisa para recargar la fila (en la web se marca al copiar y la fila se vuelve a montar).
		document.addEventListener(RECENT_CHANGED, load);
		return () => (clearTimeout(undoTimer), document.removeEventListener(RECENT_CHANGED, load));
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

	const isEpisode = (i: RecentItem) => i.kind === 'tv' && !!i.season && !!i.episode;
	/** El capítulo que sigue (undefined si la ficha no cargó; se reintenta al volver a abrir). */
	function nextOf(i: RecentItem): Promise<EpisodeRef | null | undefined> {
		const k = keyOf(i);
		let p = pending.get(k);
		if (!p) {
			p = api.title
				.details(i.kind, i.id)
				.then((d) => (nexts[k] = nextEpisode(d.seasons, i.season ?? 0, i.episode ?? 0)))
				.catch(() => (pending.delete(k), undefined));
			pending.set(k, p);
		}
		return p;
	}
	function toggle(i: RecentItem) {
		const k = keyOf(i);
		asking = asking === k ? null : k;
		// Se pide al abrir para que la opción primaria ya diga qué capítulo abre.
		if (asking && isEpisode(i)) void nextOf(i);
	}
	/** Primera línea de la barra (diseño "4 · Barra hundida, controles elevados"): el capítulo que abre el play, sin "Ver". */
	function barText(i: RecentItem) {
		if (i.kind === 'movie') return t('Ver de nuevo');
		const k = keyOf(i);
		if (!isEpisode(i) || !(k in nexts)) return t('Ver próximo capítulo');
		const n = nexts[k];
		return n ? t('T{s} · E{e}', { s: n.season, e: n.episode }) : t('Ya la terminé');
	}
	/** Al final de la serie el play solo marca visto: ícono de tilde en vez de play. */
	const finished = (i: RecentItem) => isEpisode(i) && keyOf(i) in nexts && nexts[keyOf(i)] === null;
	function primaryText(i: RecentItem) {
		if (i.kind === 'movie') return t('Ver de nuevo');
		const k = keyOf(i);
		if (!isEpisode(i) || !(k in nexts)) return t('Ver próximo capítulo');
		const n = nexts[k];
		return n ? t('Ver T{s} · E{e}', { s: n.season, e: n.episode }) : t('Ya la terminé');
	}

	/** Primaria: en series marca visto el capítulo actual y abre el siguiente (si era el último, solo lo marca); en películas abre la ficha. */
	async function primary(i: RecentItem) {
		asking = null;
		if (!isEpisode(i)) return onresume(i, null);
		busy = keyOf(i);
		const next = await nextOf(i);
		busy = null;
		if (next === undefined) return onresume(i, null);
		if (!next) return remove(i, 'visto');
		remove(i, 'visto', false);
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
				<div class="c" class:open={asking === k} animate:slide out:leave>
					<button id="recent-{k}" type="button" class="hit" aria-label={`${i.title} · ${epText(i)}`} aria-expanded={asking === k} onclick={() => toggle(i)}>
						<span class="art fade-side">{#if img}<img src={img} alt="" loading="lazy" draggable="false" />{/if}</span>
						<span class="tx">
							<span class="ttl">{i.title}</span>
							<span class="sub">{epText(i)}{#if busy === k}<span class="dots" aria-hidden="true">···</span>{/if}</span>
						</span>
					</button>
					<button id="recent-more-{k}" type="button" class="x" class:frost={asking !== k} class:neu={asking === k} class:sq={asking === k} aria-label={asking === k ? t('Cancelar') : t('Opciones')} aria-expanded={asking === k} onclick={() => toggle(i)}>{#if asking === k}<Icon name="close" size={14} />{:else}<span class="chev"><Icon name="back" size={15} /></span>{/if}</button>
					{#if asking === k}
						<div class="ask" role="group" aria-label={t('Opciones')}>
							<button id="recent-next-{k}" type="button" class="play neu" aria-label={primaryText(i)} onclick={() => primary(i)}><Icon name={finished(i) ? 'check' : 'play'} size={22} /></button>
							<span class="bt">
								<span class="b1">{barText(i)}</span>
								<span class="b2">{i.title}</span>
							</span>
							<button id="recent-hide-{k}" type="button" class="sq neu" aria-label={t('Ocultar')} onclick={() => remove(i, 'olvidar')}><Icon name="eye-off" size={17} /></button>
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
		<button id="recent-undo" type="button" class="frost" onclick={restore}>{t('Deshacer')}</button>
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
	.railwrap { position: relative; margin: -12px -16px -18px; }
	.rail { display: flex; gap: 12px; padding: 14px 16px 24px; overflow-x: auto; overscroll-behavior-x: contain; scroll-snap-type: x proximity; scroll-padding-inline: 16px; scrollbar-width: none; }
	.rail::-webkit-scrollbar { display: none; }
	.c { position: relative; flex: none; width: 256px; scroll-snap-align: start; animation: rise 0.45s var(--out) both; }
	@media (min-width: 760px) { .c { width: 304px; } }
	.hit { position: relative; display: block; width: 100%; height: 72px; padding: 0; border: 0; border-radius: 14px; overflow: hidden; isolation: isolate; background: #080a0e; box-shadow: 0 10px 24px rgb(0 0 0 / 0.6); text-align: left; transition: transform 0.15s var(--out); }
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
	/* Botones de la tarjeta y del Deshacer: vidrio esmerilado + relieve neumórfico (la sombra de los pósters de `Grid.svelte`,
	   10/-8 px, a escala de botón), con brillo interior arriba; al presionar se hunde (sombras inset). Nada de azul sólido. */
	.frost { border: 1px solid rgb(255 255 255 / 0.22); color: #fff; background: rgb(255 255 255 / 0.15); backdrop-filter: blur(14px) saturate(1.6); -webkit-backdrop-filter: blur(14px) saturate(1.6); box-shadow: 4px 4px 10px rgb(0 0 0 / 0.85), -3px -3px 8px rgb(255 255 255 / 0.07), inset 0 1px 0 rgb(255 255 255 / 0.28); transition: background 0.15s, box-shadow 0.15s, transform 0.15s var(--out); }
	@media (hover: hover) { .frost:hover { background: rgb(255 255 255 / 0.22); } }
	.frost:active { background: rgb(255 255 255 / 0.12); box-shadow: inset 3px 3px 6px rgb(0 0 0 / 0.55), inset -2px -2px 5px rgb(255 255 255 / 0.07); transform: scale(0.97); }
	.frost:focus-visible { outline: 2px solid var(--accent-fg); outline-offset: 2px; }
	.x { position: absolute; top: 50%; right: 8px; z-index: 5; display: grid; place-items: center; width: 28px; height: 28px; margin-top: -14px; padding: 0; border-radius: 50%; }
	/* Chevron: `back` espejado (como la flecha "Siguientes"), corrido 1 px para quedar ópticamente centrado. */
	.chev { display: grid; margin-left: 1px; }
	.chev :global(svg) { transform: scaleX(-1); }
	/* Opciones abiertas (diseño "4 · Barra hundida, controles elevados"): la barra entera hundida tapa la tarjeta; a la
	   izquierda el play redondo, el texto en dos líneas y a la derecha ocultar y cerrar, cuadrados. El cerrar es el botón de la
	   tarjeta (z-index 5, encima): por eso el padding derecho. */
	.ask { position: absolute; inset: 0; z-index: 4; display: flex; align-items: center; gap: 10px; padding: 0 56px 0 10px; border-radius: 14px; background: rgb(8 10 13 / 0.94); backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px); box-shadow: inset 4px 4px 9px rgb(0 0 0 / 0.85), inset -3px -3px 7px rgb(255 255 255 / 0.07); color: #fff; animation: fade 0.2s var(--out); }
	/* Controles elevados: vidrio + relieve; hover más elevado y con más luz; al presionar se hunden (inset). */
	.neu { display: grid; place-items: center; padding: 0; border: 0; color: #fff; background: rgb(255 255 255 / 0.07); backdrop-filter: blur(14px) saturate(1.5); -webkit-backdrop-filter: blur(14px) saturate(1.5); box-shadow: 6px 6px 14px rgb(0 0 0 / 0.85), -4px -4px 10px rgb(255 255 255 / 0.07); transition: background 0.15s, box-shadow 0.15s, transform 0.15s var(--out); }
	@media (hover: hover) { .neu:hover { background: rgb(255 255 255 / 0.12); box-shadow: 9px 9px 20px rgb(0 0 0 / 0.9), -6px -6px 14px rgb(255 255 255 / 0.1); transform: translateY(-1px); } }
	.neu:active { background: rgb(255 255 255 / 0.04); box-shadow: inset 4px 4px 9px rgb(0 0 0 / 0.85), inset -3px -3px 7px rgb(255 255 255 / 0.07); transform: none; }
	.neu:focus-visible { outline: 2px solid var(--accent-fg); outline-offset: 2px; }
	.play { flex: none; width: 52px; height: 52px; border-radius: 50%; }
	.play :global(svg) { margin-left: 2px; }
	.bt { flex: 1; display: flex; flex-direction: column; gap: 2px; min-width: 0; }
	.b1, .b2 { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
	.b1 { font-size: 15px; font-weight: 500; font-variant-numeric: tabular-nums; }
	.b2 { font-size: 12px; color: var(--muted); }
	.sq { flex: none; width: 36px; height: 36px; border-radius: 12px; }
	.x.sq { right: 10px; margin-top: -18px; }
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
	.toast button { flex: none; height: 32px; padding: 0 14px; border-radius: 999px; font-weight: 700; }
	@keyframes rise { from { opacity: 0; transform: translateY(8px); } }
	@keyframes fade { from { opacity: 0; } }
	@keyframes blink { 50% { opacity: 0.3; } }
	@keyframes toast-in { from { opacity: 0; transform: translate(-50%, 12px); } }
	@media (prefers-reduced-motion: reduce) { .c, .ask, .toast, .dots { animation: none; } }
</style>
