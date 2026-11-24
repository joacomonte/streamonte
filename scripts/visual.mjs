// Regresión visual: capturas de pantallas clave contra baselines en tests/visual/baseline/.
// Uso: node scripts/visual.mjs [--update] [--only TEXTO] [--threshold PCT=0.1] [--tol CANAL=16] [--out DIR]
//                              [--record]  (web: graba /api/* reales en tests/visual/fixtures/web/; corré el server con TMDB_KEY y pasá --web-url)
//                              [--ui-url URL] [--web-url URL]  (usar servers ya levantados en vez de levantar los propios)
//                              [--changed]  (solo las pantallas de la app que tocan los cambios sin commitear vs HEAD; packages/ = ambas)  [--changed-apps]  (solo imprime esas apps, "ui web"; lo usa contracts.sh)
// Sin red: desktop = ui con mock-tauri (ui/mock/*.json); web = /api/* respondido con fixtures; imágenes remotas = placeholder.
// El diff de píxeles lo hace el propio Chrome (canvas): sin dependencias. Detalle y decisión de CI: tests/visual/README.md.
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';

const root = new URL('..', import.meta.url).pathname;
const { chromium } = createRequire(`${root}web/package.json`)('playwright-core');
const argv = process.argv.slice(2);
const flag = (k) => argv.includes(`--${k}`);
const opt = (k, d) => (argv.includes(`--${k}`) ? argv[argv.indexOf(`--${k}`) + 1] : d);
if (argv.includes('--help')) { console.log('uso: node scripts/visual.mjs [--update] [--only TEXTO] [--threshold PCT] [--tol CANAL] [--out DIR] [--record] [--ui-url URL] [--web-url URL]'); process.exit(0); }
const update = flag('update'), record = flag('record');
const threshold = Number(opt('threshold', 0.1)); // % de píxeles distintos tolerado
const tol = Number(opt('tol', 16)); // diferencia máxima por canal (0-255) para contar un píxel como igual: absorbe antialiasing
const only = flag('only') ? opt('only') : '';
// --changed: qué app tocan los archivos modificados/nuevos (ui/ → desktop, web/ → web, packages/ → las dos).
const touched = new Set();
if (flag('changed') || flag('changed-apps')) {
  const { execSync } = await import('node:child_process');
  const files = execSync('git diff --name-only HEAD && git ls-files --others --exclude-standard', { cwd: root, encoding: 'utf8' }).split('\n');
  for (const f of files) {
    if (f.startsWith('ui/src/') || f.startsWith('ui/index.html') || f.startsWith('ui/mock/')) touched.add('ui');
    if (f.startsWith('web/src/')) touched.add('web');
    if (f.startsWith('packages/ui/')) { touched.add('ui'); touched.add('web'); }
  }
  if (flag('changed-apps')) { console.log([...touched].join(' ')); process.exit(0); } // lo usa contracts.sh --changed: una sola regla
  if (!touched.size) { console.log('visual: sin cambios de UI, nada que capturar'); process.exit(0); }
}
const baseDir = `${root}tests/visual/baseline`;
const fixDir = `${root}tests/visual/fixtures/web`;
const outDir = opt('out', `${tmpdir()}/streamonte-visual`);
mkdirSync(baseDir, { recursive: true }); mkdirSync(fixDir, { recursive: true }); mkdirSync(outDir, { recursive: true });

// ── servers (propios, en puertos poco comunes y estrictos, salvo --ui-url / --web-url)
const children = [];
async function serve(url, cwd, args, env = {}) {
  const base = url ?? null;
  if (base) return base;
  const port = args[args.indexOf('--port') + 1];
  const child = spawn(`${root}${cwd}/node_modules/.bin/vite`, args, { cwd: `${root}${cwd}`, env: { ...process.env, ...env }, stdio: 'ignore' });
  children.push(child);
  const u = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 120; i++) { // hasta 60 s
    if (await fetch(u).then((r) => r.ok, () => false)) return u;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`no levantó ${cwd} en ${u}`);
}
const stopAll = () => children.forEach((c) => c.kill());
process.on('exit', stopAll);

// ── pantallas. Cada una: app (ui|web), viewport, ruta y pasos hasta la vista estable.
const VIEWPORTS = {
  desktop: { viewport: { width: 1280, height: 800 } },
  mobile: { viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true },
};
const settle = (p, ms = 400) => p.waitForTimeout(ms);
const SCREENS = [
  { name: 'app-home', app: 'ui', vp: 'desktop', path: '/', run: (p) => p.waitForSelector('[id^=cat-card-]') },
  { name: 'app-ficha-fight-club', app: 'ui', vp: 'desktop', path: '/', run: async (p) => {
    await p.fill('#cat-q', 'fight club');
    await p.click('#cat-card-tt0137523');
    await p.waitForSelector('#cat-about-toggle');
    await p.getByText('Analizá o reproducí una.').waitFor({ timeout: 30000 }); // estado final de los streams (un sleep fijo cae distinto en cada máquina)
    await settle(p, 1500);
  } },
  { name: 'app-temporadas-breaking-bad', app: 'ui', vp: 'desktop', path: '/', run: async (p) => {
    await p.click('#cat-kind-tv');
    await p.click('#cat-card-tt0903747');
    await p.locator('#cat-season-1').scrollIntoViewIfNeeded();
    await settle(p, 1000);
  } },
  { name: 'app-ajustes', app: 'ui', vp: 'desktop', path: '/', run: async (p) => {
    await p.waitForSelector('[id^=cat-card-]');
    await p.click('#btn-settings');
    await p.waitForSelector('#dlg-settings[open]');
    await settle(p, 800);
  } },
  { name: 'web-home', app: 'web', vp: 'mobile', path: '/', run: (p) => p.waitForSelector('a[href^="/t/"] img') },
  { name: 'web-ficha', app: 'web', vp: 'mobile', path: '/', run: async (p) => {
    await p.click('a[href^="/t/movie/"]'); // navegación del lado del cliente: el load de la ficha usa el fetch del navegador (interceptable)
    await p.waitForURL(/\/t\/movie\//);
    await settle(p, 1500);
  } },
  { name: 'web-ajustes', app: 'web', vp: 'mobile', path: '/ajustes', run: (p) => settle(p, 1000) },
].filter((s) => s.name.includes(only) && (!flag('changed') || touched.has(s.app)));

// ── red: imágenes remotas = placeholder fijo; /api/* de la web = fixtures (o grabación con --record)
const PLACEHOLDER = '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="450"><rect width="300" height="450" fill="#8a94a6"/></svg>';
const apiFile = (url) => {
  const u = new URL(url);
  for (const k of ['from', 'to', 'l']) u.searchParams.delete(k); // from/to: fechas relativas a hoy; l: clave de caché de idioma que la web agrega sola (no cambia la respuesta)
  return `${fixDir}/${u.pathname.slice(1).replace(/[^a-z0-9]+/gi, '-')}-${createHash('sha1').update(u.search).digest('hex').slice(0, 8)}.json`;
};
async function stubNetwork(ctx, appOrigin) {
  await ctx.route('**/*', async (route) => {
    const req = route.request(), url = new URL(req.url());
    if (url.origin === appOrigin && req.resourceType() === 'image' && url.pathname.startsWith('/packages/')) { // ui/index.html: el dev server devuelve HTML en vez del SVG (imagen rota, cuyo alt cada SO dibuja distinto)
      return route.fulfill({ contentType: 'image/svg+xml', body: readFileSync(root + url.pathname.slice(1)) });
    }
    if (url.origin !== appOrigin) {
      if (req.resourceType() === 'image') return route.fulfill({ contentType: 'image/svg+xml', body: PLACEHOLDER });
      return route.abort(); // fuentes/scripts externos: nada de red
    }
    if (!url.pathname.startsWith('/api/') || appOrigin !== webOrigin) return route.continue();
    if (record && url.pathname !== '/api/torrents') { // torrents es un stream sin fin y necesita TorBox: no se graba
      const res = await route.fetch();
      if (res.ok() && req.method() === 'GET') writeFileSync(apiFile(req.url()), await res.text());
      return route.fulfill({ response: res });
    }
    if (req.method() !== 'GET') return route.fulfill({ status: 204 }); // /api/track y similares
    const file = apiFile(req.url());
    if (existsSync(file)) return route.fulfill({ contentType: 'application/json', body: readFileSync(file) });
    if (flag('verbose')) console.warn('sin fixture', url.pathname + url.search);
    return route.fulfill({ status: 404, contentType: 'application/json', body: '{"message":"sin fixture"}' });
  });
}

// ── diff en Chrome: ambos PNG a canvas, píxel a píxel; devuelve % distinto y un PNG de diff (rojo sobre el baseline atenuado)
async function diff(page, a, b) {
  return page.evaluate(async ({ a, b, tol }) => {
    const load = async (s) => { const bmp = await createImageBitmap(await (await fetch(`data:image/png;base64,${s}`)).blob()); const c = new OffscreenCanvas(bmp.width, bmp.height); const x = c.getContext('2d'); x.drawImage(bmp, 0, 0); return { w: bmp.width, h: bmp.height, d: x.getImageData(0, 0, bmp.width, bmp.height) }; };
    const [A, B] = [await load(a), await load(b)];
    if (A.w !== B.w || A.h !== B.h) return { pct: 100, size: `${A.w}x${A.h} vs ${B.w}x${B.h}` };
    const out = new ImageData(A.w, A.h);
    let n = 0;
    for (let i = 0; i < A.d.data.length; i += 4) {
      const bad = Math.max(Math.abs(A.d.data[i] - B.d.data[i]), Math.abs(A.d.data[i + 1] - B.d.data[i + 1]), Math.abs(A.d.data[i + 2] - B.d.data[i + 2])) > tol;
      if (bad) n++;
      out.data.set(bad ? [255, 0, 0, 255] : [B.d.data[i] * 0.3 + 178, B.d.data[i + 1] * 0.3 + 178, B.d.data[i + 2] * 0.3 + 178, 255], i);
    }
    const c = new OffscreenCanvas(A.w, A.h); c.getContext('2d').putImageData(out, 0, 0);
    const blob = await c.convertToBlob({ type: 'image/png' });
    const png = await new Promise((ok) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(',')[1]); r.readAsDataURL(blob); });
    return { pct: (100 * n) / (A.w * A.h), png };
  }, { a, b, tol });
}

// ── ejecución
let webOrigin = '';
const uiUrl = SCREENS.some((s) => s.app === 'ui') ? await serve(opt('ui-url'), 'ui', ['--port', '1541', '--strictPort']) : '';
// Sin keys en el server: las respuestas salen de los fixtures. En --record el server debe traer TMDB_KEY (se le pasa por --web-url).
const webUrl = SCREENS.some((s) => s.app === 'web') ? await serve(opt('web-url'), 'web', ['dev', '--port', '5283', '--strictPort', '--host', '127.0.0.1'], { TMDB_KEY: '', APP_PASSWORD: '' }) : '';
webOrigin = webUrl && new URL(webUrl).origin;
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const checker = await browser.newPage();
const t0 = Date.now();
let failed = 0;
for (const theme of ['light', 'dark']) {
  for (const s of SCREENS) {
    const base = s.app === 'ui' ? uiUrl : webUrl;
    const ctx = await browser.newContext({ ...VIEWPORTS[s.vp], deviceScaleFactor: 1, colorScheme: theme, reducedMotion: 'reduce', locale: 'es-AR', timezoneId: 'UTC' });
    await ctx.addInitScript(() => { try { localStorage.setItem('tour:welcome', '1'); localStorage.setItem('tour:nick', '1'); } catch { /* sin storage */ } });
    await ctx.addCookies([{ name: 'nick', value: 'Joaco', url: base }]); // sin apodo la web lo pide en un diálogo
    await stubNetwork(ctx, new URL(base).origin);
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(base + s.path, { waitUntil: 'networkidle' });
    await s.run(page);
    await page.addStyleTag({ content: '*,*::before,*::after{caret-color:transparent!important;animation:none!important;transition:none!important}' });
    await page.evaluate(() => document.fonts.ready);
    const file = `${s.name}-${s.vp}-${theme}.png`;
    const shot = await page.screenshot(); // solo el viewport: estable y liviano
    await ctx.close();
    if (errors.length) console.warn(`${file}: errores de página: ${errors.join(' | ')}`);
    if (record) { console.log(`grabado ${file}`); continue; }
    if (update) { writeFileSync(`${baseDir}/${file}`, shot); console.log(`baseline ${file} (${(shot.length / 1024).toFixed(0)} KB)`); continue; }
    if (!existsSync(`${baseDir}/${file}`)) { console.log(`FALTA ${file} (corré con --update)`); failed++; continue; }
    const r = await diff(checker, readFileSync(`${baseDir}/${file}`).toString('base64'), shot.toString('base64'));
    const bad = r.pct > threshold;
    if (bad) {
      failed++;
      writeFileSync(`${outDir}/${file.replace('.png', '.actual.png')}`, shot);
      if (r.png) writeFileSync(`${outDir}/${file.replace('.png', '.diff.png')}`, Buffer.from(r.png, 'base64'));
    }
    console.log(`${bad ? 'FALLA' : 'ok   '} ${file} ${r.size ?? `${r.pct.toFixed(3)} %`}`);
  }
}
await browser.close();
console.log(`${((Date.now() - t0) / 1000).toFixed(1)} s${failed ? `; ${failed} fallaron: diffs en ${outDir}` : ''}`);
process.exit(failed ? 1 : 0);
