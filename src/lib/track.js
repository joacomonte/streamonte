/** Avisa al servidor una acción del usuario (ver /admin). No espera respuesta ni falla.
 * @param {string} accion @param {string} [dato] */
export function track(accion, dato) {
	try {
		// `z`: zona horaria del navegador, para ver en el panel la hora local de cada uno.
		navigator.sendBeacon('/api/track', JSON.stringify({ a: accion, d: dato, z: Intl.DateTimeFormat().resolvedOptions().timeZone }));
	} catch {
		/* sin red o sin sendBeacon: no importa */
	}
}
