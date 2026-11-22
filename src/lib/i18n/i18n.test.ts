import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import EN from './en.ts';
import { pickLang, pickLangs, translate } from './translate.ts';

const SRC = fileURLToPath(new URL('../../', import.meta.url));
const holes = (s: string) => [...new Set(s.match(/\{\w+\}/g) ?? [])].sort();

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

test('en.ts: los {x} de cada clave coinciden con los de su traducción', () => {
	const bad = Object.entries(EN).filter(([key, value]) => holes(key).join() !== holes(value).join()).map(([key]) => key);
	assert.deepEqual(bad, []);
});

function sources(dir: string): string[] {
	return readdirSync(dir, { withFileTypes: true }).flatMap((f) => {
		const path = join(dir, f.name);
		if (f.isDirectory()) return f.name === 'node_modules' ? [] : sources(path);
		return /\.(js|ts|svelte)$/.test(f.name) && !/\.test\.(js|ts)$/.test(f.name) ? [path] : [];
	});
}

// t('…'), tr('…'), tx('…') con literal de comilla simple, doble o backtick sin `${}`.
const CALL = /(?<![\w$])(?:t|tr|tx)\(\s*(?:'((?:\\.|[^'\\\n])*)'|"((?:\\.|[^"\\\n])*)"|`((?:\\.|[^`\\$])*)`)/g;
const unescape = (raw: string) => raw.replace(/\\(.)/g, (_: string, c: string) => (c === 'n' ? '\n' : c));

test('src: cada t/tr/tx con literal tiene su clave en en.ts', () => {
	const missing: string[] = [];
	for (const file of sources(SRC)) {
		const text = readFileSync(file, 'utf8');
		for (const m of text.matchAll(CALL)) {
			const key = unescape(m[1] ?? m[2] ?? m[3]);
			if (!(key in EN)) missing.push(`${file}: ${key}`);
		}
	}
	assert.deepEqual(missing, []);
});
