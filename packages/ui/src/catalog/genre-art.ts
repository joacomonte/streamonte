// Dibujo y color de cada género del catálogo (`art` de `subgenres.ts`: id de TMDB del género o una clave propia) para el
// botón y la hoja de géneros (`GenrePicker.svelte`). SVG de línea en 24×24 con trazo `currentColor`, como
// `components/icons.ts`. `hue` es el tono OKLCH del género.

export type GenreArt = { svg: string; hue: number };

const BOLT = '<path d="M13 2 4 14h7l-1 8 9-12h-7l1-8z"/>';

const ART: Record<string, GenreArt> = {
	/** Acción */
	'28': { svg: BOLT, hue: 35 },
	/** Aventura */
	'12': { svg: '<circle cx="12" cy="12" r="9"/><path d="m15.5 8.5-2 5-5 2 2-5z"/>', hue: 150 },
	/** Animación */
	'16': { svg: '<path d="M11 3.5 12.8 8l4.7 1.8-4.7 1.8L11 16l-1.8-4.4-4.7-1.8L9.2 8z"/><path d="m18.5 14 .8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z"/>', hue: 300 },
	/** Comedia */
	'35': { svg: '<circle cx="12" cy="12" r="9"/><path d="M7.8 13.5a4.6 4.6 0 0 0 8.4 0"/><path d="M9 9.5h.01M15 9.5h.01"/>', hue: 90 },
	/** Crimen */
	'80': { svg: '<circle cx="10.5" cy="10.5" r="6"/><path d="m15 15 5.5 5.5"/>', hue: 245 },
	/** Documental */
	'99': { svg: '<rect x="3" y="7" width="12" height="10" rx="2"/><path d="m15 11 6-3v8l-6-3"/>', hue: 195 },
	/** Drama */
	'18': { svg: '<path d="M5 4h14v7a7 7 0 0 1-14 0z"/><path d="M8.5 9h2M13.5 9h2"/><path d="M9 15.5a4 4 0 0 1 6 0"/>', hue: 340 },
	/** Familia */
	'10751': { svg: '<path d="M3 11 12 4l9 7"/><path d="M5 9.5V20h14V9.5"/><path d="M12 17.5s-2.6-1.5-2.6-3.1a1.3 1.3 0 0 1 2.6-.3 1.3 1.3 0 0 1 2.6.3c0 1.6-2.6 3.1-2.6 3.1z"/>', hue: 60 },
	/** Fantasía */
	'14': { svg: '<path d="m4 20 11-11"/><path d="m13 7 2-2 2 2-2 2z"/><path d="M18.5 2.5v2.5M19.75 3.75h-2.5M20.5 10v2M21.5 11h-2M10 2.5v2M11 3.5H9"/>', hue: 285 },
	/** Terror */
	'27': { svg: '<path d="M5 21V11a7 7 0 0 1 14 0v10l-2.3-2-2.4 2-2.3-2-2.3 2-2.4-2z"/><path d="M9.5 11h.01M14.5 11h.01"/>', hue: 165 },
	/** Música */
	'10402': { svg: '<path d="M9 18V5l11-2v13"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="17.5" cy="16" r="2.5"/>', hue: 315 },
	/** Misterio */
	'9648': { svg: '<circle cx="12" cy="12" r="9"/><path d="M9.6 9.4a2.5 2.5 0 1 1 3.4 2.4c-.6.3-1 .9-1 1.6v.6"/><path d="M12 17h.01"/>', hue: 270 },
	/** Romance */
	'10749': { svg: '<path d="M12 20s-7-4.4-8.5-9A4.5 4.5 0 0 1 12 7.5a4.5 4.5 0 0 1 8.5 3.5C19 15.6 12 20 12 20z"/>', hue: 10 },
	/** Ciencia ficción */
	'878': { svg: '<path d="M12 3c3 2 4.5 5 4.5 9l-2 4h-5l-2-4c0-4 1.5-7 4.5-9z"/><circle cx="12" cy="10" r="1.6"/><path d="M9.5 16 7 19l.5-4.2M14.5 16l2.5 3-.5-4.2M12 18.5V21"/>', hue: 220 },
	/** Suspense */
	'53': { svg: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>', hue: 15 },
	/** Western */
	'37': { svg: '<path d="M10 21V5a2 2 0 0 1 4 0v16"/><path d="M14 12.5h2a2 2 0 0 0 2-2V8"/><path d="M10 14.5H8a2 2 0 0 1-2-2v-2"/><path d="M5 21h14"/>', hue: 50 },
	/** Reality (series) */
	'10764': { svg: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3.5" fill="currentColor"/>', hue: 25 },
	/** Deportes (no es género de TMDB: lo usa `subgenres.ts`) */
	sport: { svg: '<circle cx="12" cy="12" r="9"/><path d="m12 7 4 3-1.5 4.5h-5L8 10z"/><path d="M12 3v4M16 10l4.5-1.5M14.5 14.5l2.5 4M9.5 14.5 7 18.5M8 10 3.5 8.5"/>', hue: 120 },
};

/** Para un género que TMDB agregue y no esté en la tabla: un fotograma. */
const FALLBACK: GenreArt = { svg: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 4v16M17 4v16M3 9h4M3 15h4M17 9h4M17 15h4"/>', hue: 240 };

/** "Todos": cuatro cuadros. */
export const ALL_ART: GenreArt = { svg: '<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/>', hue: 250 };

export const genreArt = (id: string): GenreArt => ART[id] ?? FALLBACK;
