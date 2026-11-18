// Idioma del pedido en curso (lo fija hooks.server.js): TMDB y los mensajes de error lo usan sin pasarlo a mano.
import { AsyncLocalStorage } from 'node:async_hooks';
import { translate } from '../i18n/translate.js';

/** @type {AsyncLocalStorage<import('../i18n/translate.js').Lang>} */
export const langStore = new AsyncLocalStorage();
export const lang = () => langStore.getStore() ?? 'es';
/** @param {string} s @param {Record<string, string | number>} [vars] */
export const tx = (s, vars) => translate(lang(), s, vars);
