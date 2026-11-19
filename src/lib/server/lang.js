// Idiomas del pedido en curso (los fija hooks.server.js), así nadie los pasa a mano:
// - `ui`: textos de la app y errores.
// - `titles`: títulos de películas, series y capítulos (lo que se le pide a TMDB).
import { AsyncLocalStorage } from 'node:async_hooks';
import { translate } from '../i18n/translate.js';

/** @typedef {import('../i18n/translate.js').Langs} Langs */
/** @type {AsyncLocalStorage<Langs>} */
export const langStore = new AsyncLocalStorage();
const now = () => langStore.getStore() ?? { ui: 'es', titles: 'es' };
export const lang = () => now().ui;
export const titlesLang = () => now().titles;
/** @param {string} s @param {Record<string, string | number>} [vars] */
export const tx = (s, vars) => translate(lang(), s, vars);
