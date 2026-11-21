// Panel de uso: resumen de entradas, usuarios (por dispositivo, con su apodo) y lo que hizo cada uno.
// shortcut: contraseña fija en env guardada tal cual en una cookie; si hay datos sensibles, pasar a login real.
// Con el mismo límite de intentos que el código de acceso (lib/server/intentos.js), aparte por IP.
import { fail, redirect } from '@sveltejs/kit';
import { sql } from '#lib/server/track.js';
import { attempt } from '#lib/server/intentos.js';

export async function load({ cookies, url, getClientAddress }) {
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
	const dev = url.searchParams.get('d');
	const [resumen, dias, dispositivos, eventos] = await Promise.all([
		q`SELECT count(*) FILTER (WHERE accion = 'entrar')::int AS entradas,
			count(DISTINCT dispositivo)::int AS dispositivos,
			count(*) FILTER (WHERE accion = 'entrar' AND fecha > now() - interval '1 day')::int AS hoy
			FROM eventos`,
		q`SELECT to_char(date_trunc('day', fecha AT TIME ZONE 'America/Argentina/Buenos_Aires'), 'DD/MM') AS dia,
			count(*)::int AS entradas, count(DISTINCT dispositivo)::int AS dispositivos
			FROM eventos WHERE accion = 'entrar' AND fecha > now() - interval '14 days'
			GROUP BY 1, date_trunc('day', fecha AT TIME ZONE 'America/Argentina/Buenos_Aires') ORDER BY date_trunc('day', fecha AT TIME ZONE 'America/Argentina/Buenos_Aires') DESC`,
		// Un usuario = un dispositivo con su último apodo; más reciente arriba. Reproducciones = links copiados.
		q`SELECT dispositivo, (array_agg(equipo ORDER BY fecha DESC))[1] AS equipo, min(fecha) AS primera, max(fecha) AS ultima,
			(array_agg(apodo ORDER BY fecha DESC) FILTER (WHERE apodo IS NOT NULL))[1] AS apodo,
			(array_agg(lugar ORDER BY fecha DESC) FILTER (WHERE lugar IS NOT NULL))[1] AS lugar,
			(array_agg(zona ORDER BY fecha DESC) FILTER (WHERE zona IS NOT NULL))[1] AS zona,
			(array_agg(modelo ORDER BY fecha DESC) FILTER (WHERE modelo IS NOT NULL))[1] AS modelo,
			(array_agg(dato ORDER BY fecha DESC) FILTER (WHERE accion = 'entrar' AND dato IS NOT NULL))[1] AS pantalla,
			(array_agg(dato ORDER BY fecha DESC) FILTER (WHERE accion = 'copiar link'))[1] AS ultimo,
			count(*) FILTER (WHERE accion = 'copiar link')::int AS reproducciones,
			count(*) FILTER (WHERE accion = 'entrar')::int AS entradas, count(*)::int AS acciones
			FROM eventos GROUP BY dispositivo ORDER BY max(fecha) DESC LIMIT 200`,
		dev ? q`SELECT id::int, accion, dato, lugar, fecha FROM eventos WHERE dispositivo = ${dev} ORDER BY fecha DESC LIMIT 500` : Promise.resolve([])
	]);
	return {
		locked: false,
		resumen: /** @type {{entradas: number, dispositivos: number, hoy: number}} */ (/** @type {any[]} */ (resumen)[0]),
		dias: /** @type {{dia: string, entradas: number, dispositivos: number}[]} */ (dias),
		dispositivos: /** @type {{dispositivo: string, equipo: string | null, apodo: string | null, lugar: string | null, zona: string | null, modelo: string | null, pantalla: string | null, ultimo: string | null, primera: string, ultima: string, reproducciones: number, entradas: number, acciones: number}[]} */ (dispositivos),
		eventos: /** @type {{id: number, accion: string, dato: string | null, lugar: string | null, fecha: string}[]} */ (eventos),
		dev
	};
}

export const actions = {
	default: async ({ request, cookies, url, getClientAddress }) => {
		const pass = String((await request.formData()).get('pass') ?? '');
		if (!process.env.ADMIN_PASSWORD) return fail(401, { wrong: true });
		const r = await attempt(`admin:${getClientAddress()}`, pass, process.env.ADMIN_PASSWORD);
		if (!r.ok) return fail(r.wait ? 429 : 401, { wrong: true, wait: r.wait });
		cookies.set('admin', pass, { path: '/', maxAge: 60 * 60 * 24 * 365, httpOnly: true, sameSite: 'lax', secure: url.protocol === 'https:' });
		redirect(303, '/admin');
	}
};
