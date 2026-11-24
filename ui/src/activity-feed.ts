// Qué se cuenta en la burbuja de actividad (components/Activity.svelte es el widget): eventos del núcleo → líneas del
// log, el resumen de lo que corre de fondo para su píldora y cómo se agrupan las líneas. Puro: lo prueba activity-feed.test.ts.
import { t as tr } from '../../packages/ui/src/i18n/runtime.ts';
import { clock, humanBytes, mb } from '../../packages/ui/src/format.ts';
import { fullName, titleOf, type Live } from './live.ts';
import type { CoreEvent } from './types.ts';

export type Level = 'info' | 'warn' | 'error';
/** Lo que se anota. `key`: misma clave = mismo trabajo (p. ej. la velocidad en vivo): se actualiza en su lugar. */
export type FeedLine = { area: string; text: string; level?: Level; key?: string; at?: Date; announce?: boolean };
/** Línea ya en la lista (`n`: repeticiones seguidas). */
export type Line = { id: number; key: string; n: number; text: string; area: string; level: Level; at: Date };

/** Áreas: nombre e ícono (trazo 2, 24×24). */
export const AREA: Record<string, [string, string]> = {
	analisis: [tr('Análisis'), '<path d="M4.6 18.5a9 9 0 1 1 14.8 0"/><path d="M12 14.5l4.2-5"/>'],
	motor: ['Torrent', '<path d="M12 3v12"/><path d="M7 10l5 5 5-5"/><path d="M5 20h14"/>'],
	reproduccion: [tr('Reproducción'), '<path d="M8 5.5v13l10-6.5z"/>'],
	subtitulos: [tr('Subtítulos'), '<rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="M7 14h4M13 14h4M7 10h10"/>'],
	catalogo: [tr('Catálogo'), '<circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.3 15.3L20 20"/>'],
	limpieza: [tr('Limpieza'), '<path d="M5 7h14M10 7V4.5h4V7M7 7l1 13h8l1-13"/>'],
	red: [tr('Red'), '<path d="M5 12.5a10 10 0 0 1 14 0M8 15.5a5.5 5.5 0 0 1 8 0"/><circle cx="12" cy="19" r="1.2" fill="currentColor"/>'],
	portapapeles: [tr('Portapapeles'), '<rect x="6" y="4.5" width="12" height="16" rx="2"/><path d="M9.5 4.5V3h5v1.5"/>'],
	general: [tr('General'), '<circle cx="12" cy="12" r="8"/><path d="M12 8v4.5l3 2"/>'],
	error: [tr('Error'), '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5v5.5"/><circle cx="12" cy="16.5" r="1.1" fill="currentColor"/>']
};

/** Tope de líneas guardadas. */
export const KEEP = 300;

/** Agrega `l` a `lines` o actualiza la del mismo trabajo (`key`, entre las últimas 25) o la última si es igual (×N).
 *  `last` es la última línea tocada (la que muestra la píldora); `added` = línea nueva. */
export function mergeLine(lines: readonly Line[], last: Line | null, l: FeedLine, id: number): { lines: Line[]; last: Line; added: boolean } {
	const level = l.level ?? 'info';
	const area = level === 'error' ? 'error' : l.area in AREA ? l.area : 'general';
	const key = l.key ?? `${area}|${l.text}`;
	const at = l.at ?? new Date();
	const same = l.key ? lines.slice(-25).find((x) => x.key === key) : last?.key === key ? lines.find((x) => x.id === last.id) : undefined;
	if (same) {
		const upd: Line = { ...same, n: l.key ? same.n : same.n + 1, text: l.text, level, area, at };
		return { lines: lines.map((x) => (x === same ? upd : x)), last: upd, added: false };
	}
	const line: Line = { id, key, n: 1, text: l.text, area, level, at };
	return { lines: [...lines, line].slice(-KEEP), last: line, added: true };
}

const PHASE_TEXT: Record<string, string> = { connecting: 'conectando', metadata: 'buscando metadatos', preload: 'precargando' };

/** Resumen de lo que corre de fondo para la píldora ('' = nada). */
export function busyText(s: Live): string {
	const title = (k: string): string => titleOf(s, k);
	const parts: string[] = [];
	for (const r of s.playbacks.values()) {
		const k = r.state.kind;
		if (k === 'fetching-metadata' || k === 'preparing') parts.push(tr('Preparando {a}{b}', { a: title(r.key), b: k === 'preparing' ? ` ${Math.round((r.state.fraction ?? 0) * 100)} %` : '' }));
		else if (k === 'playing' && r.progress < 0.999) parts.push(tr('Bajando {a} · {b} %', { a: title(r.key), b: Math.floor(r.progress * 100) }));
		else if (k === 'background') parts.push(tr('Bajando {a} de fondo · {b} %', { a: title(r.key), b: Math.floor(r.progress * 100) }));
		else if (k === 'stopping') parts.push(tr('Cerrando {a}', { a: title(r.key) }));
	}
	const a = s.analyzer;
	if (a.kind === 'scraping') parts.push(tr('Consultando trackers'));
	else if (a.kind === 'quick-scan') parts.push(tr('Leyendo datos de {total}', { total: a.total }));
	else if (a.kind === 'measuring' && a.current) parts.push(tr('Midiendo {a}', { a: title(a.current) }));
	const waiting = s.queued.filter((h) => !(a.kind === 'measuring' && a.current === h)).length;
	if (waiting && a.kind !== 'paused') parts.push(tr('{waiting} en cola', { waiting }));
	return parts.join(' · ');
}

/** Evento del núcleo → líneas de la burbuja. `prev` es el estado ANTES del evento: se cuentan solo los cambios, no cada tic. */
export function eventLines(prev: Live, ev: CoreEvent): FeedLine[] {
	const out: FeedLine[] = [];
	const A = (area: string, text: string, more: Omit<FeedLine, 'area' | 'text'> = {}): void => void out.push({ area, text, ...more });
	const titleOfKey = (k: string): string => titleOf(prev, k);
	switch (ev.type) {
		case 'activity':
			A(ev.area, ev.message, { level: ev.level, at: new Date(ev.at) });
			break;
		case 'status':
			A('general', ev.message, { level: ev.level });
			break;
		case 'clipboard-history-unavailable':
			A('portapapeles', tr('El historial del portapapeles (Win+V) está apagado: solo se ve lo último copiado.'), { level: 'warn' });
			break;
		case 'analyzer-progress': {
			const s = ev.state;
			const p = prev.analyzer;
			if (s.kind === 'scraping' && p.kind !== 'scraping') A('analisis', tr('Consultando trackers de {total} magnet(s)', { total: s.total }));
			else if (s.kind === 'quick-scan' && p.kind !== 'quick-scan') A('analisis', tr('Leyendo datos rápidos de {total}: nombre, duración, audios, seeds', { total: s.total }));
			else if (s.kind === 'measuring' && s.current) {
				if (p.kind !== 'measuring' || p.current !== s.current) A('analisis', tr('Midiendo la velocidad de {a} ({b} de {total})', { a: titleOfKey(s.current), b: s.done + 1, total: s.total }), { announce: true });
				if (s.live) {
					const ph = s.live.phase;
					const txt = ph in PHASE_TEXT ? tr('preparando · {a}', { a: PHASE_TEXT[ph] })
						: ph === 'probing' ? tr('{a} Mbps · leyendo duración y audios', { a: mb(s.live.speed_bps) })
							: tr('{a} Mbps · {b} s · {peers} peers{c}', { a: mb(s.live.speed_bps), b: Math.round(s.live.secs), peers: s.live.peers, c: s.live.stable ? tr(' · ya estable') : '' });
					A('analisis', `${titleOfKey(s.current)}: ${txt}`, { key: `spd:${s.current}` });
				}
			} else if (s.kind === 'paused' && p.kind !== 'paused') A('analisis', tr('Análisis en pausa'));
			else if (s.kind === 'idle' && p.kind !== 'idle' && p.kind !== 'paused') A('analisis', tr('Análisis terminado: la lista quedó ordenada de mejor a peor'), { announce: true });
			break;
		}
		case 'analyzer-queue':
			if (ev.queued.length && ev.queued.length !== prev.queued.length) A('analisis', tr('{n} en cola para analizar', { n: ev.queued.length }), { key: 'queue' });
			for (const hsh of ev.held) if (!prev.held.has(hsh)) A('analisis', tr('Pausado el análisis de {a}', { a: titleOfKey(hsh) }));
			break;
		case 'library-entry-updated': {
			const e = ev.entry;
			const old = prev.entries.get(e.key);
			const t = e.release?.title || fullName(e);
			if (!old) { A('portapapeles', tr('Agregado: {t}', { t })); break; }
			if (!old.torrent_name && e.torrent_name) A('motor', tr('Metadatos de {t}: {torrent_name}', { t, torrent_name: e.torrent_name }));
			if (!old.live && e.live) {
				const size = e.video_size ?? e.live.file_size;
				A('analisis', tr('Datos leídos de {t}: {a}{b}{c}', { t, a: size ? humanBytes(size) : '', b: e.live.duration_secs ? ` · ${clock(e.live.duration_secs)}` : '', c: e.languages?.length ? ` · ${e.languages.map((l) => l.short).join('/')}` : '' }));
			}
			if (e.live && e.live.avg_speed_bps > 0 && e.live.avg_speed_bps !== old.live?.avg_speed_bps) {
				A('analisis', tr('{t}: {a} Mbps reales', { t, a: mb(e.live.avg_speed_bps) }), { announce: true });
			}
			if (e.status?.kind === 'failed' && old.status?.kind !== 'failed') A('analisis', tr('Falló el análisis de {t}: {a}', { t, a: e.status.reason ?? tr('sin detalle') }), { level: 'error' });
			break;
		}
		case 'library-entry-removed':
			A('general', tr('Quitado de la lista: {a}', { a: titleOfKey(ev.key) }));
			break;
		case 'playback-updated': {
			const r = ev.row;
			const k = r.state.kind;
			const old = prev.playbacks.get(r.id);
			const t = titleOfKey(r.key);
			if (old?.state.kind !== k || k === 'preparing') {
				const text = {
					'fetching-metadata': tr('Buscando metadatos de {t}', { t }),
					preparing: tr('Preparando {t}: {a} % (principio y final del video)', { t, a: Math.round((r.state.fraction ?? 0) * 100) }),
					playing: tr('Reproduciendo {t} en mpv', { t }),
					'download-paused': tr('Descarga de {t} en pausa', { t }),
					stopping: tr('Cerrando {t}', { t }),
					paused: tr('{t} quedó pausada{a}: lo bajado queda guardado', { t, a: r.state.position_secs != null ? tr(' en {c}', { c: clock(r.state.position_secs) }) : '' }),
					failed: tr('No se pudo reproducir {t}: {message}', { t, message: r.state.message }),
					'ask-after-close': tr('Cerraste el reproductor de {t}: ¿seguir bajando de fondo o pausar?', { t }),
					background: tr('{t} sigue bajando de fondo, sin reproductor', { t })
				}[k];
				A('reproduccion', text, { key: k === 'preparing' ? `prep:${r.id}` : undefined, level: k === 'failed' ? 'error' : 'info', announce: k === 'playing' || k === 'failed' });
			}
			if ((k === 'playing' || k === 'background') && r.progress < 0.999) {
				A('motor', tr('Bajando {t}: {a} % · {b} Mbps · {peers} peers', { t, a: Math.floor(r.progress * 100), b: mb(r.speed_bps ?? 0), peers: r.peers }), { key: `dl:${r.id}` });
			}
			break;
		}
		case 'playback-removed': {
			const r = prev.playbacks.get(ev.id);
			if (r) A('limpieza', tr('Descarga de {a} borrada', { a: titleOfKey(r.key) }));
			break;
		}
		case 'catalog-streams': {
			const u = ev.update;
			const failed = u.addons.filter((x) => x.message).length;
			A('catalogo', tr('Catálogo: {n} streams de {n2} addons{a}{b}', { n: u.candidates.length, n2: u.addons.length, a: u.done ? '' : tr(' (llegando…)'), b: failed ? tr(' · {failed} sin respuesta', { failed }) : '' }), { key: `cat:${u.video_id}` });
			break;
		}
		default:
			break;
	}
	return out;
}
