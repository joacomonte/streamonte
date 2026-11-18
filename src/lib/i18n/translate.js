// Traducción con claves en español (como gettext): en español el texto queda igual; en inglés sale de `EN`.
// Un solo diccionario para la web y el servidor. `{x}` se reemplaza por `vars.x`.
import EN from './en.js';

/** @typedef {'es' | 'en'} Lang */

/** @param {Lang} lang @param {string} s @param {Record<string, string | number>} [vars] */
export function translate(lang, s, vars) {
	const out = lang === 'en' ? (/** @type {Record<string, string>} */ (EN)[s] ?? s) : s;
	return vars ? out.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? '')) : out;
}

/** Idioma de un pedido: la cookie `lang` y, si no hay, el del navegador. @param {string | undefined} cookie @param {string | null} accept @returns {Lang} */
export const pickLang = (cookie, accept) => (cookie === 'es' || cookie === 'en' ? cookie : /^es\b/i.test(accept ?? '') ? 'es' : accept ? 'en' : 'es');

/** Locale para fechas y números. @param {Lang} lang */
export const locale = (lang) => (lang === 'en' ? 'en-US' : 'es-AR');
