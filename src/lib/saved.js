// Respuestas guardadas 1 hora en el navegador (localStorage), como en el desktop. Sin storage, todo sigue andando:
// `get` da null y `put` no hace nada. En el cliente porque en Vercel la memoria del servidor no dura entre pedidos.
const PREFIX = 'saved:';
const TTL = 60 * 60 * 1000;
const KEEP = 'keep:';

/** Claves guardadas (con prefijo). @returns {string[]} */
const savedKeys = () => Object.keys(localStorage).filter((k) => k.startsWith(PREFIX));

/** Lo guardado para `key` si tiene menos de 1 hora; si no, null. @param {string} key @returns {any} */
export function get(key) {
	try {
		const v = JSON.parse(localStorage.getItem(PREFIX + key) ?? 'null');
		return v && Date.now() - v.at < TTL ? v.data : null;
	} catch {
		return null;
	}
}

/** Guarda `data` para `key`; antes borra lo vencido para que no crezca sin tope. @param {string} key @param {unknown} data */
export function put(key, data) {
	try {
		for (const k of savedKeys()) if (!(Date.now() - (JSON.parse(localStorage.getItem(k) ?? '{}').at ?? 0) < TTL)) localStorage.removeItem(k);
		localStorage.setItem(PREFIX + key, JSON.stringify({ at: Date.now(), data }));
	} catch {
		// Lleno o bloqueado: queda sin guardar, como antes.
	}
}

/** Para siempre (datos que no cambian, como qué subtítulos trae un torrent): otro prefijo, así el borrado de lo
 * vencido no los toca. @param {string} key @returns {any} */
export function recall(key) {
	try {
		return JSON.parse(localStorage.getItem(KEEP + key) ?? 'null');
	} catch {
		return null;
	}
}
/** @param {string} key @param {unknown} data */
export function remember(key, data) {
	try {
		localStorage.setItem(KEEP + key, JSON.stringify(data));
	} catch {
		// Lleno o bloqueado: no queda guardado.
	}
}

/** Borra todo lo guardado. @returns {number} cuántas borró */
export function clear() {
	try {
		const ks = savedKeys();
		for (const k of ks) localStorage.removeItem(k);
		return ks.length;
	} catch {
		return 0;
	}
}
