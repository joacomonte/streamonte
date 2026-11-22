// Estado del medidor de velocidad (botón + panel). Sin runes: los componentes se suscriben y copian `snapshot()`.
import { failedView, viewAfterEvent, type SpeedView } from './speed-model.ts';
import type * as Raw from './types.js';

export type SpeedSnapshot = { view: SpeedView; editing: boolean };
export type SpeedDeps = { speedTest: (force: boolean) => Promise<Raw.SpeedResult>; setLinkMbps: (mbps: number, network: string) => void };

export function createSpeedStore(deps: SpeedDeps) {
	let snap: SpeedSnapshot = { view: { kind: 'idle' }, editing: false };
	const listeners = new Set<() => void>();
	const set = (next: Partial<SpeedSnapshot>): void => {
		snap = { ...snap, ...next };
		listeners.forEach((l) => l());
	};
	return {
		snapshot: (): SpeedSnapshot => snap,
		subscribe(fn: () => void): () => void {
			listeners.add(fn);
			return () => void listeners.delete(fn);
		},
		/** Editando a mano el aporte por seeder. */
		setEditing: (editing: boolean): void => set({ editing }),
		/** Al abrir la app no se fuerza (el núcleo mide solo si esta red no tiene medición); "Medir de nuevo" sí. */
		async measure(force: boolean): Promise<void> {
			set({ view: { kind: 'measuring', mbps: 0 } });
			try {
				const r = await deps.speedTest(force);
				set({ view: { kind: 'done', mbps: r.mbps, at: r.measured_at } });
				deps.setLinkMbps(r.mbps, r.network);
			} catch (e) {
				set({ view: failedView(e) });
			}
		},
		onEvent(s: Raw.SpeedState): void {
			const view = viewAfterEvent(snap.view, s);
			if (view !== snap.view) set({ view });
		}
	};
}
export type SpeedStore = ReturnType<typeof createSpeedStore>;
