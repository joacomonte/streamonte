// Traducción con claves en español (como gettext): en español el texto queda igual; en inglés sale de `EN`.
// Un solo diccionario para la web y el servidor. `{x}` se reemplaza por `vars.x`.
import EN from './en.js';

/** @typedef {'es' | 'en'} Lang */

/** @param {Lang} lang @param {string} s @param {Record<string, string | number>} [vars] */
export function translate(lang, s, vars) {
	const out = lang === 'en' ? (/** @type {Record<string, string>} */ (EN)[s] ?? s) : s;
	return vars ? out.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? '')) : out;
}

/** Idioma de un pedido: la cookie `lang` y, si no hay, español (sin mirar el navegador). @param {string | undefined} cookie @param {string | null} _accept @returns {Lang} */
export const pickLang = (cookie, _accept) => (cookie === 'en' ? 'en' : 'es');

/** @typedef {{ui: Lang, titles: Lang}} Langs */
/** Las dos preferencias a partir de sus cookies (`lang`, `titles`). Sin elegir, todo
 * va en el idioma de la app. @param {(name: string) => string | undefined} cookie @param {string | null} accept @returns {Langs} */
export function pickLangs(cookie, accept) {
	const ui = pickLang(cookie('lang'), accept);
	const t = cookie('titles');
	const titles = t === 'es' || t === 'en' ? t : ui;
	return { ui, titles };
}

/** Locale para fechas y números. @param {Lang} lang */
export const locale = (lang) => (lang === 'en' ? 'en-US' : 'es-AR');
