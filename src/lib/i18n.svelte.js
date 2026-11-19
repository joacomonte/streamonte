// Idiomas elegidos por el usuario. Los subtítulos no dependen de esto: siempre priorizan español.
// - `lang`: textos de la app.
// - `titles`: títulos de películas, series y capítulos (TMDB).
// Sinopsis y géneros siempre van en el idioma de la app.
import { translate, locale, pickLangs } from './i18n/translate.js';

/** @typedef {import('./i18n/translate.js').Lang} Lang */

/** En el navegador arranca de lo que decidió el servidor (`<html lang>` y las cookies): los `load` corren antes que
 * el layout y la clave de la caché ya tiene que ir en el idioma correcto.
 * @returns {{lang: Lang, titles: Lang}} */
function initial() {
	if (typeof document === 'undefined') return { lang: 'es', titles: 'es' };
	const cookie = (/** @type {string} */ n) => document.cookie.match(new RegExp(`(?:^|; )${n}=([^;]*)`))?.[1];
	const ui = document.documentElement.lang === 'en' ? 'en' : 'es';
	const l = pickLangs((n) => (n === 'lang' ? ui : cookie(n)), null);
	return { lang: l.ui, titles: l.titles };
}

/** @type {{lang: Lang, titles: Lang}} */
export const i18n = $state(initial());

/** Texto en el idioma de la app; la clave es el texto en español. @param {string} s @param {Record<string, string | number>} [vars] */
export const t = (s, vars) => translate(i18n.lang, s, vars);
/** Locale para `toLocaleDateString` y números. */
export const loc = () => locale(i18n.lang);
/** Idiomas en que llega lo de TMDB (títulos y sinopsis): la caché de esas respuestas va por esta clave. */
export const contentKey = () => `${i18n.titles}.${i18n.lang}`;

/** @param {string} name @param {string} value */
const save = (name, value) => {
	document.cookie = `${name}=${value}; path=/; max-age=31536000; samesite=lax${location.protocol === 'https:' ? '; secure' : ''}`;
};

/** Idioma de la app. @param {Lang} lang */
export function setLang(lang) {
	// Sin idioma de títulos elegido, queda fijo el que había: el toggle de la app no cambia los títulos.
	if (!/(?:^|; )titles=/.test(document.cookie)) save('titles', i18n.titles);
	i18n.lang = lang;
	save('lang', lang);
	document.documentElement.lang = lang;
}
/** Idioma de los títulos. @param {Lang} titles */
export function setTitles(titles) {
	i18n.titles = titles;
	save('titles', titles);
}
