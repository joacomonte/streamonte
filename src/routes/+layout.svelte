<script>
	import '../app.css';
	import favicon from '#lib/assets/favicon.svg';
	import Tour from '#lib/Tour.svelte';
	import { device, markSeen, seen, welcomeSteps } from '#lib/tours.js';
	import { i18n, t } from '#lib/i18n.svelte.js';

	/** @type {{data: {lang: 'es' | 'en'}, children: import('svelte').Snippet}} */
	let { data, children } = $props();
	// El idioma que decidió el servidor (cookie o navegador), antes del primer render (también en el servidor, donde
	// no corren los efectos); después lo cambia el toggle.
	(() => (i18n.lang = data.lang))();

	// Bienvenida: una sola vez, al entrar por primera vez (después del código de acceso). Vista o salteada, no vuelve.
	let welcome = $state(/** @type {import('#lib/tours.js').Step[] | null} */ (null));
	$effect(() => {
		if (!seen('welcome')) welcome = welcomeSteps(device());
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

{#if welcome}
	<Tour id="welcome" label={t('Bienvenida')} open steps={welcome} onclose={() => { markSeen('welcome'); welcome = null; }} />
{/if}
