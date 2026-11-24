// Benchmark repetible del render de la lista de opciones de torrents (desktop `ui/src/catalog-options.ts` vs web `web/src/lib/Torrents.svelte`).
// Uso: node scripts/bench-options.mjs [--target desktop,web] [--n 25,100,300] [--rate 10] [--secs 5] [--rows 3] [--runs 1] [--dev] [--profile] [--out FILE]
// Levanta `vite preview` (build de producción; `--dev`: `vite dev`) de ui y de web en puertos libres, carga la lista con N opciones sintéticas (misma base en ambos)
// y empuja `rate` actualizaciones por segundo durante `secs`, cada una cambiando `rows` filas al azar. Una línea JSON por escenario.
//  - desktop: eventos del core vía `window.__mockEmit` (`ui/src/mock-tauri.ts`): `catalog-swarm-counted` (prueba rápida) por tick y, cada 5º,
//    un `catalog-streams` completo. Se tocan los 25 de arriba hasta "Mostrar más" para que se dibujen las N, como la web.
//  - web: `fetch('/api/torrents')` interceptado con un NDJSON controlado; cada update es una línea `{result}` con la lista entera (lo único
//    que la web recibe en vivo; sus lecturas por fila llegan 1 cada ~8 s). `localStorage.setItem` queda en no-op (el guardado de 1 h no es render).
// Medición: CDP `Performance.getMetrics` (Script/Layout/RecalcStyle/Task) alrededor de cada update + dos rAF; longtasks (>50 ms) y nodos DOM.
import { createRequire } from 'node:module';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const { chromium } = createRequire(new URL('../web/package.json', import.meta.url))('playwright-core');
const argv = process.argv.slice(2);
const opt = (k, d) => (argv.includes(`--${k}`) ? argv[argv.indexOf(`--${k}`) + 1] : d);
const targets = opt('target', 'desktop,web').split(',');
const sizes = opt('n', '25,100,300').split(',').map(Number);
const rate = Number(opt('rate', 10));
const secs = Number(opt('secs', 5));
const rowsPerUpdate = Number(opt('rows', 3));
const runs = Number(opt('runs', 1)); // repeticiones por escenario: se reporta la mediana y el rango (min-max) de cada métrica
const profile = argv.includes('--profile'); // suma `top_self_ms`: las 8 funciones con más tiempo propio (perfil de CPU de CDP) durante los updates
const dev = argv.includes('--dev');
const outFile = opt('out', '');
const VIDEO = 'tt0137523';

// ---------- datos sintéticos (PRNG con semilla: mismos datos en cada corrida) ----------
function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const hex = (r, n) => Array.from({ length: n }, () => Math.floor(r() * 16).toString(16)).join('');
// Candidatos reales grabados (`ui/mock/events__catalog_streams__movie_tt0137523.json`): se clonan en ciclo con hash nuevo, sufijo en el
// nombre y seeders/leechers variados. Todos pasan a 1080p: así el desktop (que muestra un grupo de resolución a la vez) dibuja las N.
const recorded = JSON.parse(readFileSync(new URL('../ui/mock/events__catalog_streams__movie_tt0137523.json', import.meta.url), 'utf8')).findLast((e) => e.type === 'catalog-streams').update; // el último: la lista completa (el mock es progresivo)
function base(n) {
  const r = rng(42);
  return Array.from({ length: n }, (_, i) => {
    const c = recorded.candidates[i % recorded.candidates.length];
    const seeders = Math.floor(r() ** 3 * 800);
    return { ...c, info_hash: hex(r, 40), release_name: `${c.release_name}.${i}`, resolution: '1080p', seeders, seeders_declared: seeders, leechers: Math.floor(r() * 120) };
  });
}
const desktopCand = (c) => c;
const webTorrent = (c) => ({ hash: c.info_hash, release: c.release_name, file: c.file_name, res: c.resolution, hdr: c.hdr, source: c.source,
  hint: c.audio.includes('lat') ? 'lat' : c.audio.includes('cast') ? 'spain' : null, multi: c.audio.includes('multi'), spa: ['lat', 'cast', 'es'].some((a) => c.audio.includes(a)),
  size: c.size_bytes, seeds: c.seeders ?? 0, addons: c.addons, subFile: c.subs.includes('es') });
const desktopUpdate = (list, video) => ({ type: 'catalog-streams', update: { video_id: video, addons: [{ id: 'torrentio', name: 'Torrentio', state: 'ok', count: list.length, ms: 100, message: null }], candidates: list, done: true } });

// ---------- servidores ----------
const freePort = () => new Promise((res) => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });
const NODE_BIN = `${process.env.HOME}/.nvm/versions/node/v24.21.0/bin`;
const env = { ...process.env, PATH: `${NODE_BIN}:/opt/homebrew/bin:${process.env.PATH}` };
async function serve(cmd, args, cwd, port) {
  const p = spawn(cmd, args, { cwd, env, stdio: 'ignore', detached: true });
  const url = `http://127.0.0.1:${port}/`;
  for (let i = 0; i < 120; i++) {
    try { if ((await fetch(url)).status < 500) return { url, stop: () => { try { process.kill(-p.pid); } catch { /* ya cerró */ } } }; } catch { /* aún no */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  try { process.kill(-p.pid); } catch { /* ya cerró */ }
  throw new Error(`no levantó: ${cmd} ${args.join(' ')}`);
}

// ---------- medición ----------
const pctl = (xs, q) => { if (!xs.length) return 0; const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(q * s.length))]; };
const round = (x) => Math.round(x * 100) / 100;
const INIT = `window.__long = []; try { new PerformanceObserver((l) => l.getEntries().forEach((e) => window.__long.push(e.duration))).observe({ type: 'longtask', buffered: true }); } catch {}
window.__raf2 = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(performance.now()))));`;

async function metrics(cdp) {
  const { metrics: m } = await cdp.send('Performance.getMetrics');
  const g = (k) => (m.find((x) => x.name === k)?.value ?? 0) * 1000;
  return { task: g('TaskDuration'), script: g('ScriptDuration'), layout: g('LayoutDuration'), style: g('RecalcStyleDuration') };
}
const delta = (a, b) => ({ task: b.task - a.task, work: b.script + b.layout + b.style - (a.script + a.layout + a.style), script: b.script - a.script, layout: b.layout - a.layout, style: b.style - a.style });

/** Empuja `rate`/s updates durante `secs` y mide cada uno. `emit(i)` corre en la página y devuelve cuando ya entregó el update. */
async function drive(page, cdp, emit) {
  await page.evaluate(() => { window.__long.length = 0; });
  if (profile) { await cdp.send('Profiler.enable'); await cdp.send('Profiler.start'); }
  const per = [];
  const t0 = await metrics(cdp);
  const start = Date.now();
  for (let i = 0; i < rate * secs; i++) {
    const a = await metrics(cdp);
    await page.evaluate(emit, i);
    await page.evaluate(() => window.__raf2());
    per.push(delta(a, await metrics(cdp)).work);
    const wait = start + ((i + 1) * 1000) / rate - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  }
  const total = delta(t0, await metrics(cdp));
  const long = await page.evaluate(() => window.__long.slice());
  let top_self_ms;
  if (profile) {
    const { profile: prof } = await cdp.send('Profiler.stop');
    const self = new Map();
    const byId = new Map(prof.nodes.map((n) => [n.id, n]));
    prof.samples.forEach((id, i) => { const f = byId.get(id).callFrame; const k = `${f.functionName || '(anon)'} ${f.url.split('/').slice(-2).join('/')}:${f.lineNumber + 1}`; self.set(k, (self.get(k) ?? 0) + (prof.timeDeltas[i] ?? 0) / 1000); });
    top_self_ms = [...self].filter(([k]) => !k.startsWith('(idle)')).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => `${k} ${round(v)}`);
  }
  return { updates: per.length, update_work_ms_p50: round(pctl(per, 0.5)), update_work_ms_p95: round(pctl(per, 0.95)), update_work_ms_max: round(Math.max(...per)),
    long_tasks: long.length, long_task_ms: round(long.reduce((s, x) => s + x, 0)), main_busy_ms: round(total.task), script_ms: round(total.script), layout_ms: round(total.layout), style_ms: round(total.style), ...(top_self_ms ? { top_self_ms } : {}) };
}
// El click va por dentro de la página para que el reloj no incluya la espera de "estable" de Playwright (animaciones de entrada).
const timedClick = (page, sel) => page.evaluate((q) => { window.__t = performance.now(); document.querySelector(q).click(); }, sel);
const domNodes = (page) => page.evaluate(() => document.querySelectorAll('*').length);

// ---------- escenarios ----------
async function desktop(browser, url, n) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  await page.addInitScript(INIT);
  await page.goto(url, { waitUntil: 'networkidle' });
  // La peli con fixtures (`ui/mock/`): se busca "fight club" y se abre; el mock reproduce sus 25 opciones y después se pisan con las N.
  await page.fill('#cat-q', 'fight club');
  const video = 'tt0137523';
  await page.click(`.card[data-id="${video}"]`);
  await page.waitForSelector('#cat-side');
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Performance.enable');
  const list = base(n);
  await page.waitForSelector('#cat-flow-lat-no');
  await page.evaluate((u) => window.__mockEmit(u), desktopUpdate(list, video));
  await page.click('#cat-flow-lat-no');
  await page.waitForSelector('#cat-flow-res-1080p');
  const m0 = await metrics(cdp);
  await timedClick(page, '#cat-flow-res-1080p');
  await page.waitForSelector('.cat-options li');
  const first = await page.evaluate(() => window.__raf2().then((t) => t - window.__t));
  // "Mostrar más" hasta que estén las N filas.
  while (await page.$('#cat-more-rows')) await page.click('#cat-more-rows');
  const full = await page.evaluate(() => window.__raf2().then((t) => t - window.__t));
  const build_work_ms = round(delta(m0, await metrics(cdp)).work); // CPU de la construcción (script+layout+estilo), sin las esperas del reloj
  const rows = await page.evaluate(() => document.querySelectorAll('.cat-options li').length);
  // `catalog-streams` de cada 5º update: la misma lista con seeders cambiados.
  await page.evaluate((u) => {
    window.__benchStreams = (i) => ({ ...u, update: { ...u.update, candidates: u.update.candidates.map((c, k) => (k % 10 === i % 10 ? { ...c, seeders: (i * 13 + k) % 300 } : c)) } });
  }, desktopUpdate(list, video));
  const res = await runLive(page, cdp, list, 'desktop');
  const nodes = await domNodes(page);
  await ctx.close();
  return { first_render_ms: round(first), full_render_ms: round(full), build_work_ms, rows, dom_nodes: nodes, ...res };
}

/** `drive` con el emisor armado según el target (se serializa a la página). */
function runLive(page, cdp, list, target) {
  const payload = { rowsN: rowsPerUpdate, hashes: list.map((b) => b.info_hash), target };
  return page.evaluate((p) => { window.__bench = p; }, payload).then(() => drive(page, cdp, (i) => {
    const { rowsN, hashes } = window.__bench;
    const at = (k) => (i * 7919 + k * 104729) % hashes.length;
    if (window.__bench.target === 'desktop') {
      for (let k = 0; k < rowsN; k++) {
        const seeds = (i * 31 + k * 17) % 200;
        window.__mockEmit({ type: 'catalog-swarm-counted', hash: hashes[at(k)], deep: false, count: { seeds, peers: seeds + 20, reached: true, known: seeds + 30, incoming: 0 } });
      }
      if (i % 5 === 4) window.__mockEmit(window.__benchStreams(i));
    } else window.__benchPush(i);
  }));
}

async function web(browser, url, n) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce' });
  await ctx.addCookies([{ name: 'nick', value: 'Bench', url }]); // sin apodo la app abre su bienvenida
  const page = await ctx.newPage();
  await page.addInitScript(INIT + `
    for (const k of ['welcome', 'cast-never', 'cast']) localStorage.setItem('tour:' + k, '1');
    Storage.prototype.setItem = () => {};
    const realFetch = window.fetch.bind(window); let ctrl;
    window.__benchPush = (i) => { const l = JSON.parse(JSON.stringify(window.__benchList)); for (let k = 0; k < window.__bench.rowsN; k++) l[(i * 7919 + k * 104729) % l.length].seeds = (i * 31 + k * 17) % 200;
      window.__benchList = l; ctrl.enqueue(new TextEncoder().encode(JSON.stringify({ result: { list: l, found: l.length, sources: 1 } }) + '\\n')); };
    window.fetch = (input, init) => {
      const u = typeof input === 'string' ? input : input.url;
      if (u.includes('/api/torrents')) return Promise.resolve(new Response(new ReadableStream({ start(c) { ctrl = c; window.__benchOpen = true; } }), { headers: { 'content-type': 'application/x-ndjson' } }));
      return realFetch(input, init);
    };`);
  const title = { id: 550, imdb: VIDEO, title: 'Fight Club', origLang: 'en', runtime: 139, kind: 'movie', year: '1999', seasons: [], genres: [], providers: [], people: [], companies: [], poster: null, backdrop: null, overview: '', lang: 'Inglés' };
  await page.route('**/api/title/**', (r) => r.fulfill({ json: title }));
  await page.route(/\/api\/(tracks|scores|season|premium|keys|track)/, (r) => r.abort());
  await page.goto(url, { waitUntil: 'networkidle' });
  // La carga del título corre en el servidor al entrar directo: se entra por navegación del cliente (donde el fetch ya está interceptado).
  await page.evaluate((id) => { const a = document.createElement('a'); a.id = 'bench-go'; a.href = `/t/movie/${id}`; document.body.append(a); a.click(); }, VIDEO);
  await page.waitForFunction(() => window.__benchOpen === true, null, { timeout: 30000 });
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Performance.enable');
  const list = base(n);
  await page.evaluate((l) => { window.__benchList = l; window.__bench = { rowsN: 0 }; }, list.map(webTorrent));
  await page.evaluate(() => { window.__benchPush(0); });
  await page.click('#net-high');
  await page.click('#audio-any');
  await page.waitForSelector('#search-stop, #see-all, #see-all-rest');
  await page.click('#search-stop', { timeout: 1500 }).catch(() => {}); // la búsqueda de pistas (abortada) puede haber terminado sola
  await page.waitForSelector('#see-all, #see-all-rest');
  const m0 = await metrics(cdp);
  await timedClick(page, '#see-all, #see-all-rest');
  await page.waitForSelector('li.cat-opt');
  const first = await page.evaluate(() => window.__raf2().then((t) => t - window.__t));
  await page.waitForFunction((k) => document.querySelectorAll('li.cat-opt').length >= k, n);
  const full = await page.evaluate(() => window.__raf2().then((t) => t - window.__t));
  const build_work_ms = round(delta(m0, await metrics(cdp)).work);
  const rows = await page.evaluate(() => document.querySelectorAll('li.cat-opt').length);
  const res = await runLive(page, cdp, list, 'web');
  const nodes = await domNodes(page);
  await ctx.close();
  return { first_render_ms: round(first), full_render_ms: round(full), build_work_ms, rows, dom_nodes: nodes, ...res };
}

// ---------- main ----------
const servers = [];
const results = [];
try {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  for (const target of targets) {
    const port = await freePort();
    const dir = `${root}${target === 'desktop' ? 'ui' : 'web'}`;
    // Por defecto build de producción + `vite preview` (el dev de Svelte suma get_stack/get_error a cada lectura de estado); `--dev` usa `vite dev`.
    if (!dev) spawnSync('corepack', ['pnpm', 'run', 'build'], { cwd: dir, env, stdio: 'ignore' });
    const srv = await serve('node', ['node_modules/vite/bin/vite.js', dev ? 'dev' : 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], dir, port);
    servers.push(srv);
    for (const n of sizes) {
      const all = [];
      for (let k = 0; k < runs; k++) all.push(await (target === 'desktop' ? desktop : web)(browser, srv.url, n));
      const keys = Object.keys(all[0]).filter((m) => typeof all[0][m] === 'number');
      const r = { ...Object.fromEntries(keys.map((m) => [m, round(pctl(all.map((x) => x[m]), 0.5))])), ...(all[0].top_self_ms ? { top_self_ms: all[0].top_self_ms } : {}) };
      const range = Object.fromEntries(keys.map((m) => [m, [Math.min(...all.map((x) => x[m])), Math.max(...all.map((x) => x[m]))]]));
      const line = { target, n, rate, secs, rows_per_update: rowsPerUpdate, runs, ...r, ...(runs > 1 ? { range } : {}) };
      results.push(line);
      console.log(JSON.stringify(line));
    }
  }
  await browser.close();
} finally {
  servers.forEach((s) => s.stop());
}
const cols = ['first_render_ms', 'full_render_ms', 'build_work_ms', 'rows', 'dom_nodes', 'update_work_ms_p50', 'update_work_ms_p95', 'long_tasks', 'main_busy_ms'];
console.log(`\n| target | N | ${cols.join(' | ')} |\n|${'---|'.repeat(cols.length + 2)}\n${results.map((r) => `| ${r.target} | ${r.n} | ${cols.map((c) => r[c]).join(' | ')} |`).join('\n')}`);
if (outFile) writeFileSync(outFile, JSON.stringify({ date: new Date().toISOString().slice(0, 10), mode: dev ? 'vite dev' : 'build + vite preview', results }, null, 1) + '\n');
