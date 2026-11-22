/** Días desde el estreno en cine en los que casi siempre hay solo copias filmadas (CAM/TS/TC). Medido el 2026-11-20 con
 * 25 películas contra los torrents reales: fue la señal con menos errores (las fechas digitales de TMDB llegan tarde). */
const DAYS = 21;

/** Película recién estrenada: probablemente todavía no haya torrents de buena calidad. `released`: AAAA-MM-DD. */
export function onlyCinema(released: string | null | undefined): boolean {
	if (!released) return false;
	const days = (Date.now() - new Date(`${released}T00:00`).getTime()) / 864e5;
	return days >= 0 && days < DAYS;
}
