// Formatos compartidos: bytes, Mbps, duraciones, fechas relativas, en español de Argentina (coma decimal).
import { t } from './i18n/runtime.ts';

/** "1,4 GB" / "734 MB"; sin dato, "—". */
export function humanBytes(b: number | null | undefined): string {
	if (b == null) return '—';
	if (b >= 1024 ** 3) return `${(b / 1024 ** 3).toFixed(1).replace('.', ',')} GB`;
	return `${Math.round(b / 1024 ** 2)} MB`;
}

/** bytes/s → "7,2 Mbps" (siempre un decimal). */
export const mbps = (bytesPerSec: number): string => t('{a} Mbps', { a: ((bytesPerSec * 8) / 1e6).toFixed(1).replace('.', ',') });

/** Hasta un decimal ("2", "1,5"). */
export const nf = (n: number): string => n.toLocaleString('es-AR', { maximumFractionDigits: 1 });
/** Siempre un decimal ("2,0", "1,5"). */
export const nf1 = (n: number): string => n.toLocaleString('es-AR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
/** bytes/s → Mbps redondeado como en el diseño ("78", "7,2"), sin la unidad. */
export const mb = (bps: number): string => {
	const v = (bps * 8) / 1e6;
	return nf(v >= 10 ? Math.round(v) : v);
};

/** Reloj "h:mm:ss"; con `shortUnderHour`, "m:ss" si dura menos de una hora. */
export function clock(secs: number, shortUnderHour = false): string {
	const h = Math.floor(secs / 3600);
	const m = Math.floor((secs % 3600) / 60);
	const ss = String(Math.floor(secs % 60)).padStart(2, '0');
	if (shortUnderHour && h === 0) return `${m}:${ss}`;
	return `${h}:${String(m).padStart(2, '0')}:${ss}`;
}

/** "recién", "hace 5 min", "hace 3 h", "hace 2 días". */
export function ago(iso: string): string {
	const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
	if (mins < 1) return t('recién');
	if (mins < 60) return t('hace {mins} min', { mins });
	const h = Math.round(mins / 60);
	return h < 48 ? t('hace {h} h', { h }) : t('hace {a} días', { a: Math.round(h / 24) });
}

/** Días desde el estreno en cine en los que casi siempre hay solo copias filmadas (CAM/TS/TC). Medido el 2026-11-20 con
 * 25 películas contra los torrents reales: fue la señal con menos errores (las fechas digitales de TMDB llegan tarde). */
const CINEMA_DAYS = 21;

/** Película recién estrenada: probablemente todavía no haya torrents de buena calidad. `released`: AAAA-MM-DD. */
export function onlyCinema(released: string | null | undefined): boolean {
	if (!released) return false;
	const days = (Date.now() - new Date(`${released}T00:00`).getTime()) / 864e5;
	return days >= 0 && days < CINEMA_DAYS;
}
