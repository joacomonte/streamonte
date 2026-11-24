// Runner único de escenas (tests/scenes/*.json): contratos de pantalla y capturas visuales.
// Uso: node scripts/scenes.mjs [nombre...] [--contracts | --shots] [--only TEXTO] [--changed] [--all] [--update] [--record] [--file X.json] [--snap]
//        [--ui-url URL] [--web-url URL] [--jobs N=4] [--threshold PCT=0.1] [--tol CANAL=16] [--out DIR] [--changed-apps]
// Alias documentados: `scripts/contracts.sh` (= --contracts) y `scripts/visual.mjs` (= --shots). `verify-ui.sh` = lock + este runner con todo.
//
// Escena = { app: "desktop"|"web", url, viewport?, cookies?, apodo?(web: false = sin sesión de apodo), storage?, live?, setup[], must[], shot? }
//   setup: { click | type+text | hover | contextmenu | wait(ms) | waitFor(sel) | waitText(texto) | waitUrl(regex) | scroll(sel),
//            after?(ms; 400 en contratos, 0 en capturas), timeout?, optional? (click: se saltea si no aparece) }
//   must:  { sel, text?(regex), count?(>=), hover?(selector a pasar el mouse antes), status?: "regressed", note?, timeout?, after? }
//   shot:  { viewport: "desktop"|"mobile" }  → captura el viewport y la compara con tests/visual/baseline/<nombre sin "shot-">-<viewport>-dark.png.
//          Con shot, la red se simula (imágenes = gris, /api/* de la web = tests/fixtures/http/api) y la escena corre sin red.
// Sin `--ui-url/--web-url` (o UI_URL/WEB_URL) levanta un vite por app (web con HTTP_FIXTURES=tests/fixtures/http y APP_PASSWORD vacío).
// Sin `shot` es un contrato: exit 1 si falla algo que no es `regressed` (--all: también esos). `"live": true` solo con LIVE=1 o por nombre.
// El diff de píxeles lo hace el propio Chrome (canvas): sin dependencias. Detalle: tests/visual/README.md.
import { createRequire } from 'node:module';
import { execSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { apodoCookie } from './lib/web-apodo.mjs';

const root = new URL('..', import.meta.url).pathname;
const { chromium } = createRequire(`${root}web/package.json`)('playwright-core');
const argv = process.argv.slice(2);
const VALUED = new Set(['only', 'ui-url', 'web-url', 'jobs', 'threshold', 'tol', 'out', 'file']);
const flag = (k) => argv.includes(`--${k}`);
const opt = (k, d) => (argv.includes(`--${k}`) ? argv[argv.indexOf(`--${k}`) + 1] : d);
const names = argv.filter((a, i) => !a.startsWith('--') && !VALUED.has((argv[i - 1] ?? '').slice(2)));
if (flag('help')) { console.log('uso: node scripts/scenes.mjs [nombre...] [--contracts|--shots] [--only TEXTO] [--changed] [--all] [--update] [--record] [--ui-url URL] [--web-url URL] [--jobs N]'); process.exit(0); }
const update = flag('update'), record = flag('record');
const threshold = Number(opt('threshold', 0.1)); // % de píxeles distintos tolerado
const tol = Number(opt('tol', 16)); // diferencia máxima por canal (0-255) para contar un píxel como igual: absorbe antialiasing
const jobs = Number(opt('jobs', process.env.JOBS ?? 4)); // 4: ~35 % menos que 2 (medido 2026-11-24); el lock pesado evita correr dos runners
const only = opt('only', '');

// ── qué app tocan los cambios (sin commitear y sin pushear): ui/ → desktop, web/ → web, packages/ui/ → las dos
const touched = new Set();
if (flag('changed') || flag('changed-apps')) {
  const files = execSync('git diff --name-only HEAD && git ls-files --others --exclude-standard && git log --format= --name-only HEAD --not --remotes=origin', { cwd: root, encoding: 'utf8' }).split('\n');
  for (const f of files) {
    if (f.startsWith('ui/src/') || f.startsWith('ui/index.html') || f.startsWith('ui/mock/')) touched.add('ui');
    if (f.startsWith('web/src/')) touched.add('web');
    if (f.startsWith('packages/ui/')) { touched.add('ui'); touched.add('web'); }
  }
  if (flag('changed-apps')) { console.log([...touched].join(' ')); process.exit(0); }
  if (!touched.size) { console.log('escenas: sin cambios de UI, nada que correr'); process.exit(0); }
}

// ── elegir escenas
const sceneDir = `${root}tests/scenes`;
const baseDir = `${root}tests/visual/baseline`;
const fixDir = `${root}tests/fixtures/http/api`;
const outDir = opt('out', `${tmpdir()}/streamonte-visual`);
const appKey = (s) => (s.app === 'web' ? 'web' : 'ui');
// `--file X.json`: una escena suelta fuera de tests/scenes (pruebas a mano sin escribir Playwright); corre aunque sea live.
const file = opt('file', '');
const scenes = (file ? [{ name: file.split('/').pop().replace(/\.json$/, ''), ...JSON.parse(readFileSync(file, 'utf8')) }]
  : readdirSync(sceneDir).filter((f) => f.endsWith('.json')).sort().map((f) => ({ name: f.slice(0, -5), ...JSON.parse(readFileSync(`${sceneDir}/${f}`, 'utf8')) })))
  .filter((s) => file || !names.length || names.includes(s.name))
  .filter((s) => !only || s.name.includes(only))
  .filter((s) => !(flag('contracts') && s.shot) && !(flag('shots') && !s.shot))
  .filter((s) => !s.live || process.env.LIVE || names.length || file)
  .filter((s) => !touched.size || touched.has(appKey(s)))
  .filter((s) => !record || (s.shot && s.app === 'web'));
if (!scenes.length) { console.log('escenas: ninguna elegida'); process.exit(0); }
const baselineOf = (s) => `${s.name.replace(/^shot-/, '')}-${s.shot.viewport}-dark.png`;

// ── servers (propios en puertos libres, salvo --ui-url / --web-url / UI_URL / WEB_URL)
const children = [];
const stopAll = () => children.forEach((c) => c.kill());
process.on('exit', stopAll);
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => process.exit(130));
const freePort = () => new Promise((ok) => { const s = createServer().listen(0, () => { const p = s.address().port; s.close(() => ok(p)); }); });
async function serve(given, cwd, args, env = {}) {
  if (given) return given;
  const port = await freePort();
  children.push(spawn('node', ['node_modules/vite/bin/vite.js', ...args, '--port', String(port), '--strictPort', '--host', '127.0.0.1'], { cwd: `${root}${cwd}`, env: { ...process.env, ...env }, stdio: 'ignore' }));
  const u = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 120; i++) { // hasta 60 s
    if (await fetch(u).then((r) => r.ok, () => false)) return u;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`no levantó ${cwd} en ${u}`);
}
const baseUrl = {};
if (scenes.some((s) => appKey(s) === 'ui')) baseUrl.ui = await serve(opt('ui-url', process.env.UI_URL), 'ui', []);
if (scenes.some((s) => appKey(s) === 'web')) baseUrl.web = await serve(opt('web-url', process.env.WEB_URL), 'web', ['dev'], { HTTP_FIXTURES: `${root}tests/fixtures/http`, APP_PASSWORD: '', DATABASE_URL: '', APODO_WAIT_SECONDS: '1' });
// Sesión del apodo de prueba (cookie firmada `apodo`, en la base en memoria del vite): la usan las capturas.
const webApodo = baseUrl.web ? await apodoCookie(baseUrl.web) : null;

// ── contextos de navegador
const CONTRACT_VP = {
  mobile: { viewport: { width: 375, height: 812 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  desktop: { viewport: { width: 1280, height: 800 } },
};
const SHOT_VP = {
  desktop: { viewport: { width: 1280, height: 800 } },
  mobile: { viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true },
};

// red de las capturas: imágenes remotas = gris fijo; /api/* de la web = fixtures (o grabación con --record)
const PLACEHOLDER = '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="450"><rect width="300" height="450" fill="#8a94a6"/></svg>';
const apiFile = (url) => {
  const u = new URL(url);
  for (const k of ['from', 'to', 'l']) u.searchParams.delete(k); // from/to: fechas relativas a hoy; l: clave de caché de idioma que la web agrega sola
  return `${fixDir}/${u.pathname.slice(1).replace(/[^a-z0-9]+/gi, '-')}-${createHash('sha1').update(u.search).digest('hex').slice(0, 8)}.json`;
};
async function stubNetwork(ctx, appOrigin, isWeb) {
  await ctx.route('**/*', async (route) => {
    const req = route.request(), url = new URL(req.url());
    if (url.origin === appOrigin && req.resourceType() === 'image' && url.pathname.startsWith('/packages/')) { // el dev server devuelve HTML en vez del SVG (imagen rota, cuyo alt cada SO dibuja distinto)
      return route.fulfill({ contentType: 'image/svg+xml', body: readFileSync(root + url.pathname.slice(1)) });
    }
    if (url.origin !== appOrigin) {
      if (req.resourceType() === 'image') return route.fulfill({ contentType: 'image/svg+xml', body: PLACEHOLDER });
      return route.abort(); // fuentes/scripts externos: nada de red
    }
    if (!url.pathname.startsWith('/api/') || !isWeb) return route.continue();
    if (record && url.pathname !== '/api/torrents') { // torrents es un stream sin fin y necesita TorBox: no se graba
      const res = await route.fetch();
      if (res.ok() && req.method() === 'GET') { mkdirSync(fixDir, { recursive: true }); writeFileSync(apiFile(req.url()), await res.text()); }
      return route.fulfill({ response: res });
    }
    if (req.method() !== 'GET') return route.fulfill({ status: 204 }); // /api/track y similares
    const file = apiFile(req.url());
    if (existsSync(file)) return route.fulfill({ contentType: 'application/json', body: readFileSync(file) });
    if (flag('verbose')) console.warn('sin fixture', url.pathname + url.search);
    return route.fulfill({ status: 404, contentType: 'application/json', body: '{"message":"sin fixture"}' });
  });
}

// ── una escena: setup, must y (si hay shot) captura. Devuelve { name, rc, lines[], shot? }
async function runScene(s) {
  const base = baseUrl[appKey(s)];
  const origin = new URL(base).origin;
  const isShot = !!s.shot;
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const failed = [], regressed = [], fixed = [], pageErrors = [];
  let passed = 0, shotBuf = null;
  try {
    const ctx = await browser.newContext(isShot
      ? { ...SHOT_VP[s.shot.viewport], deviceScaleFactor: 1, colorScheme: 'dark', reducedMotion: 'reduce', locale: 'es-AR', timezoneId: 'UTC' }
      : { ...CONTRACT_VP[s.viewport ?? 'desktop'], reducedMotion: 'reduce' });
    const cookies = { ...(s.app === 'web' && s.apodo !== false ? { apodo: webApodo } : {}), ...s.cookies }; // sin apodo la web lo pide en un diálogo (`"apodo": false`: la escena lo prueba)
    const storage = { ...(isShot ? { 'tour:welcome': '1', 'tour:nick': '1' } : {}), ...s.storage };
    await ctx.addCookies(Object.entries(cookies).map(([name, value]) => ({ name, value, url: origin })));
    await ctx.addInitScript((kv) => { try { for (const k in kv) localStorage.setItem(k, kv[k]); } catch { /* sin storage */ } }, storage);
    if (isShot) await stubNetwork(ctx, origin, s.app === 'web');
    const page = await ctx.newPage();
    page.on('pageerror', (e) => pageErrors.push(e.message));
    const label = (m) => [m.hover && m.hover !== m.sel && `hover ${m.hover}`, m.hover && m.hover === m.sel && 'hover', m.sel, m.text && `/${m.text}/`, m.count && `x>=${m.count}`].filter(Boolean).join(' ');
    try {
      await page.goto(base + s.url, { waitUntil: 'networkidle' });
      for (const st of s.setup ?? []) {
        const timeout = st.timeout ?? (isShot ? 30000 : 15000);
        if (st.wait) await page.waitForTimeout(st.wait);
        else if (st.waitFor) await page.waitForSelector(st.waitFor, { timeout });
        else if (st.waitText) await page.getByText(st.waitText).waitFor({ timeout }); // estado final (un sleep fijo cae distinto en cada máquina)
        else if (st.waitUrl) await page.waitForURL(new RegExp(st.waitUrl), { timeout });
        else if (st.scroll) await page.locator(st.scroll).scrollIntoViewIfNeeded({ timeout });
        else if (st.type) await page.fill(st.type, st.text);
        else if (st.contextmenu) await page.dispatchEvent(st.contextmenu, 'contextmenu', { bubbles: true, cancelable: true, clientX: 300, clientY: 300 });
        else if (st.hover) await page.hover(st.hover);
        else if (st.optional) { try { await page.click(st.click, { timeout }); } catch { /* el estado alternativo no trae este botón */ } }
        else await page.click(st.click, { timeout });
        await page.waitForTimeout(st.after ?? (isShot ? 0 : 400));
      }
    } catch (e) { failed.push(`setup: ${String(e.message).split('\n')[0]}`); }
    if (!failed.length) for (const m of s.must ?? []) {
      let ok = false;
      try {
        if (m.hover) { await page.hover(m.hover, { timeout: 5000 }); await page.waitForTimeout(m.after ?? 900); }
        const t0 = Date.now();
        do {
          ok = await page.evaluate(({ sel, text, count }) => {
            const re = text ? new RegExp(text, 'i') : null;
            const hits = [...document.querySelectorAll(sel)].filter((e) => {
              const r = e.getBoundingClientRect();
              return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== 'hidden' && (!re || re.test(e.textContent ?? ''));
            });
            return hits.length >= (count ?? 1);
          }, m);
          if (!ok) await page.waitForTimeout(250);
        } while (!ok && Date.now() - t0 < (m.timeout ?? 3000));
      } catch { ok = false; }
      if (ok) { passed++; if (m.status === 'regressed') fixed.push(label(m)); }
      else if (m.status === 'regressed') regressed.push(label(m) + (m.note ? ` (${m.note})` : ''));
      else failed.push(label(m));
    }
    if (flag('snap')) { mkdirSync(outDir, { recursive: true }); await page.screenshot({ path: `${outDir}/${s.name}.snap.png` }); console.log(`snap ${outDir}/${s.name}.snap.png`); } // --snap: captura del estado final de cualquier escena
    if (isShot && !failed.length) {
      await page.addStyleTag({ content: '*,*::before,*::after{caret-color:transparent!important;animation:none!important;transition:none!important}' });
      await page.evaluate(() => document.fonts.ready);
      shotBuf = await page.screenshot(); // solo el viewport: estable y liviano
    }
  } catch (e) { failed.push(String(e.message).split('\n')[0]); } finally { await browser.close(); }
  const bad = failed.length > 0 || (flag('all') && regressed.length > 0);
  const out = { name: s.name, rc: bad ? 1 : 0, failed, regressed, fixed, passed, pageErrors, shotBuf };
  return out;
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

// ── ejecución: contratos de a `jobs` (un Chrome por escena); capturas de a una (el reloj y la carga cambian el render)
const t0 = Date.now();
const contracts = scenes.filter((s) => !s.shot), shots = scenes.filter((s) => s.shot);
let failures = 0;
const report = (r) => {
  if (r.pageErrors.length) console.warn(`${r.name}: errores de página: ${r.pageErrors.join(' | ')}`);
  if (r.rc) { failures++; console.log(`FALLA ${r.name}`); console.log(JSON.stringify({ contract: r.name, passed: r.passed, failed: r.failed, regressed: r.regressed })); }
  else if (r.fixed.length) console.log(JSON.stringify({ contract: r.name, passed: r.passed, failed: r.failed, regressed: r.regressed, fixed: r.fixed }));
  else console.log(`ok   ${r.name} (${r.passed}${r.regressed.length ? `, ${r.regressed.length} regressed` : ''})`);
};
const queue = [...contracts];
await Promise.all(Array.from({ length: Math.min(jobs, queue.length) }, async () => { for (let s; (s = queue.shift());) report(await runScene(s)); }));
if (contracts.length) console.log(failures ? 'contratos: FALLAN (ver arriba)' : `contratos ok (${contracts.length})`);

if (shots.length) {
  mkdirSync(baseDir, { recursive: true }); mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const checker = await browser.newPage();
  let shotFails = 0;
  for (const s of shots) {
    const r = await runScene(s), file = baselineOf(s);
    if (r.pageErrors.length) console.warn(`${file}: errores de página: ${r.pageErrors.join(' | ')}`);
    if (!r.shotBuf) { shotFails++; console.log(`FALLA ${file} ${r.failed.join(' | ')}`); continue; }
    if (r.failed.length) { shotFails++; console.log(`FALLA ${file} must: ${r.failed.join(' | ')}`); }
    if (record) { console.log(`grabado ${file}`); continue; }
    if (update) { writeFileSync(`${baseDir}/${file}`, r.shotBuf); console.log(`baseline ${file} (${(r.shotBuf.length / 1024).toFixed(0)} KB)`); continue; }
    if (!existsSync(`${baseDir}/${file}`)) { console.log(`FALTA ${file} (corré con --update)`); shotFails++; continue; }
    const d = await diff(checker, readFileSync(`${baseDir}/${file}`).toString('base64'), r.shotBuf.toString('base64'));
    const bad = d.pct > threshold;
    if (bad) {
      shotFails++;
      writeFileSync(`${outDir}/${file.replace('.png', '.actual.png')}`, r.shotBuf);
      if (d.png) writeFileSync(`${outDir}/${file.replace('.png', '.diff.png')}`, Buffer.from(d.png, 'base64'));
    }
    console.log(`${bad ? 'FALLA' : 'ok   '} ${file} ${d.size ?? `${d.pct.toFixed(3)} %`}`);
  }
  await browser.close();
  failures += shotFails;
  if (shotFails) console.log(`${shotFails} capturas fallaron: diffs en ${outDir}`);
}
console.log(`${((Date.now() - t0) / 1000).toFixed(1)} s`);
process.exit(failures ? 1 : 0);
