// Lógica pura de la lista de subtítulos (sin DOM ni Api): orden, textos de fila y cuota.
import { groupOf, rank, sourceOf, type Match } from '../sub-match.ts';
import { t } from '../i18n/runtime.ts';
import { sxe } from '../format.ts';
import type { MatchLevel, PremiumQuota, SubtitleOption } from '../types.ts';

export type RankedSub = { sub: SubtitleOption; lvl: number };

const LEVEL_NUM: Record<MatchLevel, number> = { exact: 3, release: 2, fps: 1, none: 0 };

/** 3 hecho para ese archivo · 2 mismo release · 1 mismos fps y duración · 0 nada. Con `match` (web) se calcula acá; sin él, del `level` que ya trae. */
export function rankSubs(list: SubtitleOption[], match: Match | null): RankedSub[] {
	if (!match) return list.map((sub) => ({ sub, lvl: LEVEL_NUM[sub.level] }));
	const items = list.map((sub) => ({ sub, release: sub.release, exact: sub.level === 'exact', fps: sub.fps, last: sub.last, latino: sub.latino, downloads: sub.downloads, com: sub.premium }));
	return rank(items, match).map(({ sub, level }) => ({ sub, lvl: level }));
}

/** Encabezado de la fila: grupo del release. */
export const headOf = (sub: SubtitleOption): string => sub.group || groupOf(sub.release) || (sub.premium ? 'OpenSubtitles' : 'OpenSubtitles.org');
/** Lo de la derecha del release: proveedor (gratis) o descargas (Premium); nada si no se sabe. */
export const srcOf = (sub: SubtitleOption): string | null =>
	sub.premium ? (sub.downloads > 0 ? `${sub.downloads.toLocaleString('es-AR')} ↓` : null) : sub.provider || null;

/** ¿Se conocen fps y duración del archivo? Web: del video copiado; desktop: lo que dijo el núcleo. `undefined` = no se sabe. */
export const timingOf = (list: SubtitleOption[], match: Match | null): boolean | undefined =>
	match ? !!match.video?.fps : list.find((s) => s.timingKnown !== undefined)?.timingKnown;

/** Si ninguno calza, por qué (sin inventar niveles): otro release, o no se saben fps y duración. Null si alguno calza o no hay dato. */
export function noFitText(list: RankedSub[], timing: boolean | undefined): string | null {
	if (!list.length || timing === undefined || list.some((r) => r.lvl > 0)) return null;
	return timing ? t('Ninguno es de este release ni de sus mismos fps y duración') : t('Sin fps ni duración de este archivo: solo se reconoce el mismo release');
}

/** "fuente resolución" del release. */
export const specOf = (sub: SubtitleOption): string =>
	[sourceOf(sub.release), sub.release.match(/\b(2160p|1080p|720p|480p)\b/i)?.[1]].filter(Boolean).join(' ') || t('sin release');

export const levelWord = (lvl: number): string => [t('puede desfasar'), t('probable'), t('muy probable'), t('perfecto')][lvl] ?? '';
export const levelWhy = (lvl: number): string =>
	[t('Otro release: puede ir adelantado o atrasado'), t('Mismos fps y misma duración que el video'), t('Mismo release: mismo grupo y fuente'), t('Hecho para este mismo archivo')][lvl] ?? '';

/** Copiar/usar otro cuenta el anterior como probado (no sincronizó). */
export function pickKey(state: { picked: string | null; tried: string[] }, key: string): { picked: string; tried: string[] } {
	const tried = state.picked && state.picked !== key && !state.tried.includes(state.picked) ? [...state.tried, state.picked] : state.tried;
	return { picked: key, tried: tried.filter((k) => k !== key) };
}

/** Clave de fila: las gratis y las Premium pueden compartir id. */
export const keyOf = (sub: SubtitleOption): string => `${sub.premium ? 'p' : 'o'}${sub.id}`;

/** "S01E02" de `tt…:1:2`, o null si es película. */
export function episodeLabel(videoId: string): string | null {
	const [, s, e] = videoId.split(':');
	return s && e ? sxe(s, e) : null;
}

export function quotaText(quota: PremiumQuota | null, hour: (ms: number) => string): string {
	if (!quota) return t('viendo cuántas descargas quedan…');
	if (quota.loginError) return quota.loginError;
	if (quota.remaining == null) return t('no sé cuántas descargas quedan hoy');
	if (quota.remaining === 0) return t('usaste las {n} de hoy', { n: quota.perDay ?? '' }) + (quota.resetsAt ? t(' · vuelven {h}', { h: hour(quota.resetsAt) }) : '');
	return t('quedan {n} de {d} descargas hoy', { n: quota.remaining, d: quota.perDay ?? '' });
}
