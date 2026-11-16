# Idea 8 — Salud como rango con confianza ("4–60 Mbps · trackers · sin calibrar")

Spec listo para implementar sin decidir nada. Solo UI (JS + CSS); el núcleo Rust no cambia.
Contexto compartido: /Users/monti/Documents/Dev/streamonte/docs/plans/salud-fiel/00-contexto.md.
Base: árbol con el cambio SIN COMMIT del 2026-11-16 (`seedsCounted`, `basis`, `trackerSeedMbps`). Las líneas citadas son de ese árbol.

## 1. Problema
- La salud es un punto: `supply = (seeds + leech/6) × Mbps por seeder` → nivel seco (`ratio ≥ 2` buena, `≥ 1` justa, si no mala). No dice cuánto puede variar ni de dónde sale.
- Solo se muestra con conteo profundo: `healthBadge` corta con `if (!counted.get(c.info_hash)?.reached) return null` (/Users/monti/Documents/Dev/streamonte/ui/src/catalog.js:727). Sin analizar se ve el botón "Verificar salud".
- Con conteo, `basis = 'counted'` pisa a los trackers aunque los trackers den más (el conteo subestima: ADR-30, 30 conexiones, sin entrantes).
- Sin mediciones propias se usa `DEFAULT_SEED_MBPS = 3` (conservador) → caso real "Puede cortarse" para algo que anduvo a ~55 Mbps.

## 2. Estado actual (verificado)
| Pieza | Dónde | Qué hace hoy |
|---|---|---|
| `lightOf` | /Users/monti/Documents/Dev/streamonte/ui/src/catalog.js:454 | Texto de velocidad medida de la biblioteca (`55,0 Mbps · 2,1×`) en la celda del peso. No cambia. |
| `sortOptions` | /Users/monti/Documents/Dev/streamonte/ui/src/catalog.js:485 | Tier 2 (contadas) por `level`, entre buenas por peso, si no por `ratio`; tier 1 por `bySeeds` (decisión D7 de mem.db). |
| `health` | /Users/monti/Documents/Dev/streamonte/ui/src/catalog.js:702 | Punto `supply`, `level`, `basis` ('counted'/'tracker'), `perSeed`; lo medido manda (B6). |
| `healthBadge` | /Users/monti/Documents/Dev/streamonte/ui/src/catalog.js:726 | Botón ícono `#cat-health-<hash>` con tooltip; solo si contado. |
| `signalSvg` | /Users/monti/Documents/Dev/streamonte/ui/src/catalog.js:744 | 3 barras, `on` las del nivel. |
| `heavyBadge` | /Users/monti/Documents/Dev/streamonte/ui/src/catalog.js:687 | "Pesado" si pide ≥ 35 Mbps. No cambia. |
| `bgText` | /Users/monti/Documents/Dev/streamonte/ui/src/catalog.js:763 | `2,3× · alcanza` de la carga en background. No cambia. |
| `optionRow` | /Users/monti/Documents/Dev/streamonte/ui/src/catalog.js:821 | Usa `healthBadge(c)` en :861 (mini, reproduciendo) y :868 (`healthBadge(c) ?? verifyButton(c)`). |
| `healthCalibration` | /Users/monti/Documents/Dev/streamonte/ui/src/health-calib.js:64 | `seedMbps` = mediana de `sustained/seeds`; `trackerSeedMbps` = mediana de `sustained/(ts + tl/6)`; default 3 con < 3 muestras; `capMbps`. |
| Popover | /Users/monti/Documents/Dev/streamonte/ui/src/speed.js:80 | Tarjeta "por seeder" con `seedMbps` y `trackerSeedMbps`. |
| Estilos | /Users/monti/Documents/Dev/streamonte/ui/catalog.css:273 | `.cat-health-ic`, colores por nivel, `button.cat-health-ic`, `.cat-mini-stats`. |

Decisiones vigentes de /Users/monti/Documents/Dev/streamonte/mem.db que se respetan: B6 (lo medido manda; mediana por red; buena ≥ 2×), B24 (piso sostenido p25 por reproducción), D7 (orden por tiers), B16 (bitrate pedido). Se cambia a conciencia una cosa de B6: con conteo y trackers se usa la evidencia que da más (ver §3.3).

## 3. Modelo del rango
### 3.1 Factor por seeder (por red, en `healthCalibration`)
Por cada muestra: `f = sustainedMbps(l) / l.seeds` (contadas) o `f = sustainedMbps(l) / (tracker_seeds + tracker_leechers/6)` (trackers). Igual que hoy.

`quantile(xs, p) = sorted(xs)[floor((len − 1) · p)]` — misma regla que `median` (p = 0,5) y `sustained` (p = 0,25); así `p50` es exactamente el `seedMbps`/`trackerSeedMbps` actual (B6 intacto).

Banda por seeder `{lo, p50, p75, hi, conf}`:
- **Con n ≥ MIN_SAMPLES (3)** muestras: `q = [q25, q50, q75]`, `w = 1 / (2·√n)`;
  `lo = q25·(1 − w)`, `p50 = q50`, `p75 = q75`, `hi = q75·(1 + w)`, `conf = 'media'`. (n = 3 → ±29 %; n = 30 → ±9 %: con pocas muestras los cuartiles subestiman la dispersión.)
- **Sin muestras suficientes** (prior): `d = DEFAULT_SEED_MBPS · bias`; `lo = 0,5·d`, `p50 = d`, `p75 = 4·d`, `hi = 8·d`, `conf = 'baja'`. Con `bias = 1`: 1,5 / 3 / 12 / 24 (el 24 ≈ la única medición real de seedboxes, ~26). `bias` = sesgo aprendido de la idea 4 (default 1); solo se aplica al prior para no contarlo dos veces sobre factores ya calibrados con reproducciones reales.
- **Trackers sin muestras propias pero contadas sí**: la banda de contadas con `conf = 'baja'` (hoy `trackerSeedMbps` ya cae a `seedMbps`).
- **Manual** (`cfg.seedMbps`): `lo = p50 = p75 = hi = v`, `conf = 'media'`.

### 3.2 Rango del torrent
`eff = seeds + leechers · LEECH_SHARE` (1/6). Con `cap = capMbps` (null = sin tope):
`lo = min(eff·band.lo, cap)`, `p50 = min(eff·band.p50, cap)`, `p75 = min(eff·band.p75, cap)`, `hi = min(eff·band.hi, cap)`.

Medido (reproducción ≥ MIN_SECS o `live.avg_speed_bps`, B6): `lo = p50 = p75 = hi = m`, `conf = 'alta'`, `basis = 'measured'`, sin tope.

### 3.3 "Nunca peor que la evidencia"
Candidatos: `counted` (`seedsCounted`, `leechersOf`, banda de contadas) y `tracker` (`seedsOf`, `c.leechers`, banda de trackers). Gana el de **p50 más alto** (rango entero, para que "de dónde sale" sea uno solo). Razón: todas las fuentes subestiman (tabla del contexto). Excepción: si el conteo dio **0 seeders** (alcanzó peers), los trackers no entran (0 contados es evidencia fuerte; los trackers pueden estar viejos). Lo medido pisa todo.
Efecto secundario bueno: mientras cuenta (conteo parcial bajo) la salud no se desploma.

### 3.4 Rango → nivel
- `level` = nivel del p50: `p50/need ≥ 2` → 0, `≥ 1` → 1, si no 2 (igual que hoy).
- `probable` = no medido, `level > 0` y el p75 alcanza el umbral del nivel de arriba (`p75/need ≥ 2` para subir a 0; `≥ 1` para subir a 1). Sube **un** nivel como máximo.
- `shown = probable ? level − 1 : level` → ícono, texto y orden.
- `level` (sin subir) sigue alimentando "Mejor opción" (:850) y `anyGood` (:583): lo probable no se recomienda como mejor.
- Textos: 0 "Buena salud" / "Buena probable"; 1 "Puede cortarse" / "Puede alcanzar"; 2 "Mala salud".

### 3.5 Orden con incertidumbre
Tier 2 (contadas): `[-tier, shown, probable ? 1 : 0, …resto igual]` → buenas seguras, buenas probables, justas seguras, justas probables, malas. Entre buenas seguras, por peso como hoy; buenas probables por `ratio` (p50/need). Tier 1 (sin contar) sigue por `bySeeds` (D7): con la misma banda de trackers para todas, el orden por p50 sería casi igual.

### 3.6 Ejemplo real (trackers 2 seeds · 3 leechers, 4K 1,4 GB, real ~55 Mbps, sin mediciones de trackers)
`eff = 2 + 3/6 = 2,5`; banda prior 1,5/3/12/24 → rango **3,75 / 7,5 / 30 / 60** Mbps (sin tope o tope ≥ 60). 55 cae adentro.
- Si dura 45 min: pide 1,4e9·8/2700 ≈ 4,1 Mbps. p50/need = 1,8 → nivel 1; p75/need = 7,2 ≥ 2 → **"Buena probable · 3,8–60 Mbps · trackers · sin calibrar"**. Hoy: "Puede cortarse".
- Sin duración (pide típico 25): p50/need = 0,3 → nivel 2; p75/need = 1,2 ≥ 1 → **"Puede alcanzar"**. Hoy: "Mala salud".

## 4. Diseño visual
Fila (columna de stats, a la izquierda de los seeds), botón `#cat-health-<hash>` (mismo id de hoy):
```
[▂▄▆]  3,8–60 Mbps
       trackers · sin calibrar
```
- Línea 1 (12,5 px, 600, `--text`, tabular): `lo–hi Mbps`; si `hi/lo < 1,25` → `~p50 Mbps`. Números: ≥ 10 enteros, < 10 un decimal (`nf`).
- Línea 2 (11 px, `--muted`): fuente `trackers` / `seeders contados` + ` · sin calibrar` si `conf = 'baja'`.
- Ícono: barras `3 − shown`, color del nivel mostrado; si `probable`, la barra más alta encendida va al 40 % (`rect.on.maybe`): "llena pero no segura".
- Medido o reproduciendo (`.cat-mini-stats`): solo ícono, como hoy (la velocidad ya está en `lightOf`/`bgText`/estado).
- Tooltip (`title`, multilínea):
  `Buena probable: entre 3,8 y 60 Mbps, lo más probable ~7,5; pide ~4 (1,8×).`
  `2 seeders de trackers y 3 leechers × 1,5–24 Mbps por seeder (sin mediciones propias en esta red: rango amplio).`
  `Confianza: baja. Cargar en background (⤓) la mide de verdad.`
  `Tocá para verificarla de nuevo (cuenta los seeders reales).`
- `aria-label`: `Buena probable, 3,8–60 Mbps, trackers · sin calibrar, confianza baja: verificar de nuevo`. SVG `aria-hidden`.
- Click = `reanalyze([hash])` (igual que hoy). Con salud mostrable, `verifyButton` deja de aparecer (:868 no cambia: `healthBadge(c) ?? …`); queda solo si no se conoce ningún seeder.
- Popover "Tu conexión": una línea más con la banda por seeder y su confianza.

## 5. Pasos
### Paso 1 — Bandas en la calibración
Archivo /Users/monti/Documents/Dev/streamonte/ui/src/health-calib.js.
1a. Debajo de `median` (:57) agregar:
```js
/** Cuantil p con la misma regla que `median` (p = 0,5 da lo mismo) y `sustained` (p = 0,25). */
const quantile = (xs, p) => [...xs].sort((a, b) => a - b)[Math.floor((xs.length - 1) * p)];

/** Banda del aporte por seeder (2026-11-xx, idea 8): `{lo, p50, p75, hi, conf}` en Mbps. `q` =
 *  [p25, p50, p75] de las mediciones (null sin MIN_SAMPLES): con pocas, se ensancha ±1/(2√n). Sin
 *  mediciones, alrededor del default (×0,5 a ×8; el ×8 ≈ la medición real de seedboxes) movido por
 *  `bias` (sesgo aprendido, idea 4; 1 sin él). */
export function perSeedBand(q, n, bias = 1) {
  if (!q) { const d = DEFAULT_SEED_MBPS * bias; return { lo: d * 0.5, p50: d, p75: d * 4, hi: d * 8, conf: 'baja' }; }
  const w = 1 / (2 * Math.sqrt(n));
  return { lo: q[0] * (1 - w), p50: q[1], p75: q[2], hi: q[2] * (1 + w), conf: 'media' };
}
/** Rango de Mbps de un torrent: `eff` seeders equivalentes × la banda, con tope `cap` (null = sin). */
export function supplyRange(eff, band, cap) {
  const at = (x) => (cap ? Math.min(eff * x, cap) : eff * x);
  return { lo: at(band.lo), p50: at(band.p50), p75: at(band.p75), hi: at(band.hi), conf: band.conf };
}
```
1b. En `healthCalibration` (:64–87): agregar `seedBand` y `trackerBand` al retorno, sin tocar `seedMbps`/`trackerSeedMbps`:
- antes del `if (cfg.seedMbps > 0)` (:75):
```js
  const q3 = (xs) => (xs.length >= MIN_SAMPLES ? [0.25, 0.5, 0.75].map((p) => quantile(xs, p)) : null);
  const seedBand = perSeedBand(q3(counted.map((l) => sustainedMbps(l) / l.seeds)), n);
  const trackQ = q3(tracked.map((l) => sustainedMbps(l) / (l.tracker_seeds + (l.tracker_leechers ?? 0) / 6)));
  // Sin mediciones de trackers: la de contadas, con confianza baja (como `trackerSeedMbps`).
  const trackerBand = trackQ ? perSeedBand(trackQ, tracked.length) : { ...seedBand, conf: 'baja' };
```
- `base` (:74) pasa a `{ capMbps, capFrom, n, trackerN: tracked.length, samples, seedBand, trackerBand }` (mover la línea de `base` debajo del bloque anterior).
- Manual (:75): `const v = cfg.seedMbps, fixed = { lo: v, p50: v, p75: v, hi: v, conf: 'media' };` y retornar `{ ...base, seedBand: fixed, trackerBand: fixed, seedMbps: v, trackerSeedMbps: v, source: 'manual' }`.
- Actualizar el doc de `healthCalibration` (:59–63) nombrando `seedBand`/`trackerBand`.
- No pasar `bias` todavía (lo enchufa la idea 4).

**Verificación 1** (self-check, desde /Users/monti/Documents/Dev/streamonte):
```sh
node --input-type=module -e "
import assert from 'node:assert/strict';
import { perSeedBand, supplyRange } from './ui/src/health-calib.js';
const prior = perSeedBand(null, 0);
assert.deepEqual([prior.lo, prior.p50, prior.p75, prior.hi, prior.conf], [1.5, 3, 12, 24, 'baja']);
const real = supplyRange(2 + 3 / 6, prior, null);            // caso real: trackers 2 seeds · 3 leechers
assert.deepEqual([real.lo, real.p50, real.p75, real.hi], [3.75, 7.5, 30, 60]);
assert.ok(real.lo <= 55 && 55 <= real.hi);                  // lo real (~55 Mbps) cae adentro
assert.ok(real.p50 / (1.4e9 * 8 / 2700) < 2 && real.p75 / (1.4e9 * 8 / 2700) >= 2); // justa → buena probable
assert.equal(supplyRange(2.5, prior, 40).hi, 40);            // tope de internet
const cal = perSeedBand([2, 4, 8], 4);                       // n = 4 → ±25 %
assert.deepEqual([cal.lo, cal.p50, cal.p75, cal.hi, cal.conf], [1.5, 4, 8, 10, 'media']);
assert.equal(perSeedBand(null, 0, 2).p50, 6);                // sesgo de la idea 4
console.log('ok');" 2>&1 | grep -v -i 'warning\|reparsing\|module type\|trace-warnings\|eliminate'
```
Debe imprimir `ok`.

### Paso 2 — `health` con rango, evidencia máxima y "probable"
/Users/monti/Documents/Dev/streamonte/ui/src/catalog.js:694–722. Reemplazar el cuerpo de `health` (mantener `LEECH_SHARE` y el gate de :703–704) por:
```js
function health(c) {
  const seeds = knownSeeds(c);
  if (seeds == null || counted.get(c.info_hash)?.reached === false) return null;
  const bps = neededBps(c);
  const need = bps ? toMbps(bps) : TYPICAL_MBPS[c.resolution] ?? 3;
  const cal = renderCal ?? healthCalibration(state.library.values());
  const pb = playbackOf(c.info_hash);
  const now = pb && speedOf(pb.key);
  const measuredBps = now?.n >= MIN_SECS ? now.avg : rowsOf(c.info_hash).find((e) => e.live?.avg_speed_bps > 0)?.live.avg_speed_bps;
  // Cada evidencia da un rango; gana la de p50 más alto (idea 8: todas subestiman). Con 0 seeders
  // contados los trackers no entran (pueden estar viejos). Lo medido manda (B6).
  const sc = seedsCounted(c);
  const ev = [];
  if (sc != null) ev.push({ basis: 'counted', seeds: sc, leech: leechersOf(c) ?? 0, band: cal.seedBand });
  if (sc !== 0 && seedsOf(c) != null) ev.push({ basis: 'tracker', seeds: seedsOf(c), leech: c.leechers ?? 0, band: cal.trackerBand });
  const m = measuredBps && toMbps(measuredBps);
  const best = m
    ? { basis: 'measured', seeds, leech: leechersOf(c) ?? 0, band: null, range: { lo: m, p50: m, p75: m, hi: m, conf: 'alta' } }
    : ev.map((e) => ({ ...e, range: supplyRange(e.seeds + e.leech * LEECH_SHARE, e.band, cal.capMbps) }))
      .reduce((a, b) => (b.range.p50 > a.range.p50 ? b : a));
  const r = best.range;
  const lvl = (x) => (x >= 2 ? 0 : x >= 1 ? 1 : 2);
  const level = lvl(r.p50 / need);
  const probable = !m && level > 0 && lvl(r.p75 / need) < level;
  return { level, shown: probable ? level - 1 : level, probable, range: r, conf: r.conf, ratio: r.p50 / need, supply: r.p50, need, exact: !!bps,
    measured: !!m, seeds: best.seeds, leech: best.leech, cal, basis: best.basis, band: best.band, perSeed: best.band?.p50 };
}
```
- `ev` nunca queda vacío sin medición: `knownSeeds` no null ⇒ `sc` o `seedsOf` no null (si `sc === 0`, entra `counted`).
- Import (:11): `import { MIN_SECS, healthCalibration, speedOf, supplyRange, trackPlayback } from './health-calib.js';`
- Doc de `health` (:694–700): sumar "Devuelve el rango (p50 manda el nivel; `probable` si el p75 alcanza el nivel de arriba) y de qué evidencia sale".

**Verificación 2**: `node --check /Users/monti/Documents/Dev/streamonte/ui/src/catalog.js`. En la app (`cargo run -p streamonte` desde /Users/monti/Documents/Dev/streamonte): abrir un título analizado; el orden de tier 2 no cambia salvo opciones que suben por trackers o por `probable`.

### Paso 3 — Badge con rango, siempre visible
/Users/monti/Documents/Dev/streamonte/ui/src/catalog.js:724–744. Reemplazar `healthBadge` y `signalSvg`:
```js
const HEALTH_TEXT = [['Buena salud', 'Buena probable'], ['Puede cortarse', 'Puede alcanzar'], ['Mala salud']];
const HEALTH_SRC = { measured: 'medido', counted: 'seeders contados', tracker: 'trackers' };
const mbpsN = (v) => nf(v >= 10 ? Math.round(v) : v);
/** Salud como rango con confianza (idea 8): ícono + "lo–hi Mbps" + de dónde sale; siempre que se
 *  conozca algún seeder. `compact` (reproduciendo) o medido: solo el ícono (la velocidad ya se ve). */
function healthBadge(c, compact = false) {
  const h = health(c);
  if (!h) return null;
  const { shown, probable, range: r, conf, basis, band, need, exact, seeds, leech, cal } = h;
  const text = HEALTH_TEXT[shown][probable ? 1 : 0];
  const cls = ['cat-health-good', 'cat-health-fair', 'cat-health-risky'][shown];
  const span = r.hi / Math.max(r.lo, 0.1) < 1.25 ? `~${mbpsN(r.p50)} Mbps` : `${mbpsN(r.lo)}–${mbpsN(r.hi)} Mbps`;
  const src = `${HEALTH_SRC[basis]}${conf === 'baja' ? ' · sin calibrar' : ''}`;
  const asks = exact ? `pide ~${Math.round(need)}` : `un ${resLabel(resKey(c))} suele pedir ~${Math.round(need)} (el real se sabe al analizarlo)`;
  const internet = cal.capMbps && r.hi >= cal.capMbps ? ` (tope: tu internet, ${Math.round(cal.capMbps)} Mbps)` : '';
  const what = basis === 'measured' ? `bajó a ~${mbpsN(r.p50)} Mbps` : `entre ${mbpsN(r.lo)} y ${mbpsN(r.hi)} Mbps, lo más probable ~${mbpsN(r.p50)}`;
  const why = basis === 'measured' ? 'Medido bajando este torrent.'
    : `${seeds} ${basis === 'tracker' ? 'seeders de trackers' : 'seeders contados'} y ${leech} leechers × ${mbpsN(band.lo)}–${mbpsN(band.hi)} Mbps por seeder${conf === 'baja' ? ' (sin mediciones propias en esta red: rango amplio)' : ''}${internet}.`;
  const tip = `${text}: ${what}; ${asks} (${nf1(h.ratio)}×).\n${why}\nConfianza: ${conf}.${conf === 'alta' ? '' : ' Cargar en background (⤓) la mide de verdad.'}\nTocá para verificarla de nuevo (cuenta los seeders reales).`;
  const attrs = { id: `cat-health-${c.info_hash}`, title: tip, 'aria-label': `${text}, ${span}, ${src}, confianza ${conf}: verificar de nuevo`, onclick: () => reanalyze([c.info_hash]) };
  const svg = signalSvg(3 - shown, probable);
  if (compact || basis === 'measured') {
    const b = el('button', { ...attrs, class: `cat-health-ic ${cls}` });
    b.innerHTML = svg;
    return b;
  }
  const ic = el('span', { class: 'cat-health-ic', 'aria-hidden': 'true' });
  ic.innerHTML = svg;
  return el('button', { ...attrs, class: `cat-health ${cls}` }, ic,
    el('span', { class: 'cat-health-txt' }, el('span', { class: 'cat-health-range' }, span), el('span', { class: 'cat-health-src' }, src)));
}
/** Ícono de señal: `bars` llenas de 3 (0 = sin verificar); `maybe`: la más alta, a medias (probable). */
const signalSvg = (bars, maybe = false) => `<svg viewBox="0 0 16 14" width="16" height="14" aria-hidden="true">${[1, 2, 3].map((b) => `<rect x="${b * 5 - 4}" y="${12 - b * 4}" width="3.4" height="${b * 4}" rx="1" class="${b <= bars ? 'on' : ''}${maybe && b === bars ? ' maybe' : ''}"/>`).join('')}</svg>`;
```
- Import de formato (:10): sumar `nf`: `import { humanBytes, mbps, nf, nf1, playbackText } from './format.js';`
- :861: `healthBadge(c)` → `healthBadge(c, true)`. :868 sin cambios.
- `verifyButton` (:889) usa `signalSvg(0)`: sigue igual.

**Verificación 3**: en la app, título sin analizar → cada opción con seeders muestra badge con rango y "trackers · sin calibrar"; las sin seeders, "Verificar salud". Tab hasta el badge → foco visible; lector de pantalla lee el `aria-label`. Click → analiza esa opción. Reproduciendo → ícono chico sin texto. Solo un `#cat-health-<hash>` por fila (`document.querySelectorAll('[id^=cat-health-]')` sin duplicados).

### Paso 4 — Estilos
/Users/monti/Documents/Dev/streamonte/ui/catalog.css, debajo de :285 (`button.cat-health-ic:hover`):
```css
/* Salud como rango (idea 8): ícono + "lo–hi Mbps" + de dónde sale. */
.cat-health { display: inline-flex; align-items: center; gap: 6px; min-height: 44px; padding: 2px 8px 2px 4px; border: none; border-radius: 10px; background: none; cursor: pointer; text-align: left; }
.cat-health:hover { background: color-mix(in srgb, var(--text) 8%, transparent); }
.cat-health .cat-health-ic { cursor: inherit; }
.cat-health-txt { display: flex; flex-direction: column; gap: 1px; line-height: 1.2; white-space: nowrap; }
.cat-health-range { font-size: 12.5px; font-weight: 600; color: var(--text); font-variant-numeric: tabular-nums; }
.cat-health-src { font-size: 11px; font-weight: 500; color: var(--muted); }
/* Probable: la barra más alta, a medias. */
.cat-health-ic rect.on.maybe { fill-opacity: .4; }
```
**Verificación 4**: panel lateral a su ancho mínimo (`min(560px, 48vw)`): la fila no se corta ni empuja ▶ fuera; tema claro y oscuro legibles.

### Paso 5 — Orden
/Users/monti/Documents/Dev/streamonte/ui/src/catalog.js:490–494 (`key` de `sortOptions`):
```js
    const h = health(c);
    const lvl = h?.shown ?? 3;
    const good = lvl === 0;
    const bySize = good && !h.probable && h.exact && !c.is_pack; // el peso de un pack es de varios episodios
    return [-tierOf(c), lvl, h?.probable ? 1 : 0, good && !bySize ? 1 : 0, bySize ? -(c.size_bytes ?? 0) : -(h?.ratio ?? -1)];
```
Actualizar el doc de `sortOptions` (:478–484): "por salud mostrada (las seguras antes que las probables)".
**Verificación 5**: con un análisis terminado, una "Buena probable" queda debajo de las "Buena salud" y arriba de las "Puede cortarse".

### Paso 6 — Popover
/Users/monti/Documents/Dev/streamonte/ui/src/speed.js:85, debajo de la línea "Con seeders de trackers":
```js
      el('span', { class: 'conn-sub' }, `Rango por seeder: ${nf1(cal.seedBand.lo)}–${nf1(cal.seedBand.hi)} Mbps (confianza ${cal.seedBand.conf})`),
```
**Verificación 6**: abrir "Tu conexión": sin mediciones dice `1,5–24,0 Mbps (confianza baja)`.

## 6. Qué queda igual a propósito
- `level` (p50) sigue mandando "Mejor opción" (:850) y "Ninguna llega a salud buena" (:583): lo probable no se recomienda.
- Tier 1 ordenado por seeds/leechers (D7). `lightOf`, `bgText`, `heavyBadge`: sin cambios.
- `seedMbps`/`trackerSeedMbps` y la mediana: idénticos (B6, B24); el p50 de la banda es el mismo número.
- El núcleo Rust y lo que se guarda en localStorage: sin cambios (las bandas se calculan de las muestras existentes).

## 7. Riesgos
- **Sobrecarga visual**: +~90 px por fila y un número más; rangos amplios ("3,8–60") pueden leerse como ruido. Mitigación: solo ícono reproduciendo/medido; "~X" cuando el rango es angosto.
- **Optimismo**: la regla del máximo + "probable" sesga hacia arriba; con trackers inflados (números falsos de la fuente) una opción muerta puede verse "Puede alcanzar" hasta contarla. El conteo con 0 seeders lo corta.
- **Prior arbitrario** (×0,5…×8): sale de una sola medición real; si el usuario mide mucho, deja de importar (se usan cuartiles).
- `hi` topado por internet puede igualar `p75` y quitar el "probable" en conexiones lentas (correcto, pero sorprende).
- Más opciones con badge clickeable: un click accidental lanza un análisis (ya pasa con las contadas).

## 8. Decisiones abiertas (el spec toma la primera; cambiar es local)
1. Evidencia máxima entre contadas y trackers (salvo 0 contados) — alt: contadas siempre mandan (hoy).
2. "Probable" para toda estimación — alt: solo con `conf = 'baja'`.
3. Prior ×0,5 / ×1 / ×4 / ×8 del default — alt: ×0,5 / ×1 / ×3 / ×6.
4. Sin `verifyButton` cuando hay badge (la acción va en el badge) — alt: mantener ambos (más ruido).
5. Tier 1 por `bySeeds` (D7) — alt: ordenar por p50/need también.

## 9. Estimación
Alcance: un módulo (UI: 3 JS + 1 CSS) · Complejidad: media (casos medido/contado/trackers/prior, "probable", orden) · Incertidumbre: conocido en código; investigar con uso si el ancho del prior y la regla del máximo dan rangos útiles (se valida mirando 10–20 títulos contra lo que después anda).

## 10. Relación con ideas 3, 4, 5
- **3 (medición con tope)**: su resultado entra como `basis 'measured'`, `conf alta`; el rango colapsa a "~X". Si mide 20–30 s, sus p25/p75 por segundo pueden dar `lo/hi` reales en vez de un punto.
- **4 (sesgo aprendido)**: aporta `bias` a `perSeedBand(null, 0, bias)` (solo prior); si además corrige factores calibrados, evitar contar dos veces.
- **5 (extrapolar enjambre)**: sus seeders previstos a 3 min son otro elemento de `ev` (`basis 'extrapolado'`, con su banda); la regla del máximo lo integra sin tocar la UI.
- Este spec no depende de ninguna: con `bias = 1` y sin 3/5 ya corrige el caso real.
