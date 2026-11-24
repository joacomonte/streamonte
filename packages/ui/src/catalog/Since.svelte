<script lang="ts">
	// "Estrenos desde → hasta": una tira de película que se arrastra, con el título, el año (pegado al cabezal) y "hoy"
	// adentro (2026-11-23, variante 3A: sin atajos ni encabezado aparte).
	import { untrack } from 'svelte';
	import Icon from '../components/Icon.svelte';
	import { t } from '../i18n/runtime.ts';
	import { BACK, backLabel, type Filters } from './filters.ts';
	import type { CatalogStore } from './store.ts';

	interface Props {
		store: CatalogStore;
		/** Cambia los filtros (la pantalla vuelve arriba y registra el cambio). */
		onset: (changes: Partial<Filters>) => void;
	}
	let { store, onset }: Props = $props();
	const st = $derived(store.st);

	/* Estrenos desde → hasta (hoy, salvo que se abra el segundo cabezal): una línea de tiempo que se arrastra. */
	const LAST = BACK.length - 1;
	const YEAR = new Date().getFullYear();
	/** Meses hacia atrás hasta 1950 (el borde izquierdo con zoom al máximo). */
	const MAX = BACK[LAST];
	/** Meses (continuos) → paso de BACK más cercano: meses sueltos bajo el año, años enteros arriba. */
	const snap = (m: number) => (m < 11.5 ? Math.max(0, Math.round(m)) : Math.min(MAX, Math.round(m / 12) * 12));
	/** Meses de BACK mientras se arrastra, desde y hasta (-1 = quieto). */
	let scrub = $state(-1);
	let scrubTo = $state(-1);
	const shownM = $derived(scrub >= 0 ? scrub : BACK[Math.max(1, BACK.indexOf(st.f.from))]);
	const shownIdx = $derived(BACK.indexOf(shownM));
	const shownTo = $derived(scrubTo >= 0 ? scrubTo : Math.min(st.f.to, BACK[shownIdx - 1]));
	const toIdx = $derived(BACK.indexOf(shownTo));
	/** Segundo cabezal ("hasta"): abierto a mano o porque ya hay un hasta distinto de hoy. */
	let untilOpen = $state(false);
	const showTo = $derived(untilOpen || st.f.to > 0);
	function toggleTo() {
		if (!showTo) return void (untilOpen = true);
		untilOpen = false;
		if (st.f.to) onset({ to: 0 });
	}
	/** Zoom: la tira muestra `span` meses (hoy a la derecha); se abre cuanto más atrás va el valor. */
	const still = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
	/** Deja aire a la izquierda del valor: los años más viejos se ven antes de llegar. */
	const spanTo = $derived(Math.min(MAX, Math.max(24, shownM * 2.2)));
	let span = $state(untrack(() => Math.min(MAX, Math.max(24, BACK[Math.max(1, BACK.indexOf(st.f.from))] * 2.2))));
	let zooming = $state(false);
	$effect(() => {
		const to = spanTo;
		if (still()) return void (span = to);
		zooming = true;
		let raf = 0;
		let t0 = performance.now();
		const step = (t: number) => {
			span += (to - span) * (1 - Math.exp(-(t - t0) / 140));
			t0 = t;
			if (Math.abs(to - span) < 0.3) return void ((span = to), (zooming = false));
			raf = requestAnimationFrame(step);
		};
		raf = requestAnimationFrame(step);
		return () => cancelAnimationFrame(raf);
	});
	/** % desde la izquierda de algo que pasó hace `m` meses, según el zoom actual. */
	const at = (m: number) => Math.max(0, 100 * (1 - m / span));
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
	 * en el borde izquierdo, -1 en el derecho. */
	type Drag = { x: number; t: number; m: number; v: number; moved: number; to: boolean; stop: boolean; l: number; w: number; edge: number };
	let drag: Drag | null = null;
	/** rAF de la inercia al soltar rápido (0 = quieta). */
	let glide = 0;
	/** rAF del avance solo mientras el dedo queda en un borde (0 = no). */
	let edge = 0;
	/** Rango permitido del cabezal que se mueve: siempre queda al menos un paso entre hasta y desde. */
	const range = (to: boolean) => (to ? [0, BACK[shownIdx - 1]] : [BACK[toIdx + 1], MAX]);
	/** Agarra el cabezal más cercano al dedo y congela ambos valores. */
	function scrubDown(e: PointerEvent & { currentTarget: HTMLElement }) {
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
	 * píxeles de la tira, así el zoom no cambia la velocidad. */
	function scrubMove(e: PointerEvent) {
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
		const step = (t: number) => {
			held += (t - t0) / 1000;
			const pace = Math.min(30, 3 + 8 * held); // pasos (meses o años) por segundo
			if (nudge(d, (-dir * (d.m < 12 ? 1 : 12) * pace * (t - t0)) / 1000, true)) return void (edge = 0);
			t0 = t;
			edge = requestAnimationFrame(step);
		};
		edge = requestAnimationFrame(step);
	}
	/** Mueve el cabezal `dx` px (o `dx` meses si `months`); true si topó con un límite.
	 */
	function nudge(d: Drag, dx: number, months = false) {
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
		if (from !== st.f.from || to !== st.f.to) onset({ from, to });
	}
	/** Suelta: aplica. Un toque sin arrastrar salta a donde tocaste (con el zoom de ese momento). */
	function scrubUp(e: PointerEvent & { currentTarget: HTMLElement }) {
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
			const step = (t: number) => {
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
	/** Flechas ±1 paso, Re/Av Pág ±10. */
	const keyStep = (e: KeyboardEvent) => (({ ArrowLeft: 1, ArrowDown: 1, ArrowRight: -1, ArrowUp: -1, PageDown: 10, PageUp: -10 }) as Record<string, number>)[e.key] ?? 0;
	function scrubKey(e: KeyboardEvent) {
		const step = keyStep(e);
		if (!step) return;
		e.preventDefault();
		onset({ from: BACK[Math.min(LAST, Math.max(toIdx + 1, shownIdx + step))] });
	}
	function untilKey(e: KeyboardEvent) {
		e.stopPropagation();
		const step = keyStep(e);
		if (!step) return;
		e.preventDefault();
		onset({ to: BACK[Math.min(shownIdx - 1, Math.max(0, toIdx + step))] });
	}
	/** Texto de un valor: meses sueltos ("hace 3 meses") o el año. */
	const valueText = (m: number) => (m < 12 ? backLabel(m) : String(YEAR - m / 12));
	/** La etiqueta del año pasa al lado izquierdo del cabezal cuando este queda cerca de la derecha. */
	const flip = $derived(at(shownM) < 16);

</script>

				<div class="since">
					<div
						id="since-slider"
						class="reel"
						class:live={scrub >= 0}
						class:zooming
						class:flip
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
						<span class="reel-label" aria-hidden="true">{t('Estrenos desde')}</span>
						<span class="playhead" aria-hidden="true"></span>
						{#key shownM}<span id="since-value" class="tag" aria-hidden="true">{valueText(shownM)}</span>{/key}
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
						<!-- "hoy" (o el hasta elegido): tocarlo abre/cierra el segundo cabezal; no arrastra la tira. -->
						<button id="since-to" type="button" class="since-to" class:on={showTo} aria-pressed={showTo} title={t(showTo ? 'Volver a hasta hoy' : 'Elegir hasta cuándo')}
							onpointerdown={(e) => e.stopPropagation()} onclick={toggleTo}>
							{#key shownTo}<span class="to-val">{shownTo === 0 ? t('hoy') : valueText(shownTo)}</span>{/key}{#if showTo}<Icon name="close" size={11} />{/if}
						</button>
					</div>
				</div>

<style>
	/* Estrenos desde: una tira de película con todo adentro (título, año en el cabezal, "hoy"). */
	.since { margin-top: 10px; }
	.reel-label { position: absolute; left: 12px; top: 17px; z-index: 1; font-size: 11px; font-weight: 700; color: var(--muted); text-transform: uppercase; letter-spacing: 0.07em; pointer-events: none; }
	/* El año, pegado al cabezal por la izquierda (2026-11-24); pasa a su derecha cuando el cabezal queda cerca del borde izquierdo. */
	.tag {
		position: absolute;
		top: 50%;
		left: var(--at);
		z-index: 2;
		translate: calc(-100% - 10px) -50%;
		padding: 3px 9px;
		border-radius: var(--r-xs);
		/* Placa ámbar llena (2026-11-24: la de vidrio tenue no se veía). */
		background: var(--amber);
		box-shadow: 0 4px 14px color-mix(in srgb, var(--amber) 40%, transparent), 0 0 0 1px rgb(0 0 0 / 0.25);
		color: #1a1204;
		font-size: 15px;
		font-weight: 800;
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
		pointer-events: none;
		transition: left 0.45s cubic-bezier(0.34, 1.56, 0.64, 1);
		animation: tick-in 0.25s var(--out);
	}
	.reel.flip .tag { translate: 10px -50%; }
	.reel.live .tag { transition: none; }
	.since-to {
		position: absolute;
		right: 6px;
		top: 50%;
		z-index: 2;
		translate: 0 -50%;
		display: inline-flex;
		align-items: center;
		gap: 5px;
		min-height: 44px;
		padding: 0 8px;
		border: 0;
		border-radius: var(--r-sm);
		background: none;
		font-size: 15px;
		font-weight: 700;
		font-variant-numeric: tabular-nums;
		color: var(--text);
		cursor: pointer;
	}
	.since-to.on { color: var(--accent-fg); }
	.since-to :global(svg) { color: var(--muted); }
	.to-val { display: inline-block; animation: tick-in 0.25s var(--out); }
	@keyframes tick-in { from { transform: translateY(40%); opacity: 0; filter: blur(2px); } }

	/* Tira de película: perforaciones arriba y abajo; lo elegido (desde → hoy) queda "revelado" y brilla. */
	.reel {
		position: relative;
		height: 76px;
		border-radius: var(--r-card);
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
		inset: 12px calc(100% - var(--to-at)) 12px var(--at);
		background: linear-gradient(90deg, color-mix(in srgb, var(--amber) var(--tint-4), transparent), color-mix(in srgb, var(--accent) var(--tint-3), transparent));
		transition: left 0.45s cubic-bezier(0.34, 1.56, 0.64, 1), right 0.45s cubic-bezier(0.34, 1.56, 0.64, 1);
	}
	.reel.zooming .reel-lit, .reel.zooming .playhead { transition-property: transform; }
	.reel.live .reel-lit { transition: none; animation: flicker 0.3s steps(2) infinite; }
	@keyframes flicker { 50% { opacity: 0.82; } }
	.decade {
		position: absolute;
		bottom: 14px;
		translate: -50% 0;
		font-size: 10px;
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

</style>
