// Caché del navegador (localStorage), una sola regla para toda la web. Sobrevive a deploys: el prefijo es fijo y
// no depende del build; si cambia el formato de un dato, se sube su versión en `V` y solo ese se descarta.
// Sin storage (privado, bloqueado, servidor) todo sigue andando: `get` da null y `put` no hace nada.
import { contentKey } from './i18n.svelte.js';

const PREFIX = 'saved:';
const KEEP = 'keep:';
export const HOUR = 60 * 60 * 1000;
export const DAY = 24 * HOUR;
/** Versión del formato de cada respuesta, por ruta de la API. */
const V = { catalog: 1, genres: 1, title: 3, season: 1, scores: 1, torrents: 1 };

/** Clave de una URL de la API, con su versión y los idiomas de TMDB (títulos.sinopsis):
 * `/api/catalog?…` → `catalog@1:es.es/api/catalog?…`. @param {string} url */
const keyOf = (url) => {
	const kind = /** @type {keyof typeof V} */ (url.split('/')[2]?.split('?')[0] ?? '');
	return `${kind}@${V[kind] ?? 0}:${contentKey()}${url}`;
};

/** Lo guardado si todavía está vigente; si no, null. @param {string} key @returns {any} */
export function get(key) {
	try {
		const v = JSON.parse(localStorage.getItem(PREFIX + key) ?? 'null');
		return v && Date.now() < v.until ? v.data : null;
	} catch {
		return null;
	}
}

/** Guarda `data` por `ttl` ms. Antes borra lo vencido; si igual no entra, vacía la caché y prueba una vez más.
 * @param {string} key @param {unknown} data @param {number} ttl */
export function put(key, data, ttl) {
	try {
		const item = JSON.stringify({ until: Date.now() + ttl, data });
		for (const k of cachedKeys()) if (!(Date.now() < (JSON.parse(localStorage.getItem(k) ?? '{}').until ?? 0))) localStorage.removeItem(k);
		try {
			localStorage.setItem(PREFIX + key, item);
		} catch {
			for (const k of cachedKeys()) localStorage.removeItem(k);
			localStorage.setItem(PREFIX + key, item);
		}
	} catch {
		// Lleno o bloqueado: queda sin guardar.
	}
}

/** La respuesta guardada y vigente de una URL de la API, ya (sin esperar): para pintar sin un cuadro de carga
 * intermedio. null si no hay. @param {string} url @returns {any} */
export const peek = (url) => get(keyOf(url));

/** GET a la API con caché: si hay una respuesta vigente la devuelve sin pedir; si no, pide y guarda solo las ok.
 * @param {typeof fetch} f el `fetch` de SvelteKit en un `load`, o el global @param {string} url @param {number} ttl
 * @returns {Promise<{ok: boolean, status: number, data: any}>} */
export async function json(f, url, ttl) {
	const key = keyOf(url);
	const hit = get(key);
	if (hit != null) return { ok: true, status: 200, data: hit };
	const r = await f(url);
	const data = await r.json();
	if (r.ok) put(key, data, ttl);
	return { ok: r.ok, status: r.status, data };
}

/** @returns {string[]} */
const cachedKeys = () => Object.keys(localStorage).filter((k) => k.startsWith(PREFIX));

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

/** "Borrar caché": todo lo que la web guarda en este navegador (caché, preferencias, tutoriales vistos,
 * sessionStorage, IndexedDB, Cache Storage y service workers). No toca cookies: el código de acceso sigue. */
export async function wipe() {
	try {
		localStorage.clear();
		sessionStorage.clear();
	} catch {
		// Bloqueado: nada que borrar.
	}
	const dbs = await indexedDB?.databases?.().catch(() => []) ?? [];
	for (const d of dbs) if (d.name) indexedDB.deleteDatabase(d.name);
	if ('caches' in window) for (const k of await caches.keys()) await caches.delete(k);
	for (const r of (await navigator.serviceWorker?.getRegistrations()) ?? []) await r.unregister();
}
