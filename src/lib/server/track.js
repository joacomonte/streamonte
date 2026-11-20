// Registro simple de uso: qué dispositivo hizo qué y cuándo, en la tabla `eventos` de Neon.
// El dispositivo es un id al azar en la cookie `dev` (la pone hooks.server.js); sin DATABASE_URL no registra nada.
import { neon } from '@neondatabase/serverless';

/** @type {ReturnType<typeof neon> | null} */
let db = null;
export const sql = () => (db ??= process.env.DATABASE_URL ? neon(process.env.DATABASE_URL) : null);

/** @param {import('@sveltejs/kit').RequestEvent} event @param {string} accion @param {string} [dato] */
export async function track(event, accion, dato) {
	const q = sql();
	if (!q) return;
	const dev = event.cookies.get('dev') ?? 'sin-cookie';
	const equipo = (event.request.headers.get('user-agent') ?? '').slice(0, 300);
	try {
		await q`INSERT INTO eventos (dispositivo, equipo, accion, dato) VALUES (${dev}, ${equipo}, ${accion.slice(0, 40)}, ${dato?.slice(0, 300) ?? null})`;
	} catch (e) {
		console.error('track', e);
	}
}
