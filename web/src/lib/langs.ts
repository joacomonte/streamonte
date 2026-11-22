// Idiomas para el selector y el tutorial compartidos: elegir uno se aplica al toque y vuelve a pedir lo de TMDB.
import type { LangOptions } from '$ui/components/tour-state.ts';
import { webCatalog } from './catalog.svelte.ts';
import { i18n, setLang, setTitles } from './i18n.svelte.ts';

export const langOptions = (): LangOptions => ({
	app: i18n.lang,
	titles: i18n.titles,
	onpick: (key, value) => {
		if (value === (key === 'app' ? i18n.lang : i18n.titles)) return;
		if (key === 'app') setLang(value);
		else setTitles(value);
		webCatalog().relang();
	}
});
