// Apodo del usuario: lo pide la bienvenida (obligatorio) y se cambia en Ajustes. Vive en la cookie `nick` (legible,
// 5 años, como `dev`); la pone /api/nick, que lo vuelve a validar, y la lee track() del servidor.
// El mismo validador corre en el navegador (error al toque) y en el servidor (la cookie se puede tocar a mano).

/** Letras (con acentos y ñ) separadas por un solo espacio. */
const NICK = /^\p{L}+( \p{L}+)*$/u;

/** Limpia y valida un apodo: recorta, junta espacios repetidos, primera letra mayúscula y el resto en minúscula.
 * `error` es la clave en español para `t()`/`tx()`.
 * @param {unknown} raw @returns {{nick?: string, error?: string}} */
export function cleanNick(raw) {
	const s = String(raw ?? '').normalize('NFC').trim().replace(/\s+/g, ' ');
	if (!s) return { error: 'Escribí tu apodo' };
	if (!NICK.test(s)) return { error: 'Solo letras y espacios' };
	if (s.length < 2 || s.length > 20) return { error: 'Entre 2 y 20 letras' };
	return { nick: s[0].toUpperCase() + s.slice(1).toLowerCase() };
}

/** Lo guarda en el servidor (cookie + apodo en lo que ya registró este dispositivo).
 * @param {string} raw @returns {Promise<{nick?: string, error?: string}>} */
export async function saveNick(raw) {
	const c = cleanNick(raw);
	if (!c.nick) return c;
	try {
		const r = await fetch('/api/nick', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ nick: c.nick }) });
		const j = await r.json();
		return r.ok ? { nick: j.nick } : { error: j.message };
	} catch {
		return { error: 'No se pudo guardar. Probá de nuevo.' };
	}
}
