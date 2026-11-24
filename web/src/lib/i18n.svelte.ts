// Idiomas elegidos por el usuario. Los subtítulos no dependen de esto: siempre priorizan español.
// - `lang`: textos de la app.
// - `titles`: títulos de películas, series y capítulos (TMDB).
// Sinopsis y géneros siempre van en el idioma de la app.
import { createLangStore } from '$ui/i18n/store.svelte.ts';
import { pickLangs, type Lang, type Vars } from './i18n/translate.ts';

/** En el navegador arranca de lo que decidió el servidor (`<html lang>` y las cookies): los `load` corren antes que
 * el layout y la clave de la caché ya tiene que ir en el idioma correcto. */
function initial(): { lang: Lang; titles: Lang } {
	if (typeof document === 'undefined') return { lang: 'es', titles: 'es' };
	const cookie = (n: string) => document.cookie.match(new RegExp(`(?:^|; )${n}=([^;]*)`))?.[1];
	const ui = document.documentElement.lang === 'en' ? 'en' : 'es';
	const l = pickLangs((n) => (n === 'lang' ? ui : cookie(n)), null);
	return { lang: l.ui, titles: l.titles };
}

const start = initial();

const save = (name: string, value: string) => {
	document.cookie = `${name}=${value}; path=/; max-age=31536000; samesite=lax${location.protocol === 'https:' ? '; secure' : ''}`;
};

// El idioma de la app y su `t` reactivo viven en `$ui/i18n/store.svelte.ts`; acá solo dónde se guarda (cookie + `<html lang>`).
const store = createLangStore({
	load: () => start.lang,
	save: (lang) => {
		save('lang', lang);
		document.documentElement.lang = lang;
	}
});
const titlesState: { titles: Lang } = $state({ titles: start.titles });

export const i18n = {
	get lang(): Lang {
		return store.lang;
	},
	get titles(): Lang {
		return titlesState.titles;
	}
};

/** Texto en el idioma de la app; la clave es el texto en español. */
export const t = (s: string, vars?: Vars) => store.t(s, vars);
/** Locale para `toLocaleDateString` y números. */
export const loc = () => store.loc();
/** Idiomas en que llega lo de TMDB (títulos y sinopsis): la caché de esas respuestas va por esta clave. */
export const contentKey = () => `${i18n.titles}.${i18n.lang}`;

/** Los idiomas que decidió el servidor (cookie o navegador), sin guardarlos: el layout lo llama antes del primer render. */
export function syncLangs(langs: { lang: Lang; titles: Lang }): void {
	store.sync(langs.lang);
	titlesState.titles = langs.titles;
}

/** Idioma de la app. */
export function setLang(lang: Lang): void {
	// Sin idioma de títulos elegido, queda fijo el que había: el toggle de la app no cambia los títulos.
	if (!/(?:^|; )titles=/.test(document.cookie)) save('titles', i18n.titles);
	void store.setLang(lang);
}
/** Idioma de los títulos. */
export function setTitles(titles: Lang): void {
	titlesState.titles = titles;
	save('titles', titles);
}
