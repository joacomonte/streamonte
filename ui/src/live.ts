// Estado en vivo del núcleo (biblioteca, reproducciones, análisis) como valor inmutable: cada evento da un `Live` nuevo
// (o el mismo si no cambia nada), para guardarlo en `$state.raw` (live.svelte.ts). Puro: lo prueba live.test.ts.
import { t } from '../../packages/ui/src/i18n/runtime.ts';
import type { AnalyzerState, CoreEvent, InfoHash, LibraryRow, LibraryView, PlaybackId, PlaybackRow, VideoKey } from './types.ts';

export type Live = {
	/** Clave de video (`key` del núcleo: hash + episodio) → fila. Un pack de temporada tiene una fila por episodio con el
	 *  mismo info_hash: play, quitar y "Retomar" van por `key`; el análisis, por info_hash. */
	readonly entries: ReadonlyMap<VideoKey, LibraryRow>;
	readonly playbacks: ReadonlyMap<PlaybackId, PlaybackRow>;
	/** Último `analyzer-progress`. */
	readonly analyzer: AnalyzerState;
	/** Magnets esperando análisis y pausados uno por uno (`analyzer-queue`). */
	readonly queued: readonly InfoHash[];
	readonly held: ReadonlySet<InfoHash>;
};

export const emptyLive = (): Live => ({ entries: new Map(), playbacks: new Map(), analyzer: { kind: 'idle' }, queued: [], held: new Set() });

function without<K, V>(map: ReadonlyMap<K, V>, key: K): ReadonlyMap<K, V> {
	const next = new Map(map);
	next.delete(key);
	return next;
}

export function reduce(s: Live, ev: CoreEvent): Live {
	switch (ev.type) {
		case 'analyzer-progress':
			return { ...s, analyzer: ev.state };
		case 'analyzer-queue':
			return { ...s, queued: ev.queued, held: new Set(ev.held) };
		case 'library-entry-updated':
			return { ...s, entries: new Map(s.entries).set(ev.entry.key, ev.entry) };
		case 'library-entry-removed':
			return s.entries.has(ev.key) ? { ...s, entries: without(s.entries, ev.key) } : s;
		case 'playback-updated':
			return { ...s, playbacks: new Map(s.playbacks).set(ev.row.id, ev.row) };
		case 'playback-removed':
			return s.playbacks.has(ev.id) ? { ...s, playbacks: without(s.playbacks, ev.id) } : s;
		default:
			return s;
	}
}

/** Estado inicial pedido al arrancar: las filas que ya llegaron por evento (más nuevas) no se pisan. */
export function loaded(s: Live, view: LibraryView, rows: readonly PlaybackRow[]): Live {
	const entries = new Map(s.entries);
	for (const e of [...view.pasted_now, ...view.previous]) if (!entries.has(e.key)) entries.set(e.key, e);
	const playbacks = new Map(s.playbacks);
	for (const r of rows) playbacks.set(r.id, r);
	return { ...s, entries, playbacks };
}

/** Una fila cualquiera de ese torrent (para lo que es por info_hash: el análisis). */
export function entryOfHash(s: Live, hash: InfoHash): LibraryRow | null {
	for (const e of s.entries.values()) if (e.info_hash === hash) return e;
	return null;
}

/** Nombre completo del torrent: el de los metadatos si ya están, si no el `dn` del magnet. */
export const fullName = (e: LibraryRow): string => e.torrent_name || e.live?.torrent_name || e.name;

/** Nombre corto para los mensajes: de una fila (`key`) o de un torrent (info_hash). */
export function titleOf(s: Live, k: string): string {
	const e = s.entries.get(k) ?? entryOfHash(s, k);
	if (!e) return t('un torrent');
	const r = e.release;
	const ep = r?.season != null && r?.episode != null ? ` T${r.season}·E${r.episode}` : '';
	return `${r?.title || fullName(e)}${ep}`;
}
