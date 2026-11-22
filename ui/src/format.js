// @ts-check
// Formatos de números compartidos por la app: bytes, Mbps, duraciones y fechas
// relativas, en español de Argentina (coma decimal).
import { t } from './i18n.js';

/** "1,4 GB" / "734 MB"; sin dato, "—". */
/** @param {number|null|undefined} b @returns {string} */
export function humanBytes(b) {
  if (b == null) return '—';
  if (b >= 1024 ** 3) return `${(b / 1024 ** 3).toFixed(1).replace('.', ',')} GB`;
  return `${Math.round(b / 1024 ** 2)} MB`;
}

/** bytes/s → "7,2 Mbps" (siempre un decimal). */
/** @param {number} bytesPerSec @returns {string} */
export const mbps = (bytesPerSec) => t('{a} Mbps', { a: ((bytesPerSec * 8) / 1e6).toFixed(1).replace('.', ',') });

/** Hasta un decimal ("2", "1,5"). */
/** @param {number} n @returns {string} */
export const nf = (n) => n.toLocaleString('es-AR', { maximumFractionDigits: 1 });
/** Siempre un decimal ("2,0", "1,5"). */
/** @param {number} n @returns {string} */
export const nf1 = (n) => n.toLocaleString('es-AR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
/** bytes/s → Mbps redondeado como en el diseño ("78", "7,2"), sin la unidad. */
/** @param {number} bps @returns {string} */
export const mb = (bps) => { const v = (bps * 8) / 1e6; return nf(v >= 10 ? Math.round(v) : v); };

/** Reloj "h:mm:ss"; con `shortUnderHour`, "m:ss" si dura menos de una hora. */
/** @param {number} secs @param {boolean=} shortUnderHour @returns {string} */
export function clock(secs, shortUnderHour = false) {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = Math.floor(secs % 60);
  const ss = String(s).padStart(2, '0');
  if (shortUnderHour && h === 0) return `${m}:${ss}`;
  return `${h}:${String(m).padStart(2, '0')}:${ss}`;
}

/** "recién", "hace 5 min", "hace 3 h", "hace 2 días". */
/** @param {string} iso @returns {string} */
export function ago(iso) {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return t('recién');
  if (mins < 60) return t('hace {mins} min', { mins });
  const h = Math.round(mins / 60);
  return h < 48 ? t('hace {h} h', { h }) : t('hace {a} días', { a: Math.round(h / 24) });
}

/** Estado de una reproducción en palabras (menú Descargas y la card del catálogo). */
/** @param {import('./types.js').PlaybackRow} pb @returns {string} */
export function playbackText(pb) {
  const k = pb.state.kind;
  if (k === 'fetching-metadata') return t('cargando…');
  if (k === 'preparing') return t('cargando {a} %', { a: Math.round((pb.state.fraction ?? 0) * 100) });
  if (k === 'stopping') return t('cerrando…');
  if (k === 'download-paused') return t('reproduciendo · descarga en pausa');
  if (k === 'ask-after-close') return t('cerraste el reproductor…');
  if (k === 'background') return t('descargando · {a} %', { a: Math.floor((pb.progress ?? 0) * 100) });
  if (k === 'paused') return t('pausado · {a} % bajado', { a: Math.floor((pb.progress ?? 0) * 100) });
  if (k === 'failed') return t('falló: {message}', { message: pb.state.message });
  return t('reproduciendo');
}

/** Película estrenada hace menos de 3 semanas: casi seguro todavía no hay copias buenas, solo filmadas en el cine. */
/** @param {string} released @returns {boolean} */
export function onlyCinema(released) {
  const days = (Date.now() - Date.parse(released)) / 864e5;
  return days >= 0 && days < 21;
}
