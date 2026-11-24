// Reglas de "buen match" y "candidata a leer" de los pasos de elegir video (web ↔ desktop). Puras: cada app arma los
// `MatchFacts` de una opción con lo que sabe (nombre, pistas leídas, subs) y acá se decide.
import { latRank } from '../audio.ts';
import type { LatState } from '../types.ts';

export type MatchFacts = {
	latState: LatState;
	/** Dice o trae español sin aclarar cuál (MULTI / Dual / español en el nombre, o una pista en español). */
	saysSpanish: boolean;
	/** ¿Trae subs en español? true / false si ya se leyó, null si no se sabe. */
	subsEs: boolean | null;
	/** Ya se leyeron las pistas de audio. */
	audioRead: boolean;
};

/** Sin confirmar pero vale la pena leer sus pistas: web latina, o español sin aclarar. */
export const latToCheck = (f: MatchFacts): boolean => f.latState === 'likely' || (f.latState === 'check' && f.saysSpanish);

/** Con potencial de latino (única regla): latino o vale la pena revisarla. */
export const latPotential = (f: MatchFacts): boolean => f.latState === 'lat' || latToCheck(f);

/** Única regla de "buen match": pidiendo latino, LAT (pistas o nombre; los subs no importan); con audio original, sub ES
 * nativo. `excluded`: lo que la app descarta aparte (el desktop: CAM y las que ya fallaron). */
export const isMatch = (wantLat: boolean, f: MatchFacts, excluded = false): boolean =>
	!excluded && (wantLat ? f.latState === 'lat' : f.subsEs === true);

/** Única regla de "candidata a leer" (sin contar salud ni si ya se probó, que son de cada app): latino, sin pistas leídas y
 * con algo que lo sugiera; audio original, sin saber si trae sub ES. */
export const needsReading = (wantLat: boolean, f: MatchFacts): boolean =>
	wantLat ? !f.audioRead && latToCheck(f) : f.subsEs === null;

/** Pidiendo latino, por señal de latino (`latRank`) y, dentro de cada grupo, el orden que trae (calidad); si no, igual. */
export function latFirst<T>(items: T[], wantLat: boolean, latStateOf: (item: T) => LatState): T[] {
	return wantLat ? [...items].sort((a, b) => latRank(latStateOf(a)) - latRank(latStateOf(b))) : items;
}
