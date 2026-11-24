/// <reference types="svelte" />
// Estado en vivo del desktop: UNA suscripción a `core://event` (`startLive`, la llama app.js) que reduce cada evento a
// `live.v` (live.ts) y anota la actividad (activity-feed.ts); los componentes leen de acá. La referencia a los tipos de
// svelte es para el tsc de los JS (tsconfig.js.json), que llega acá por state.js.
import { api, onCoreEvent } from './api.js';
import { emptyLive, loaded, reduce, type Live } from './live.ts';
import { eventLines, mergeLine, type FeedLine, type Line } from './activity-feed.ts';
import type { CoreEvent } from './types.ts';

class LiveStore {
	v = $state.raw<Live>(emptyLive());
}
export const live = new LiveStore();

class ActivityLog {
	lines = $state.raw<Line[]>([]);
	/** Última línea tocada (la que muestra la píldora). */
	last = $state.raw<Line | null>(null);
	/** Líneas nuevas desde que se cerró el panel. */
	unseen = $state(0);
	/** `Date.now()` de la última línea nueva (para "pasó hace poco"). */
	lastAt = $state(0);
	/** Sube con cada línea nueva (el widget hace un "bump"). */
	added = $state(0);
	/** Anuncio para lectores de pantalla. */
	said = $state('');
	/** Panel abierto (lo maneja el widget). */
	open = $state(false);
	clear(): void {
		this.lines = [];
		this.last = null;
		this.unseen = 0;
	}
}
export const activityLog = new ActivityLog();

let nextId = 0;
let lastSaidAt = 0;

/** Agrega (o actualiza) una línea de la actividad. También la usan dom.js (errores) y audio-picker.js vía activity.js. */
function push(l: FeedLine): void {
	const r = mergeLine(activityLog.lines, activityLog.last, l, nextId++);
	activityLog.lines = r.lines;
	activityLog.last = r.last;
	if (!r.added) return;
	if (!activityLog.open) activityLog.unseen++;
	activityLog.lastAt = Date.now();
	activityLog.added++;
	// Lectores de pantalla: solo resúmenes, como mucho uno cada 4 s.
	if ((l.announce || r.last.level !== 'info') && Date.now() - lastSaidAt >= 4000) {
		lastSaidAt = Date.now();
		activityLog.said = l.text;
	}
}
export const activity = { push };

/** Se suscribe a los eventos del núcleo y carga el estado inicial. `onEvent` (app.js: lo que todavía no migró) corre
 *  después de actualizar `live.v`, con el estado anterior en `prev` para comparar. */
export async function startLive(onEvent: (event: CoreEvent, prev: Live) => void): Promise<void> {
	await onCoreEvent((event: CoreEvent) => {
		const prev = live.v;
		for (const l of eventLines(prev, event)) push(l);
		live.v = reduce(prev, event);
		onEvent(event, prev);
	});
	const [view, rows] = await Promise.all([api.library(), api.playbacks()]);
	live.v = loaded(live.v, view, rows);
}
