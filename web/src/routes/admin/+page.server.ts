// Panel de uso: resumen, usuarios (por apodo, con todos sus dispositivos) y lo que hizo cada uno.
// shortcut: contraseña fija en env guardada tal cual en una cookie; si hay datos sensibles, pasar a login real.
// Con el mismo límite de intentos que el código de acceso (lib/server/intentos.js), aparte por IP.
import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { sql } from '#lib/server/track.ts';
import { attempt } from '#lib/server/intentos.ts';

export const load: PageServerLoad = async ({ cookies, url, getClientAddress }) => {
	const pass = process.env.ADMIN_PASSWORD;
	const admin = cookies.get('admin');
	if (!pass || !admin) return { locked: true };
	// La cookie también cuenta como intento: si no, se podría probar códigos poniéndola a mano.
	const r = await attempt(`admin:${getClientAddress()}`, admin, pass);
	if (!r.ok) {
		cookies.delete('admin', { path: '/' });
		return { locked: true, wait: r.wait };
	}
	const q = sql();
	if (!q) return { locked: false, noDb: true };
	// Usuario abierto: por apodo (`u`) o, si nunca puso apodo, por dispositivo (`d`). /api/nick le pone el apodo a lo
	// que el dispositivo hizo antes, así que sin apodo quedan solo los que nunca lo eligieron.
	const nick = url.searchParams.get('u');
	const dev = nick ? null : url.searchParams.get('d');
	const quien = nick ? q`apodo = ${nick}` : q`apodo IS NULL AND dispositivo = ${dev}`;
	const [resumen, dias, usuarios, equipos, eventos] = await Promise.all([
		// Entradas quedan contadas pero en segundo plano (el panel destaca usuarios y reproducciones).
		q`SELECT count(*) FILTER (WHERE accion = 'entrar')::int AS entradas,
			count(*) FILTER (WHERE accion = 'entrar' AND fecha > now() - interval '1 day')::int AS hoy,
			count(DISTINCT COALESCE(apodo, dispositivo))::int AS usuarios,
			(count(DISTINCT COALESCE(apodo, dispositivo)) FILTER (WHERE fecha > now() - interval '1 day'))::int AS activos,
			count(*) FILTER (WHERE accion = 'copiar link')::int AS reproducciones
			FROM eventos`,
		q`SELECT to_char(date_trunc('day', fecha AT TIME ZONE 'America/Argentina/Buenos_Aires'), 'DD/MM') AS dia,
			count(*)::int AS entradas, count(DISTINCT COALESCE(apodo, dispositivo))::int AS usuarios
			FROM eventos WHERE accion = 'entrar' AND fecha > now() - interval '14 days'
			GROUP BY 1, date_trunc('day', fecha AT TIME ZONE 'America/Argentina/Buenos_Aires') ORDER BY date_trunc('day', fecha AT TIME ZONE 'America/Argentina/Buenos_Aires') DESC`,
		// Un usuario = un apodo con todos sus dispositivos (sin apodo: uno por dispositivo); más reciente arriba.
		// Reproducciones = links copiados. `equipo`/`pantalla` solo sirven para nombrar a los sin apodo.
		q`SELECT apodo, CASE WHEN apodo IS NULL THEN dispositivo END AS dispositivo, max(fecha) AS ultima,
			(array_agg(equipo ORDER BY fecha DESC))[1] AS equipo,
			(array_agg(dato ORDER BY fecha DESC) FILTER (WHERE accion = 'entrar' AND dato IS NOT NULL))[1] AS pantalla,
			(array_agg(dato ORDER BY fecha DESC) FILTER (WHERE accion = 'copiar link'))[1] AS ultimo,
			count(*) FILTER (WHERE accion = 'copiar link')::int AS reproducciones,
			count(DISTINCT dispositivo)::int AS dispositivos
			FROM eventos GROUP BY apodo, CASE WHEN apodo IS NULL THEN dispositivo END ORDER BY max(fecha) DESC LIMIT 200`,
		// Dispositivos del usuario abierto, con lo último que se sabe de cada uno.
		nick || dev
			? q`SELECT dispositivo, (array_agg(equipo ORDER BY fecha DESC))[1] AS equipo, min(fecha) AS primera, max(fecha) AS ultima,
				(array_agg(lugar ORDER BY fecha DESC) FILTER (WHERE lugar IS NOT NULL))[1] AS lugar,
				(array_agg(zona ORDER BY fecha DESC) FILTER (WHERE zona IS NOT NULL))[1] AS zona,
				(array_agg(modelo ORDER BY fecha DESC) FILTER (WHERE modelo IS NOT NULL))[1] AS modelo,
				(array_agg(dato ORDER BY fecha DESC) FILTER (WHERE accion = 'entrar' AND dato IS NOT NULL))[1] AS pantalla,
				count(*) FILTER (WHERE accion = 'copiar link')::int AS reproducciones,
				count(*) FILTER (WHERE accion = 'entrar')::int AS entradas, count(*)::int AS acciones
				FROM eventos WHERE ${quien} GROUP BY dispositivo ORDER BY max(fecha) DESC`
			: Promise.resolve([]),
		// Su actividad sin los 'entrar' (ruido), salvo el primero: es cuando llegó (dentro de los 90 días que se guardan).
		nick || dev
			? q`SELECT id::int, accion, dato, fecha, dispositivo, zona FROM eventos WHERE ${quien}
				AND (accion <> 'entrar' OR id = (SELECT id FROM eventos WHERE ${quien} AND accion = 'entrar' ORDER BY fecha LIMIT 1))
				ORDER BY fecha DESC LIMIT 500`
			: Promise.resolve([])
	]);
	return {
		locked: false,
		resumen: (resumen as unknown[])[0] as { entradas: number; hoy: number; usuarios: number; activos: number; reproducciones: number },
		dias: dias as { dia: string; entradas: number; usuarios: number }[],
		usuarios: usuarios as { apodo: string | null; dispositivo: string | null; equipo: string | null; pantalla: string | null; ultimo: string | null; ultima: string; reproducciones: number; dispositivos: number }[],
		equipos: equipos as { dispositivo: string; equipo: string | null; lugar: string | null; zona: string | null; modelo: string | null; pantalla: string | null; primera: string; ultima: string; reproducciones: number; entradas: number; acciones: number }[],
		eventos: eventos as { id: number; accion: string; dato: string | null; fecha: string; dispositivo: string; zona: string | null }[],
		nick,
		dev
	};
};

export const actions: Actions = {
	login: async ({ request, cookies, url, getClientAddress }) => {
		const pass = String((await request.formData()).get('pass') ?? '');
		if (!process.env.ADMIN_PASSWORD) return fail(401, { wrong: true });
		const r = await attempt(`admin:${getClientAddress()}`, pass, process.env.ADMIN_PASSWORD);
		if (!r.ok) return fail(r.wait ? 429 : 401, { wrong: true, wait: r.wait });
		cookies.set('admin', pass, { path: '/', maxAge: 60 * 60 * 24 * 365, httpOnly: true, sameSite: 'lax', secure: url.protocol === 'https:' });
		redirect(303, '/admin');
	},
	/** Borra todo lo registrado de un usuario (por apodo, o por dispositivo si nunca puso apodo): usuarios de prueba
	 * o que entraron sin nombre. Si ese equipo vuelve a usar la app, aparece de nuevo con lo nuevo. */
	borrar: async ({ request, cookies }) => {
		const pass = process.env.ADMIN_PASSWORD;
		if (!pass || cookies.get('admin') !== pass) return fail(401, { wrong: true });
		const q = sql();
		if (!q) return fail(503, { noDb: true });
		const f = await request.formData();
		const nick = String(f.get('u') ?? '');
		const dev = String(f.get('d') ?? '');
		if (nick) await q`DELETE FROM eventos WHERE apodo = ${nick}`;
		else if (dev) await q`DELETE FROM eventos WHERE apodo IS NULL AND dispositivo = ${dev}`;
		redirect(303, '/admin');
	}
};
