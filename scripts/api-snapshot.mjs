#!/usr/bin/env node
// Foto de las respuestas de /api/* de la web, para probar que una reestructura no cambia lo que devuelve el server.
//   node scripts/api-snapshot.mjs take <dir> [--fixtures DIR]   # levanta la web sin red (HTTP_FIXTURES) y guarda un JSON por ruta
//   node scripts/api-snapshot.mjs diff <a> <b>                  # compara valores y tipos; exit 1 si hay diferencias
// Sin TorBox (link, tracks, premium): usan tokens y red real. --fixtures por defecto tests/fixtures/http (graba lo que falte).
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';

const ROUTES = {
	'catalog-browse': '/api/catalog?kind=movie&sort=rating&from=2025-01-01&to=&votes=10000&lang=en,es&interests=&page=1',
	'catalog-search': '/api/catalog?q=fight%20club&page=1',
	people: '/api/people?q=brad%20pitt',
	'title-movie': '/api/title/movie/550',
	'title-tv': '/api/title/tv/1396',
	season: '/api/season/1396/1',
	scores: '/api/scores/tt0903747',
	awards: '/api/awards/tt0137523',
	'torrents-movie': '/api/torrents?imdb=tt0137523',
	'torrents-episode': '/api/torrents?imdb=tt0903747&s=1&e=1',
	subs: '/api/subs?imdb=tt0137523'
};
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const [cmd, a, b] = process.argv.slice(2);

async function take(dir) {
	const i = process.argv.indexOf('--fixtures');
	const fixtures = path.resolve(i > 0 ? process.argv[i + 1] : `${root}/tests/fixtures/http`);
	const port = await new Promise((ok) => { const s = net.createServer().listen(0, () => { const p = s.address().port; s.close(() => ok(p)); }); });
	const web = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'dev', '--port', String(port), '--strictPort'], { cwd: `${root}/web`, env: { ...process.env, HTTP_FIXTURES: fixtures }, stdio: 'ignore' });
	const base = `http://localhost:${port}`;
	try {
		for (let t = 0; t < 120 && !(await fetch(base).then(() => true, () => false)); t++) await new Promise((r) => setTimeout(r, 500));
		fs.mkdirSync(dir, { recursive: true });
		for (const [name, url] of Object.entries(ROUTES)) {
			const r = await fetch(base + url);
			const text = await r.text();
			// /api/torrents responde NDJSON (una línea por update): se guarda como array.
			let body;
			try { body = JSON.parse(text); } catch { body = text.split('\n').filter(Boolean).map((l) => JSON.parse(l)); }
			fs.writeFileSync(`${dir}/${name}.json`, JSON.stringify({ url, status: r.status, body }, null, 1));
			console.log(`${r.status} ${name}`);
		}
	} finally { web.kill(); }
}

function diff(x, y, at, out) {
	const type = (v) => (v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v);
	if (type(x) !== type(y)) return out.push(`${at}: tipo ${type(x)} → ${type(y)}`);
	if (type(x) === 'array') { if (x.length !== y.length) out.push(`${at}: largo ${x.length} → ${y.length}`); x.forEach((v, i) => i < y.length && diff(v, y[i], `${at}[${i}]`, out)); return; }
	if (type(x) === 'object') { for (const k of new Set([...Object.keys(x), ...Object.keys(y)])) k in x && k in y ? diff(x[k], y[k], `${at}.${k}`, out) : out.push(`${at}.${k}: ${k in x ? 'sacado' : 'nuevo'}`); return; }
	if (x !== y) out.push(`${at}: ${JSON.stringify(x)} → ${JSON.stringify(y)}`);
}

if (cmd === 'take' && a) await take(path.resolve(a));
else if (cmd === 'diff' && a && b) {
	let n = 0;
	for (const f of [...new Set([...fs.readdirSync(a), ...fs.readdirSync(b)])].sort()) {
		const out = [];
		if (!fs.existsSync(`${a}/${f}`) || !fs.existsSync(`${b}/${f}`)) out.push(`falta en ${fs.existsSync(`${a}/${f}`) ? b : a}`);
		else diff(JSON.parse(fs.readFileSync(`${a}/${f}`, 'utf8')), JSON.parse(fs.readFileSync(`${b}/${f}`, 'utf8')), '', out);
		for (const l of out.slice(0, 20)) console.log(`${f} ${l}`);
		if (out.length > 20) console.log(`${f} … +${out.length - 20}`);
		n += out.length;
	}
	console.log(n ? `${n} diferencias` : 'sin diferencias');
	process.exit(n ? 1 : 0);
} else { console.error('uso: api-snapshot.mjs take <dir> [--fixtures DIR] | diff <a> <b>'); process.exit(2); }
