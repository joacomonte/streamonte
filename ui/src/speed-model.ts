// "Tu conexión" sin DOM: estados del medidor y geometría de la aguja.
import { nf1 } from '../../packages/ui/src/format.ts';
import type * as Raw from './types.js';

export type SpeedView =
	| { kind: 'idle'; mbps?: number }
	| { kind: 'measuring'; mbps: number }
	| { kind: 'done'; mbps: number; at: string }
	| { kind: 'failed'; mbps: number; message: string };

/** Ángulo de la aguja: escala logarítmica de 1 a 1000 Mbps sobre media vuelta (-90° a 90°). */
export const angle = (v: number): number => -90 + 180 * Math.min(1, Math.max(0, Math.log10(Math.max(1, v)) / 3));

/** Largo del arco y de lo relleno (`stroke-dasharray`). */
export function gaugeArc(v: number): { angle: number; len: number; fill: number } {
	const a = angle(v);
	const len = Math.PI * 8;
	return { angle: a, len, fill: (len * (a + 90)) / 180 };
}

/** Evento `speed-test` del núcleo: solo mueve la aguja mientras se mide (el final llega con la respuesta). */
export function viewAfterEvent(view: SpeedView, s: Raw.SpeedState): SpeedView {
	return s.kind === 'measuring' && view.kind === 'measuring' ? { ...view, mbps: s.mbps } : view;
}

export const failedView = (e: unknown): SpeedView => ({ kind: 'failed', mbps: 0, message: (e as { message?: string } | null)?.message ?? String(e) });

/** Mbps sin decimales desde 100. */
export const fmtMbps = (v: number): string => (v >= 100 ? String(Math.round(v)) : nf1(v));
