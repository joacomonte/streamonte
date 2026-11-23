// Datos de los selectores de idioma (bienvenida y Ajustes): nombres y el ejemplo real de título traducido.
import type { LangCode } from './tour-state.ts';

/** Cada idioma con su nombre en su propio idioma. */
export const LANGS = [['es', 'Español'], ['en', 'English']] as const;

/** La Odisea (Nolan, 2026), con el título y el póster de TMDB en cada idioma. */
export const SAMPLE_TITLE: Record<LangCode, string> = { es: 'La Odisea', en: 'The Odyssey' };
export const SAMPLE_POSTER: Record<LangCode, string> = {
	es: 'https://image.tmdb.org/t/p/w342/sRxbUe5FB25Gde0e2FnwwSckpXb.jpg',
	en: 'https://image.tmdb.org/t/p/w342/5rhTDKUhPYvpdQIijFIs5VoWsON.jpg'
};
