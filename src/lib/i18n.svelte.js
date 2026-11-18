// Idioma de la interfaz (ES / EN). Los subtítulos no dependen de esto: siempre priorizan español.
import { translate, locale } from './i18n/translate.js';

/** En el navegador arranca del `<html lang>` que puso el servidor: los `load` corren antes que el layout y la clave
 * de la caché ya tiene que ir en el idioma correcto. @type {{lang: import('./i18n/translate.js').Lang}} */
export const i18n = $state({ lang: typeof document !== 'undefined' && document.documentElement.lang === 'en' ? 'en' : 'es' });

/** Texto en el idioma elegido; la clave es el texto en español. @param {string} s @param {Record<string, string | number>} [vars] */
export const t = (s, vars) => translate(i18n.lang, s, vars);
/** Locale para `toLocaleDateString` y números. */
export const loc = () => locale(i18n.lang);

/** Cambia el idioma: queda en una cookie (el servidor la lee para TMDB y para el primer render). @param {'es' | 'en'} lang */
export function setLang(lang) {
	i18n.lang = lang;
	document.cookie = `lang=${lang}; path=/; max-age=31536000; samesite=lax${location.protocol === 'https:' ? '; secure' : ''}`;
	document.documentElement.lang = lang;
}
