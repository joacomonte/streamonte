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

test('cardAwards: solo eventos grandes; mejor película o serie aparte del resto de los ganados', () => {
	const inc = cardAwards(inception)!;
	const won = inception.entries.filter((e) => e.won).length;
	assert.equal(inc.best + inc.other, won);
	assert.equal(inc.nominations, inception.entries.length - won);
	assert.deepEqual({ imdbWins: inc.imdbWins, imdbNominations: inc.imdbNominations }, { imdbWins: 160, imdbNominations: 220 });
	assert.ok(cardAwards(bad)!.best >= 2, 'Breaking Bad: Emmy a mejor serie dramática');
	assert.equal(cardAwards({ wins: 5, nominations: 3, entries: [] }), null);
	const mix = { wins: 9, nominations: 9, entries: [
		{ event: 'oscar', won: true, award: 'Oscar', category: 'Best Motion Picture of the Year', year: 2019 },
		{ event: 'oscar', won: true, award: 'Oscar', category: 'Best Performance by an Actor in a Leading Role', year: 2019 },
		{ event: 'cannes', won: true, award: "Palme d'Or", category: null, year: 2019 },
		{ event: 'cannes', won: true, award: 'Best Director', category: null, year: 2019 },
		{ event: 'globe', won: false, award: 'Golden Globe', category: 'Best Motion Picture - Drama', year: 2019 }
	] } satisfies TitleAwards;
	assert.deepEqual(cardAwards(mix), { best: 2, other: 2, nominations: 1, imdbWins: 9, imdbNominations: 9 });
});

test('cardAwardsLabel: mejor película · premios · nominaciones · totales de IMDb, en los dos idiomas', () => {
	const c = { best: 1, other: 3, nominations: 15, imdbWins: 164, imdbNominations: 165 };
	assert.equal(cardAwardsLabel(c, es), '1 a mejor película o serie · 3 premios · 15 nominaciones · En IMDb, 164 premios y 165 nominaciones en total.');
	assert.equal(cardAwardsLabel(c, en), '1 for best picture or series · 3 awards · 15 nominations · On IMDb, 164 awards and 165 nominations in total.');
	assert.equal(cardAwardsLabel({ best: 0, other: 0, nominations: 1, imdbWins: 0, imdbNominations: 0 }, es), '1 nominación');
});
