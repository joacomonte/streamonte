// Dibujo, color y movimiento de cada género de TMDB (ids de películas y de series) para la fila de géneros del catálogo
// (2026-11-23). SVG de línea en 24×24 con trazo `currentColor`, como `components/icons.ts`. `hue` es el tono OKLCH del
// género; `motion` es cómo "actúa" el dibujo al elegirlo o al pasar el mouse (keyframes `act-*` de `Genres.svelte`).

export type GenreMotion = 'shake' | 'spin' | 'bounce' | 'wobble' | 'sweep' | 'beat' | 'float' | 'lift' | 'flicker' | 'blink' | 'wave' | 'flip' | 'twinkle';
export type GenreArt = { svg: string; hue: number; motion: GenreMotion };

const BOLT = '<path d="M13 2 4 14h7l-1 8 9-12h-7l1-8z"/>';

const ART: Record<string, GenreArt> = {
	/** Acción */
	'28': { svg: BOLT, hue: 35, motion: 'shake' },
	/** Acción y aventura (series) */
	'10759': { svg: BOLT, hue: 35, motion: 'shake' },
	/** Aventura */
	'12': { svg: '<circle cx="12" cy="12" r="9"/><path d="m15.5 8.5-2 5-5 2 2-5z"/>', hue: 150, motion: 'spin' },
	/** Animación */
	'16': { svg: '<path d="M11 3.5 12.8 8l4.7 1.8-4.7 1.8L11 16l-1.8-4.4-4.7-1.8L9.2 8z"/><path d="m18.5 14 .8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z"/>', hue: 300, motion: 'twinkle' },
	/** Comedia */
	'35': { svg: '<circle cx="12" cy="12" r="9"/><path d="M7.8 13.5a4.6 4.6 0 0 0 8.4 0"/><path d="M9 9.5h.01M15 9.5h.01"/>', hue: 90, motion: 'wobble' },
	/** Crimen */
	'80': { svg: '<circle cx="10.5" cy="10.5" r="6"/><path d="m15 15 5.5 5.5"/>', hue: 245, motion: 'sweep' },
	/** Documental */
	'99': { svg: '<rect x="3" y="7" width="12" height="10" rx="2"/><path d="m15 11 6-3v8l-6-3"/>', hue: 195, motion: 'flicker' },
	/** Drama */
	'18': { svg: '<path d="M5 4h14v7a7 7 0 0 1-14 0z"/><path d="M8.5 9h2M13.5 9h2"/><path d="M9 15.5a4 4 0 0 1 6 0"/>', hue: 340, motion: 'wobble' },
	/** Familia */
	'10751': { svg: '<path d="M3 11 12 4l9 7"/><path d="M5 9.5V20h14V9.5"/><path d="M12 17.5s-2.6-1.5-2.6-3.1a1.3 1.3 0 0 1 2.6-.3 1.3 1.3 0 0 1 2.6.3c0 1.6-2.6 3.1-2.6 3.1z"/>', hue: 60, motion: 'bounce' },
	/** Infantil (series) */
	'10762': { svg: '<path d="M12 15c-3.3 0-6-3-6-6.5S8.7 3 12 3s6 2 6 5.5S15.3 15 12 15z"/><path d="m11 15 1 1.8 1-1.8"/><path d="M12 16.8c-1.2 1.6 1 2.6 0 4.2"/>', hue: 330, motion: 'float' },
	/** Fantasía */
	'14': { svg: '<path d="m4 20 11-11"/><path d="m13 7 2-2 2 2-2 2z"/><path d="M18.5 2.5v2.5M19.75 3.75h-2.5M20.5 10v2M21.5 11h-2M10 2.5v2M11 3.5H9"/>', hue: 285, motion: 'twinkle' },
	/** Historia */
	'36': { svg: '<path d="M6 3h12M6 21h12"/><path d="M8 3v3.5l4 5.5 4-5.5V3"/><path d="M8 21v-3.5l4-5.5 4 5.5V21"/>', hue: 70, motion: 'flip' },
	/** Terror */
	'27': { svg: '<path d="M5 21V11a7 7 0 0 1 14 0v10l-2.3-2-2.4 2-2.3-2-2.3 2-2.4-2z"/><path d="M9.5 11h.01M14.5 11h.01"/>', hue: 165, motion: 'float' },
	/** Música */
	'10402': { svg: '<path d="M9 18V5l11-2v13"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="17.5" cy="16" r="2.5"/>', hue: 315, motion: 'bounce' },
	/** Misterio */
	'9648': { svg: '<circle cx="12" cy="12" r="9"/><path d="M9.6 9.4a2.5 2.5 0 1 1 3.4 2.4c-.6.3-1 .9-1 1.6v.6"/><path d="M12 17h.01"/>', hue: 270, motion: 'wobble' },
	/** Romance */
	'10749': { svg: '<path d="M12 20s-7-4.4-8.5-9A4.5 4.5 0 0 1 12 7.5a4.5 4.5 0 0 1 8.5 3.5C19 15.6 12 20 12 20z"/>', hue: 10, motion: 'beat' },
	/** Telenovela (series) */
	'10766': { svg: '<path d="M8.5 17s-5-3-6-6.2A3.2 3.2 0 0 1 8.5 8.3a3.2 3.2 0 0 1 6 2.5"/><path d="M16 21s-4-2.4-4.8-5a2.6 2.6 0 0 1 4.8-2 2.6 2.6 0 0 1 4.8 2c-.8 2.6-4.8 5-4.8 5z"/>', hue: 355, motion: 'beat' },
	/** Ciencia ficción */
	'878': { svg: '<path d="M12 3c3 2 4.5 5 4.5 9l-2 4h-5l-2-4c0-4 1.5-7 4.5-9z"/><circle cx="12" cy="10" r="1.6"/><path d="M9.5 16 7 19l.5-4.2M14.5 16l2.5 3-.5-4.2M12 18.5V21"/>', hue: 220, motion: 'lift' },
	/** Ciencia ficción y fantasía (series) */
	'10765': { svg: '<circle cx="12" cy="12" r="5.5"/><path d="M5.2 15.8c-2.2 2.3 3.3 2 8.8-1.2s8.7-7.6 7.2-9.5c-.7-.9-2.6-.7-4.9.2"/>', hue: 255, motion: 'spin' },
	/** Película de TV */
	'10770': { svg: '<rect x="3" y="6" width="18" height="13" rx="2"/><path d="m8 2 4 4 4-4"/>', hue: 235, motion: 'flicker' },
	/** Suspense */
	'53': { svg: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>', hue: 15, motion: 'blink' },
	/** Bélica */
	'10752': { svg: '<path d="M12 3 5 6v5c0 4.5 3 8 7 10 4-2 7-5.5 7-10V6z"/><path d="M12 8v8M8.5 12h7"/>', hue: 110, motion: 'shake' },
	/** Guerra y política (series) */
	'10768': { svg: '<path d="M5 21V4"/><path d="M5 4.5c4-2 7 2 14 0v9c-7 2-10-2-14 0"/>', hue: 115, motion: 'wave' },
	/** Western */
	'37': { svg: '<path d="M10 21V5a2 2 0 0 1 4 0v16"/><path d="M14 12.5h2a2 2 0 0 0 2-2V8"/><path d="M10 14.5H8a2 2 0 0 1-2-2v-2"/><path d="M5 21h14"/>', hue: 50, motion: 'wobble' },
	/** Noticias (series) */
	'10763': { svg: '<rect x="3" y="5" width="15" height="14" rx="2"/><path d="M18 9h3v8a2 2 0 0 1-2 2"/><path d="M7 9h7M7 12.5h7M7 16h4"/>', hue: 210, motion: 'flip' },
	/** Reality (series) */
	'10764': { svg: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3.5" fill="currentColor"/>', hue: 25, motion: 'beat' },
	/** Talk show (series) */
	'10767': { svg: '<path d="M4 5h16v11H9.5L4 20z"/><path d="M8 9.5h8M8 12.5h5"/>', hue: 185, motion: 'bounce' }
};

/** Para un género que TMDB agregue y no esté en la tabla: un fotograma. */
const FALLBACK: GenreArt = { svg: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 4v16M17 4v16M3 9h4M3 15h4M17 9h4M17 15h4"/>', hue: 240, motion: 'bounce' };

/** "Todos": cuatro cuadros. */
export const ALL_ART: GenreArt = { svg: '<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/>', hue: 250, motion: 'spin' };

export const genreArt = (id: string): GenreArt => ART[id] ?? FALLBACK;
