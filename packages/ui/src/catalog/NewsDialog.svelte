<script lang="ts">
	// "Novedades" a pantalla completa (diseño "Marquesina": docs/mockups/novedades/dialog-a.html). Fondo con zoom lento,
	// póster flotante a la derecha (no en celu) y rollo de película abajo para saltar: el cuadro activo se levanta y marca el
	// avance; pasa solo cada 8 s y se pausa con el mouse (o el dedo) sobre el texto, el rollo o Cerrar. Esc o deslizar hacia
	// abajo cierra; ←/→ o deslizar de costado pasa. Una sola acción: Ver (título → ficha; capítulo → ese capítulo).
	// Con prefers-reduced-motion: solo fundidos y sin avance automático. `<dialog>` nativo: foco atrapado y fondo inerte.
	import Icon from '../components/Icon.svelte';
	import { t } from '../i18n/runtime.ts';
	import type { NewsItem } from './news.ts';
	import { compactVotes, NEWS_SLIDE_MS, newsTag, newsWhen, ratingText, watchLabel } from './news-ui.ts';
	import { subgenreLabels } from './subgenres.ts';

	interface Props {
		items: NewsItem[];
		open: boolean;
		onclose: () => void;
		/** Ver: ya cerró el diálogo. */
		onwatch: (item: NewsItem) => void;
	}
	let { items, open, onclose, onwatch }: Props = $props();

	let dlg = $state<HTMLDialogElement>();
	let closeBtn = $state<HTMLButtonElement>();
	let reel = $state<HTMLDivElement>();
	let frames = $state<HTMLButtonElement[]>([]);
	let reelW = $state(0);
	let cur = $state(0);
	/** Hacia dónde se pasó (paralaje): 1 siguiente, -1 anterior, 0 al abrir. */
	let dir = $state(0);
	let paused = $state(false);
	let closing = $state(false);
	let calm = $state(false);
	/** Puntero relativo al centro (-1..1): el póster se corre al revés. */
	let mx = $state(0);
	let my = $state(0);
	/** Deslizar: horizontal pasa, hacia abajo cierra. */
	let drag: { x: number; y: number; dx: number; dy: number; axis: 'x' | 'y' | null } | null = null;
	let pull = $state(0);
	let suppressClick = false;

	const it = $derived(items[cur]);
	const n = $derived(items.length);
	/** Solo se cargan las imágenes del cuadro actual y los vecinos. */
	const near = (k: number) => Math.abs(k - cur) <= 1;

	$effect(() => {
		if (!dlg) return;
		if (open && !dlg.open) {
			calm = matchMedia('(prefers-reduced-motion: reduce)').matches;
			cur = 0;
			dir = 0;
			closing = false;
			paused = false;
			dlg.showModal();
			closeBtn?.focus({ preventScroll: true });
		} else if (!open && dlg.open) dlg.close();
	});

	/** Rollo centrado en el cuadro activo. */
	const tx = $derived.by(() => {
		void reelW;
		const f = frames[cur];
		return f ? reelW / 2 - (f.offsetLeft + f.offsetWidth / 2) : 0;
	});

	function go(k: number) {
		const next = Math.max(0, Math.min(n - 1, k));
		if (next === cur) return;
		dir = next > cur ? 1 : -1;
		cur = next;
	}
	function requestClose() {
		if (closing || !dlg?.open) return;
		if (calm) return dlg.close();
		closing = true;
		setTimeout(() => dlg?.close(), 280);
	}
	function watch() {
		const item = it;
		dlg?.close();
		if (item) onwatch(item);
	}

	function onkeydown(e: KeyboardEvent) {
		if (e.key === 'ArrowRight') (e.preventDefault(), go(cur + 1));
		else if (e.key === 'ArrowLeft') (e.preventDefault(), go(cur - 1));
	}
	const PAUSE = '.info, .reel, .close-wrap';
	function onpointerover(e: PointerEvent) {
		if (e.target instanceof Element && e.target.closest(PAUSE)) paused = true;
	}
	function onpointerout(e: PointerEvent) {
		const to = e.relatedTarget;
		if (e.target instanceof Element && e.target.closest(PAUSE) && !(to instanceof Element && to.closest(PAUSE))) paused = false;
	}
	function onpointerdown(e: PointerEvent) {
		if (e.button === 0) drag = { x: e.clientX, y: e.clientY, dx: 0, dy: 0, axis: null };
	}
	function onpointermove(e: PointerEvent) {
		const glass = e.target instanceof Element ? e.target.closest<HTMLElement>('.glass') : null;
		if (glass) {
			const r = glass.getBoundingClientRect();
			glass.style.setProperty('--sx', `${e.clientX - r.left}px`);
			glass.style.setProperty('--sy', `${e.clientY - r.top}px`);
		}
		if (e.pointerType === 'mouse' && !calm) {
			mx = (e.clientX / innerWidth) * 2 - 1;
			my = (e.clientY / innerHeight) * 2 - 1;
		}
	}
	function winmove(e: PointerEvent) {
		if (!drag) return;
		drag.dx = e.clientX - drag.x;
		drag.dy = e.clientY - drag.y;
		if (!drag.axis && Math.hypot(drag.dx, drag.dy) > 8) drag.axis = Math.abs(drag.dx) > Math.abs(drag.dy) ? 'x' : 'y';
		if (drag.axis === 'y') pull = Math.max(0, drag.dy);
	}
	function winup() {
		if (!drag) return;
		const d = drag;
		drag = null;
		pull = 0;
		if (d.axis) {
			suppressClick = true;
			setTimeout(() => (suppressClick = false), 0);
		}
		if (d.axis === 'x' && Math.abs(d.dx) > 50) go(cur + (d.dx < 0 ? 1 : -1));
		else if (d.axis === 'y' && d.dy > 110) requestClose();
	}
</script>

<svelte:window onpointermove={winmove} onpointerup={winup} onpointercancel={winup} onresize={() => (reelW = reel?.clientWidth ?? 0)} />

<dialog
	id="news-dialog"
	bind:this={dlg}
	class="dlg"
	class:closing
	class:paused
	class:calm
	aria-labelledby="news-title"
	style:--d={dir}
	style:--mx={mx}
	style:--my={my}
	style:--slide="{NEWS_SLIDE_MS}ms"
	oncancel={(e) => (e.preventDefault(), requestClose())}
	onclose={() => ((closing = false), onclose())}
	onclickcapture={(e) => suppressClick && (e.preventDefault(), e.stopPropagation())}
	{onkeydown}
	{onpointerover}
	{onpointerout}
	{onpointerdown}
	{onpointermove}
>
	{#if open && it}
		<div class="stage" class:dragging={pull > 0} style:transform={pull ? `translateY(${pull * 0.8}px) scale(${1 - Math.min(pull, 400) / 4000})` : null} style:border-radius={pull ? '22px' : null}>
			{#each items as x, k (k)}
				{@const img = x.backdrop ?? x.poster}
				<div class="bg" class:on={k === cur} aria-hidden="true">{#if img && near(k)}<img src={img} alt="" draggable="false" />{/if}</div>
			{/each}
			<div class="shade" aria-hidden="true"></div>

			{#if it.poster}
				{#key cur}
					<div class="fp" aria-hidden="true"><div class="bob"><img src={it.poster} alt="" draggable="false" /></div></div>
				{/key}
			{/if}

			<span class="grab" aria-hidden="true"></span>
			<div class="head">
				<h2 id="news-title">{t('Novedades')}</h2>
				<span class="count" aria-live="polite">{t('{i} de {n}', { i: cur + 1, n })}</span>
			</div>

			{#key cur}
				{@const rating = ratingText(it)}
				{@const subs = subgenreLabels(it.subgenres)}
				<div class="info">
					<h3 style:--k={0}>{it.title}</h3>
					<div class="news" style:--k={1}>
						<span class="tag" class:ep={it.what?.type === 'episode'}>{newsTag(it)}</span>
						<span>{newsWhen(it)}</span>
					</div>
					{#if subs.length || it.year || rating}
						<div class="facts" style:--k={2}>
							{#each subs as s (s)}<span>{s}</span>{/each}
							{#if it.year}<span>{it.year}</span>{/if}
							{#if rating}<span class="rt"><Icon name="star" size={13} />{rating}{#if it.imdbVotes}<span class="vt">· {compactVotes(it.imdbVotes)}</span>{/if}</span>{/if}
						</div>
					{/if}
					<button id="news-watch" type="button" class="glass ver" style:--k={3} aria-label={`${watchLabel(it)} · ${it.title}`} onclick={watch}>
						<span class="pl"><Icon name="play" size={16} /></span><span>{watchLabel(it)}</span>
					</button>
					{#if it.overview}<p class="syn" style:--k={4}>{it.overview}</p>{/if}
				</div>
			{/key}

			<div class="reel" bind:this={reel} bind:clientWidth={reelW}>
				<div class="track" style:--tx="{tx}px">
					{#each items as x, k (k)}
						<button id="news-reel-{k}" type="button" class="frm" bind:this={frames[k]} aria-current={k === cur ? 'true' : undefined} aria-label={x.title} onclick={() => go(k)}>
							{#if x.poster}<img src={x.poster} alt="" loading="lazy" draggable="false" />{/if}
							<span class="prog" aria-hidden="true"><i onanimationend={() => !calm && k === cur && go(cur + 1)}></i></span>
						</button>
					{/each}
				</div>
			</div>

			<button id="news-prev" type="button" class="side prev" aria-label={t('Anterior')} disabled={cur === 0} onclick={() => go(cur - 1)}><Icon name="back" size={20} /></button>
			<button id="news-next" type="button" class="side next" aria-label={t('Siguiente')} disabled={cur === n - 1} onclick={() => go(cur + 1)}><Icon name="back" size={20} /></button>

			<div class="close-wrap">
				<button id="news-close" type="button" class="glass close-btn" bind:this={closeBtn} onclick={requestClose}>
					<span class="x"><Icon name="close" size={16} /></span><span>{t('Cerrar')}</span><kbd>Esc</kbd>
				</button>
			</div>
		</div>
	{/if}
</dialog>

<style>
	/* Pantalla completa: sin el marco ni el tamaño del <dialog> del navegador. */
	.dlg { position: fixed; inset: 0; width: 100%; height: 100%; max-width: none; max-height: none; margin: 0; padding: 0; border: 0; overflow: hidden; color: #fff; background: #07090c; touch-action: none; user-select: none; -webkit-user-select: none; }
	.dlg::backdrop { background: #07090c; }
	.dlg[open] { animation: dlg-in 0.55s var(--out) both; }
	.dlg.closing { animation: dlg-out 0.28s ease-in both; }
	.stage { position: absolute; inset: 0; overflow: hidden; transition: transform 0.35s var(--out), border-radius 0.35s; }
	.stage.dragging { transition: none; }

	/* Fondo: un cuadro por título que se funde; el activo entra corrido (paralaje) y hace un zoom lento. */
	.bg { position: absolute; inset: -5%; opacity: 0; transition: opacity 0.9s var(--ease); }
	.bg.on { opacity: 1; animation: pan-bg 0.9s var(--out); }
	.bg img { width: 100%; height: 100%; object-fit: cover; object-position: 50% 25%; }
	.bg.on img { animation: kenburns 24s ease-in-out infinite alternate; }
	/* Fade a oscuro hacia el texto (izquierda) y el rollo (abajo). */
	.shade { position: absolute; inset: 0; z-index: 3; pointer-events: none; background: linear-gradient(90deg, rgb(7 9 12 / 0.92) 0%, rgb(7 9 12 / 0.6) 40%, rgb(7 9 12 / 0.05) 75%), linear-gradient(to top, rgb(7 9 12 / 0.96) 0%, rgb(7 9 12 / 0.4) 32%, transparent 52%); }

	/* Póster flotante: entra desde el lado hacia el que se pasó, flota y se corre con el puntero. */
	.fp { position: absolute; z-index: 5; right: 9%; top: 15%; width: clamp(170px, 18vw, 230px); pointer-events: none; animation: pan-poster 0.9s var(--out) both; }
	.bob { animation: bob 6s ease-in-out infinite; }
	.fp img { display: block; width: 100%; aspect-ratio: 2 / 3; object-fit: cover; border-radius: var(--r-lg); box-shadow: 0 34px 70px rgb(0 0 0 / 0.6); transform: rotate(4deg) translate(calc(var(--mx) * -12px), calc(var(--my) * -8px)); transition: transform 0.3s ease-out; }

	.head { position: absolute; top: 0; left: 0; right: 0; z-index: 8; display: flex; align-items: baseline; gap: 10px; padding: calc(var(--safe-top, 0px) + 20px) 28px 20px; pointer-events: none; }
	.head h2 { margin: 0; font-size: 17px; font-weight: 750; letter-spacing: -0.01em; }
	.count { margin-left: auto; color: rgb(255 255 255 / 0.78); font-size: 13px; font-weight: 650; font-variant-numeric: tabular-nums; }
	.grab { display: none; }

	/* Título → qué hay de nuevo → subgénero, año y puntaje → Ver → sinopsis. Cada línea sube escalonada. */
	.info { position: absolute; left: 96px; bottom: calc(var(--safe-bottom, 0px) + 262px); z-index: 6; display: flex; flex-direction: column; align-items: flex-start; width: min(520px, 50%); text-shadow: 0 1px 12px rgb(0 0 0 / 0.45); animation: pan-info 0.8s var(--out); }
	.info > * { animation: rise 0.55s var(--out) both; animation-delay: calc(0.15s + var(--k) * 75ms); }
	.info h3 { margin: 0; font-size: clamp(40px, 5vw, 60px); font-weight: 850; line-height: 0.96; letter-spacing: -0.035em; text-wrap: balance; }
	.news { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 10px; margin-top: 12px; font-size: 15px; font-weight: 650; color: rgb(255 255 255 / 0.86); font-variant-numeric: tabular-nums; }
	.tag { display: inline-flex; align-items: center; height: 26px; padding: 0 10px; border-radius: var(--r-xs); background: var(--amber); color: #1a1206; font-size: 13.5px; font-weight: 800; letter-spacing: 0.01em; text-shadow: none; animation: tag-in 0.6s cubic-bezier(0.3, 1.5, 0.5, 1) 0.3s both; }
	.tag.ep { background: var(--accent-fg); color: #07152e; }
	/* Cada dato con su "·" delante y sin cortarse; el "·" que queda al empezar renglón cae en los 20px que se corren a la
	   izquierda y el recorte (solo de ese lado) lo esconde: al partir la línea no queda un punto suelto. */
	.facts { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 0; margin: 8px 0 0 -20px; font-size: 14px; color: rgb(255 255 255 / 0.78); font-variant-numeric: tabular-nums; clip-path: inset(-1em -1em -1em 20px); }
	.facts > * { white-space: nowrap; }
	.facts > *::before { content: '·'; display: inline-block; width: 20px; text-align: center; color: rgb(255 255 255 / 0.45); font-weight: 400; }
	.rt::before { margin-right: -4px; }
	.rt { display: inline-flex; align-items: center; gap: 4px; color: var(--yellow); font-weight: 750; }
	.vt { color: rgb(255 255 255 / 0.62); font-weight: 500; }
	.syn { display: -webkit-box; max-width: 44ch; margin: 16px 0 0; overflow: hidden; font-size: 13.5px; line-height: 1.5; color: rgb(255 255 255 / 0.66); -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical; }

	/* Vidrio esmerilado (Cerrar y Ver): desenfoque del fondo, borde con luz arriba, brillo que sigue al puntero y reflejo que cruza. */
	.glass { --sx: 50%; --sy: 0%; position: relative; display: inline-flex; align-items: center; overflow: hidden; border: 0; border-radius: var(--r-pill); color: #fff; font: inherit; letter-spacing: 0.01em; text-shadow: none; cursor: pointer; pointer-events: auto;
		background: linear-gradient(180deg, rgb(255 255 255 / 0.2), rgb(255 255 255 / 0.07));
		-webkit-backdrop-filter: blur(22px) saturate(1.8); backdrop-filter: blur(22px) saturate(1.8);
		box-shadow: inset 0 1px 0 rgb(255 255 255 / 0.38), inset 0 0 0 1px rgb(255 255 255 / 0.18), 0 12px 32px rgb(0 0 0 / 0.4);
		transition: transform 0.25s cubic-bezier(0.3, 1.6, 0.5, 1), box-shadow 0.2s; }
	.glass::before { content: ''; position: absolute; inset: 0; border-radius: inherit; background: radial-gradient(80px circle at var(--sx) var(--sy), rgb(255 255 255 / 0.32), transparent 70%); opacity: 0.55; transition: opacity 0.3s; pointer-events: none; }
	.glass::after { content: ''; position: absolute; top: 0; bottom: 0; left: -50%; width: 40%; background: linear-gradient(100deg, transparent, rgb(255 255 255 / 0.22), transparent); transform: skewX(-18deg); animation: sheen 6s var(--ease) 2s infinite; pointer-events: none; }
	.glass > * { position: relative; z-index: 1; }
	@media (hover: hover) { .glass:hover { transform: translateY(-1px); } .glass:hover::before { opacity: 1; } }
	.glass:active { transform: scale(0.95); }
	.glass:focus-visible { outline: 2px solid rgb(255 255 255 / 0.75); outline-offset: 3px; }
	/* Ver: el mismo vidrio, más grande y luminoso, con el play en un círculo sólido: es la acción principal. */
	.ver { gap: 12px; height: 58px; margin-top: 24px; padding: 0 28px 0 9px; font-size: 17px; font-weight: 800;
		background: linear-gradient(180deg, rgb(255 255 255 / 0.32), rgb(255 255 255 / 0.14));
		box-shadow: inset 0 1px 0 rgb(255 255 255 / 0.55), inset 0 0 0 1px rgb(255 255 255 / 0.3), 0 16px 40px rgb(0 0 0 / 0.45); }
	.ver::after { animation-delay: 1s; }
	.pl { display: grid; place-items: center; width: 40px; height: 40px; border-radius: 50%; background: #fff; color: #0b0d11; box-shadow: 0 4px 12px rgb(0 0 0 / 0.3); transition: transform 0.35s cubic-bezier(0.3, 1.6, 0.5, 1); }
	.pl :global(svg) { margin-left: 3px; }
	@media (hover: hover) { .ver:hover .pl { transform: scale(1.1); } }

	/* Rollo de película: perforaciones que corren con la tira; el cuadro activo se levanta y marca el avance. La cinta (fondo y
	   perforaciones) se estira a los dos lados más allá de los cuadros: con el activo centrado en el primero o el último
	   no quedan huecos y el rollo ocupa todo el ancho. */
	.reel { position: absolute; left: 0; right: 0; bottom: calc(var(--safe-bottom, 0px) + 84px); z-index: 7; height: 172px; overflow: hidden; -webkit-mask: linear-gradient(90deg, transparent, #000 8%, #000 92%, transparent); mask: linear-gradient(90deg, transparent, #000 8%, #000 92%, transparent); }
	.track { position: absolute; left: 0; bottom: 8px; display: flex; gap: 6px; padding: 14px 10px; transform: translateX(var(--tx, 0)); transition: transform 0.8s var(--out); }
	.track::before { --holes: repeating-linear-gradient(90deg, transparent 0 5px, rgb(232 226 210 / 0.55) 5px 13px, transparent 13px 18px); content: ''; position: absolute; top: 0; bottom: 0; left: -100vw; right: -100vw; background: var(--holes) 0 4px / 100% 6px no-repeat, var(--holes) 0 calc(100% - 4px) / 100% 6px no-repeat, #0b0c0f; box-shadow: 0 10px 30px rgb(0 0 0 / 0.5); }
	.frm { position: relative; flex: none; width: 60px; aspect-ratio: 2 / 3; padding: 0; overflow: hidden; border: 0; border-radius: 4px; background: var(--surface-2); opacity: 0.55; cursor: pointer; transition: transform 0.5s cubic-bezier(0.3, 1.5, 0.5, 1), opacity 0.3s, box-shadow 0.4s; }
	.frm img { display: block; width: 100%; height: 100%; object-fit: cover; }
	@media (hover: hover) { .frm:hover { opacity: 0.9; } }
	.frm:focus-visible { outline: 2px solid #fff; outline-offset: 2px; opacity: 0.9; }
	.frm[aria-current='true'] { z-index: 2; opacity: 1; transform: translateY(-18px) scale(1.28); box-shadow: 0 0 0 2px #fff, 0 14px 30px rgb(0 0 0 / 0.55); }
	.prog { position: absolute; left: 3px; right: 3px; bottom: 3px; z-index: 3; height: 2.5px; overflow: hidden; border-radius: 2px; background: rgb(255 255 255 / 0.25); opacity: 0; }
	.frm[aria-current='true'] .prog { opacity: 1; }
	.prog i { display: block; height: 100%; background: #fff; transform: scaleX(0); transform-origin: left; }
	.frm[aria-current='true'] .prog i { animation: fillx var(--slide) linear forwards; }
	.paused .prog i { animation-play-state: paused !important; }

	/* Flechas a los costados (no en celu: se desliza). */
	.side { position: absolute; top: 46%; z-index: 9; display: grid; place-items: center; width: 46px; height: 46px; margin-top: -23px; padding: 0; border: 0; border-radius: 50%; color: #fff; background: rgb(8 10 14 / 0.45); box-shadow: inset 0 0 0 1px rgb(255 255 255 / 0.16), 0 6px 18px rgb(0 0 0 / 0.3); cursor: pointer; transition: background 0.15s, transform 0.25s cubic-bezier(0.3, 1.6, 0.5, 1), opacity 0.2s; }
	@media (hover: hover) { .side:hover { background: rgb(8 10 14 / 0.7); transform: scale(1.1); } }
	.side:focus-visible { outline: 2px solid rgb(255 255 255 / 0.75); outline-offset: 3px; }
	.side:disabled { opacity: 0; pointer-events: none; }
	.prev { left: 22px; }
	.next { right: 22px; }
	.next :global(svg) { transform: scaleX(-1); }

	/* Cerrar: vidrio abajo al centro. */
	.close-wrap { position: absolute; left: 0; right: 0; bottom: calc(var(--safe-bottom, 0px) + 22px); z-index: 12; display: flex; justify-content: center; pointer-events: none; }
	.close-btn { gap: 9px; height: 50px; padding: 0 26px 0 20px; font-size: 14.5px; font-weight: 750; }
	.close-btn .x { display: inline-grid; transition: transform 0.4s cubic-bezier(0.3, 1.6, 0.5, 1); }
	@media (hover: hover) { .close-btn:hover .x { transform: rotate(90deg); } }
	kbd { margin-left: 4px; padding: 1px 6px; border-radius: var(--r-xs); background: rgb(255 255 255 / 0.12); color: rgb(255 255 255 / 0.8); font: 600 11px var(--display); }

	/* Celu: texto a todo el ancho, sin póster flotante, flechas, sinopsis ni Esc; manija arriba (deslizar cierra). */
	@media (max-width: 599px) {
		.shade { background: linear-gradient(to top, rgb(7 9 12 / 0.97) 12%, rgb(7 9 12 / 0.78) 46%, rgb(7 9 12 / 0.1) 78%); }
		.fp, .side, .syn, kbd { display: none; }
		.head { padding: calc(var(--safe-top, 0px) + 18px) 18px 18px; }
		.grab { position: absolute; top: calc(var(--safe-top, 0px) + 7px); left: 50%; z-index: 9; display: block; width: 38px; height: 4px; margin-left: -19px; border-radius: 2px; background: rgb(255 255 255 / 0.35); }
		.info { left: 20px; right: 20px; bottom: calc(var(--safe-bottom, 0px) + 222px); width: auto; }
		.info h3 { font-size: 38px; }
		.ver { height: 54px; margin-top: 20px; font-size: 16px; }
		/* Cinta y Cerrar separados (~20px), los dos sobre el área segura de abajo. */
		.reel { bottom: calc(var(--safe-bottom, 0px) + 78px); height: 138px; }
		.frm { width: 46px; }
		.frm[aria-current='true'] { transform: translateY(-14px) scale(1.22); }
		.close-wrap { bottom: calc(var(--safe-bottom, 0px) + 16px); }
	}

	/* Movimiento reducido: solo fundidos (fondo, texto y diálogo) y sin avance automático. */
	.calm[open], .calm .bg.on, .calm .bg.on img, .calm .fp, .calm .bob, .calm .info, .calm .tag, .calm .glass::after { animation: none; }
	.calm .info > * { animation: fade 0.3s ease both; }
	.calm .prog { display: none; }
	.calm .track, .calm .frm, .calm .stage { transition: none; }

	@keyframes kenburns { from { transform: scale(1); } to { transform: scale(1.12) translate(-2.5%, -1.5%); } }
	@keyframes pan-bg { from { transform: translateX(calc(var(--d) * 6%)); } }
	@keyframes pan-poster { from { opacity: 0; transform: translateX(calc(var(--d) * 260px)) rotate(calc(var(--d) * 10deg)); } }
	@keyframes pan-info { from { transform: translateX(calc(var(--d) * 90px)); } }
	@keyframes rise { from { opacity: 0; transform: translateY(16px); } }
	@keyframes fade { from { opacity: 0; } }
	@keyframes bob { 50% { transform: translateY(-10px); } }
	@keyframes fillx { to { transform: scaleX(1); } }
	@keyframes tag-in { from { opacity: 0; transform: scale(0.6); } }
	@keyframes sheen { 0%, 70% { left: -50%; } 100% { left: 120%; } }
	@keyframes dlg-in { from { opacity: 0; transform: scale(1.03); } }
	@keyframes dlg-out { to { opacity: 0; transform: scale(0.98); } }
</style>
