<script>
	import '../app.css';
	import favicon from '#lib/assets/favicon.svg';

	/** @type {{children: import('svelte').Snippet}} */
	let { children } = $props();

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
	<link rel="icon" href={favicon} />
	<meta name="theme-color" content="#0d1014" media="(prefers-color-scheme: dark)" />
	<meta name="theme-color" content="#f6f7f9" media="(prefers-color-scheme: light)" />
	<meta name="apple-mobile-web-app-capable" content="yes" />
	<title>Streamonte</title>
</svelte:head>

{@render children()}
