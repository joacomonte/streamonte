<script lang="ts">
	import '../app.css';
	import type { LayoutProps } from './$types';
	import favicon from '$ui/assets/logo.svg';
	import Tour from '$ui/components/Tour.svelte';
	import { markSeen, nickStep, seen, welcomeSteps } from '$ui/components/tours.ts';
	import { i18n, syncLangs, t } from '#lib/i18n.svelte.ts';
	import { updated } from '$app/state';
	import { beforeNavigate, invalidateAll, onNavigate } from '$app/navigation';
	import { setContext } from 'svelte';
	import { setApi } from '$ui/context.ts';
	import { webApi } from '#lib/webApi.ts';
	import Icon from '$ui/components/Icon.svelte';
	import Updating from '$ui/components/Updating.svelte';
	import { track } from '#lib/track.ts';
	import { langOptions } from '#lib/langs.ts';
	import { saveNick } from '#lib/nick.ts';
	import { installTypeFx } from '$ui/components/type-fx.ts';

	// Letras que entran desenfocadas al escribir, en todos los campos de texto.
	$effect(() => installTypeFx());

	let { data, children }: LayoutProps = $props();
	setApi(webApi);
	// Con versión nueva, los chunks viejos ya no existen: navegar con carga completa en vez de client-side.
	beforeNavigate(({ willUnload, to, cancel }) => {
		if (updated.current && !willUnload && to?.url) { cancel(); location.href = to.url.href; }
	});
	// El idioma que decidió el servidor (cookie o navegador), antes del primer render (también en el servidor, donde
	// no corren los efectos); después lo cambia el toggle.
	(() => syncLangs({ lang: data.langs.ui, titles: data.langs.titles }))();

	// Bienvenida: una sola vez, al entrar por primera vez (después del código de acceso). Vista o salteada, no vuelve.
	let welcomeOpen = $state(false);
	// Quien ya vio la bienvenida y no tiene apodo (la vio antes de que existiera): solo el paso del apodo, sin salida.
	let nickOpen = $state(false);
	// Una vez por carga de la app, antes que los avisos de la página (los efectos de las hijas corren primero). La pantalla
	// (en puntos y densidad) deja adivinar el modelo de iPhone, que Safari no informa.
	if (typeof window !== 'undefined') track('entrar', `${screen.width}x${screen.height}@${devicePixelRatio}`);
	/** La bienvenida tapa la portada (deja de taparla al empezar a salir): la portada guarda su entrada para ese momento. */
	let touring = $state(false);
	setContext('touring', () => touring);
	$effect(() => {
		if (!seen('welcome')) welcomeOpen = touring = true;
		else if (!data.nick) nickOpen = true;
	});
	/** Guarda el apodo; el saludo de la portada lo lee de los datos del layout. */
	const onnick = async (raw: string) => {
		const r = await saveNick(raw);
		if (r.nick) invalidateAll();
		return r;
	};
	// Se rearma al cambiar el idioma en su paso: el resto del tutorial ya sale en el elegido.
	const welcome = $derived(welcomeOpen ? welcomeSteps() : null);

	// Actualizar: la pantalla completa aparece al instante y recién después de pintarla se recarga (en celu la recarga tarda).
	let reloading = $state(false);
	const reloadNow = () => {
		reloading = true;
		requestAnimationFrame(() => requestAnimationFrame(() => location.reload()));
	};

	// Grilla ↔ ficha con View Transitions: el póster tocado vuela a su lugar en la ficha y, al volver, a su casilla.
	// Sin soporte, navegación normal; sin el póster de destino (o con movimiento reducido), solo un fundido.
	onNavigate((nav) => {
		const from = nav.from?.route.id, to = nav.to?.route.id;
		const open = from === '/' && to === '/t/[kind]/[id]';
		if (!document.startViewTransition || !(open || (from === '/t/[kind]/[id]' && to === '/'))) return;
		const motion = !matchMedia('(prefers-reduced-motion: reduce)').matches;
		const card = `a.card[href="${(open ? nav.to : nav.from)?.url.pathname}"]`;
		const named: HTMLElement[] = [];
		/** Solo el póster visible: uno fuera de pantalla volaría desde (o hacia) afuera. */
		const name = (el: HTMLElement | null) => {
			const r = el?.getBoundingClientRect();
			if (!el || !r || !motion || r.bottom < 0 || r.top > innerHeight) return;
			el.style.viewTransitionName = 'poster';
			named.push(el);
		};
		name(document.querySelector(open ? `${card} img` : '#poster'));
		document.documentElement.dataset.vt = open ? 'open' : 'close';
		return new Promise((resolve) => {
			const vt = document.startViewTransition(async () => {
				resolve();
				await nav.complete;
				if (open) return name(document.querySelector('#poster'));
				// La casilla de destino aterriza quieta (sin el giro de entrada) para que el póster caiga en su lugar.
				const back = document.querySelector<HTMLElement>(card);
				if (back && named.length) back.style.animation = 'none';
				if (named.length) name(document.querySelector(`${card} img`));
			});
			vt.ready.catch(() => {});
			vt.finished.catch(() => {}).finally(() => {
				for (const el of named) el.style.viewTransitionName = '';
				delete document.documentElement.dataset.vt;
			});
		});
	});

	// Solo en desarrollo. Al cambiar de app el celu corta la conexión con Vite, y al volver Vite recarga la página
	// siempre. Se frena esa recarga (el listener no termina nunca) y, cada vez que la app vuelve a verse, se recarga
	// solo si el código cambió desde el corte. Mientras tanto no hay recarga en caliente: llega al volver a la app.
	if (import.meta.hot && typeof document !== 'undefined') {
		let lost = 0;
		import.meta.hot.on('vite:ws:disconnect', () => {
			lost = Date.now();
			return new Promise(() => {});
		});
		document.addEventListener('visibilitychange', async () => {
			if (!lost || document.visibilityState !== 'visible') return;
			const r = await fetch('/api/dev-stamp').catch(() => null);
			if (r?.ok && (await r.json()).changed > lost) location.reload();
		});
	}
</script>

<svelte:head>
	<link rel="icon" type="image/svg+xml" href={favicon} />
	<link rel="apple-touch-icon" href="/apple-touch-icon.png" />
	<meta name="theme-color" content="#0d1014" media="(prefers-color-scheme: dark)" />
	<meta name="theme-color" content="#f6f7f9" media="(prefers-color-scheme: light)" />
	<meta name="apple-mobile-web-app-capable" content="yes" />
	<title>Streamonte</title>
</svelte:head>

{@render children()}

<!-- Versión nueva publicada (la app instalada en el celu queda abierta días): se ofrece recargar. -->
{#if updated.current}
	<div id="update-bar" class="update" role="status">
		<span>{t('Hay una versión nueva')}</span>
		<button id="update-now" type="button" class="update-btn" onclick={reloadNow}><Icon name="download" size={16} />{t('Actualizar')}</button>
	</div>
{/if}

{#if reloading}<Updating detail={t('Cargando la versión nueva…')} />{/if}

{#if welcome}
	<Tour id="welcome" label={t('Bienvenida')} open steps={welcome} nick={data.nick} {onnick} langs={langOptions()} confetti onleave={() => (touring = false)} onclose={() => { markSeen('welcome'); welcomeOpen = touring = false; }} />
{/if}

{#if nickOpen}
	<Tour id="nick" label={t('Tu apodo')} open steps={[nickStep()]} nick={data.nick} {onnick} onclose={() => (nickOpen = false)} />
{/if}

<style>
	.update {
		position: fixed;
		left: 12px;
		right: 12px;
		bottom: calc(12px + var(--safe-bottom));
		z-index: 60;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		max-width: 520px;
		margin: 0 auto;
		padding: 8px 8px 8px 16px;
		border-radius: var(--r-card);
		background: var(--raised);
		box-shadow: 0 8px 28px var(--shadow-lg);
		font-size: 14.5px;
		font-weight: 600;
		animation: update-in 0.4s var(--out);
	}
	.update-btn { display: inline-flex; align-items: center; gap: 6px; min-height: 40px; padding: 0 14px; border: 0; border-radius: var(--r-md); background: var(--accent); color: var(--accent-text); font-size: 14px; font-weight: 700; }
	.update-btn:active { transform: scale(0.97); }
	@keyframes update-in { from { transform: translateY(24px); opacity: 0; } }
	@media (prefers-reduced-motion: reduce) { .update { animation: none; } }

	/* Grilla ↔ ficha. El póster usa solo la imagen nueva (en vivo, nítida) y se levanta en el vuelo. */
	/* Solo transform y opacity: los filtros (blur, drop-shadow) sobre capturas de pantalla entera traban en el celu. */
	:global(::view-transition-group(poster)) { animation-duration: 0.6s; animation-timing-function: cubic-bezier(0.3, 0.9, 0.2, 1); z-index: 2; }
	:global(::view-transition-old(poster)) { animation: none; opacity: 0; }
	:global(::view-transition-new(poster)) { animation: none; height: 100%; object-fit: cover; }
	:global(::view-transition-image-pair(poster)) { animation: vt-lift 0.6s cubic-bezier(0.3, 0.9, 0.2, 1); border-radius: var(--r-md); overflow: hidden; }
	/* Abrir: el catálogo se hunde y desenfoca detrás; cerrar: la ficha baja y se apaga mientras vuelve el catálogo.
	   Con movimiento reducido queda el fundido corto por defecto del navegador. */
	@media (prefers-reduced-motion: no-preference) {
		:global(html[data-vt='open']::view-transition-old(root)) { animation: vt-recede 0.45s var(--ease) both; }
		:global(html[data-vt='open']::view-transition-new(root)) { animation: vt-fade 0.35s var(--ease) 0.08s both; }
		:global(html[data-vt='close']::view-transition-old(root)) { animation: vt-drop 0.4s var(--ease) both; }
		:global(html[data-vt='close']::view-transition-new(root)) { animation: vt-return 0.5s var(--out) both; }
	}
	@keyframes -global-vt-lift { 45% { transform: scale(1.08) rotate(-1.5deg); } }
	@keyframes -global-vt-recede { to { opacity: 0; transform: scale(0.94); } }
	@keyframes -global-vt-fade { from { opacity: 0; } }
	@keyframes -global-vt-drop { to { opacity: 0; transform: translateY(28px) scale(0.98); } }
	@keyframes -global-vt-return { from { opacity: 0; transform: scale(1.03); } }

</style>
