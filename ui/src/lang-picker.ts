// ES / EN chico en la barra de arriba (el selector grande, de la app y los títulos, es el LangPicker compartido).
// Cada cambio recarga la ventana en el idioma nuevo.
import { el } from './dom.ts';
import { langs, setLangs, t } from './i18n.ts';

const LANGS: ('es' | 'en')[] = ['es', 'en'];

/** ES / EN de la app en la barra de arriba (los títulos tienen su propio idioma, en Ajustes). */
export function langToggle(): HTMLElement {
  return el('div', { id: 'top-lang', class: 'top-lang', role: 'radiogroup', 'aria-label': t('Idioma') }, LANGS.map((v) => el('button', {
    id: `top-lang-${v}`, type: 'button', role: 'radio', 'aria-checked': String(langs.app === v), onclick: () => langs.app !== v && setLangs({ app: v }),
  }, v.toUpperCase())));
}
