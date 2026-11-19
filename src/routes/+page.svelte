<script>
	import { goto } from '$app/navigation';
	import { getContext, onMount } from 'svelte';
	import Icon from '#lib/Icon.svelte';
	import Sheet from '#lib/Sheet.svelte';
	import { BACK, DEFAULTS, KINDS, LANGS, SORTS, VOTES, backLabel, cat, loadGenres, loadMore, relang, reset, votesLabel } from '#lib/catalog.svelte.js';
	import { i18n, setLang, t } from '#lib/i18n.svelte.js';

	/** @type {{tmdb: boolean, torbox: boolean} | null} */
	let keys = $state(null);
	let filtersOpen = $state(false);
	/** Alto de lo que se va al scrollear (marca, buscador, tipo): la barra de chips queda pegada arriba. */
	let topH = $state(0);
	/** @type {HTMLElement | undefined} */
	let sentinel = $state();
	/** @type {ReturnType<typeof setTimeout>} */
	let typing;
	/** Tipo recién tocado: solo ese hace el "pop" (al cargar la página no rebota). */
	let popped = $state('');

	const kind = $derived(KINDS.find((k) => k.v === cat.f.kind) ?? KINDS[0]);
	const kindIdx = $derived(Math.max(0, KINDS.indexOf(kind)));
	const genres = $derived(cat.genreList[kind.kind] ?? []);
	const searching = $derived(cat.q.trim() !== '');
	/** Resumen de lo aplicado, debajo de los chips (ni el idioma ni las fechas, que ya muestra el selector de años). */
	const summary = $derived(
		[
			cat.f.votes ? votesLabel(cat.f.votes) : '',
			genres.filter((/** @type {{id: string}} */ g) => cat.f.genres.includes(g.id)).map((/** @type {{name: string}} */ g) => g.name).join(', ')
		].filter(Boolean)
	);
	/** Filtros de la hoja que no están en su valor por defecto. */
	const changed = $derived(
		[cat.f.votes !== DEFAULTS.votes, cat.f.lang !== DEFAULTS.lang].filter(Boolean).length + cat.f.genres.length
	);

	onMount(() => {
		// Catálogo y géneros salen de la caché al instante (si están); las keys solo deciden el aviso.
		loadGenres(kind.kind);
		if (!cat.items.length && !cat.loading) loadMore();
		fetch('/api/keys').then((r) => r.json()).then((k) => (keys = k));
	});

	// Scroll infinito: el final está a menos de ~2 pantallas. Se pide mientras siga cerca, no solo al cruzar el
	// borde: si la página nueva no lo alejó (o las keys llegaron después), el observer no vuelve a avisar.
	let near = $state(false);
	$effect(() => {
		if (!sentinel) return;
		const io = new IntersectionObserver((es) => (near = es[0].isIntersecting), { rootMargin: '0px 0px 1600px 0px' });
		io.observe(sentinel);
		return () => io.disconnect();
	});
	$effect(() => {
		if (!near || !keys?.tmdb || cat.loading || cat.done || !sentinel) return;
		// `near` se actualiza un cuadro después de pintar la página nueva: se confirma con la posición real.
		if (sentinel.getBoundingClientRect().top < innerHeight + 1600) loadMore();
	});


	/* Estrenos desde → hasta (hoy, salvo que se abra el segundo cabezal): atajos + una línea de tiempo que se arrastra. */
	const LAST = BACK.length - 1;
	const YEAR = new Date().getFullYear();
	/** Atajos en meses hacia atrás; el último es "Todo". */
	const PRESETS = [
		[3, '3 meses'],
		[12, '1 año'],
		[60, '5 años'],
		[120, '10 años'],
		[BACK[LAST], 'Todo']
	];
	/** Meses hacia atrás hasta 1950 (el borde izquierdo con zoom al máximo). */
	const MAX = BACK[LAST];
	/** Meses (continuos) → paso de BACK más cercano: meses sueltos bajo el año, años enteros arriba. @param {number} m */
	const snap = (m) => (m < 11.5 ? Math.max(0, Math.round(m)) : Math.min(MAX, Math.round(m / 12) * 12));
	/** Meses de BACK mientras se arrastra, desde y hasta (-1 = quieto). */
	let scrub = $state(-1);
	let scrubTo = $state(-1);
	const shownM = $derived(scrub >= 0 ? scrub : BACK[Math.max(1, BACK.indexOf(cat.f.from))]);
	const shownIdx = $derived(BACK.indexOf(shownM));
	const shownTo = $derived(scrubTo >= 0 ? scrubTo : Math.min(cat.f.to, BACK[shownIdx - 1]));
	const toIdx = $derived(BACK.indexOf(shownTo));
	/** Segundo cabezal ("hasta"): abierto a mano o porque ya hay un hasta distinto de hoy. */
	let untilOpen = $state(false);
	const showTo = $derived(untilOpen || cat.f.to > 0);
	function toggleTo() {
		if (!showTo) return void (untilOpen = true);
		untilOpen = false;
		if (cat.f.to) setF({ to: 0 });
	}
	/** Zoom: la tira muestra `span` meses (hoy a la derecha); se abre cuanto más atrás va el valor. */
	const still = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
	/** Deja aire a la izquierda del valor: los años más viejos se ven antes de llegar. */
	const spanTo = $derived(Math.min(MAX, Math.max(24, shownM * 2.2)));
	let span = $state(Math.min(MAX, Math.max(24, BACK[Math.max(1, BACK.indexOf(cat.f.from))] * 2.2)));
	let zooming = $state(false);
	$effect(() => {
		const to = spanTo;
		if (still()) return void (span = to);
		zooming = true;
		let raf = 0;
		let t0 = performance.now();
		/** @param {number} t */
		const step = (t) => {
			span += (to - span) * (1 - Math.exp(-(t - t0) / 140));
			t0 = t;
			if (Math.abs(to - span) < 0.3) return void ((span = to), (zooming = false));
			raf = requestAnimationFrame(step);
		};
		raf = requestAnimationFrame(step);
		return () => cancelAnimationFrame(raf);
	});
	/** % desde la izquierda de algo que pasó hace `m` meses, según el zoom actual. @param {number} m */
	const at = (m) => Math.max(0, 100 * (1 - m / span));
	/** Rayitas: cada 1/3/12/60 meses según el zoom, que no queden más de ~80. */
	const tick = $derived([1, 3, 12].find((s) => span / s <= 80) ?? 60);
	/** Años rotulados: de a 1/2/5/10/20 según el zoom, sin pegarse a los bordes. */
	const labels = $derived.by(() => {
		const every = [1, 2, 5, 10].find((s) => span / 12 / s <= 8) ?? 20;
		return Array.from({ length: Math.floor(span / 12) }, (_, i) => YEAR - 1 - i).filter(
			(y) => y >= 1950 && y % every === 0 && ((YEAR - y) * 12) / span > 0.06 && ((YEAR - y) * 12) / span < 0.94
		);
	});
	/** v: velocidad suavizada con signo (px/ms); stop: este toque frenó una inercia; l/w: la tira; edge: 1 = sostenido
	 * en el borde izquierdo, -1 en el derecho.
	 * @typedef {{x: number, t: number, m: number, v: number, moved: number, to: boolean, stop: boolean, l: number, w: number, edge: number}} Drag */
	/** @type {Drag | null} */
	let drag = null;
	/** rAF de la inercia al soltar rápido (0 = quieta). */
	let glide = 0;
	/** rAF del avance solo mientras el dedo queda en un borde (0 = no). */
	let edge = 0;
	/** Rango permitido del cabezal que se mueve: siempre queda al menos un paso entre hasta y desde. */
	const range = (/** @type {boolean} */ to) => (to ? [0, BACK[shownIdx - 1]] : [BACK[toIdx + 1], MAX]);
	/** Agarra el cabezal más cercano al dedo y congela ambos valores. @param {PointerEvent & {currentTarget: HTMLElement}} e */
	function scrubDown(e) {
		e.currentTarget.setPointerCapture(e.pointerId);
		const r = e.currentTarget.getBoundingClientRect();
		const x = (100 * (e.clientX - r.left)) / r.width;
		const to = showTo && Math.abs(x - at(shownTo)) < Math.abs(x - at(shownM));
		const stop = glide > 0;
		cancelAnimationFrame(glide);
		glide = 0;
		drag = { x: e.clientX, t: e.timeStamp, m: to ? shownTo : shownM, v: 0, moved: 0, to, stop, l: r.left, w: r.width, edge: 0 };
		scrub = shownM;
		scrubTo = shownTo;
	}
	/** Despacio mueve de a un mes/año (~25 px por paso); rápido salta muchos años. Se mide en meses, no en
	 * píxeles de la tira, así el zoom no cambia la velocidad. @param {PointerEvent} e */
	function scrubMove(e) {
		if (!drag) return;
		const dx = e.clientX - drag.x;
		// Velocidad suavizada (px/ms): un tirón suelto no dispara saltos.
		drag.v += (dx / Math.max(1, e.timeStamp - drag.t) - drag.v) * 0.3;
		drag.moved += Math.abs(dx);
		drag.x = e.clientX;
		drag.t = e.timeStamp;
		nudge(drag, dx);
		// Dedo en un borde: sigue yendo solo hacia ese lado, cada vez más rápido.
		const dir = drag.moved < 4 ? 0 : e.clientX < drag.l + 28 ? 1 : e.clientX > drag.l + drag.w - 28 ? -1 : 0;
		if (dir === drag.edge) return;
		cancelAnimationFrame(edge);
		edge = 0;
		drag.edge = dir;
		if (!dir) return;
		const d = drag;
		let t0 = performance.now();
		let held = 0;
		const step = (/** @type {number} */ t) => {
			held += (t - t0) / 1000;
			const pace = Math.min(30, 3 + 8 * held); // pasos (meses o años) por segundo
			if (nudge(d, (-dir * (d.m < 12 ? 1 : 12) * pace * (t - t0)) / 1000, true)) return void (edge = 0);
			t0 = t;
			edge = requestAnimationFrame(step);
		};
		edge = requestAnimationFrame(step);
	}
	/** Mueve el cabezal `dx` px (o `dx` meses si `months`); true si topó con un límite.
	 * @param {Drag} d @param {number} dx @param {boolean} [months] */
	function nudge(d, dx, months = false) {
		const gain = months ? 1 : (d.m < 12 ? 1 : 12) * 0.04 + Math.min(1, Math.abs(d.v) / 2) ** 2 * 3; // meses por px
		const [lo, hi] = range(d.to);
		d.m = Math.min(hi, Math.max(lo, d.m - dx * gain));
		const m = Math.min(hi, Math.max(lo, snap(d.m)));
		if (m !== (d.to ? scrubTo : scrub)) {
			if (d.to) scrubTo = m;
			else scrub = m;
			navigator.vibrate?.(3);
		}
		return d.m === lo || d.m === hi;
	}
	function commit() {
		const [from, to] = [scrub, scrubTo];
		scrub = scrubTo = -1;
		if (from !== cat.f.from || to !== cat.f.to) setF({ from, to });
	}
	/** Suelta: aplica. Un toque sin arrastrar salta a donde tocaste (con el zoom de ese momento). @param {PointerEvent & {currentTarget: HTMLElement}} e */
	function scrubUp(e) {
		if (!drag) return;
		cancelAnimationFrame(edge);
		edge = 0;
		if (drag.moved < 4 && !drag.stop) {
			const r = e.currentTarget.getBoundingClientRect();
			const [lo, hi] = range(drag.to);
			const m = Math.min(hi, Math.max(lo, snap((1 - (e.clientX - r.left) / r.width) * span)));
			if (drag.to) scrubTo = m;
			else scrub = m;
		}
		const d = drag;
		drag = null;
		// Soltó rápido (y sin frenar antes): sigue de largo frenando de a poco, como un scroll de iOS.
		if (d.moved >= 4 && Math.abs(d.v) > 0.4 && e.timeStamp - d.t < 80 && !still()) {
			let t0 = performance.now();
			const step = (/** @type {number} */ t) => {
				d.v *= Math.exp(-(t - t0) / 325);
				const hit = nudge(d, d.v * (t - t0));
				t0 = t;
				if (hit || Math.abs(d.v) < 0.05) return void ((glide = 0), commit());
				glide = requestAnimationFrame(step);
			};
			glide = requestAnimationFrame(step);
			return;
		}
		commit();
	}
	/** Flechas ±1 paso, Re/Av Pág ±10. @param {KeyboardEvent} e */
	const keyStep = (e) => ({ ArrowLeft: 1, ArrowDown: 1, ArrowRight: -1, ArrowUp: -1, PageDown: 10, PageUp: -10 })[e.key] ?? 0;
	/** @param {KeyboardEvent} e */
	function scrubKey(e) {
		const step = keyStep(e);
		if (!step) return;
		e.preventDefault();
		setF({ from: BACK[Math.min(LAST, Math.max(toIdx + 1, shownIdx + step))] });
	}
	/** @param {KeyboardEvent} e */
	function untilKey(e) {
		e.stopPropagation();
		const step = keyStep(e);
		if (!step) return;
		e.preventDefault();
		setF({ to: BACK[Math.min(shownIdx - 1, Math.max(0, toIdx + step))] });
	}
	/** Píldora que salta al atajo elegido. @type {HTMLElement | undefined} */
	let presetsEl = $state();
	let pill = $state({ x: 0, w: 0, on: false });
	$effect(() => {
		void cat.f.from, cat.f.to, searching;
		const on = /** @type {HTMLElement | null | undefined} */ (presetsEl?.querySelector('[aria-checked="true"]'));
		pill = on ? { x: on.offsetLeft, w: on.offsetWidth, on: true } : { x: 0, w: 0, on: false };
	});

	/** @param {Partial<typeof cat.f>} changes */
	function setF(changes) {
		Object.assign(cat.f, changes);
		if (changes.kind) {
			cat.f.genres = [];
			loadGenres(kind.kind);
		}
		reset();
		scrollTo({ top: 0 });
	}
	/** Vuelve al catálogo con los filtros, arriba de todo. */
	function clearSearch() {
		clearTimeout(typing);
		cat.q = '';
		reset();
		scrollTo({ top: 0 });
	}
	/** "Pegar magnet" (2026-11-18): un magnet pegado en el buscador va a su pantalla en vez de buscarse como texto.
	 * btih en hex (40) o base32 (32, se pasa a hex). @param {string} text */
	function magnetHash(text) {
		const m = text.trim().match(/^magnet:\?.*?xt=urn:btih:([0-9a-z]{32,40})/i);
		if (!m) return null;
		const h = m[1];
		if (/^[0-9a-f]{40}$/i.test(h)) return h.toLowerCase();
		if (!/^[a-z2-7]{32}$/i.test(h)) return null;
		let bits = '';
		for (const ch of h.toUpperCase()) bits += 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'.indexOf(ch).toString(2).padStart(5, '0');
		return bits.match(/.{4}/g)?.map((b) => parseInt(b, 2).toString(16)).join('') ?? null;
	}
	function onSearch() {
		const hash = magnetHash(cat.q);
		if (hash) {
			const dn = new URLSearchParams(cat.q.trim().split('?')[1] ?? '').get('dn') ?? '';
			cat.q = '';
			goto(`/m/${hash}${dn ? `?${new URLSearchParams({ dn })}` : ''}`);
			return;
		}
		clearTimeout(typing);
		typing = setTimeout(reset, 350);
	}
	/** @param {string} id */
	function toggleGenre(id) {
		cat.f.genres = cat.f.genres.includes(id) ? cat.f.genres.filter((/** @type {string} */ g) => g !== id) : [...cat.f.genres, id];
		reset();
	}
	/** @type {('es' | 'en')[]} */
	const UI_LANGS = ['es', 'en'];
	/** ES / EN de la app (los títulos tienen su propio idioma, en Ajustes): sinopsis y géneros siguen a la app. @param {'es' | 'en'} l */
	function switchLang(l) {
		if (l === i18n.lang) return;
		setLang(l);
		relang();
	}
	function resetFilters() {
		setF({ votes: DEFAULTS.votes, lang: DEFAULTS.lang, genres: [] });
	}
	/** La bienvenida está tapando la portada (la pone el layout). @type {() => boolean} */
	const touring = getContext('touring');
	/** Tarjetas observadas que todavía no entraron. @type {Set<HTMLElement>} */
	const waiting = new Set();
	/** La portada entra al terminar la bienvenida: barra de arriba que sube y tarjetas con su entrada de siempre. */
	let intro = $state(false);
	let covered = false;
	$effect(() => {
		if (touring()) return void (covered = true);
		if (!covered) return;
		covered = false;
		intro = true;
		setTimeout(() => (intro = false), 1500);
		// Las que ya estaban a la vista esperaron tapadas: volver a observarlas las hace entrar ahora.
		for (const n of waiting) {
			seen?.unobserve(n);
			seen?.observe(n);
		}
	});
	/** El conteo de cada tarjeta, para cancelarlo si se desmonta. @type {WeakMap<Element, number>} */
	const counting = new WeakMap();
	/** Arranca la entrada apenas la tarjeta asoma por el borde (al cargar o al scrollear). Las que entran juntas
	 * se escalonan por orden (tope 12 × 70 ms); el puntaje cuenta de 0 a su valor cuando la tarjeta aterriza. */
	const seen =
		typeof IntersectionObserver === 'undefined'
			? null
			: new IntersectionObserver(
					(entries) => {
						if (touring()) return;
						let i = 0;
						for (const e of entries) {
							if (!e.isIntersecting) continue;
							seen?.unobserve(e.target);
							waiting.delete(/** @type {HTMLElement} */ (e.target));
							play(/** @type {HTMLElement} */ (e.target), Math.min(i++, 12));
						}
					},
					{ rootMargin: '0px' }
				);
	/** @param {HTMLElement} node @param {number} i */
	function play(node, i) {
		node.style.setProperty('--i', String(i));
		node.style.setProperty('--play', 'running');
		const text = node.querySelector('.num')?.firstChild;
		if (!text) return;
		const end = Number(text.nodeValue);
		const start = performance.now() + i * 70 + 500;
		let last = '';
		let wrote = 0;
		const tick = (/** @type {number} */ now) => {
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
	/** @param {HTMLElement} node */
	function enter(node) {
		if (!seen || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
		// Las que nacen debajo del borde o en una página siguiente (en el lugar de los esqueletos) llegan scrolleando:
		// arrancan ya visibles a medias, así nunca queda un hueco.
		if (cat.page > 1 || node.getBoundingClientRect().top > innerHeight) node.classList.add('late');
		seen.observe(node);
		waiting.add(node);
		return {
			destroy: () => {
				seen.unobserve(node);
				waiting.delete(node);
				cancelAnimationFrame(counting.get(node) ?? 0);
			}
		};
	}
</script>

<header class="head" class:intro style:--hide="{topH}px">
	<div class="wrap">
		<div class="head-top" bind:clientHeight={topH}>
			<div class="row">
				<h1 class="brand">Streamonte</h1>
				<div class="top-actions">
					<div class="lang" role="radiogroup" aria-label={t('Idioma')}>
						{#each UI_LANGS as l (l)}
							<button id="lang-{l}" type="button" role="radio" aria-checked={i18n.lang === l} onclick={() => switchLang(l)}>{l.toUpperCase()}</button>
						{/each}
					</div>
					<a id="go-settings" class="icon-btn" href="/ajustes" aria-label={t('Ajustes')}><Icon name="gear" /></a>
				</div>
			</div>
			<label class="search">
				<Icon name="search" size={18} />
				<input id="cat-q" type="search" placeholder={t('Buscar película o serie')} autocomplete="off" enterkeyhint="search" bind:value={cat.q} oninput={onSearch} onkeydown={(e) => e.key === 'Escape' && cat.q && clearSearch()} />
				{#if cat.q}
					<button id="cat-q-clear" type="button" class="clear-q" aria-label={t('Limpiar búsqueda')} onclick={clearSearch}><Icon name="close" size={14} /></button>
				{/if}
			</label>
			{#if !searching}
				<div class="seg" role="radiogroup" aria-label={t('Tipo')} style:--i={kindIdx}>
					<span class="seg-thumb" aria-hidden="true"></span>
					{#each KINDS as k (k.v)}
						<button id="kind-{k.v}" type="button" role="radio" aria-checked={cat.f.kind === k.v} onclick={() => cat.f.kind !== k.v && ((popped = k.v), setF({ kind: k.v }))}>
							<span class="seg-in" class:pop={popped === k.v}><Icon name={k.icon} size={17} />{t(k.label)}</span>
						</button>
					{/each}
				</div>
				<div class="since">
					<div class="since-head">
						<span class="since-label">{t('Estrenos desde')}</span>
						<span class="since-val" class:live={scrub >= 0}>
							{#key shownM}<b>{shownM < 12 ? backLabel(shownM) : YEAR - shownM / 12}</b>{/key}
							<span class="since-dash" aria-hidden="true">–</span>
							<button id="since-to" type="button" class="since-to" class:on={showTo} aria-pressed={showTo} title={t(showTo ? 'Volver a hasta hoy' : 'Elegir hasta cuándo')} onclick={toggleTo}>
								{#key shownTo}<span class="to-val">{shownTo === 0 ? t('hoy') : shownTo < 12 ? backLabel(shownTo) : YEAR - shownTo / 12}</span>{/key}{#if showTo}<Icon name="close" size={11} />{/if}
							</button>
						</span>
					</div>
					<div class="presets" role="radiogroup" aria-label={t('Estrenos desde')} bind:this={presetsEl}>
						<span class="preset-pill" class:on={pill.on} style:--x="{pill.x}px" style:--w="{pill.w}px" aria-hidden="true"></span>
						{#each PRESETS as [m, l] (m)}
							<button id="since-{m}" type="button" role="radio" aria-checked={cat.f.from === m && !cat.f.to} onclick={() => ((untilOpen = false), setF({ from: Number(m), to: 0 }))}>{t(String(l))}</button>
						{/each}
					</div>
					<div
						id="since-slider"
						class="reel"
						class:live={scrub >= 0}
						class:zooming
						role="slider"
						tabindex="0"
						aria-label={t('Estrenos desde')}
						aria-valuemin={1}
						aria-valuemax={LAST}
						aria-valuenow={shownIdx}
						aria-valuetext={backLabel(shownM)}
						title={t('Despacio afina, rápido salta años')}
						style:--at="{at(shownM)}%"
						style:--to-at="{at(shownTo)}%"
						style:--tick="{(100 * tick) / span}%"
						onpointerdown={scrubDown}
						onpointermove={scrubMove}
						onpointerup={scrubUp}
						onpointercancel={scrubUp}
						onkeydown={scrubKey}
					>
						<span class="reel-lit" aria-hidden="true"></span>
						{#each labels as y (y)}
							<span class="decade" style:left="{at((YEAR - y) * 12)}%" aria-hidden="true">{y}</span>
						{/each}
						<span class="playhead" aria-hidden="true"></span>
						<span
							id="until-slider"
							class="playhead until"
							class:on={showTo}
							role="slider"
							tabindex={showTo ? 0 : -1}
							aria-hidden={!showTo}
							aria-label={t('Hasta')}
							aria-valuemin={0}
							aria-valuemax={LAST - 1}
							aria-valuenow={toIdx}
							aria-valuetext={backLabel(shownTo)}
							style:--at="{at(shownTo)}%"
							onkeydown={untilKey}
						></span>
					</div>
				</div>

				<div class="sort" role="radiogroup" aria-label={t('Orden')}>
					{#each SORTS as [v, l] (v)}
						<button id="sort-{v}" type="button" role="radio" class="marquee" aria-checked={cat.f.sort === v} onclick={() => cat.f.sort !== v && setF({ sort: v })}>
							<Icon name={v === 'popular' ? 'flame' : 'star'} size={14} />{t(l)}
						</button>
					{/each}
				</div>
			{/if}
		</div>
		{#if !searching}
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

<main class="wrap">
	{#if keys && (!keys.tmdb || !keys.torbox)}
		<a id="keys-cta" class="cta" href="/ajustes">
			<strong>{t('Faltan keys')}</strong>
			<span>{!keys.tmdb ? t('TMDB (catálogo)') : ''}{!keys.tmdb && !keys.torbox ? t(' y ') : ''}{!keys.torbox ? t('TorBox (torrents)') : ''}{t(': cargalas en Ajustes.')}</span>
		</a>
	{/if}

	<ul class="grid" aria-busy={cat.loading}>
		{#each cat.items as it (`${it.kind}${it.id}`)}
			<li>
				<a class="card" href="/t/{it.kind}/{it.id}" data-sveltekit-preload-data="tap" use:enter>
					{#if it.poster}
						<img src={it.poster} alt="" loading="lazy" decoding="async" width="342" height="513" />
					{:else}
						<div class="noposter">{it.title}</div>
					{/if}
					<div class="meta">
						<span class="title">{it.title}</span>
						<span class="sub">
							{it.year}{#if it.rating}<span class="rate"><Icon name="star" size={11} /><span class="num">{it.rating}</span></span>{/if}
						</span>
					</div>
				</a>
			</li>
		{/each}
		{#if cat.loading && cat.items.length}
			{#each Array(12) as _, i (i)}
				<li><div class="card"><div class="poster-skel skel"></div></div></li>
			{/each}
		{/if}
	</ul>

	<!-- Primera carga: un proyector en loop (rollos girando, cinta corriendo, haz que titila). -->
	{#if cat.loading && !cat.items.length}
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

	{#if cat.error}
		<div class="state">
			<p class="error" role="alert">{cat.error}</p>
			<div class="state-actions">
				<button id="cat-retry" type="button" class="btn" onclick={reset}>{t('Reintentar')}</button>
				<a id="cat-settings" class="btn" href="/ajustes">{t('Ir a Ajustes')}</a>
			</div>
		</div>
	{:else if cat.done && !cat.items.length}
		<div class="state">
			<p class="muted">{t('No hay títulos con estos filtros.')}</p>
			{#if changed}<button id="empty-reset" type="button" class="btn" onclick={resetFilters}>{t('Restablecer filtros')}</button>{/if}
		</div>
	{/if}
	<div bind:this={sentinel} class="sentinel"></div>
</main>

<Sheet id="filters-sheet" title={t('Filtros avanzados')} open={filtersOpen} onclose={() => (filtersOpen = false)}>
	<h3 class="gh first">{t('Géneros')}</h3>
	<div class="genre-chips">
		{#each genres as g (g.id)}
			<button id="genre-{g.id}" type="button" class="chip" class:on={cat.f.genres.includes(g.id)} aria-pressed={cat.f.genres.includes(g.id)} onclick={() => toggleGenre(g.id)}>{g.name}</button>
		{/each}
	</div>

	<h3 class="gh" id="votes-h">{t('Votos mínimos')}</h3>
	<div class="vote-chips" role="radiogroup" aria-labelledby="votes-h">
		{#each VOTES as v (v)}
			<button id="votes-{v}" type="button" role="radio" class="chip" class:on={cat.f.votes === v} aria-checked={cat.f.votes === v} onclick={() => setF({ votes: v })}>{v ? `${v / 1000}k+` : t('Cualquiera')}</button>
		{/each}
	</div>

	<h3 class="gh" id="lang-h">{t('Idioma original')}</h3>
	<div class="seg lang-seg" role="radiogroup" aria-labelledby="lang-h" style:--i={Math.max(0, LANGS.findIndex(([v]) => v === cat.f.lang))}>
		<span class="seg-thumb" aria-hidden="true"></span>
		{#each LANGS as [v, l] (v)}
			<button id="lang-{v || 'any'}" type="button" role="radio" aria-checked={cat.f.lang === v} onclick={() => setF({ lang: v })}><span class="seg-in">{t(l)}</span></button>
		{/each}
	</div>

	<div class="sheet-actions">
		<button id="filters-reset" type="button" class="btn" disabled={!changed} onclick={resetFilters}>{t('Restablecer')}</button>
		<button id="filters-done" type="button" class="btn primary" onclick={() => (filtersOpen = false)}>{t('Ver resultados')}</button>
	</div>
</Sheet>

<style>
	/* Se pega arriba corrido hacia arriba lo que mide la parte de arriba: al scrollear queda solo la barra de chips. */
	.head {
		position: sticky;
		top: calc(-1 * (var(--hide) + 6px));
		z-index: 20;
		padding: calc(var(--safe-top) + 6px) 16px 0;
		/* Casi opaco y sin blur: el backdrop-filter sobre la grilla animada era lo más caro al scrollear en el celu. */
		background: color-mix(in srgb, var(--bg) 96%, transparent);
		border-bottom: 1px solid var(--border);
	}
	.head-top { padding-bottom: 2px; }
	/* Entrada después de la bienvenida: cada bloque de arriba sube escalonado. */
	.intro .head-top > *, .intro .filters { animation: rise 0.7s var(--out) backwards; }
	.intro .head-top > :nth-child(2) { animation-delay: 60ms; }
	.intro .head-top > :nth-child(3) { animation-delay: 120ms; }
	.intro .head-top > :nth-child(4) { animation-delay: 180ms; }
	.intro .head-top > :nth-child(5) { animation-delay: 240ms; }
	.intro .filters { animation-delay: 300ms; }
	@keyframes rise { from { opacity: 0; transform: translateY(24px); } }
	.row { display: flex; align-items: center; justify-content: space-between; margin-right: -10px; }
	.top-actions { display: flex; align-items: center; gap: 4px; }
	/* ES / EN: dos letras, la elegida resaltada; sin ocupar más que un ícono y medio. */
	.lang { display: inline-flex; padding: 2px; border-radius: 999px; background: var(--surface-2); }
	.lang button { position: relative; min-width: 34px; height: 28px; padding: 0 8px; border: 0; border-radius: 999px; background: none; color: var(--muted); font-size: 12px; font-weight: 750; letter-spacing: 0.04em; transition: background 0.2s var(--ease), color 0.2s var(--ease); }
	.lang button::after { content: ''; position: absolute; inset: -8px -2px; }
	.lang button[aria-checked='true'] { background: var(--surface); color: var(--text); box-shadow: 0 1px 3px var(--shadow); }
	.brand { margin: 0; font-size: 28px; font-weight: 750; letter-spacing: -0.025em; }
	.search {
		display: flex;
		align-items: center;
		gap: 8px;
		margin-top: 6px;
		padding: 0 12px;
		height: 44px;
		border-radius: 12px;
		background: var(--surface-2);
		color: var(--muted);
	}
	.search input { flex: 1; min-width: 0; border: 0; background: none; outline: none; color: var(--text); font-size: 16px; }
	.search input::placeholder { color: var(--muted); }
	/* Sin la cruz nativa: va la propia, igual en todos los navegadores. */
	.search input::-webkit-search-cancel-button { display: none; }
	.clear-q {
		position: relative;
		flex: none;
		display: grid;
		place-items: center;
		width: 22px;
		height: 22px;
		margin-right: -2px;
		padding: 0;
		border: 0;
		border-radius: 999px;
		background: color-mix(in srgb, var(--muted) 55%, transparent);
		color: var(--bg);
	}
	/* Se ve de 22px, se toca en 44px. */
	.clear-q::after { content: ''; position: absolute; inset: -11px; }

	/* Control segmentado (iOS/Android): la píldora se desliza al tipo elegido. */
	.seg {
		position: relative;
		display: grid;
		grid-template-columns: repeat(2, 1fr);
		margin-top: 10px;
		padding: 3px;
		border-radius: 12px;
		background: var(--surface-2);
	}
	.seg-thumb {
		position: absolute;
		top: 3px;
		bottom: 3px;
		left: 3px;
		width: calc((100% - 6px) / 2);
		border-radius: 9px;
		background: var(--raised);
		box-shadow: 0 1px 2px var(--shadow), 0 2px 8px var(--shadow);
		transform: translateX(calc(100% * var(--i)));
		/* Resorte con rebote (el reduced-motion global de app.css lo deja instantáneo). */
		transition: transform 0.5s cubic-bezier(0.34, 1.56, 0.64, 1);
	}
	.seg button {
		position: relative;
		min-height: 38px;
		border: 0;
		border-radius: 9px;
		background: none;
		font-size: 14px;
		font-weight: 600;
		color: var(--muted);
		transition: color 0.2s var(--ease);
	}
	.seg button[aria-checked='true'] { color: var(--text); }
	.seg-in { display: inline-flex; align-items: center; justify-content: center; gap: 7px; }
	.seg-in.pop { animation: seg-pop 0.45s var(--ease); }
	@keyframes seg-pop {
		30% { transform: scale(1.14, 0.86); }
		55% { transform: scale(0.94, 1.08); }
		80% { transform: scale(1.03, 0.98); }
	}
	@media (min-width: 640px) { .seg { max-width: 360px; } }

	/* Orden: switch-píldora compacto (distinto al seg). Un pulgar-marquesina se desliza entre las dos: telón y foquitos. */
	.sort {
		position: relative;
		display: inline-grid;
		grid-template-columns: 1fr 1fr;
		margin-top: 10px;
		border: 1px solid var(--border);
		border-radius: 999px;
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
		box-shadow: 0 4px 14px color-mix(in srgb, var(--c) 28%, transparent), inset 0 1px 0 rgb(255 255 255 / 0.08), inset 0 0 0 1px color-mix(in srgb, var(--c) 35%, transparent);
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
		border-radius: 999px;
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

	/* Estrenos desde: atajos con una píldora que salta, y una tira de película que se arrastra. */
	.since { margin-top: 14px; }
	.since-head { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
	.since-label { font-size: 12.5px; font-weight: 600; color: var(--muted); text-transform: uppercase; letter-spacing: 0.06em; }
	/* Desde – hasta: dos valores gemelos, subrayados con el color de su cabezal (ámbar / azul). */
	.since-val { display: inline-flex; align-items: baseline; gap: 8px; font-size: 18px; font-weight: 700; letter-spacing: -0.01em; font-variant-numeric: tabular-nums; }
	.since-val b, .to-val { display: inline-block; animation: tick-in 0.25s var(--out); }
	.since-val b { font-weight: inherit; }
	.since-val.live b { color: var(--amber); }
	.since-dash { color: var(--muted); font-weight: 400; }
	.since-to {
		display: inline-flex;
		align-items: baseline;
		gap: 5px;
		padding: 10px 4px;
		margin: -10px -4px;
		font: inherit;
		color: var(--muted);
		background: none;
		border: 0;
		cursor: pointer;
		transition: color 0.2s;
	}
	/* Sin hasta: "hoy" tenue con subrayado punteado, invita a tocar. Con hasta: firme, y una × discreta. */
	.since-to:hover, .since-to.on { color: var(--text); }
	.since-to :global(svg) { align-self: center; color: var(--muted); }
	@keyframes tick-in { from { transform: translateY(40%); opacity: 0; filter: blur(2px); } }

	.presets {
		position: relative;
		display: flex;
		gap: 2px;
		margin: 8px -16px 0;
		padding: 0 16px;
		overflow-x: auto;
		scrollbar-width: none;
	}
	.presets::-webkit-scrollbar { display: none; }
	.presets button {
		position: relative;
		flex: none;
		min-height: 34px;
		padding: 0 13px;
		border: 0;
		border-radius: 999px;
		background: none;
		color: var(--muted);
		font-size: 13.5px;
		font-weight: 600;
		transition: color 0.25s var(--ease);
	}
	.presets button[aria-checked='true'] { color: var(--accent-text); }
	.preset-pill {
		position: absolute;
		top: 0;
		left: 0;
		height: 34px;
		width: var(--w);
		border-radius: 999px;
		background: var(--accent);
		box-shadow: 0 4px 14px color-mix(in srgb, var(--accent) 45%, transparent);
		transform: translateX(var(--x)) scale(0.6);
		opacity: 0;
		transition: transform 0.55s cubic-bezier(0.34, 1.56, 0.64, 1), width 0.45s cubic-bezier(0.34, 1.56, 0.64, 1), opacity 0.2s;
	}
	.preset-pill.on { transform: translateX(var(--x)); opacity: 1; }

	/* Tira de película: perforaciones arriba y abajo; lo elegido (desde → hoy) queda "revelado" y brilla. */
	.reel {
		position: relative;
		height: 64px;
		margin-top: 10px;
		border-radius: 14px;
		background:
			radial-gradient(circle at 50% 50%, var(--bg) 2.2px, transparent 2.8px) 0 5px / 14px 8px repeat-x,
			radial-gradient(circle at 50% 50%, var(--bg) 2.2px, transparent 2.8px) 0 calc(100% - 5px) / 14px 8px repeat-x,
			repeating-linear-gradient(270deg, color-mix(in srgb, var(--muted) 22%, transparent) 0 1px, transparent 1px var(--tick)),
			var(--surface-2);
		touch-action: none;
		cursor: ew-resize;
		user-select: none;
		-webkit-user-select: none;
		overflow: hidden;
		outline-offset: 3px;
	}
	.reel-lit {
		position: absolute;
		inset: 14px calc(100% - var(--to-at)) 14px var(--at);
		background: linear-gradient(90deg, color-mix(in srgb, var(--amber) 55%, transparent), color-mix(in srgb, var(--accent) 35%, transparent));
		transition: left 0.45s cubic-bezier(0.34, 1.56, 0.64, 1), right 0.45s cubic-bezier(0.34, 1.56, 0.64, 1);
	}
	.reel.zooming .reel-lit, .reel.zooming .playhead { transition-property: transform; }
	.reel.live .reel-lit { transition: none; animation: flicker 0.3s steps(2) infinite; }
	@keyframes flicker { 50% { opacity: 0.82; } }
	.decade {
		position: absolute;
		top: 50%;
		translate: -50% -50%;
		font-size: 10.5px;
		font-weight: 700;
		color: var(--muted);
		font-variant-numeric: tabular-nums;
		pointer-events: none;
		animation: tick-in 0.25s var(--out);
	}
	.playhead {
		position: absolute;
		top: 4px;
		bottom: 4px;
		left: var(--at);
		width: 4px;
		margin-left: -2px;
		border-radius: 4px;
		background: var(--text);
		box-shadow: 0 0 0 3px color-mix(in srgb, var(--amber) 40%, transparent), 0 0 18px var(--amber);
		transition: left 0.45s cubic-bezier(0.34, 1.56, 0.64, 1), transform 0.2s var(--out);
	}
	.reel.live .playhead { transition: transform 0.2s var(--out); transform: scaleY(1.08) scaleX(1.5); }
	/* Cabezal "hasta": sale desde hoy (borde derecho) estirándose; al cerrar vuelve a hoy y se apaga. */
	.playhead.until {
		left: min(var(--at), calc(100% - 4px));
		background: var(--accent);
		box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 40%, transparent), 0 0 18px var(--accent);
		opacity: 0;
		visibility: hidden;
		transform: scaleY(0);
		transition: left 0.45s cubic-bezier(0.34, 1.56, 0.64, 1), opacity 0.25s, transform 0.4s cubic-bezier(0.34, 1.56, 0.64, 1), visibility 0s 0.4s;
	}
	.playhead.until.on { opacity: 1; visibility: visible; transform: none; transition-delay: 0s; }
	.reel.live .playhead.until.on { transform: scaleY(1.08) scaleX(1.5); }

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
		border-radius: var(--radius);
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
		border-radius: 999px;
		background: var(--accent);
		color: var(--accent-text);
		font-size: 11px;
		line-height: 17px;
		text-align: center;
		animation: pop 0.35s var(--out);
	}
	@keyframes pop { from { transform: scale(0.4); opacity: 0; } }
	.sep { flex: none; width: 3px; height: 3px; border-radius: 50%; background: currentColor; opacity: 0.6; }

	main { padding: 14px 16px calc(24px + var(--safe-bottom)); }
	.cta {
		display: flex;
		flex-direction: column;
		gap: 2px;
		padding: 12px 14px;
		margin-bottom: 12px;
		border-radius: var(--radius-card);
		background: color-mix(in srgb, var(--accent) 14%, var(--surface));
		border: 1px solid color-mix(in srgb, var(--accent) 35%, transparent);
		text-decoration: none;
		font-size: 14px;
	}
	.grid {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 14px 10px;
	}
	@media (min-width: 640px) { .grid { grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 20px 14px; } }
	.card { display: block; text-decoration: none; }
	.card img, .noposter, .poster-skel {
		width: 100%;
		height: auto;
		aspect-ratio: 2 / 3;
		border-radius: 10px;
		background: var(--surface-2);
		object-fit: cover;
		box-shadow: 0 1px 3px var(--shadow);
	}
	.card:active img { transform: scale(0.97); }
	.card img { transition: transform 0.15s var(--ease); }
	.noposter { display: grid; place-items: center; padding: 8px; text-align: center; font-size: 13px; color: var(--muted); }
	.meta { display: flex; flex-direction: column; padding: 6px 2px 0; }
	.title { font-size: 13px; font-weight: 600; line-height: 1.25; display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
	.sub { display: flex; gap: 6px; align-items: center; font-size: 12px; color: var(--muted); }
	.rate { position: relative; display: inline-flex; align-items: center; gap: 2px; color: var(--yellow); }
	/* El conteo cambia el texto en cada frame: ancho fijo y `contain` para que no recalcule la grilla entera. */
	.num { display: inline-block; min-width: 2.6ch; font-variant-numeric: tabular-nums; contain: layout paint; }
	/* Entrada: sube, crece con rebote y se enfoca; la estrella gira y suelta un destello cuando la tarjeta aterriza. */
	/* overflow: hidden recorta el brillo, que se mueve con transform (sin repintar cada frame). */
	a.card { --t: calc(var(--i, 0) * 70ms); position: relative; overflow: hidden; animation: card-in 0.9s cubic-bezier(0.25, 0.8, 0.3, 1) var(--t) backwards var(--play, paused); }
	/* Las que llegan scrolleando: entrada corta, escalonado mínimo y desde medio visibles (en pausa ya se ven). */
	a.card:global(.late) { --t: calc(min(var(--i, 0), 4) * 35ms); animation-name: card-rise; animation-duration: 0.6s; }
	/* Brillo que cruza el póster después del giro. */
	a.card::after {
		content: '';
		position: absolute;
		inset: 0 0 auto;
		aspect-ratio: 2 / 3;
		border-radius: 10px;
		background: linear-gradient(100deg, transparent 25%, rgb(255 255 255 / 0.22) 45%, rgb(190 225 255 / 0.16) 55%, transparent 75%);
		opacity: 0;
		pointer-events: none;
		animation: shine 0.8s ease-in-out calc(var(--t) + 450ms) var(--play, paused);
	}
	/* Fundido abajo: las tarjetas se pierden en el fondo antes del borde de la pantalla. */
	.grid::after {
		content: '';
		position: fixed;
		inset: auto 0 0;
		height: 110px;
		background: linear-gradient(transparent, var(--bg) 85%);
		pointer-events: none;
		z-index: 5;
	}
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
		a.card, a.card::after, .rate :global(svg), .rate::before, .num, .intro .head-top > *, .intro .filters { animation: none; }
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
	.proj-body { position: absolute; left: 20px; top: 72px; width: 130px; height: 46px; border-radius: 10px; background: var(--surface-3); box-shadow: inset 0 0 0 2px var(--border-strong); }
	.proj-body::after { content: ''; position: absolute; right: -16px; top: 12px; width: 18px; height: 22px; border-radius: 3px 8px 8px 3px; background: var(--border-strong); }
	.proj-beam {
		position: absolute;
		left: 166px;
		top: 58px;
		width: 60px;
		height: 74px;
		background: linear-gradient(90deg, color-mix(in srgb, var(--amber) 55%, transparent), transparent);
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
	@keyframes spin { to { transform: rotate(360deg); } }
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

	/* Hoja de filtros: lista agrupada como los ajustes del sistema. */
	.gh.first { margin-top: 4px; }
	/* Votos: una sola fila que se desliza de costado. */
	.vote-chips { display: flex; gap: 8px; margin: 0 -16px; padding: 2px 16px 4px; overflow-x: auto; scrollbar-width: none; }
	.vote-chips::-webkit-scrollbar { display: none; }
	.vote-chips .chip { font-variant-numeric: tabular-nums; }
	.lang-seg { margin-top: 0; }
	.gh { margin: 20px 0 10px; font-size: 13px; font-weight: 650; color: var(--muted); }
	.genre-chips { display: flex; flex-wrap: wrap; gap: 10px 8px; }
	.sheet-actions {
		position: sticky;
		bottom: -16px;
		display: grid;
		grid-template-columns: 1fr 1.6fr;
		gap: 8px;
		margin: 20px -16px -16px;
		padding: 12px 16px 16px;
		background: var(--surface);
		border-top: 1px solid var(--border);
	}
</style>
