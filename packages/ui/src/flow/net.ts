// Conexión donde se va a ver por TorBox (2026-11-18): la elige el usuario en cada video y pone el tope de bitrate del buen
// match; "¿Se cortó?" baja un nivel. Textos en español sin traducir: cada app los pasa por su `t` al mostrarlos.
export type NetChoice = { key: string; label: string; range: string; mbps: number; tone: string };

/** De menor a mayor (así "¿Se cortó?" baja al anterior). `mbps`: lo más que se le pide al video (el piso del rango). */
export const NET: readonly NetChoice[] = [
	{ key: 'terrible', label: 'Muy baja', range: 'Menos de 8 Mbps o señal que se corta: busco una muy liviana', mbps: 4, tone: 'red' },
	{ key: 'low', label: 'Baja', range: '8 a 25 Mbps, o la tele en wifi 2.4 GHz', mbps: 10, tone: 'amber' },
	{ key: 'normal', label: 'Normal', range: '25 a 100 Mbps', mbps: 25, tone: 'accent-fg' },
	{ key: 'high', label: 'Alta', range: 'Más de 100 Mbps, en wifi 5 GHz o por cable', mbps: Infinity, tone: 'green' },
];

/** ¿Entra en la conexión elegida? Sin peso no se sabe cuánto pide: no entra (no puede ser el buen match). Sin conexión elegida, entra todo con peso. */
export const fitsNet = (sizeBytes: number | null | undefined, mbpsNeeded: number, net: NetChoice | null): boolean =>
	!!sizeBytes && (!net || mbpsNeeded <= net.mbps);
