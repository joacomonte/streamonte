// Capturas + posiciones de elementos con id en 1 comando.
// Uso: node scripts/shot.mjs <url> [--out DIR] [--sel CSS] [--only mobile|desktop] [--theme light|dark] [--click CSS]...
// Contrato de pantalla: node scripts/shot.mjs --contract tests/contracts/X.json --base http://host:puerto [--all]
//   Contrato = {app, url, viewport?, cookies?, storage?, setup:[{click|type+text|hover|contextmenu|wait, after?, timeout?, optional? (click: se saltea si no aparece)}],
//   must:[{sel, text?(regex), count?(>=), hover?(selector a pasar el mouse antes), status?:'regressed', note?}]}.
//   Imprime {contract, passed, failed, regressed, fixed?}; exit 1 si falla algo que no es `regressed` (--all: también esos).
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync } from 'node:fs';

const { chromium } = createRequire(new URL('../web/package.json', import.meta.url))('playwright-core');

const argv = process.argv.slice(2);
const url = argv.find((a, i) => !a.startsWith('--') && !argv[i - 1]?.startsWith('--'));
const opt = (k) => argv.flatMap((a, i) => (a === `--${k}` ? [argv[i + 1]] : []));
const contractFile = opt('contract')[0];
if (!url && !contractFile) { console.error('uso: node scripts/shot.mjs <url> [--out DIR] [--sel CSS] [--only mobile|desktop] [--theme light|dark] [--click CSS]...'); process.exit(2); }
const slug = (url ?? '').replace(/^https?:\/\//, '').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '');
const out = opt('out')[0] ?? `/tmp/shots/${slug}`;
const sel = opt('sel')[0] ?? 'main, body';
const clicks = opt('click');
if (!contractFile) mkdirSync(out, { recursive: true });

const viewports = {
  mobile: { viewport: { width: 375, height: 812 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  desktop: { viewport: { width: 1280, height: 800 } },
};
if (contractFile) process.exit(await runContract(contractFile, opt('base')[0], argv.includes('--all')));
const only = opt('only')[0];
const themeOpt = opt('theme')[0];
const names = Object.keys(viewports).filter((v) => !only || v === only);
const themes = themeOpt ? [themeOpt] : ['light', 'dark'];

const browser = await chromium.launch({ channel: 'chrome', headless: true });
let fail = false;
for (const vp of names) for (const theme of themes) {
  const ctx = await browser.newContext({ ...viewports[vp], colorScheme: theme, reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  const consoleErrors = [];
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', (e) => { consoleErrors.push(`pageerror: ${e.message}`); fail = true; });
  page.on('response', (r) => { if (r.status() >= 400) consoleErrors.push(`${r.status()} ${r.url()}`); });
  const res = await page.goto(url, { waitUntil: 'networkidle' });
  const status = res?.status() ?? 0;
  if (status >= 400) fail = true;
  for (const c of clicks) { await page.click(c); await page.waitForLoadState('networkidle'); }
  // imágenes visibles: esperar carga o error (tope 8 s); las fallidas se cuentan
  const imgFailed = await page.evaluate(() => {
    const visible = [...document.images].filter((i) => { const r = i.getBoundingClientRect(); return r.width > 0 && r.height > 0; });
    const settled = (i) => i.complete;
    return Promise.race([
      Promise.all(visible.map((i) => settled(i) ? 0 : new Promise((ok) => { i.addEventListener('load', ok, { once: true }); i.addEventListener('error', ok, { once: true }); }))),
      new Promise((ok) => setTimeout(ok, 8000)),
    ]).then(() => visible.filter((i) => !(i.complete && i.naturalWidth)).length);
  });
  // las animaciones infinitas tiran al terminar: se ignoran
  await page.evaluate(() => document.getAnimations().forEach((a) => { try { a.finish(); } catch {} }));
  const file = `${out}/${vp}-${theme}.png`;
  await page.screenshot({ path: file, fullPage: true });
  const els = await page.evaluate((s) => [...document.querySelectorAll(s)].flatMap((root) => [...root.querySelectorAll('[id]')])
    .map((e) => ({ e, r: e.getBoundingClientRect() }))
    .filter(({ e, r }) => r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== 'hidden')
    .map(({ e, r }) => ({ id: e.id, x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), text: (e.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 40) })), sel);
  console.log(JSON.stringify({ file, viewport: vp, theme, status, imgFailed, consoleErrors, els }));
  await ctx.close();
}
await browser.close();
process.exit(fail ? 1 : 0);

/** Corre un contrato: pasos de `setup` y chequeo de cada `must`. Imprime 1 línea JSON; devuelve el exit code. */
async function runContract(file, base, all) {
  if (!base) { console.error('falta --base URL'); return 2; }
  const c = JSON.parse(readFileSync(file, 'utf8'));
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const ctx = await browser.newContext({ ...viewports[c.viewport ?? 'desktop'], reducedMotion: 'reduce' });
  const origin = new URL(base).origin;
  if (c.cookies) await ctx.addCookies(Object.entries(c.cookies).map(([name, value]) => ({ name, value, url: origin })));
  if (c.storage) await ctx.addInitScript((kv) => { for (const k in kv) localStorage.setItem(k, kv[k]); }, c.storage);
  const page = await ctx.newPage();
  const failed = [], regressed = [], fixed = [];
  let passed = 0;
  const label = (m) => [m.hover && m.hover !== m.sel && `hover ${m.hover}`, m.hover && m.hover === m.sel && 'hover', m.sel, m.text && `/${m.text}/`, m.count && `x>=${m.count}`].filter(Boolean).join(' ');
  try {
    await page.goto(base + c.url, { waitUntil: 'networkidle' });
    for (const st of c.setup ?? []) {
      if (st.wait) await page.waitForTimeout(st.wait);
      else if (st.type) await page.fill(st.type, st.text);
      else if (st.contextmenu) await page.dispatchEvent(st.contextmenu, 'contextmenu', { bubbles: true, cancelable: true, clientX: 300, clientY: 300 });
      else if (st.hover) await page.hover(st.hover);
      else if (st.optional) { try { await page.click(st.click, { timeout: st.timeout ?? 15000 }); } catch { /* el estado alternativo no trae este botón */ } }
      else await page.click(st.click, { timeout: st.timeout ?? 15000 });
      await page.waitForTimeout(st.after ?? 400);
    }
  } catch (e) { failed.push(`setup: ${String(e.message).split('\n')[0]}`); }
  if (!failed.length) for (const m of c.must) {
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
  console.log(JSON.stringify({ contract: file.replace(/^.*\//, '').replace(/\.json$/, ''), passed, failed, regressed, ...(fixed.length ? { fixed } : {}) }));
  await browser.close();
  return failed.length || (all && regressed.length) ? 1 : 0;
}
