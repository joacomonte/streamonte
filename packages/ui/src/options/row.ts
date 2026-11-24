// Modelo de una fila de la lista de opciones (`OptionRow.svelte`), común a la web y al desktop. Cada app arma la vista con
// su estado (web: TorBox y pistas leídas; desktop: además pruebas, salud, reproducción y descarga de fondo) y la fila solo
// dibuja. Lo exclusivo del desktop son variantes de `Mid`/`Action` que la web nunca arma (`capabilities.speedTests`).
import { LAT_BADGE } from '../audio.ts';
import { QUALITY_STARS } from '../rank.ts';
import type { LatState } from '../types.ts';

type Click = (ev: MouseEvent & { currentTarget: HTMLButtonElement }) => void;

/** Globito de un badge: aparece `delay` ms después de `start` (epoch ms) y dura 3 s. */
export type Tip = { text: string; start: number; delay: number };

export type AudioTag = {
	state: LatState;
	/** Botón que al tocarlo muestra su globito al toque (Gallego, LAT?, Probar manualmente). */
	tappable: boolean;
	id: string;
	text: string;
	title: string;
	tip: Tip | null;
	onclick?: Click;
};
export type SubsTag = { state: 'ok' | 'no' | 'unk'; title: string; tip: Tip | null };

export type Quality = { known: true; name: string; stars: number; tip: string; cam: boolean } | { known: false; id: string; tip: string };

/** Lo del medio (desktop): estado de reproducción o de bajar de fondo, prueba en curso, veredicto de salud, etc. */
export type Verdict = { id: string; level: 0 | 1 | 2; probable: boolean; word: string; tip: string; aria: string; compact: boolean; onclick: Click };
export type Mid =
	| { kind: 'status'; state: string; text: string; progress: number | null; progressTip: string }
	| { kind: 'bg'; cls: string; text: string; tip: string }
	| { kind: 'waiting'; text: string }
	| { kind: 'testing'; quick: boolean; counting: boolean; step: string; label: string; since: number }
	| { kind: 'failed'; id: string; text: string; tip: string; retry: string; onclick: Click }
	| { kind: 'verdict'; verdict: Verdict }
	| { kind: 'check'; id: string; text: string; title: string; onclick: Click };
export type People = { verdict: Verdict | null; seeds: string; text: string; tip: string };

/** Botón de la cápsula junto al ▶ (lo que falta saber del idioma, o analizar en la web). */
export type DockButton = { id: string; icon: 'subs' | 'speaker' | 'search' | 'volume'; text: string; busy: string | null; cancel: string; title: string; aria: string; onclick: Click };

export type Action =
	| { kind: 'cancel'; id: string; text: string; title: string; onclick: Click }
	| { kind: 'stop'; id: string; text: string; title: string; onclick: Click; subchange: { id: string; title: string; onclick: Click } | null }
	| {
			kind: 'play';
			id: string;
			/** `torbox`: verde que late (desktop) · `ghost`: sin relleno (web, no es buen match). */
			tone: 'accent' | 'torbox' | 'ghost';
			state: 'idle' | 'busy' | 'ok' | 'err';
			label: string;
			title: string;
			onclick: Click;
			bg: { id: string; on: boolean; title: string; onclick: Click } | null;
			dock: DockButton[];
	  };

export type OptionRowView = {
	hash: string;
	title: string;
	best: boolean;
	bestText: string;
	/** Sin columna del medio (TorBox sin reproducirse, o la web). */
	idle: boolean;
	tooBig: boolean;
	skipped: boolean;
	size: string;
	hdr: string | null;
	res: string | null;
	heavy: string | null;
	failedBefore: string | null;
	torbox: string | null;
	audio: AudioTag | null;
	subs: SubsTag | null;
	quality: Quality;
	nofit: { text: string; title: string } | null;
	mid: { main: Mid | null; people: People | null } | null;
	action: Action;
};

// ---------- resoluciones ----------
/** Grupos de resolución: 4K, 2K, 1080p, 720p y "Otras" (SD y sin dato). */
export const RES_ORDER = ['2160p', '1440p', '1080p', '720p', 'other'];
export const resKey = (resolution: string | null | undefined): string => (resolution && RES_ORDER.includes(resolution) ? resolution : 'other');
/** `other` → `otras` (ya traducido por quien llama). */
export const resLabel = (r: string, otras: string): string => ({ '2160p': '4K', '1440p': '2K', other: otras })[r] ?? r;

// ---------- calidad ----------
/** Calidad de imagen por la fuente del release, en palabras para alguien no técnico: [nombre, explicación]. */
export const QUALITY_TEXT: Record<string, [string, string]> = {
	REMUX: ['Máster', 'REMUX: copia exacta del Blu-ray, sin recomprimir. La mejor imagen y sonido posibles; pesa mucho.'],
	BluRay: ['Blu-ray', 'Sacada del Blu-ray y comprimida: muy buena y más liviana.'],
	'WEB-DL': ['Streaming', 'WEB-DL: bajada de una plataforma de streaming. La calidad que verías ahí.'],
	WEBRip: ['Streaming', 'WEBRip: grabada desde una plataforma de streaming. Casi como WEB-DL.'],
	WEB: ['Streaming', 'WEB-DL: bajada de una plataforma de streaming. La calidad que verías ahí.'],
	HDTV: ['TV', 'HDTV: grabada de la tele.'],
	DVDRip: ['DVD', 'Sacada de un DVD: definición baja.'],
	CAM: ['Cine (cámara)', 'CAM / TS: alguien la grabó con una cámara en la sala. Se ve movida y el sonido es malo.']
};
/** Calidad de la fila; `tr` traduce. Sin fuente en el nombre se dice por qué falta (en gris, el porqué en el tooltip). */
export function qualityOf(source: string | null, release: string, id: string, tr: (s: string, p?: Record<string, string | number>) => string): Quality {
	const q = source ? QUALITY_TEXT[source] : undefined;
	if (q && source) return { known: true, name: tr(q[0]), stars: QUALITY_STARS[source] ?? 1, tip: tr('Calidad de imagen: {a}', { a: tr(q[1]) }), cam: source === 'CAM' };
	return { known: false, id, tip: tr('Calidad sin dato: el nombre del torrent no dice de dónde salió el video (Blu-ray, streaming, TV o cámara de cine), así que no se puede saber la calidad de imagen.\nNombre: {release_name}', { release_name: release }) };
}

/** Tooltips del badge HDR: HDR y Dolby Vision se muestran igual; el tooltip dice cuál es. */
export const HDR_TIP: Record<string, string> = {
	HDR: 'HDR: más rango de brillo y color. Se aprovecha con pantalla HDR; en una común se ve igual o un poco más apagado.',
	DV: 'Dolby Vision: HDR dinámico de Dolby. En pantallas sin Dolby Vision puede verse con colores raros (verde/violeta).'
};

type Tr = (s: string, p?: Record<string, string | number>) => string;
/** Tooltip del badge HDR de una fila (`hdr` del torrent); sin HDR, null. Un tipo sin tooltip propio dice "HDR". */
export const hdrText = (hdr: string[], tr: Tr): string | null =>
	hdr.length ? hdr.map((x) => HDR_TIP[x]).filter((x): x is string => !!x).map((x) => tr(x)).join('\n') || tr('HDR') : null;
/** Etiqueta de la opción destacada. */
export const bestText = (tr: Tr): string => tr('Mejor opción');
/** Aviso de la fila que pide más de lo que da la conexión elegida. */
export const heavyText = (mbps: number, tr: Tr): string => tr('Pide ~{a} Mbps: más de lo que da tu conexión', { a: Math.round(mbps) });
/** Lista vacía: si hay torrents que los filtros esconden, lo dice y ofrece sacarlos (`clear`). */
export type EmptyList = { text: string; clear: { text: string; onclick: () => void } | null };
export function noMatches(hasCandidates: boolean, clear: () => void, tr: Tr): EmptyList {
	if (!hasCandidates) return { text: tr('No se encontraron torrents.'), clear: null };
	return { text: tr('No hay opciones con estos filtros. '), clear: { text: tr('Quitar filtros'), onclick: clear } };
}
/** Botón del dock que lee las pistas de un torrent (web: analizar audio y subs; desktop: ¿trae subs? / ¿audio latino?). Leyendo,
 * muestra `busy`; si la última lectura falló, ofrece reintentar. `aria`: por defecto lo que se ve. */
export function readButton(p: { id: string; icon: DockButton['icon']; text: string; busy: string | null; failed: boolean; title: string; aria?: string; cancel?: string; onclick: Click }, tr: Tr): DockButton {
	const text = p.failed ? tr('No se pudo · reintentar') : p.text;
	return { id: p.id, icon: p.icon, text, busy: p.busy, cancel: p.cancel ?? '', title: p.title, aria: p.aria ?? p.busy ?? text, onclick: p.onclick };
}

// ---------- globitos ----------
const TIP_MS = 3000;
/** Globitos de los badges de un video: cuándo apareció cada uno (no vuelven a salir), el primero de cada tipo explica qué
 * significa (si hay varios tipos, de a uno) y el badge tocado muestra el suyo al toque. `now` = reloj (inyectable en tests). */
export class TipBook {
	#seen = new Map<string, number>();
	#explained = new Map<string, { hash: string; delay: number }>();
	#now: () => number;
	tapped: string | null = null;
	constructor(now: () => number = () => Date.now()) {
		this.#now = now;
	}
	/** Globito `key` que arranca `delay` ms después de verse por primera vez; null si ya terminó o sin movimiento. */
	tip(key: string, text: string, delay = 500, ms = TIP_MS): Tip | null {
		const now = this.#now();
		const start = this.#seen.get(key) ?? now;
		this.#seen.set(key, start);
		return delay - (now - start) + ms > 0 ? { text, start, delay } : null;
	}
	/** El primero de cada `kind` (el de más arriba) cuenta qué significa; los tipos se escalonan 2,2 s. `fresh`: recién leído,
	 * sale ya. */
	explain(kind: string, hash: string, text: string, fresh = false): Tip | null {
		if (!this.#explained.has(kind)) this.#explained.set(kind, { hash, delay: 400 + this.#explained.size * 2200 });
		const x = this.#explained.get(kind);
		return x?.hash === hash ? this.tip(`explain|${kind}`, text, fresh ? 0 : x.delay) : null;
	}
	/** Badge tocado: su globito sale de nuevo al toque. */
	tap(hash: string): void {
		this.#seen.delete(`audio|${hash}`);
		this.tapped = hash;
	}
	/** Otro video: todo de nuevo. */
	reset(): void {
		this.#seen.clear();
		this.#explained.clear();
		this.tapped = null;
	}
}

// ---------- idioma ----------
export type LangInput = {
	hash: string;
	lat: LatState;
	/** Pidió audio latino. */
	want: boolean;
	/** La película es hablada en español (muestra "Gallego" aunque no pida latino). */
	spokenEs: boolean;
	/** Trae subs en español: true / false / null = no se sabe. */
	subs: boolean | null;
	best: boolean;
	/** Recién leído en esta pantalla (sus globitos salen ya). */
	fresh?: boolean;
	/** Título del ES verde si se sabe de dónde salen (desktop: pistas leídas). */
	subsTitle?: string;
	audioId: string;
	onTap?: Click;
};
/** Idioma ya sabido, como badges junto al peso (única regla web ↔ desktop). Audio, pidiendo latino: LAT verde (confirmado o
 * dicho en el nombre), LAT tachado (leído, sin latino), LAT? punteado (web latina) o "Probar manualmente". Con audio original,
 * LAT solo si está; y "Gallego" si es español de España en una película hablada en español. Subtítulos (no pidiendo latino):
 * ES verde (trae), ES gris (se leyó y no trae: se bajan aparte) o ES? punteado (sin leer). La mejor opción explica los suyos. */
export function langTags(p: LangInput, tips: TipBook, tr: (s: string) => string): { audio: AudioTag | null; subs: SubsTag | null } {
	const { hash, lat, want, best } = p;
	const b = LAT_BADGE[lat];
	const tapped = tips.tapped === hash;
	const tappable = (state: LatState): AudioTag => ({
		state, tappable: true, id: p.audioId, text: tr(b.text), title: tr(b.title), onclick: p.onTap,
		tip: tapped || (best && state === 'spain') ? tips.tip(`audio|${hash}`, tr(b.tip), tapped ? 0 : 500) : null
	});
	const audio: AudioTag | null = lat === 'spain' && (p.spokenEs || want) ? tappable('spain')
		: lat === 'lat' ? { state: 'lat', tappable: false, id: '', text: 'LAT', title: tr(b.title), tip: best ? tips.tip(`best-lat|${hash}`, tr(b.tip)) : null }
		: want && lat === 'none' ? { state: 'none', tappable: false, id: '', text: 'LAT', title: tr(b.title), tip: tips.explain('nolat', hash, tr(b.tip), p.fresh) }
		: want && (lat === 'likely' || lat === 'check') ? tappable(lat)
		: null;
	// Pidiendo latino, los subs no importan: no se muestran.
	const subs: SubsTag | null = want ? null
		: p.subs === true ? { state: 'ok', title: p.subsTitle ?? tr('Trae un archivo de subtítulos en español (según la lista de archivos de TorBox)'), tip: best ? tips.tip(`best-subs|${hash}`, tr('Subtítulos en español incluidos'), 3600) : null }
		: p.subs === false ? { state: 'no', title: tr('No vienen incluidos: se bajan aparte'), tip: tips.explain('esdl', hash, tr('No vienen incluidos: se bajan aparte'), p.fresh) }
		: { state: 'unk', title: tr('Sin analizar: no se sabe si trae subtítulos en español'), tip: null };
	return { audio, subs };
}

