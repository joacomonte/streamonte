import { test } from 'node:test';
import assert from 'node:assert/strict';
import { locale, pickLang, pickLangs, translate } from './translate.ts';

test('translate: es deja el texto, en traduce, {x} se reemplaza', () => {
	assert.equal(translate('es', 'Descargar'), 'Descargar');
	assert.equal(translate('en', 'Descargar'), 'Download');
	assert.equal(translate('en', 'texto sin traducir'), 'texto sin traducir');
	assert.equal(translate('en', '{n} opciones · busco una con subtítulos en español', { n: 3 }), '3 options · I find one with Spanish subtitles');
	assert.equal(translate('es', 'hola {a} y {b}', { a: 1 }), 'hola 1 y ');
});

test('pickLang / pickLangs: cookie manda, sin cookie es español', () => {
	assert.equal(pickLang('en', null), 'en');
	assert.equal(pickLang(undefined, 'en-US'), 'es');
	const cookies = (c: Record<string, string>) => (n: string) => c[n];
	assert.deepEqual(pickLangs(cookies({ lang: 'en' }), null), { ui: 'en', titles: 'en' });
	assert.deepEqual(pickLangs(cookies({ lang: 'en', titles: 'es' }), null), { ui: 'en', titles: 'es' });
	assert.deepEqual(pickLangs(cookies({ titles: 'raro' }), null), { ui: 'es', titles: 'es' });
});

test('locale', () => {
	assert.equal(locale('en'), 'en-US');
	assert.equal(locale('es'), 'es-AR');
});
