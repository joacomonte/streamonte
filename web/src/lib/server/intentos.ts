// Límite de intentos de los códigos (acceso en hooks.server.js y panel en /admin): 5 fallos seguidos desde una IP
// (cada uno a menos de 15 min del anterior) la bloquean 15 min, aunque después acierte. Tabla `intentos` en Neon
// (db/schema.sql); sin DATABASE_URL no hay límite.
import { createHash, timingSafeEqual } from 'node:crypto';
import { sql } from './track.ts';

const MAX = 5;

/** Compara en tiempo constante (hashea antes: así el largo tampoco se filtra). */
export const same = (a: string, b: string): boolean =>
	timingSafeEqual(createHash('sha256').update(a).digest(), createHash('sha256').update(b).digest());

/** Prueba un código. `wait`: minutos que faltan si la IP está bloqueada.
 * `key`: `app:<ip>` o `admin:<ip>`; `value`: el código que llegó; `pass`: el correcto. */
export async function attempt(key: string, value: string, pass: string): Promise<{ ok: boolean; wait?: number }> {
	const q = sql();
	if (!q) return { ok: same(value, pass) };
	try {
		const [row] = (await q`SELECT fallos, ultimo, hasta > now() AS vivo, ceil(extract(epoch FROM hasta - now()) / 60)::int AS wait FROM intentos WHERE ip = ${key}`) as {
			fallos: number;
			ultimo: string | null;
			vivo: boolean;
			wait: number;
		}[];
		if (row?.vivo && row.fallos >= MAX) return { ok: false, wait: row.wait };
		if (same(value, pass)) {
			if (row) await q`DELETE FROM intentos WHERE ip = ${key}`;
			return { ok: true };
		}
		// El mismo código errado otra vez (la cookie vieja en varios pedidos): ya se contó.
		if (row?.vivo && row.ultimo === value) return { ok: false };
		const [out] = (await q`INSERT INTO intentos AS prev (ip, fallos, hasta, ultimo) VALUES (${key}, 1, now() + interval '15 minutes', ${value.slice(0, 40)})
				ON CONFLICT (ip) DO UPDATE SET fallos = CASE WHEN prev.hasta > now() THEN prev.fallos + 1 ELSE 1 END,
					hasta = now() + interval '15 minutes', ultimo = EXCLUDED.ultimo
				RETURNING fallos`) as { fallos: number }[];
		return out.fallos >= MAX ? { ok: false, wait: 15 } : { ok: false };
	} catch (e) {
		// Sin tabla o sin base: el código se valida igual, sin límite.
		console.error('intentos', e);
		return { ok: same(value, pass) };
	}
}
