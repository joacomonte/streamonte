// Contrato del proxy de TorBox para el desktop (`/api/desktop/torbox/*`, 2026-11-23): cada ruta permitida, pedida con
// la forma EXACTA que la manda el desktop (reqwest: `crates/core/src/catalog/torbox.rs` `Api::get`/`post_multipart`),
// tiene que pasar las capas de SvelteKit (CSRF, rutas) y llegar al hook del código. Antes la CSRF de Kit rechazaba el
// POST multipart de `createtorrent` (sin `Origin`) y ningún test lo veía: solo se probaban los handlers sueltos.
// Levanta la web como en producción (`vite build` + `node build`, ~5 s: `vite dev` NO aplica la CSRF y no lo
// detectaba), con `ORIGIN` = el de prod, sin red: el código de prueba es incorrecto a propósito, así el hook corta con
// 401 antes de llamar a TorBox. Si el desktop cambia cómo pide (headers, método), cambiar `desktopRequest` también.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:net';

const WEB = new URL('../../../', import.meta.url);
/** Origen que manda el desktop en los POST (torbox.rs `PROXY_ORIGIN`). */
const DESKTOP_ORIGIN = 'https://streamonte-web.vercel.app';
/** Rutas permitidas, leídas del proxy mismo (`ALLOWED`): una nueva queda cubierta sin tocar este test. */
const allowed = (): [string, string][] => {
	const src = readFileSync(new URL('src/routes/api/desktop/torbox/[...path]/+server.ts', WEB), 'utf8');
	const block = /const ALLOWED[^{]*\{([\s\S]*?)\n\};/.exec(src)?.[1] ?? '';
	return [...block.matchAll(/'([\w/]+)':\s*'(GET|POST)'/g)].map((m) => [m[1], m[2]]);
};

let server: ChildProcess;
let base = '';

const freePort = () =>
	new Promise<number>((ok) => {
		const s = createServer().listen(0, () => {
			const { port } = s.address() as { port: number };
			s.close(() => ok(port));
		});
	});

before(async () => {
	const port = await freePort();
	base = `http://127.0.0.1:${port}`;
	const { VERCEL: _vercel, ...rest } = process.env;
	execFileSync(process.execPath, ['node_modules/vite/bin/vite.js', 'build'], { cwd: WEB, env: rest, stdio: 'ignore' });
	// Sin DATABASE_URL (sin límite de intentos en la base), con un código conocido y el origen de prod (la CSRF compara
	// el `Origin` del pedido con este).
	const env = { ...rest, APP_PASSWORD: 'contract-ok', DATABASE_URL: '', HTTP_FIXTURES: '', PORT: String(port), HOST: '127.0.0.1', ORIGIN: DESKTOP_ORIGIN };
	server = spawn(process.execPath, ['build'], { cwd: WEB, env, stdio: 'ignore' });
	for (const end = Date.now() + 30_000; Date.now() < end; await new Promise((r) => setTimeout(r, 250))) {
		if (await fetch(`${base}/api/desktop/torbox/x`).then(() => true, () => false)) return;
	}
	throw new Error('la web no levantó en 30 s');
});
after(() => void server?.kill());

/** Como lo pide el desktop: cookie `code`, `Accept: application/json`; el POST multipart con `Origin` de la web. */
function desktopRequest(path: string, method: string): Promise<Response> {
	const headers: Record<string, string> = { accept: 'application/json', cookie: 'code=000' };
	if (method === 'GET') return fetch(`${base}/api/desktop/torbox/${path}`, { headers });
	const body = new FormData();
	body.set('magnet', 'magnet:?xt=urn:btih:08ada5a7a6183aae1e09d831df6748d566095a10');
	body.set('add_only_if_cached', 'true');
	return fetch(`${base}/api/desktop/torbox/${path}`, { method, headers: { ...headers, origin: DESKTOP_ORIGIN }, body });
}

test('proxy del desktop: cada ruta permitida pasa CSRF y rutas, y la corta el hook del código (401)', async () => {
	const routes = allowed();
	assert.ok(routes.some(([, m]) => m === 'POST'), 'el test no encontró ALLOWED en el proxy (¿cambió su forma?)');
	for (const [path, method] of routes) {
		const r = await desktopRequest(path, method);
		const text = await r.text();
		// 401 = el código: lo que el desktop toma como "código incorrecto". 403 sería la CSRF de Kit (el bug de 2026-11-23).
		assert.equal(r.status, 401, `${method} ${path}: ${r.status} ${text.slice(0, 120)}`);
	}
});
