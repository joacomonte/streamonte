import type { HandleClientError } from '@sveltejs/kit/hooks';

// Pestaña vieja tras un deploy: el chunk de la ruta ya no existe y Kit mostraría "500". Una carga completa baja la versión nueva.
const CHUNK_FAIL = /dynamically imported module|importing a module script failed/i;

export const handleError: HandleClientError = ({ error, event }) => {
	if (!CHUNK_FAIL.test(String((error as Error)?.message ?? error))) return;
	try {
		// Anti-bucle: si ya recargamos hace <10 s y vuelve a fallar, se muestra el error.
		const last = Number(sessionStorage.getItem('chunk-reload') ?? 0);
		if (Date.now() - last < 10_000) return;
		sessionStorage.setItem('chunk-reload', String(Date.now()));
		location.href = event.url.href;
	} catch {
		// sin sessionStorage no se puede proteger del bucle: no recargamos
	}
};
