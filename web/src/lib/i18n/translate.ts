// Traducción con claves en español (como gettext): en español el texto queda igual; en inglés sale de `EN`.
// Un solo diccionario para la web y el servidor. `{x}` se reemplaza por `vars.x`.
import EN from './en.ts';

export type Lang = 'es' | 'en';

export function translate(lang: Lang, s: string, vars?: Record<string, string | number>): string {
	const out = lang === 'en' ? (EN[s] ?? s) : s;
	return vars ? out.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? '')) : out;
}

/** Idioma de un pedido: la cookie `lang` y, si no hay, español (sin mirar el navegador). */
export const pickLang = (cookie: string | undefined, _accept: string | null): Lang => (cookie === 'en' ? 'en' : 'es');

export type Langs = { ui: Lang; titles: Lang };
/** Las dos preferencias a partir de sus cookies (`lang`, `titles`). Sin elegir, todo
 * va en el idioma de la app. */
export function pickLangs(cookie: (name: string) => string | undefined, accept: string | null): Langs {
	const ui = pickLang(cookie('lang'), accept);
	const t = cookie('titles');
	const titles = t === 'es' || t === 'en' ? t : ui;
	return { ui, titles };
}

/** Locale para fechas y números. */
export const locale = (lang: Lang) => (lang === 'en' ? 'en-US' : 'es-AR');
