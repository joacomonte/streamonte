// Lógica pura de la lista de subtítulos (sin DOM ni Api): orden, textos de fila y cuota.
import { groupOf, rank, sourceOf, type Match } from '../sub-match.ts';
import { t } from '../i18n/runtime.ts';
import type { MatchLevel, PremiumQuota, SubtitleOption } from '../types.ts';

export type RankedSub = { sub: SubtitleOption; lvl: number };

const LEVEL_NUM: Record<MatchLevel, number> = { exact: 3, release: 2, fps: 1, none: 0 };

/** 3 hecho para ese archivo · 2 mismo release · 1 mismos fps y duración · 0 nada. Con `match` (web) se calcula acá; sin él, del `level` que ya trae. */
export function rankSubs(list: SubtitleOption[], match: Match | null): RankedSub[] {
	if (!match) return list.map((sub) => ({ sub, lvl: LEVEL_NUM[sub.level] }));
	const items = list.map((sub) => ({ sub, release: sub.release, exact: sub.level === 'exact', fps: sub.fps, last: sub.last, group: sub.group, latino: sub.latino, downloads: sub.downloads }));
	return rank(items, match).map(({ sub, level }) => ({ sub, lvl: level }));
}

/** Encabezado de la fila: grupo del release. */
export const headOf = (sub: SubtitleOption): string => sub.group || groupOf(sub.release) || (sub.premium ? 'OpenSubtitles' : 'OpenSubtitles.org');
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
	return s && e ? `S${s.padStart(2, '0')}E${e.padStart(2, '0')}` : null;
}

export function quotaText(quota: PremiumQuota | null, hour: (ms: number) => string): string {
	if (!quota) return t('viendo cuántas descargas quedan…');
	if (quota.loginError) return quota.loginError;
	if (quota.remaining == null) return t('no sé cuántas descargas quedan hoy');
	if (quota.remaining === 0) return t('usaste las {n} de hoy', { n: quota.perDay ?? '' }) + (quota.resetsAt ? t(' · vuelven {h}', { h: hour(quota.resetsAt) }) : '');
	return t('quedan {n} de {d} descargas hoy', { n: quota.remaining, d: quota.perDay ?? '' });
}
