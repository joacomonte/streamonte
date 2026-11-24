import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import EN from './en.ts';
import { translate } from './translate.ts';
import { setTranslator, t } from './runtime.ts';

const ROOT = new URL('../../../../', import.meta.url);
const holes = (s: string): string[] => [...new Set(s.match(/\{\w+\}/g) ?? [])].sort();

/** Textos iguales en los dos idiomas (nombres propios, unidades, palabras que no cambian): no necesitan entrada en en.ts. */
const NEUTRAL = new Set([
	'Streamonte', 'TMDB', 'TorBox', 'HDR', 'Lat-Team', 'Wyzie Subs', 'OpenSubtitles.com (Premium)', 'mpv', 'VLC', 'TCP', 'Firewall:',
	'{a} Mbps', '{a} Mbps ', 'seeders × {a}', 'leechers × {a}', ' (probable)', 'Blu-ray', 'Streaming', 'Video', 'Normal', 'General', 'Error', 'Info',
	'Debug / verbose', '{n} seeds', '~{a} min', ' · {a} leechers', '{TRACKERS_TIP} {seeders} seeders, {a} leechers.',
	'{doubtful} {a} (MULTI / Dual)', '{a} Mbps · {b} s · {peers} peers{c}'
]);

test('translate: es deja el texto, en traduce, {x} se reemplaza', () => {
	assert.equal(translate('es', 'Descargar'), 'Descargar');
	assert.equal(translate('en', 'Descargar'), 'Download');
	assert.equal(translate('en', 'texto sin traducir'), 'texto sin traducir');
	assert.equal(translate('en', '{n} opciones · busco una con subtítulos en español', { n: 3 }), '3 options · I find one with Spanish subtitles');
	assert.equal(translate('es', 'hola {a} y {b}', { a: 1 }), 'hola 1 y ');
});

test('runtime: t delega en el traductor de la app', () => {
	assert.equal(t('Descargar'), 'Descargar');
	setTranslator((s, vars) => translate('en', s, vars));
	assert.equal(t('Descargar'), 'Download');
	setTranslator((s, vars) => translate('es', s, vars));
});

test('en.ts: cada clave y su traducción tienen los mismos {placeholders}', () => {
	assert.deepEqual(Object.entries(EN).filter(([es, en]) => holes(es).join() !== holes(en).join()).map(([es]) => es), []);
});

function sources(dir: URL): URL[] {
	return readdirSync(dir, { withFileTypes: true }).flatMap((f) => {
		const url = new URL(f.isDirectory() ? `${f.name}/` : f.name, dir);
		if (f.isDirectory()) return ['node_modules', 'dist', 'build', '.svelte-kit', '.data', 'mock'].includes(f.name) ? [] : sources(url);
		return /\.(js|ts|svelte)$/.test(f.name) && !/\.test\.(js|ts)$/.test(f.name) && !/(^|\/)(en\.ts|i18n\.ts|test-stub\.ts)$/.test(f.name) ? [url] : [];
	});
}

// t('…'), tr('…'), tx('…') con literal de comilla simple, doble o backtick sin `${}`.
const CALL = /(?<![\w$.])(?:t|tr|tx)\(\s*(?:'((?:\\.|[^'\\\n])*)'|"((?:\\.|[^"\\\n])*)"|`((?:\\.|[^`\\$])*)`)/g;
const unescape = (raw: string): string => raw.replace(/\\(u[0-9a-fA-F]{4}|.)/g, (_, c: string) => (c === 'n' ? '\n' : c[0] === 'u' ? String.fromCharCode(parseInt(c.slice(1), 16)) : c));

test('código de web, desktop y packages/ui: cada t/tr/tx con literal tiene su clave en en.ts', () => {
	const missing: string[] = [];
	for (const root of ['web/src/', 'ui/src/', 'packages/ui/src/']) {
		for (const file of sources(new URL(root, ROOT))) {
			for (const m of readFileSync(file, 'utf8').matchAll(CALL)) {
				const key = unescape(m[1] ?? m[2] ?? m[3] ?? '');
				if (!(key in EN) && !NEUTRAL.has(key)) missing.push(`${file.pathname}: ${key}`);
			}
		}
	}
	assert.deepEqual(missing, []);
});

/** Textos fijos de ui/index.html (nodos de texto con letras y title/placeholder/aria-label), normalizados como `translateStatic`. */
function htmlKeys(): string[] {
	const html = readFileSync(new URL('ui/index.html', ROOT), 'utf8').replace(/<(script|style)[\s\S]*?<\/\1>/g, '').replace(/<!--[\s\S]*?-->/g, '');
	const dec = (s: string): string => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
	const out = new Set<string>();
	for (const m of html.matchAll(/>([^<>]+)</g)) out.add(dec(m[1] ?? '').replace(/\s+/g, ' ').trim());
	for (const m of html.matchAll(/\s(?:title|placeholder|aria-label)="([^"]*)"/g)) out.add(dec(m[1] ?? ''));
	return [...out].filter((s) => /\p{L}{3}/u.test(s));
}

test('ui/index.html: textos fijos tienen traducción al inglés', () => {
	assert.deepEqual(htmlKeys().filter((k) => !(k in EN) && !NEUTRAL.has(k)), []);
});
