// Traducción con claves en español (como gettext): en español el texto queda igual; en inglés sale de `EN` y lo que falte
// se muestra en español. `{x}` se reemplaza por `vars.x`. Un solo diccionario para la web, el servidor y el desktop.
import EN from './en.ts';

export type Lang = 'es' | 'en';
export type Vars = Record<string, string | number | null | undefined>;

export function translate(lang: Lang, s: string, vars?: Vars): string {
	const out = lang === 'en' ? (EN[s] ?? s) : s;
	return vars ? out.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? '')) : out;
}

/** Locale para fechas y números. */
export const locale = (lang: Lang): string => (lang === 'en' ? 'en-US' : 'es-AR');
