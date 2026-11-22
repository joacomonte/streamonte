// Tipos y lógica pura del Tour (sin DOM): qué paso es válido y desde dónde se retoma.
import type { IconName } from './icons.ts';

/** `icon`: el ícono oficial de la tienda (hotlink; si no carga, Tour muestra un mosaico propio). Sin `href` no hay
 * botón de descarga: se instala desde otro lado y `store` lo explica. */
export type StoreLink = { label: string; store: string; href?: string; icon: string };
/** `picker`: muestra ese grupo del selector de idiomas. `nick`: pide el apodo (obligatorio: sin apodo válido no se
 * avanza ni se sale). `extra`: clave de contenido propio de la app (Tour lo pide con su snippet `extra`). */
export type Step = { icon: IconName; title: string; body: string; links?: StoreLink[]; picker?: 'app' | 'titles'; nick?: boolean; extra?: string; logo?: boolean };

export type LangCode = 'es' | 'en';
/** Idiomas elegidos y qué hacer al elegir uno (cada app decide: la web aplica al toque, el desktop recarga). */
export type LangOptions = {
	app: LangCode;
	titles: LangCode;
	onpick: (key: 'app' | 'titles', value: LangCode) => void;
	/** Bandera en vez del código en la tarjeta. */
	flags?: boolean;
	/** Ícono del grupo "idioma de la app". */
	appIcon?: IconName;
};

/** Paso al que se puede ir: más allá del apodo sin tenerlo, se queda en el del apodo (`nickAt` < 0: no hay apodo). */
export const guardStep = (to: number, nickAt: number, nickOk: boolean): number => (nickAt >= 0 && !nickOk && to > nickAt ? nickAt : to);

/** Paso desde el que se retoma lo guardado (texto o nada), dentro del rango. */
export const resumeIndex = (saved: string | null, count: number): number => Math.min(count - 1, Math.max(0, Number(saved) || 0));
