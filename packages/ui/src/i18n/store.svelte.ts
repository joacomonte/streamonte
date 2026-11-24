// Idioma de la app (reactivo) y su `t`, compartidos por la web y el desktop. Cada app aporta solo dónde se guarda
// (`LangStorage`): la web, cookie + `<html lang>`; el desktop, la config del núcleo y recargar la ventana.
import { setTranslator } from './runtime.ts';
import { translate, locale, type Lang, type Vars } from './translate.ts';

export type LangStorage = {
	/** Idioma guardado (`'es'` | `'en'`); cualquier otra cosa o null = español. */
	load(): string | null;
	save(lang: Lang): void | Promise<void>;
};

export type LangStore = {
	readonly lang: Lang;
	/** Cambia el idioma de la app y lo guarda. */
	setLang(lang: Lang): Promise<void>;
	/** Texto en el idioma de la app; la clave es el texto en español. Fija también el traductor de la lógica compartida (format.ts…). */
	t(s: string, vars?: Vars): string;
	/** Locale para fechas y números. */
	loc(): string;
};

export function createLangStore(storage: LangStorage): LangStore {
	let lang: Lang = $state(storage.load() === 'en' ? 'en' : 'es');
	const t = (s: string, vars?: Vars): string => translate(lang, s, vars);
	setTranslator(t);
	return {
		get lang() {
			return lang;
		},
		async setLang(next) {
			lang = next;
			await storage.save(next);
		},
		t,
		loc: () => locale(lang)
	};
}
