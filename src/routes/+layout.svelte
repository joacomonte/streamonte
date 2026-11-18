<script>
	import '../app.css';
	import favicon from '#lib/assets/favicon.svg';
	import Tour from '#lib/Tour.svelte';
	import { device, markSeen, seen, welcomeSteps } from '#lib/tours.js';
	import { i18n, t } from '#lib/i18n.svelte.js';

	/** @type {{data: {langs: import('#lib/i18n/translate.js').Langs, info: 'titles' | 'app'}, children: import('svelte').Snippet}} */
	let { data, children } = $props();
	// El idioma que decidió el servidor (cookie o navegador), antes del primer render (también en el servidor, donde
	// no corren los efectos); después lo cambia el toggle.
	(() => Object.assign(i18n, { lang: data.langs.ui, titles: data.langs.titles, info: data.info }))();

	// Bienvenida: una sola vez, al entrar por primera vez (después del código de acceso). Vista o salteada, no vuelve.
	let welcomeOpen = $state(false);
	$effect(() => {
		if (!seen('welcome')) welcomeOpen = true;
	});
	// Se rearma al cambiar el idioma en el primer paso: el resto del tutorial ya sale en el elegido.
	const welcome = $derived(welcomeOpen ? welcomeSteps(device()) : null);

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
	<Tour id="welcome" label={t('Bienvenida')} open steps={welcome} onclose={() => { markSeen('welcome'); welcomeOpen = false; }} />
{/if}
