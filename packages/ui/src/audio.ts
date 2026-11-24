// Audio latino de una opción: lo que dicen sus pistas (si se leyeron) y, si no, lo que dice el nombre.
// Una regla, un lugar: lo usan los badges y la búsqueda del primer buen match.
import type { LatState } from './types.ts';
export { audioOf, latStatus, type Tracks } from './latino.ts';

/** Texto, explicación corta (globito) y larga (title) de cada estado. */
/** Orden de búsqueda pidiendo latino (2026-11-23), antes que la calidad: primero las que ya son latino (por nombre o
 * pistas: match sin leer nada), después las "probables" (web latina) y al final el resto (MULTI / Dual / español sin
 * aclarar). Así una latina rara de menor calidad aparece sin leer antes todas las MULTI que la superan en calidad. */
export const latRank = (s: LatState): number => (s === 'lat' ? 0 : s === 'likely' ? 1 : 2);

export const LAT_BADGE: Record<LatState, { text: string; tip: string; title: string }> = {
	lat: { text: 'LAT', tip: 'Tiene audio latino', title: 'Audio latino: lo dicen las pistas del video o el nombre del torrent' },
	likely: { text: 'LAT?', tip: 'Probablemente latino', title: 'Probablemente latino: viene de una web latina, pero no lo pudimos confirmar. Abrilo y probá el audio.' },
	spain: { text: 'Gallego', tip: 'Español de España', title: 'Gallego: español de España, no latino' },
	check: { text: 'Probar manualmente', tip: 'Abrilo y probá el audio', title: 'No pudimos confirmar si es español latino o de España. Abrilo y probá el audio.' },
	none: { text: 'LAT', tip: 'No trae audio latino', title: 'Leído: no trae audio latino' }
};
