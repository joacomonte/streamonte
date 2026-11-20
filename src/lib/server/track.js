// Registro simple de uso: qué dispositivo hizo qué y cuándo, en la tabla `eventos` de Neon (esquema en db/schema.sql).
// El dispositivo es un id al azar en la cookie `dev` (la pone hooks.server.js); sin DATABASE_URL no registra nada.
import { neon } from '@neondatabase/serverless';

/** @type {ReturnType<typeof neon> | null} */
let db = null;
export const sql = () => (db ??= process.env.DATABASE_URL ? neon(process.env.DATABASE_URL) : null);

/** @param {import('@sveltejs/kit').RequestEvent} event @param {string} accion @param {string} [dato] @param {string} [deviceId] el del link de la tele (otro navegador) */
export async function track(event, accion, dato, deviceId) {
	const q = sql();
	if (!q) return;
	const dev = deviceId || event.cookies.get('dev') || 'sin-cookie';
	const h = event.request.headers;
	const equipo = (h.get('user-agent') ?? '').slice(0, 300);
	// Ubicación aproximada por IP que manda Vercel (en local no viene).
	const city = h.get('x-vercel-ip-city');
	const lugar = [city && decodeURIComponent(city), h.get('x-vercel-ip-country-region'), h.get('x-vercel-ip-country')].filter(Boolean).join(', ') || null;
	try {
		await q`INSERT INTO eventos (dispositivo, equipo, accion, dato, lugar) VALUES (${dev}, ${equipo}, ${accion.slice(0, 40)}, ${dato?.slice(0, 300) ?? null}, ${lugar})`;
		// Retención de 90 días (lo dice Ajustes > Privacidad): 1 de cada 50 avisos borra lo viejo, sin cron.
		// shortcut: depende de que haya uso; si pasa meses sin nadie, lo viejo espera al próximo aviso.
		if (Math.random() < 0.02) await q`DELETE FROM eventos WHERE fecha < now() - interval '90 days'`;
	} catch (e) {
		console.error('track', e);
	}
}
