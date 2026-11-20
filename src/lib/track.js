/** Avisa al servidor una acción del usuario (ver /admin). No espera respuesta ni falla.
 * @param {string} accion @param {string} [dato] */
export function track(accion, dato) {
	try {
		navigator.sendBeacon('/api/track', JSON.stringify({ a: accion, d: dato }));
	} catch {
		/* sin red o sin sendBeacon: no importa */
	}
}
