// Apodo del usuario (web y desktop): lo pide la bienvenida (obligatorio) y se cambia en Ajustes, siempre con su código de
// animales (web: apodo.svelte.ts; desktop y compartido: nick-flow.svelte.ts). La sesión es la cookie firmada `apodo` (lib/server/apodo-session.ts).
// El mismo validador corre en el navegador (error al toque) y en el servidor.

/** Letras (con acentos y ñ) separadas por un solo espacio. */
const NICK = /^\p{L}+( \p{L}+)*$/u;

/** Limpia y valida un apodo: recorta, junta espacios repetidos, primera letra mayúscula y el resto en minúscula.
 * `error` es la clave en español para `t()`/`tx()`. */
export function cleanNick(raw: unknown): { nick?: string; error?: string } {
	const s = String(raw ?? '').normalize('NFC').trim().replace(/\s+/g, ' ');
	if (!s) return { error: 'Escribí tu apodo' };
	if (!NICK.test(s)) return { error: 'Solo letras y espacios' };
	if (s.length < 2 || s.length > 20) return { error: 'Entre 2 y 20 letras' };
	return { nick: s[0].toUpperCase() + s.slice(1).toLowerCase() };
}
