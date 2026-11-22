// Registro simple de uso: qué dispositivo hizo qué y cuándo, en la tabla `eventos` de Neon (esquema en db/schema.sql).
// El dispositivo es un id al azar en la cookie `dev` (la pone hooks.server.js); sin DATABASE_URL no registra nada.
import { neon } from '@neondatabase/serverless';
import type { RequestEvent } from '@sveltejs/kit';
import { cleanNick } from '../nick.ts';

let db: ReturnType<typeof neon> | null = null;
export const sql = () => (db ??= process.env.DATABASE_URL ? neon(process.env.DATABASE_URL) : null);

/** `deviceId`: el del link de la tele (otro navegador). `zona`: zona horaria IANA del navegador. */
export async function track(event: RequestEvent, accion: string, dato?: string, deviceId?: string, zona?: string): Promise<void> {
	const q = sql();
	if (!q) return;
	const dev = deviceId || event.cookies.get('dev') || 'sin-cookie';
	const h = event.request.headers;
	const equipo = (h.get('user-agent') ?? '').slice(0, 300);
	// Ubicación aproximada por IP que manda Vercel (en local no viene).
	const city = h.get('x-vercel-ip-city');
	const lugar = [city && decodeURIComponent(city), h.get('x-vercel-ip-country-region'), h.get('x-vercel-ip-country')].filter(Boolean).join(', ') || null;
	// Modelo del celu Android: Chrome lo manda porque hooks.server.js lo pide con Accept-CH (vienen entre comillas).
	const model = h.get('sec-ch-ua-model')?.replace(/"/g, '').trim();
	const version = h.get('sec-ch-ua-platform-version')?.replace(/"/g, '').split('.')[0];
	const platform = h.get('sec-ch-ua-platform')?.replace(/"/g, '');
	const modelo = model ? `${model}${platform && version ? ` · ${platform} ${version}` : ''}`.slice(0, 80) : null;
	// Apodo: el de la cookie; sin cookie (play.html, en otro navegador), el último conocido de ese dispositivo.
	const apodo = cleanNick(event.cookies.get('nick')).nick ?? null;
	try {
		await q`INSERT INTO eventos (dispositivo, equipo, accion, dato, lugar, apodo, zona, modelo)
			VALUES (${dev}, ${equipo}, ${accion.slice(0, 40)}, ${dato?.slice(0, 300) ?? null}, ${lugar},
				COALESCE(${apodo}::text, (SELECT apodo FROM eventos WHERE dispositivo = ${dev} AND apodo IS NOT NULL ORDER BY fecha DESC LIMIT 1)),
				${zona ?? null}, ${modelo})`;
		// Retención de 90 días (lo dice Ajustes > Privacidad): 1 de cada 50 avisos borra lo viejo, sin cron.
		// shortcut: depende de que haya uso; si pasa meses sin nadie, lo viejo espera al próximo aviso.
		if (Math.random() < 0.02) await q`DELETE FROM eventos WHERE fecha < now() - interval '90 days'`;
	} catch (e) {
		console.error('track', e);
	}
}
