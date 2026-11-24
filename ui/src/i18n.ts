// Idiomas (2026-11-20, como la web): la app en español o inglés, y los títulos de películas, series y capítulos en
// el suyo (TMDB los pide el núcleo en ese idioma; sinopsis y géneros siguen a la app). Los subtítulos no dependen de
// esto: siempre priorizan español.
// Traducción con claves en español (como gettext): en español el texto queda igual; en inglés sale de `EN` y lo que
// falte se muestra en español. `{x}` se reemplaza por `vars.x`.
import * as core from './core.ts';
// Diccionario único con la web: packages/ui/src/i18n/en.ts (relativo, no `$ui`: `node --test` no resuelve alias).
import EN from '../../packages/ui/src/i18n/en.ts';
import { createLangStore } from '../../packages/ui/src/i18n/store.svelte.ts';
import type { LanguageConfig } from './types.ts';

/** Los elegidos, guardados en la config del núcleo. Se leen una vez al cargar (todo módulo que importa este espera):
 *  cambiarlos recarga la ventana, así cada texto ya armado sale en el idioma nuevo. */
const saved = await core.config().then((c) => c.language, () => null);
export const langs: LanguageConfig = { app: saved?.app === 'en' ? 'en' : 'es', titles: saved?.titles === 'en' ? 'en' : 'es' };
document.documentElement.lang = langs.app;

/** Persistencia del idioma de la app: la config del núcleo; cambiarlo recarga la ventana (el núcleo sigue corriendo:
 *  descargas y reproducciones quedan). */
const store = createLangStore({
  load: () => langs.app,
  save: async (app) => { await core.setLanguage({ ...langs, app }); location.reload(); },
});
/** Texto en el idioma de la app. */
export const t = store.t;
console.assert(t('{n} de {d}', { n: 1, d: 3 }) === (langs.app === 'en' ? '1 of 3' : '1 de 3') && t('texto sin traducir') === 'texto sin traducir', 'i18n t()');

/** Locale para fechas y números. */
export const locale = store.loc;

/** Cambia el idioma de la app o el de los títulos y recarga la ventana. */
export async function setLangs(next: Partial<LanguageConfig>): Promise<void> {
  if (next.app && !next.titles) return store.setLang(next.app);
  await core.setLanguage({ ...langs, ...next });
  location.reload();
}

/** El HTML fijo de index.html: textos y `title` / `placeholder` / `aria-label` que estén en el diccionario. Se
 *  traduce una vez al arrancar; lo que arma el JS pasa por `t()`. */
export function translateStatic(root: ParentNode): void {
  if (langs.app === 'es') return;
  const walker = document.createTreeWalker(root as Node, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (n.nodeValue == null) continue;
    const text = n.nodeValue.replace(/\s+/g, ' ').trim();
    if (text && EN[text]) n.nodeValue = n.nodeValue.replace(/^(\s*)[^]*?(\s*)$/, `$1${EN[text]}$2`);
  }
  for (const node of root.querySelectorAll('[title], [placeholder], [aria-label]')) {
    for (const a of ['title', 'placeholder', 'aria-label']) {
      const v = node.getAttribute(a);
      if (v && EN[v]) node.setAttribute(a, EN[v]);
    }
  }
}
