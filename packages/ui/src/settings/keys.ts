// Las tres keys que tienen las dos apps, en el orden de Ajustes. Texto de la web (gana sobre el del desktop).
export type KeyInfo = { service: 'tmdb' | 'torbox' | 'opensubtitles'; name: string; hint: string; placeholder: string; href: string };
export const COMMON_KEYS: KeyInfo[] = [
	{ service: 'tmdb', name: 'TMDB', hint: 'catálogo', placeholder: 'API key (v3)', href: 'https://www.themoviedb.org/settings/api' },
	{ service: 'torbox', name: 'TorBox', hint: 'torrents', placeholder: 'API key', href: 'https://torbox.app/settings' },
	{ service: 'opensubtitles', name: 'OpenSubtitles.com', hint: 'subtítulos', placeholder: 'API key', href: 'https://www.opensubtitles.com/consumers' }
];
