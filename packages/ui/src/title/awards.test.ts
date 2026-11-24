// Premios con las respuestas REALES grabadas para el desktop (ui/mock/catalog_awards__*.json, misma forma que la web).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import EN from '../i18n/en.ts';
import { translate } from '../i18n/translate.ts';
import type { TitleAwards } from '../types.ts';
import { AWARD_KEYS, awardsView, cardAwards, cardAwardsLabel, entryLabel } from './awards.ts';

const fixture = (id: string): TitleAwards => JSON.parse(readFileSync(new URL(`../../../../ui/mock/catalog_awards__${id}.json`, import.meta.url), 'utf8')) as TitleAwards;
const es = (s: string, v?: Record<string, string | number>) => translate('es', s, v);
const en = (s: string, v?: Record<string, string | number>) => translate('en', s, v);
const inception = fixture('tt1375666');
const bad = fixture('tt0903747');

test('cada clave que se traduce sin literal tiene su inglés', () => {
	assert.deepEqual(AWARD_KEYS.filter((k) => !(k in EN)), []);
});

test('El Origen: ganados primero, Óscar arriba, resumen en una línea', () => {
	const v = awardsView(inception, es)!;
	assert.equal(v.won[0]?.event, 'oscar');
	assert.equal(v.won[0]?.count, 4);
	assert.ok(v.won[0]?.items.some((i) => i.label === 'Mejor fotografía'));
	assert.ok(v.nominated[0]?.items.some((i) => i.label === 'Mejor película'));
	assert.equal(v.line, 'Ganó: 4 Óscar, 3 BAFTA, Premio SAG a Mejor equipo de dobles · Nominada: 4 Óscar, 4 Globos de Oro, 6 BAFTA');
	assert.equal(v.showYears, false);
	assert.ok(awardsView(inception, en)!.line.startsWith('Won: 4 Oscars, 3 BAFTAs'));
});

test('Breaking Bad: Emmy por año, años visibles y repetidos juntos', () => {
	const v = awardsView(bad, es)!;
	const emmy = v.won.find((g) => g.event === 'emmy')!;
	const drama = emmy.items.find((i) => i.label === 'Mejor serie dramática')!;
	assert.deepEqual(drama.years, [2013, 2014]);
	assert.equal(v.showYears, true);
	assert.ok(emmy.items.some((i) => i.label === 'Mejor actor'));
});

test('uno solo: qué ganó; festivales con su premio', () => {
	const one = { wins: 3, nominations: 1, entries: [{ event: 'oscar', won: true, award: 'Oscar', category: 'Best Writing, Original Screenplay', year: 2005 }, { event: 'cannes', won: false, award: "Palme d'Or", category: null, year: 2005 }] } satisfies TitleAwards;
	assert.equal(awardsView(one, es)!.line, 'Ganó: Óscar a Mejor guion original · Nominada: Palma de Oro');
	assert.equal(awardsView(one, en)!.line, "Won: Oscar for Best Original Screenplay · Nominated: Palme d'Or");
	assert.equal(entryLabel({ event: 'berlin', won: true, award: 'Silver Berlin Bear', category: 'Best Actress', year: 2011 }, es), 'Oso de Plata · Mejor actriz');
	assert.equal(entryLabel({ event: 'cannes', won: true, award: 'Best Director', category: null, year: 2011 }, es), 'Mejor dirección');
	assert.equal(entryLabel({ event: 'oscar', won: false, award: 'Oscar', category: 'Some Odd Category', year: 2011 }, es), 'Some Odd Category');
});

test('sin eventos grandes: los totales; sin nada: null', () => {
	assert.equal(awardsView({ wins: 5, nominations: 1, entries: [] }, es)!.line, '5 premios · 1 nominación');
	assert.equal(awardsView({ wins: 0, nominations: 0, entries: [] }, es), null);
	assert.equal(awardsView(null, es), null);
});

test('cardAwards: Óscar ganados aparte de los totales', () => {
	const inc = cardAwards(inception)!;
	assert.deepEqual({ oscars: inc.oscars, wins: inc.wins, nominations: inc.nominations }, { oscars: 4, wins: 160, nominations: 220 });
	assert.ok(inc.majorWins >= inc.oscars);
	assert.equal(cardAwards(fixture('tt0137523'))?.oscars, 0);
	assert.equal(cardAwards({ wins: 0, nominations: 0, entries: [] }), null);
});

test('cardAwards: majorWins cuenta solo ganados en eventos grandes; el dorado depende de eso', () => {
	const small = { wins: 107, nominations: 20, entries: [{ event: 'oscar', won: false, award: 'Oscar', category: 'Best Picture', year: 2019 }] } satisfies TitleAwards;
	assert.equal(cardAwards(small)!.majorWins, 0);
	assert.equal(cardAwards({ ...small, entries: [{ event: 'emmy', won: true, award: 'Emmy', category: 'Best Actor', year: 2019 }] })!.majorWins, 1);
});

test('cardAwardsLabel: óscar · premios · nominaciones, en los dos idiomas', () => {
	assert.equal(cardAwardsLabel({ oscars: 7, wins: 370, nominations: 378, majorWins: 20 }, es), '7 Óscar · 370 premios · 378 nominaciones');
	assert.equal(cardAwardsLabel({ oscars: 7, wins: 370, nominations: 378, majorWins: 20 }, en), '7 Oscars · 370 awards · 378 nominations');
	assert.equal(cardAwardsLabel({ oscars: 1, wins: 1, nominations: 0, majorWins: 1 }, en), '1 Oscar · 1 award');
	assert.equal(cardAwardsLabel({ oscars: 0, wins: 0, nominations: 1, majorWins: 0 }, es), '1 nominación');
});
