// `t` para la lógica compartida (format, etc.): delega en el traductor de la app (`setTranslator`), así sigue su idioma y,
// en la web, su reactividad. Sin traductor fijado devuelve el español.
import { translate, type Vars } from './translate.ts';

export type Translator = (s: string, vars?: Vars) => string;

let current: Translator = (s, vars) => translate('es', s, vars);

export const setTranslator = (fn: Translator): void => void (current = fn);
export const t: Translator = (s, vars) => current(s, vars);
