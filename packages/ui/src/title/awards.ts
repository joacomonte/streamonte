// Premios de un título (IMDb, `TitleAwards`) como los muestran la tarjeta del catálogo y la ficha: cuentas para los íconos,
// una línea de resumen y la lista agrupada (ganados primero). Puro, sin DOM: el traductor llega por parámetro. Los textos de
// IMDb vienen en inglés; las categorías conocidas se pasan a una clave en español de `i18n/en.ts` (lo demás queda como vino).
import type { AwardEntry, AwardEvent, TitleAwards } from '../types.ts';

type T = (s: string, vars?: Record<string, string | number>) => string;

/** Orden de los eventos (el más importante primero), su nombre y cómo se cuentan varios (`{n}` = cantidad). */
const EVENTS: Record<AwardEvent, { name: string; many: string }> = {
	oscar: { name: 'Óscar', many: '{n} Óscar' },
	globe: { name: 'Globo de Oro', many: '{n} Globos de Oro' },
	bafta: { name: 'BAFTA', many: '{n} BAFTA' },
	emmy: { name: 'Emmy', many: '{n} Emmy' },
	sag: { name: 'Premio SAG', many: '{n} premios SAG' },
	goya: { name: 'Goya', many: '{n} Goya' },
	cannes: { name: 'Cannes', many: '{n} premios en Cannes' },
	venice: { name: 'Venecia', many: '{n} premios en Venecia' },
	berlin: { name: 'Berlín', many: '{n} premios en Berlín' }
};
const ORDER = Object.keys(EVENTS) as AwardEvent[];
const FESTIVALS = new Set<AwardEvent>(['cannes', 'venice', 'berlin']);

/** Premio de festival (nombre de IMDb) → clave en español. */
const PRIZES: [RegExp, string][] = [
	[/Palme d'Or/, 'Palma de Oro'],
	[/Grand Prize/, 'Gran Premio del Jurado'],
	[/Jury Prize/, 'Premio del Jurado'],
	[/Golden Lion/, 'León de Oro'],
	[/Silver Lion/, 'León de Plata'],
	[/Volpi Cup/, 'Copa Volpi'],
	[/Golden Berlin Bear/, 'Oso de Oro'],
	[/Silver Berlin Bear/, 'Oso de Plata']
];

/** Categoría de IMDb (en inglés, distinta en cada evento) → clave en español; la primera que coincide. */
const CATEGORIES: [RegExp, string][] = [
	[/Animated/i, 'Mejor película animada'],
	[/International Feature|Foreign Language|Not in the English Language/i, 'Mejor película internacional'],
	[/International/i, 'Mejor serie internacional'],
	[/Documentary/i, 'Mejor documental'],
	[/Stunt/i, 'Mejor equipo de dobles'],
	[/Ensemble|Cast in a/i, 'Mejor elenco'],
	[/Casting/i, 'Mejor casting'],
	[/Guest.*(Actress|Female)/i, 'Mejor actriz invitada'],
	[/Guest/i, 'Mejor actor invitado'],
	[/Supporting.*(Actress|Female)|(Actress|Female).*Supporting/i, 'Mejor actriz de reparto'],
	[/Supporting/i, 'Mejor actor de reparto'],
	[/Actress|Female Actor/i, 'Mejor actriz'],
	[/Actor/i, 'Mejor actor'],
	[/Adapted|Based on Material/i, 'Mejor guion adaptado'],
	[/Original Screenplay|Screenplay Written Directly|Writing.*Original/i, 'Mejor guion original'],
	[/Screenplay|Writing/i, 'Mejor guion'],
	[/Directing|Director/i, 'Mejor dirección'],
	[/Cinematography/i, 'Mejor fotografía'],
	[/Sound Editing/i, 'Mejor edición de sonido'],
	[/Sound Mixing/i, 'Mejor mezcla de sonido'],
	[/Sound/i, 'Mejor sonido'],
	[/Editing/i, 'Mejor montaje'],
	[/Visual Effects/i, 'Mejores efectos visuales'],
	[/Original Song/i, 'Mejor canción original'],
	[/Score|Music/i, 'Mejor banda sonora'],
	[/Production Design|Art Direction/i, 'Mejor diseño de producción'],
	[/Costume/i, 'Mejor vestuario'],
	[/Makeup|Hair/i, 'Mejor maquillaje'],
	[/Drama Series|Series - Drama/i, 'Mejor serie dramática'],
	[/Comedy Series|Series - (Musical or )?Comedy/i, 'Mejor serie de comedia'],
	[/Limited|Miniseries|Mini-Series/i, 'Mejor miniserie'],
	[/British Film/i, 'Mejor película británica'],
	[/Motion Picture|Best Picture|Best Film|Outstanding Film/i, 'Mejor película']
];

/** Todas las claves en español que este archivo pasa por `t` sin literal (las prueba `awards.test.ts` contra `en.ts`). */
export const AWARD_KEYS: string[] = [...ORDER.flatMap((e) => [EVENTS[e].name, EVENTS[e].many]), ...PRIZES.map(([, k]) => k), ...CATEGORIES.map(([, k]) => k)];

const match = (table: [RegExp, string][], text: string) => table.find(([re]) => re.test(text))?.[1];

/** Qué ganó o a qué estuvo nominada dentro de su evento: la categoría (o el premio de festival) ya traducida. */
export function entryLabel(e: AwardEntry, t: T): string {
	if (FESTIVALS.has(e.event)) {
		// El premio ("Palme d'Or", o "Best Director" en Cannes) y, si suma algo, la categoría ("Oso de Plata · Mejor actriz").
		const prize = match(PRIZES, e.award) ?? match(CATEGORIES, e.award);
		const name = prize ? t(prize) : e.award;
		const cat = e.category && !/Best Film|Competition|Grand Jury Prize/i.test(e.category) ? e.category : null;
		const catKey = cat ? match(CATEGORIES, cat) : null;
		return cat ? `${name} · ${catKey ? t(catKey) : cat}` : name;
	}
	// Sin categoría, a veces el premio la dice ("Anthony Asquith Award for Film Music"); si no, el evento solo.
	const key = match(CATEGORIES, e.category ?? e.award);
	return key ? t(key) : (e.category ?? t(EVENTS[e.event].name));
}

/** `best`: premio a mejor película o serie (va primero y con la copa en la ficha). */
export type AwardItem = { label: string; count: number; years: number[]; best: boolean };
export type AwardGroup = { event: AwardEvent; name: string; count: number; items: AwardItem[] };
export type AwardsView = {
	won: AwardGroup[];
	nominated: AwardGroup[];
	/** Los años solo dicen algo si hay más de uno (series, o premios que llegaron después). */
	showYears: boolean;
	/** Una línea: "Ganó: Óscar a Mejor fotografía · Nominada: 3 Globos de Oro". */
	line: string;
	wins: number;
	nominations: number;
};

function groups(entries: AwardEntry[], won: boolean, t: T): AwardGroup[] {
	return ORDER.flatMap((event) => {
		const list = entries.filter((e) => e.event === event && e.won === won);
		if (!list.length) return [];
		const items = new Map<string, AwardItem>();
		for (const e of list) {
			const label = entryLabel(e, t);
			const item = items.get(label) ?? { label, count: 0, years: [], best: isBest(e) };
			item.count++;
			if (e.year && !item.years.includes(e.year)) item.years.push(e.year);
			items.set(label, item);
		}
		for (const item of items.values()) item.years.sort((a, b) => a - b);
		return [{ event, name: t(EVENTS[event].name), count: list.length, items: [...items.values()].sort((a, b) => Number(b.best) - Number(a.best)) }];
	});
}

/** Una parte del resumen: con uno solo, qué fue ("Óscar a Mejor fotografía"); con varios, cuántos ("4 Óscar"). */
function brief(g: AwardGroup, t: T): string {
	if (g.count > 1) return t(EVENTS[g.event].many, { n: g.count });
	const label = g.items[0]?.label ?? '';
	if (FESTIVALS.has(g.event) || label === g.name) return label;
	return t('{p} a {c}', { p: g.name, c: label });
}

/** Lo que dibuja la ficha; null si no hay nada que decir. Sin eventos grandes, la línea son los totales de IMDb. */
export function awardsView(a: TitleAwards | null | undefined, t: T): AwardsView | null {
	if (!a || (!a.wins && !a.nominations && !a.entries.length)) return null;
	const won = groups(a.entries, true, t);
	const nominated = groups(a.entries, false, t);
	const parts: string[] = [];
	if (won.length) parts.push(`${t('Ganó:')} ${won.map((g) => brief(g, t)).join(', ')}`);
	if (nominated.length) parts.push(`${t('Nominada:')} ${nominated.map((g) => brief(g, t)).join(', ')}`);
	if (!parts.length) {
		if (a.wins) parts.push(t(a.wins === 1 ? '{n} premio' : '{n} premios', { n: a.wins }));
		if (a.nominations) parts.push(t(a.nominations === 1 ? '{n} nominación' : '{n} nominaciones', { n: a.nominations }));
	}
	const years = new Set(a.entries.map((e) => e.year).filter(Boolean));
	return { won, nominated, showYears: years.size > 1, line: parts.join(' · '), wins: a.wins, nominations: a.nominations };
}

/** Lo que cuenta como "mejor película o serie" (claves de CATEGORIES y los premios mayores de festival). */
const BEST = new Set(['Mejor película', 'Mejor película británica', 'Mejor película animada', 'Mejor película internacional', 'Mejor documental', 'Mejor serie dramática', 'Mejor serie de comedia', 'Mejor miniserie', 'Mejor serie internacional', 'Palma de Oro', 'León de Oro', 'Oso de Oro']);

function isBest(e: AwardEntry): boolean {
	const key = FESTIVALS.has(e.event) ? match(PRIZES, e.award) : match(CATEGORIES, e.category ?? e.award);
	return !!key && BEST.has(key);
}

/** Lo que va en la tarjeta del catálogo, solo de los eventos grandes (los que dicen la categoría): ganados a mejor película o
 *  serie, otros ganados (actor, sonido…) y nominaciones; null si nada. `imdbWins`/`imdbNominations`: totales de IMDb (tooltip). */
export type CardAwards = { best: number; other: number; nominations: number; imdbWins: number; imdbNominations: number };

export function cardAwards(a: TitleAwards | null | undefined): CardAwards | null {
	if (!a) return null;
	const won = a.entries.filter((e) => e.won);
	const best = won.filter(isBest).length;
	const nominations = a.entries.length - won.length;
	if (!won.length && !nominations) return null;
	return { best, other: won.length - best, nominations, imdbWins: a.wins, imdbNominations: a.nominations };
}

/** Texto de los premios de la tarjeta (tooltip y lector de pantalla):
 *  "1 a mejor película o serie · 3 premios · 15 nominaciones · En IMDb, 164 premios y 165 nominaciones en total." */
export function cardAwardsLabel(c: CardAwards, t: T): string {
	const parts: string[] = [];
	if (c.best) parts.push(t('{n} a mejor película o serie', { n: c.best }));
	if (c.other) parts.push(t(c.other === 1 ? '{n} premio' : '{n} premios', { n: c.other }));
	if (c.nominations) parts.push(t(c.nominations === 1 ? '{n} nominación' : '{n} nominaciones', { n: c.nominations }));
	if (c.imdbWins || c.imdbNominations) parts.push(t('En IMDb, {a} y {b} en total.', {
		a: t(c.imdbWins === 1 ? '{n} premio' : '{n} premios', { n: c.imdbWins }),
		b: t(c.imdbNominations === 1 ? '{n} nominación' : '{n} nominaciones', { n: c.imdbNominations })
	}));
	return parts.join(' · ');
}
