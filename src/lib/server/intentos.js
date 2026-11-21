// Límite de intentos de los códigos (acceso en hooks.server.js y panel en /admin): 5 fallos seguidos desde una IP
// (cada uno a menos de 15 min del anterior) la bloquean 15 min, aunque después acierte. Tabla `intentos` en Neon
// (db/schema.sql); sin DATABASE_URL no hay límite.
import { sql } from './track.js';

const MAX = 5;

/** Prueba un código. `wait`: minutos que faltan si la IP está bloqueada.
 * @param {string} key `app:<ip>` o `admin:<ip>` @param {string} value el código que llegó @param {string} pass el correcto
 * @returns {Promise<{ok: boolean, wait?: number}>} */
export async function attempt(key, value, pass) {
	const q = sql();
	if (!q) return { ok: value === pass };
	try {
		const [row] = /** @type {{fallos: number, ultimo: string | null, vivo: boolean, wait: number}[]} */ (
			await q`SELECT fallos, ultimo, hasta > now() AS vivo, ceil(extract(epoch FROM hasta - now()) / 60)::int AS wait FROM intentos WHERE ip = ${key}`
		);
		if (row?.vivo && row.fallos >= MAX) return { ok: false, wait: row.wait };
		if (value === pass) {
			if (row) await q`DELETE FROM intentos WHERE ip = ${key}`;
			return { ok: true };
		}
		// El mismo código errado otra vez (la cookie vieja en varios pedidos): ya se contó.
		if (row?.vivo && row.ultimo === value) return { ok: false };
		const [out] = /** @type {{fallos: number}[]} */ (
			await q`INSERT INTO intentos AS prev (ip, fallos, hasta, ultimo) VALUES (${key}, 1, now() + interval '15 minutes', ${value.slice(0, 40)})
				ON CONFLICT (ip) DO UPDATE SET fallos = CASE WHEN prev.hasta > now() THEN prev.fallos + 1 ELSE 1 END,
					hasta = now() + interval '15 minutes', ultimo = EXCLUDED.ultimo
				RETURNING fallos`
		);
		return out.fallos >= MAX ? { ok: false, wait: 15 } : { ok: false };
	} catch (e) {
		// Sin tabla o sin base: el código se valida igual, sin límite.
		console.error('intentos', e);
		return { ok: value === pass };
	}
}
