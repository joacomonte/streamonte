// Traducción: el diccionario y `translate` son los compartidos con el desktop (packages/ui/src/i18n/); acá queda lo propio de
// la web (idioma de un pedido por cookies). Import relativo: `node --test` no resuelve el alias `$ui`.
import type { Lang } from '../../../../packages/ui/src/i18n/translate.ts';

export { translate, locale, type Lang, type Vars } from '../../../../packages/ui/src/i18n/translate.ts';

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
