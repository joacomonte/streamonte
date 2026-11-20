// Idiomas (2026-11-20, como la web): la app en español o inglés, y los títulos de películas, series y capítulos en
// el suyo (TMDB los pide el núcleo en ese idioma; sinopsis y géneros siguen a la app). Los subtítulos no dependen de
// esto: siempre priorizan español.
// Traducción con claves en español (como gettext): en español el texto queda igual; en inglés sale de `EN` y lo que
// falte se muestra en español. `{x}` se reemplaza por `vars.x`.
import { api } from './api.js';
import EN from './i18n-en.js';

/** Los elegidos, guardados en la config del núcleo. Se leen una vez al cargar (todo módulo que importa este espera):
 *  cambiarlos recarga la ventana, así cada texto ya armado sale en el idioma nuevo. */
const saved = await api.config().then((c) => c.language, () => null);
/** @type {{app: 'es'|'en', titles: 'es'|'en'}} */
export const langs = { app: saved?.app === 'en' ? 'en' : 'es', titles: saved?.titles === 'en' ? 'en' : 'es' };
document.documentElement.lang = langs.app;

/** Texto en el idioma de la app. @param {string} s @param {Record<string, string|number>=} vars */
export function t(s, vars) {
  const out = langs.app === 'en' ? (EN[s] ?? s) : s;
  return vars ? out.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? '')) : out;
}
console.assert(t('{n} de {d}', { n: 1, d: 3 }) === (langs.app === 'en' ? '1 of 3' : '1 de 3') && t('texto sin traducir') === 'texto sin traducir', 'i18n t()');

/** Locale para fechas y números. */
export const locale = () => (langs.app === 'en' ? 'en-US' : 'es-AR');

/** Cambia uno o los dos idiomas y recarga la ventana (el núcleo sigue corriendo: descargas y reproducciones quedan). */
export async function setLangs(next) {
  await api.setLanguage({ ...langs, ...next });
  location.reload();
}

/** El HTML fijo de index.html: textos y `title` / `placeholder` / `aria-label` que estén en el diccionario. Se
 *  traduce una vez al arrancar; lo que arma el JS pasa por `t()`. */
export function translateStatic(root) {
  if (langs.app === 'es') return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
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
