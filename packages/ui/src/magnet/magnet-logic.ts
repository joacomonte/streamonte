// Textos de la vista del magnet pegado (sin DOM ni Api).
import { t } from '../i18n/runtime.ts';
import type { Identified, MagnetStatus } from '../types.ts';

export const speedText = (bps: number): string => (bps >= 1e6 ? `${(bps / 1e6).toFixed(1)} MB/s` : `${Math.round(bps / 1e3)} KB/s`);
export const etaText = (sec: number): string =>
	sec >= 3600 ? `${Math.floor(sec / 3600)} h ${Math.round((sec % 3600) / 60)} min` : sec >= 60 ? `${Math.round(sec / 60)} min` : `${sec} s`;

/** "42 % · 1.2 MB/s · 8 seeds · falta 3 min". */
export function progressText(s: Pick<MagnetStatus, 'progress' | 'speed' | 'seeds' | 'eta'>): string {
	return `${Math.floor(s.progress * 100)} % · ${speedText(s.speed)} · ${t('{n} seeds', { n: s.seeds })}${s.eta ? ` · ${t('falta {t}', { t: etaText(s.eta) })}` : ''}`;
}

/** Título: la película o serie si se reconoció; si no, el nombre del torrent. */
export const magnetTitle = (ident: Identified | null, status: MagnetStatus | null, name: string): string => ident?.title ?? status?.name ?? (name || t('Torrent pegado'));

/** Línea chica bajo el título: "Torrent pegado" (si no se reconoció) · año · T1 E2 · ★ nota; o el nombre del torrent si difiere. */
export function magnetSubtitle(ident: Identified | null, status: MagnetStatus | null, title: string): string {
	const ep = ident?.season && ident.episode ? `T${ident.season} E${ident.episode}` : ident?.season ? `T${ident.season}` : '';
	const line = [ident ? '' : t('Torrent pegado'), ident?.year, ep, ident?.rating ? `★ ${ident.rating}` : ''].filter(Boolean).join(' · ');
	if (line && line !== title) return line;
	return !line && status?.name && status.name !== title ? status.name : '';
}
