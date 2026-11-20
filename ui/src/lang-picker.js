// Idiomas que elige el usuario (2026-11-20, como LangPicker de la web): app y títulos. Uno por paso en la bienvenida,
// los dos juntos en Ajustes; ES / EN chico en la barra de arriba. Cada cambio recarga la ventana en el idioma nuevo.
import { el, icon } from './dom.js';
import { langs, setLangs, t } from './i18n.js';

/** Cada idioma con su nombre en su propio idioma. */
const LANGS = [['es', 'Español'], ['en', 'English']];

/** Tarjetas grandes: la elegida se llena de color, con su código en un disco y un tilde. `only`: un solo grupo
 *  ('app' | 'titles'), más grande (la pregunta ya la hace el título del paso). */
export function langPicker(id, only = null) {
  const seg = (key, label, ic) => el('div', { class: 'lp-row' },
    el('span', { class: 'lp-lbl', id: `${id}-${key}-lbl` }, icon(ic, 16), label),
    el('div', { class: 'lp-seg', role: 'radiogroup', 'aria-labelledby': `${id}-${key}-lbl` }, LANGS.map(([v, name]) => el('button', {
      id: `${id}-${key}-${v}`, type: 'button', role: 'radio', 'aria-checked': String(langs[key] === v),
      onclick: () => langs[key] !== v && setLangs({ [key]: v }),
    }, el('span', { class: 'lp-code' }, v.toUpperCase()), el('span', { class: 'lp-name' }, name), el('span', { class: 'lp-tick', 'aria-hidden': 'true' }, icon('check', 13))))));
  return el('div', { class: `lp ${only ? 'big' : ''}` },
    only !== 'titles' ? seg('app', t('Idioma de la app'), 'monitor') : null,
    only !== 'app' ? seg('titles', t('Títulos de pelis, series y capítulos'), 'film') : null);
}

/** ES / EN de la app en la barra de arriba (los títulos tienen su propio idioma, en Ajustes). */
export function langToggle() {
  return el('div', { id: 'top-lang', class: 'top-lang', role: 'radiogroup', 'aria-label': t('Idioma') }, LANGS.map(([v]) => el('button', {
    id: `top-lang-${v}`, type: 'button', role: 'radio', 'aria-checked': String(langs.app === v), onclick: () => langs.app !== v && setLangs({ app: v }),
  }, v.toUpperCase())));
}
