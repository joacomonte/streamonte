// Claves de i18n: todo `t('…')` / `tr('…')` con texto literal en ui/src/*.js y los textos fijos de ui/index.html
// (los que traduce `translateStatic`) tienen que estar en i18n-en.js, y cada clave conserva sus `{placeholders}`.
import './test-stub.js';
import assert from 'node:assert/strict';
import EN from './i18n-en.js';

const SRC = new URL('./', import.meta.url);
const HTML = new URL('../index.html', import.meta.url);

/** Textos iguales en los dos idiomas (nombres propios, unidades, palabras que no cambian): no necesitan entrada en i18n-en.js. */
const NEUTRAL = new Set([
  'Streamonte', 'TMDB', 'TorBox', 'Lat-Team', 'Wyzie Subs', 'OpenSubtitles.com (Premium)', 'mpv', 'VLC', 'TCP', 'Firewall:',
  '{a} Mbps', '{a} Mbps ', 'seeders × {a}', 'leechers × {a}', ' (probable)', 'Blu-ray', 'Streaming', 'Video', 'Normal', 'General', 'Error', 'Info',
  'Debug / verbose', '{n} seeds', '~{a} min', ' · {a} leechers', '{TRACKERS_TIP} {seeders} seeders, {a} leechers.',
  '{doubtful} {a} (MULTI / Dual)', '{a} Mbps · {b} s · {peers} peers{c}',
]);

/** Placeholders `{x}` de un texto, ordenados. @param {string} s */
const holes = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

/** Texto de un literal JS entre comillas simples o dobles (solo los escapes que se usan). @param {string} raw */
const unescape = (raw) => raw.replace(/\\(u[0-9a-fA-F]{4}|.)/g, (_, c) => (c === 'n' ? '\n' : c[0] === 'u' ? String.fromCharCode(parseInt(c.slice(1), 16)) : c));

/** Claves literales de `t('…')` / `tr('…')` por archivo (los template literals con `${}` no son literales). */
function codeKeys() {
  /** @type {{file: string, key: string}[]} */
  const out = [];
  for (const f of Deno.readDirSync(SRC)) {
    if (!f.name.endsWith('.js') || f.name === 'i18n-en.js' || f.name.endsWith('.test.js') || f.name === 'test-stub.js' || f.name === 'i18n.js') continue; // i18n.js: su `t()` de autoprueba usa un texto inventado
    const src = Deno.readTextFileSync(new URL(f.name, SRC));
    for (const m of src.matchAll(/(?<![\w.$])(?:t|tr)\(\s*(?:'((?:\\.|[^'\\\n])*)'|"((?:\\.|[^"\\\n])*)")/g)) {
      out.push({ file: f.name, key: unescape(m[1] ?? m[2]) });
    }
  }
  return out;
}

/** Textos fijos de index.html (nodos de texto con letras y title/placeholder/aria-label), normalizados como `translateStatic`. */
function htmlKeys() {
  const html = Deno.readTextFileSync(HTML).replace(/<(script|style)[\s\S]*?<\/\1>/g, '').replace(/<!--[\s\S]*?-->/g, '');
  const dec = (/** @type {string} */ s) => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  /** @type {Set<string>} */
  const out = new Set();
  for (const m of html.matchAll(/>([^<>]+)</g)) out.add(dec(m[1]).replace(/\s+/g, ' ').trim());
  for (const m of html.matchAll(/\s(?:title|placeholder|aria-label)="([^"]*)"/g)) out.add(dec(m[1]));
  return [...out].filter((s) => /\p{L}{3}/u.test(s));
}

Deno.test('i18n: t()/tr() literales del código tienen traducción al inglés', () => {
  const missing = codeKeys().filter(({ key }) => !(key in EN) && !NEUTRAL.has(key));
  assert.deepEqual(missing.map((m) => `${m.file}: ${m.key}`), []);
});

Deno.test('i18n: textos fijos de index.html tienen traducción al inglés', () => {
  assert.deepEqual(htmlKeys().filter((k) => !(k in EN) && !NEUTRAL.has(k)), []);
});

Deno.test('i18n: cada clave y su traducción tienen los mismos {placeholders}', () => {
  const bad = Object.entries(EN).filter(([es, en]) => holes(es).join() !== holes(en).join());
  assert.deepEqual(bad.map(([es]) => es), []);
});
