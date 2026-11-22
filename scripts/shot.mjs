// Capturas + posiciones de elementos con id en 1 comando.
// Uso: node scripts/shot.mjs <url> [--out DIR] [--sel CSS] [--only mobile|desktop] [--theme light|dark] [--click CSS]...
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';

const { chromium } = createRequire(new URL('../web/package.json', import.meta.url))('playwright-core');

const argv = process.argv.slice(2);
const url = argv.find((a, i) => !a.startsWith('--') && !argv[i - 1]?.startsWith('--'));
const opt = (k) => argv.flatMap((a, i) => (a === `--${k}` ? [argv[i + 1]] : []));
if (!url) { console.error('uso: node scripts/shot.mjs <url> [--out DIR] [--sel CSS] [--only mobile|desktop] [--theme light|dark] [--click CSS]...'); process.exit(2); }
const slug = url.replace(/^https?:\/\//, '').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '');
const out = opt('out')[0] ?? `/tmp/shots/${slug}`;
const sel = opt('sel')[0] ?? 'main, body';
const clicks = opt('click');
mkdirSync(out, { recursive: true });

const viewports = {
  mobile: { viewport: { width: 375, height: 812 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  desktop: { viewport: { width: 1280, height: 800 } },
};
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
  // las animaciones infinitas tiran al terminar: se ignoran
  await page.evaluate(() => document.getAnimations().forEach((a) => { try { a.finish(); } catch {} }));
  const file = `${out}/${vp}-${theme}.png`;
  await page.screenshot({ path: file, fullPage: true });
  const els = await page.evaluate((s) => [...document.querySelectorAll(s)].flatMap((root) => [...root.querySelectorAll('[id]')])
    .map((e) => ({ e, r: e.getBoundingClientRect() }))
    .filter(({ e, r }) => r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== 'hidden')
    .map(({ e, r }) => ({ id: e.id, x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), text: (e.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 40) })), sel);
  console.log(JSON.stringify({ file, viewport: vp, theme, status, consoleErrors, els }));
  await ctx.close();
}
await browser.close();
process.exit(fail ? 1 : 0);
