// Premios con las respuestas REALES grabadas para el desktop (ui/mock/catalog_awards__*.json, misma forma que la web).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import EN from '../i18n/en.ts';
import { translate } from '../i18n/translate.ts';
import type { TitleAwards } from '../types.ts';
import { AWARD_KEYS, awardsView, cardAwards, entryLabel } from './awards.ts';

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
	assert.deepEqual(cardAwards(inception), { oscars: 4, wins: 160, nominations: 220 });
	assert.equal(cardAwards(fixture('tt0137523'))?.oscars, 0);
	assert.equal(cardAwards({ wins: 0, nominations: 0, entries: [] }), null);
});
