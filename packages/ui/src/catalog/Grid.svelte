<script lang="ts">
	// Grilla del catálogo: tarjetas con su entrada animada, esqueletos, proyector de la primera carga, estados vacío/error y el
	// centinela del scroll infinito.
	import Icon from '../components/Icon.svelte';
	import { getApi } from '../context.ts';
	import { onlyCinema } from '../format.ts';
	import { t } from '../i18n/runtime.ts';
	import type { CatalogItem } from '../types.ts';
	import CardInfo, { loadDetails, loadRatings } from './CardInfo.svelte';
	import { changedCount } from './filters.ts';
	import type { CatalogStore } from './store.ts';

	interface Props {
		store: CatalogStore;
		onopen: (item: CatalogItem) => void;
		/** Con `href` la tarjeta es un link (clic del medio, preload); el clic simple igual llama a `onopen`. */
		href?: (item: CatalogItem) => string;
		/** Ir a Ajustes (botón del estado de error). */
		onsettings?: () => void;
		/** Ancho mínimo de una tarjeta, px. */
		cardMin?: number;
		/** Degradado al pie de la ventana (la web). */
		fade?: boolean;
		/** Cuándo hay que traer más: lo decide el que sabe de qué scrollea. */
		sentinel?: HTMLElement;
	}
	let { store, onopen, href, onsettings, cardMin = 150, fade = false, sentinel = $bindable() }: Props = $props();
	const st = $derived(store.st);
	const mode = $derived(store.mode());
	const items = $derived(store.visible());
	const waiting = $derived(st.loading || st.pending);
	const changed = $derived(changedCount(st.f));
	const empty = $derived(!waiting && !st.error && !items.length && (st.done || st.items.length > 0));

	/** Póster dibujado cuando no hay imagen (o se rompió): matiz por id. */
	const hue = (id: string) => [...id].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);
	let broken = $state<string[]>([]);
	const api = getApi();
	/** Póster alternativo por id (cuando el de la tarjeta no carga); cada id se reintenta una sola vez. */
	let swapped = $state<Record<string, string>>({});
	const retried = new Set<string>();
	async function onbroken(it: CatalogItem) {
		if (retried.has(it.id)) return void broken.push(it.id);
		retried.add(it.id);
		const url = await api.catalog.poster(it.id).catch(() => null);
		if (url) swapped[it.id] = url;
		else broken.push(it.id);
	}
	/** Detalles al detenerse un momento sobre la tarjeta (no al pasar de largo). Solo con mouse: en el celu el toque abre el título. */
	const canHover = typeof matchMedia !== 'undefined' && matchMedia('(hover: hover)').matches;
	let asked = $state<string[]>([]);
	let hoverT: ReturnType<typeof setTimeout> | undefined;
	const enterCard = (it: CatalogItem) => {
		if (canHover && !asked.includes(it.id)) hoverT = setTimeout(() => asked.push(it.id), 250);
	};
	const leaveCard = () => clearTimeout(hoverT);

	/** Precarga los datos del hover de las tarjetas que quedan a la vista ~0,4 s (no las que pasan scrolleando ni las de
	 * abajo), de a 3 pedidos a la vez; quedan en la caché de CardInfo y el hover sale al instante. Solo con mouse. */
	const warmQueue: CatalogItem[] = [];
	let warming = 0;
	function pump(): void {
		while (warming < 3 && warmQueue.length) {
			const it = warmQueue.shift() as CatalogItem;
			warming++;
			loadDetails(api, it.kind, it.id)
				.then((d) => (it.kind === 'tv' && d?.imdb ? loadRatings(api, d.imdb) : null))
				.finally(() => (warming--, pump()));
		}
	}
	const dwell = new Map<Element, ReturnType<typeof setTimeout>>();
	const visibleObs =
		canHover && typeof IntersectionObserver !== 'undefined'
			? new IntersectionObserver(
					(entries) => {
						for (const e of entries) {
							clearTimeout(dwell.get(e.target));
							if (!e.isIntersecting) continue;
							dwell.set(e.target, setTimeout(() => {
								visibleObs?.unobserve(e.target);
								const id = (e.target as HTMLElement).dataset.id;
								const it = items.find((i) => i.id === id);
								if (it) (warmQueue.push(it), pump());
							}, 400));
						}
					},
					{ threshold: 0.6 }
				)
			: null;
	function warm(node: HTMLElement) {
		visibleObs?.observe(node);
		return { destroy: () => (visibleObs?.unobserve(node), clearTimeout(dwell.get(node))) };
	}
	const click = (e: MouseEvent, it: CatalogItem) => {
		if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
		e.preventDefault();
		onopen(it);
	};

	/** Tarjetas observadas que todavía no entraron. */
	const waitingCards = new Set<HTMLElement>();
	/** El conteo de cada tarjeta, para cancelarlo si se desmonta. */
	const counting = new WeakMap<Element, number>();
	/** Arranca la entrada apenas la tarjeta asoma por el borde (al cargar o al scrollear). Las que entran juntas
	 * se escalonan por orden (tope 12 × 70 ms); el puntaje cuenta de 0 a su valor cuando la tarjeta aterriza. */
	const seen =
		typeof IntersectionObserver === 'undefined'
			? null
			: new IntersectionObserver(
					(entries) => {
						if (st.covered) return;
						let i = 0;
						for (const e of entries) {
							if (!e.isIntersecting) continue;
							seen?.unobserve(e.target);
							waitingCards.delete(e.target as HTMLElement);
							play(e.target as HTMLElement, Math.min(i++, 12));
						}
					},
					{ rootMargin: '0px' }
				);
	// Terminada la bienvenida, las que esperaban tapadas entran ahora.
	let wasCovered = false;
	$effect(() => {
		if (st.covered) return void (wasCovered = true);
		if (!wasCovered) return;
		wasCovered = false;
		for (const n of waitingCards) {
			seen?.unobserve(n);
			seen?.observe(n);
		}
	});
	function play(node: HTMLElement, i: number) {
		node.style.setProperty('--i', String(i));
		node.style.setProperty('--play', 'running');
		const text = node.querySelector('.num')?.firstChild;
		if (!text) return;
		const end = Number(text.nodeValue);
		const start = performance.now() + i * 70 + 500;
		let last = '';
		let wrote = 0;
		const tick = (now: number) => {
			const p = Math.min(1, Math.max(0, (now - start) / 700));
			// Solo toca el DOM cuando cambia el número (no en cada frame) y cada ~60 ms: el resto del frame queda libre.
			const v = (end * (1 - (1 - p) ** 3)).toFixed(1);
			if (v !== last && (p === 1 || now - wrote > 60)) {
				text.nodeValue = last = v;
				wrote = now;
			}
			if (p < 1) counting.set(node, requestAnimationFrame(tick));
		};
		counting.set(node, requestAnimationFrame(tick));
	}
	function enter(node: HTMLElement) {
		if (!seen || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
		// Las que nacen debajo del borde o en una página siguiente (en el lugar de los esqueletos) llegan scrolleando:
		// arrancan ya visibles a medias, así nunca queda un hueco.
		if (st.page > 1 || node.getBoundingClientRect().top > innerHeight) node.classList.add('late');
		seen.observe(node);
		waitingCards.add(node);
		return {
			destroy: () => {
				seen.unobserve(node);
				waitingCards.delete(node);
				cancelAnimationFrame(counting.get(node) ?? 0);
			}
		};
	}
</script>

{#snippet face(it: CatalogItem)}
	{#if it.poster && !broken.includes(it.id)}
		<img src={swapped[it.id] ?? it.poster} alt="" loading="lazy" decoding="async" width="342" height="513" referrerpolicy="no-referrer" onerror={() => onbroken(it)} />
	{:else}
		<div class="noposter" style:--hue={hue(it.id)}>{it.title}</div>
	{/if}
	{#if asked.includes(it.id)}<CardInfo item={it} />{/if}
	{#if onlyCinema(it.released)}<span class="cine" title={t('Recién estrenada: probablemente solo haya copias filmadas en el cine')}><Icon name="film" size={11} />{t('En cines')}</span>{/if}
	<div class="meta">
		<span class="title">{it.title}</span>
		<span class="sub">
			{it.year}{#if it.rating}<span class="rate"><Icon name="star" size={11} /><span class="num">{it.rating}</span></span>{/if}
		</span>
	</div>
{/snippet}

<div class="area" class:fade style:--card-min="{cardMin}px">
	<ul class="grid" aria-busy={st.loading}>
		{#each items as it (`${it.kind}${it.id}`)}
			<li>
				{#if href}
					<a id="cat-card-{it.id}" class="card" class:active={st.activeId === it.id} data-id={it.id} href={href(it)} data-sveltekit-preload-data="tap" onmouseenter={() => enterCard(it)} onmouseleave={leaveCard} onclick={(e) => click(e, it)} use:enter use:warm>{@render face(it)}</a>
				{:else}
					<button id="cat-card-{it.id}" type="button" class="card" class:active={st.activeId === it.id} data-id={it.id} onmouseenter={() => enterCard(it)} onmouseleave={leaveCard} onclick={() => onopen(it)} use:enter use:warm>{@render face(it)}</button>
				{/if}
			</li>
		{/each}
		{#if waiting && (items.length || mode !== 'browse')}
			{#each Array(12) as _, i (i)}
				<li><div class="poster-skel skel"></div></li>
			{/each}
		{/if}
	</ul>

	<!-- Primera carga del catálogo: un proyector en loop (rollos girando, cinta corriendo, haz que titila). -->
	{#if waiting && !items.length && mode === 'browse'}
		<div class="leader" role="status" aria-label={t('Cargando el catálogo')}>
			<div class="projector" aria-hidden="true">
				<span class="reel-wheel"></span><span class="reel-wheel"></span>
				<span class="proj-body"></span>
				<span class="proj-beam"></span>
				<span class="proj-strip"></span>
			</div>
			<p class="leader-msg" aria-hidden="true">
				<span>{t('Apagando las luces…')}</span><span>{t('Haciendo pochoclos…')}</span><span>{t('Rebobinando la cinta…')}</span>
			</p>
		</div>
	{/if}

	{#if st.error}
		<div class="state">
			<p class="error" role="alert">{st.error}</p>
			<div class="state-actions">
				<button id="cat-retry" type="button" class="btn" onclick={() => store.restart(0)}>{t('Reintentar')}</button>
				{#if onsettings}<button id="cat-settings" type="button" class="btn" onclick={onsettings}>{t('Ir a Ajustes')}</button>{/if}
			</div>
		</div>
	{:else if empty}
		<div class="state">
			<p class="muted">{st.person ? t('No encontré títulos de {name}.', { name: st.person.name }) : mode === 'search' ? t('Sin resultados para esa búsqueda.') : t('No hay títulos con estos filtros.')}</p>
			{#if mode === 'browse' && changed}<button id="empty-reset" type="button" class="btn" onclick={() => store.resetFilters()}>{t('Restablecer filtros')}</button>{/if}
		</div>
	{/if}
	<div bind:this={sentinel} class="sentinel"></div>
</div>

<style>
	.grid {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 14px 10px;
	}
	@media (min-width: 640px) { .grid { grid-template-columns: repeat(auto-fill, minmax(var(--card-min, 150px), 1fr)); gap: 20px 14px; } }
	.card { display: block; width: 100%; padding: 0; border: 0; background: none; color: inherit; font: inherit; text-align: left; text-decoration: none; cursor: pointer; }
	.card.active img, .card.active .noposter { outline: 2px solid var(--accent); outline-offset: 1px; }
	.card img, .noposter, .poster-skel {
		width: 100%;
		height: auto;
		aspect-ratio: 2 / 3;
		border-radius: var(--r-md);
		background: var(--surface-2);
		object-fit: cover;
		box-shadow: 0 1px 3px var(--shadow);
	}
	.card:active img { transform: scale(0.97); }
	.card img { transition: transform 0.15s var(--ease); }
	.noposter { display: grid; place-items: center; padding: 8px; text-align: center; font-size: 13px; font-weight: 700; color: #fff; text-wrap: balance; background: linear-gradient(160deg, hsl(var(--hue, 220) 45% 32%), hsl(calc(var(--hue, 220) + 40) 50% 14%)); }
	.meta { display: flex; flex-direction: column; padding: 6px 2px 0; }
	.title { font-size: 13px; font-weight: 600; line-height: 1.25; display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
	.sub { display: flex; gap: 6px; align-items: center; font-size: 12px; color: var(--muted); }
	.rate { position: relative; display: inline-flex; align-items: center; gap: 2px; color: var(--yellow); }
	/* El conteo cambia el texto en cada frame: ancho fijo y `contain` para que no recalcule la grilla entera. */
	.num { display: inline-block; min-width: 2.6ch; font-variant-numeric: tabular-nums; contain: layout paint; }
	/* Entrada: sube, crece con rebote y se enfoca; la estrella gira y suelta un destello cuando la tarjeta aterriza. */
	/* overflow: hidden recorta el brillo, que se mueve con transform (sin repintar cada frame). */
	/* Recién estrenada en cines: chip arriba del póster. */
	.cine { position: absolute; top: 6px; left: 6px; z-index: 2; display: inline-flex; align-items: center; gap: 4px; padding: 3px 7px; border-radius: var(--r-pill); background: rgb(0 0 0 / 0.72); color: #fff; font-size: 11px; font-weight: 700; }
	.card { --t: calc(var(--i, 0) * 70ms); position: relative; overflow: hidden; animation: card-in 0.9s cubic-bezier(0.25, 0.8, 0.3, 1) var(--t) backwards var(--play, paused); }
	/* Las que llegan scrolleando: entrada corta, escalonado mínimo y desde medio visibles (en pausa ya se ven). */
	.card:global(.late) { --t: calc(min(var(--i, 0), 4) * 35ms); animation-name: card-rise; animation-duration: 0.6s; }
	/* Brillo que cruza el póster después del giro. */
	.card::after {
		content: '';
		position: absolute;
		top: 0;
		left: 0;
		width: 100%; /* no `inset` horizontal: con aspect-ratio WebKit lo achica (ver CardInfo.svelte) */
		aspect-ratio: 2 / 3;
		border-radius: var(--r-md);
		background: linear-gradient(100deg, transparent 25%, rgb(255 255 255 / 0.22) 45%, rgb(190 225 255 / 0.16) 55%, transparent 75%);
		opacity: 0;
		pointer-events: none;
		animation: shine 0.8s ease-in-out calc(var(--t) + 450ms) var(--play, paused);
	}
	/* Fundido abajo: las tarjetas se pierden en el fondo antes del borde de la pantalla. */
	.fade .grid::after {
		content: '';
		position: fixed;
		inset: auto 0 0;
		height: 110px;
		background: linear-gradient(transparent, var(--bg) 85%);
		pointer-events: none;
		z-index: 5;
	}
	/* Safari de iOS: el fixed termina arriba de su barra flotante y deja un corte duro; la barra ya difumina sola. */
	@supports (-webkit-touch-callout: none) { .fade .grid::after { display: none; } }
	.rate :global(svg) { animation: star-in 0.8s var(--ease) calc(var(--t) + 500ms) backwards var(--play, paused); }
	.num { display: inline-block; animation: num-pop 0.45s var(--ease) calc(var(--t) + 1200ms) var(--play, paused); }
	.rate::before {
		content: '';
		position: absolute;
		left: -4px;
		width: 19px;
		height: 19px;
		border-radius: 50%;
		opacity: 0;
		pointer-events: none;
	}
	.rate::before { border: 1px solid currentColor; animation: sparkle 0.6s ease-out calc(var(--t) + 750ms) var(--play, paused); }
	/* Revelado de figurita: la tarjeta se da vuelta en 3D como un póster coleccionable y un brillo holográfico la cruza. */
	@keyframes card-in {
		0% { opacity: 0; transform: perspective(700px) translateY(40px) rotateY(-120deg) rotateZ(-6deg) scale(0.7); }
		45% { opacity: 1; transform: perspective(700px) translateY(-8px) rotateY(18deg) rotateZ(2deg) scale(1.06); }
		70% { transform: perspective(700px) translateY(2px) rotateY(-6deg) rotateZ(-1deg) scale(0.99); }
		100% { opacity: 1; transform: none; }
	}
	@keyframes card-rise {
		from { opacity: 0.45; transform: perspective(700px) translateY(26px) rotateY(-24deg) scale(0.94); }
	}
	@keyframes shine {
		from { opacity: 1; transform: translateX(-100%); }
		to { opacity: 1; transform: translateX(100%); }
	}
	@keyframes star-in {
		from { opacity: 0; transform: scale(0.4) rotate(-120deg); }
		60% { opacity: 1; transform: scale(1.25) rotate(8deg); }
	}
	@keyframes sparkle {
		from { opacity: 0.5; transform: scale(0.5); }
		to { opacity: 0; transform: scale(1.4); }
	}
	@keyframes num-pop {
		40% { transform: scale(1.12); }
	}
	@media (prefers-reduced-motion: reduce) {
		.card, .card::after, .rate :global(svg), .rate::before, .num { animation: none; }
	}
	/* Proyector en loop: dos rollos que giran, la cinta que corre debajo y el haz de luz que titila. */
	.leader { display: grid; justify-items: center; gap: 18px; padding: 48px 0 24px; }
	.projector { position: relative; width: 220px; height: 150px; }
	.reel-wheel {
		position: absolute;
		top: 0;
		width: 70px;
		aspect-ratio: 1;
		border-radius: 50%;
		background:
			radial-gradient(circle, var(--bg) 0 9%, var(--muted) 10% 16%, transparent 17%),
			radial-gradient(circle at 50% 22%, var(--bg) 0 11%, transparent 12%),
			radial-gradient(circle at 50% 78%, var(--bg) 0 11%, transparent 12%),
			radial-gradient(circle at 22% 50%, var(--bg) 0 11%, transparent 12%),
			radial-gradient(circle at 78% 50%, var(--bg) 0 11%, transparent 12%),
			var(--surface-3);
		box-shadow: inset 0 0 0 4px var(--border-strong);
		animation: spin 1.6s linear infinite;
	}
	.reel-wheel:first-child { left: 18px; }
	.reel-wheel:nth-child(2) { left: 92px; width: 58px; top: 8px; animation-duration: 1.2s; }
	.proj-body { position: absolute; left: 20px; top: 72px; width: 130px; height: 46px; border-radius: var(--r-md); background: var(--surface-3); box-shadow: inset 0 0 0 2px var(--border-strong); }
	.proj-body::after { content: ''; position: absolute; right: -16px; top: 12px; width: 18px; height: 22px; border-radius: 3px var(--r-sm) var(--r-sm) 3px; background: var(--border-strong); }
	.proj-beam {
		position: absolute;
		left: 166px;
		top: 58px;
		width: 60px;
		height: 74px;
		background: linear-gradient(90deg, color-mix(in srgb, var(--amber) var(--tint-4), transparent), transparent);
		clip-path: polygon(0 40%, 100% 0, 100% 100%, 0 60%);
		transform-origin: left center;
		animation: beam 0.22s steps(2) infinite;
	}
	.proj-strip {
		position: absolute;
		left: 0;
		right: 0;
		bottom: 0;
		height: 22px;
		border-radius: 3px;
		background:
			radial-gradient(circle, var(--bg) 1.6px, transparent 2px) 0 3px / 12px 5px repeat-x,
			radial-gradient(circle, var(--bg) 1.6px, transparent 2px) 0 calc(100% - 3px) / 12px 5px repeat-x,
			repeating-linear-gradient(90deg, color-mix(in srgb, var(--amber) 35%, var(--surface-3)) 0 26px, var(--surface-3) 26px 30px),
			var(--surface-3);
		animation: roll 0.9s linear infinite;
	}
	@keyframes beam { 50% { opacity: 0.6; } }
	@keyframes roll { to { background-position: 12px 3px, 12px calc(100% - 3px), 30px 0, 0 0; } }
	.leader-msg { display: grid; margin: 0; color: var(--muted); font-size: 14px; font-weight: 600; }
	.leader-msg span { grid-area: 1 / 1; text-align: center; opacity: 0; animation: msg 3.6s var(--ease) infinite; }
	.leader-msg span:nth-child(2) { animation-delay: 1.2s; }
	.leader-msg span:nth-child(3) { animation-delay: 2.4s; }
	@keyframes msg {
		0% { opacity: 0; transform: translateY(8px); }
		8%, 28% { opacity: 1; transform: none; }
		36%, 100% { opacity: 0; transform: translateY(-8px); }
	}
	@media (prefers-reduced-motion: reduce) {
		.reel-wheel, .proj-beam, .proj-strip, .leader-msg span { animation: none; }
		.leader-msg span:first-child { opacity: 1; }
	}
	.state { display: flex; flex-direction: column; align-items: center; gap: 12px; padding: 32px 0; text-align: center; }
	.state p { margin: 0; }
	.state-actions { display: flex; gap: 8px; }
	.sentinel { height: 1px; }
</style>
