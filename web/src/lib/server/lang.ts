// Idiomas del pedido en curso (los fija hooks.server.js), así nadie los pasa a mano:
// - `ui`: textos de la app y errores.
// - `titles`: títulos de películas, series y capítulos (lo que se le pide a TMDB).
import { AsyncLocalStorage } from 'node:async_hooks';
import { translate } from '../i18n/translate.ts';
import type { Lang, Langs } from '../i18n/translate.ts';

export const langStore = new AsyncLocalStorage<Langs>();
const now = (): Langs => langStore.getStore() ?? { ui: 'es', titles: 'es' };
export const lang = (): Lang => now().ui;
export const titlesLang = (): Lang => now().titles;
export const tx = (s: string, vars?: Record<string, string | number>): string => translate(lang(), s, vars);
