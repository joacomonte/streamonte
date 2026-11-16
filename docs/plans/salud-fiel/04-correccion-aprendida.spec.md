# Spec 04 — Corrección aprendida análisis → reproducción, por red

Fecha: 2026-11-16 · Contexto y reglas: /Users/monti/Documents/Dev/streamonte/docs/plans/salud-fiel/00-contexto.md
Base: cambio SIN COMMIT de hoy en /Users/monti/Documents/Dev/streamonte/ui/src/health-calib.js,
/Users/monti/Documents/Dev/streamonte/ui/src/catalog.js y /Users/monti/Documents/Dev/streamonte/ui/src/speed.js
(`trackerSeedMbps`, muestras con `tracker_seeds`/`tracker_leechers`/`real_peers`). Este spec lo reemplaza/extiende.

## 0. Veredicto
Viable y barato (UI + 1 campo en Rust). Corrige el sesgo SISTEMÁTICO por red, no el caso puntual: con 1 reproducción
mueve 1/3 del camino; con ~8 queda dentro de ×1,5. No acelera el análisis ni ve entrantes que el análisis no ve (eso es
idea 1/3); aprende cuánto subestiman.

## 1. Hallazgos que condicionan el diseño (verificados en código)
1. **`trackerSeedMbps` hoy no se ve en el catálogo.** `healthBadge` exige `counted.get(hash)?.reached`
   (/Users/monti/Documents/Dev/streamonte/ui/src/catalog.js:727) y `sortOptions` solo usa `health()` en tier 2 (contado,
   /Users/monti/Documents/Dev/streamonte/ui/src/catalog.js:490). Con conteo, `seedsCounted` nunca es null → `basis` es siempre
   `'counted'`. Lo que mueve la salud visible es el factor de **conteo** y el de **medición del análisis**; el de tracker se
   aprende y se muestra en "Tu conexión", pero no cambia ningún ícono (ver D-A3).
2. **Ya existe otra calibración análisis→reproducción en Rust**: /Users/monti/Documents/Dev/streamonte/crates/core/src/playback/calibration.rs
   (`calibration.json`, ventana min 1–5, mediana de real/`live.avg_speed_bps`, acotada [0,5; 4], GLOBAL, sin red). Alimenta
   `speed_factor` del semáforo de *Mis magnets* (/Users/monti/Documents/Dev/streamonte/crates/core/src/app.rs:169), no la salud del
   catálogo. Se deja igual (D-A2).
3. Las muestras de la biblioteca (`live`, /Users/monti/Documents/Dev/streamonte/ui/src/health-calib.js:46-50) son mediciones
   **del análisis**, o sea predicción, no realidad: hoy entran como "lo real" del aporte por seeder. El modelo nuevo las saca
   del aprendizaje (siguen sirviendo para el techo `fastest`).
4. `Stats.seeds` ya existe y rqbit lo llena (`live_seeders`, /Users/monti/Documents/Dev/streamonte/crates/core/src/engine/rqbit.rs:607);
   solo falta copiarlo a `PlaybackRow`.
5. `live` solo lo escribe el analizador (/Users/monti/Documents/Dev/streamonte/crates/core/src/analyzer/queue.rs:480,555,770): no
   se contamina con la reproducción → sirve como evidencia de respaldo cuando el panel está cerrado. `scrape` de la fila
   (seeders/leechers de trackers) también.
6. Hoy la muestra mide p25 de TODA la reproducción desde el seg 10 (incluye arranque) → sesgo pesimista extra.

## 2. Qué se registra y dónde
**Dónde: localStorage `streamonte.health` (mismo objeto que hoy).** Clave nueva `pred` + muestras `bg` con formato nuevo.
- Alternativa descartada: guardar la predicción en `LibraryEntry` (/Users/monti/Documents/Dev/streamonte/crates/core/src/library.rs:76)
  vía `catalog_add`. Costo: campo serde + firma de comando + /Users/monti/Documents/Dev/streamonte/src-tauri/src/commands.rs:279 +
  /Users/monti/Documents/Dev/streamonte/ui/src/api.js:80. Beneficio nulo mientras "lo real" viva en localStorage (borrar el storage
  pierde las dos mitades igual). Además la UI es la única que conoce lo mostrado (calibración vigente, `need`).
- Panel cerrado: se cubre con (a) la **foto al tocar ▶/⤓** (el panel SÍ está abierto en ese momento) y (b) respaldo desde la
  fila de la biblioteca (`live` + `scrape`) para reproducciones desde *Mis magnets*.

### 2.1 Evidencia (`ev`) — lo que sabía el análisis
```
ev = {
  tracker_seeds, tracker_leechers,   // scrape/fuente (seedsOf(c), c.leechers) o fila.scrape
  counted_seeds, counted_leech,      // conteo profundo (counted) o live.seeds / live.peers−seeds; null si no hubo
  analysis_mbps,                     // live.avg_speed_bps del análisis (Mbps) o null
  need_mbps,                         // lo que pide el video (neededBps o TYPICAL_MBPS[res]); null si no se sabe
  res,                               // '2160p'… o null (se guarda, NO se estratifica: D-C3)
  at                                 // ISO, solo en la foto `pred`
}
```
`cfg.pred[hash] = ev` al tocar ▶ o ⤓ (máx. 60, las más nuevas). Vale si `Date.now() − at < 6 h`; si no, respaldo.

### 2.2 Muestra (`cfg.bg[hash]`) — lo que pasó
```
{ name, source, network, measured_at, measured_secs,
  ev,                     // copia de la evidencia de esa reproducción
  real_mbps,              // p25 de Mbps/seg en la ventana
  window_secs, short,     // segundos en ventana; short = ventana corta (medio peso)
  real_seeds, real_peers, real_incoming,   // máximos en la ventana (seeds: Rust, paso 1)
  avg_speed_bps, sustained_bps, max_speed_bps }   // se mantienen (techo `fastest`, texto de ⤓)
```
Se quitan de la muestra nueva los campos sueltos `seeds`/`tracker_seeds`/`tracker_leechers`/`real_peers` (van en `ev`/`real_*`).

### 2.3 Ventana de "lo real"
- `t.n` = segundos de descarga activa (`playing`/`background`, ya existe). Se guardan tuplas
  `[seg, speed_bps, seeds, peers, incoming]` para `30 < seg ≤ 300` y `progress < 0.95` (el final de archivo frena: endgame).
- **Completa**: tuplas con `seg > 120` (min 2–5), si son ≥ 60 → `short=false`, peso 1.
- **Corta** (se cortó o el archivo terminó antes): todas las tuplas (seg 30→fin) si son ≥ 30 → `short=true`, peso 0,5.
  Motivo: sin esto, las reproducciones que el usuario abandona porque andaban mal (< 3 min) no entran → sesgo optimista.
- `real_mbps = p25(speed_bps de la ventana) · 8 / 1e6` (mismo `sustained` de hoy, B-24 de mem.db).
- Se escribe cada 10 s mientras `seg ≤ 310`; después queda fija.

## 3. Modelo
Base fija (el "prior"): `S0 = DEFAULT_SEED_MBPS = 3`, `LEECH_SHARE = 1/6` (B-6).

Predicción cruda por evidencia `e`:
- tracker: `P = max(0,5; (ts + tl/6)·S0)`, solo si `ts > 0` (un 0 de tracker no es confiable, `trackersWin`).
- counted: `P = max(0,5; (cs + cl/6)·S0)`, si `cs != null`.
- measured: `P = analysis_mbps`, si `> 0`.

Por muestra i y evidencia e: `r_i = ln(real_i / P_i,e)`.
- Censura por la línea: si `link` (test de velocidad) y `real_i ≥ 0,85·link` y `r_i ≤ 0` → se descarta (la línea topó; no dice nada).
- Peso: `w_i = peso_base_i · 0,5^(edad_días / 30)` (peso_base 1; 0,5 si `short` o vieja migrada).
- `n_eff = Σ w_i`; `m = mediana ponderada de r_i` (primera r cuyo peso acumulado ≥ n_eff/2, ordenando por r).
- **Contracción al prior 0** (= modelo sin corregir): `b_e = clamp( n_eff·m / (n_eff + 2), −ln 4, ln 20 )`; `k_e = e^{b_e}`.
- Sin muestras: `b_e = 0`, `k_e = 1` (reemplaza el umbral `MIN_SAMPLES` del aporte por seeder).

Aplicación (por red: `measurements` ya filtra por `network`):
- `seedMbps = S0 · k_counted`, `trackerSeedMbps = S0 · k_tracker` → `health()` no cambia su fórmula (B-6 intacto).
- Medición del análisis: `supply = analysis_mbps · k_measured` (solo cuando lo medido viene de `live`, no de la reproducción
  en curso). El techo `capMbps` sigue igual.
- Manual (Ajustes → "Fijar"): `seedMbps = trackerSeedMbps = manual` (como hoy); `k_measured` se aprende igual.
- Evidencia que usa la salud de una muestra (`basisOf`): measured si `analysis_mbps > 0`, si no counted si `cs != null`,
  si no tracker si `ts > 0` (mismo orden que `health()`).

### 3.1 Ejemplo con el caso real
4K 1,4 GB, trackers 2·3, real ~55 Mbps (asumo p25 de ventana = 55; episodio de 45 min → pide 1,4e9·8/2700 = 4,15 Mbps).
- Cruda: `P = (2 + 3/6)·3 = 7,5` → 7,5/4,15 = 1,8× → **"Puede cortarse"**. Error `ln(7,5/55) = −1,99` (pesimista ×7,3).
- 1 muestra (hoy): `r = ln(55/7,5) = 1,992`; `b = 1·1,992/3 = 0,664`; `k = 1,94` → 14,6 Mbps → 3,5× → **"Buena"**.
  Aporte por seeder de trackers 5,8.
- 3 muestras r = {1,8; 2,0; 2,2}: `m = 2,0`, `b = 3·2/5 = 1,2`, `k = 3,32` → 24,9 Mbps (10,0 por seeder).
- 8 muestras con m = 2,0: `b = 16/10 = 1,6`, `k = 4,95` → 37,1 Mbps; error `ln(37,1/55) = −0,39` (×1,48).
- Un atípico (r = −4,3 junto a 1,8/2,0/2,2): mediana ponderada = 1,8 → `b = 4·1,8/6 = 1,2`: no se cae.
Si ese caso tenía conteo profundo (lo más probable, porque se mostró salud), la misma cuenta aplica a `counted` con los
seeders contados (no quedaron registrados; supongo del mismo orden).

## 4. Validación (métrica y umbral)
`fidelity(samples, link)`, **prequencial** (cada muestra se predice con lo aprendido SOLO de las anteriores, en orden de
fecha; sin fuga): por muestra con `basisOf` y `need_mbps`:
- `antes = cap(P)`, `después = cap(P·k)` (cap = `min(·, link)` salvo measured); `err = ln(pred/real)`.
- `nivel(x) = x ≥ 2 ? 0 : x ≥ 1 ? 1 : 2` sobre `pred/need` y `real/need`; acierto = mismo nivel; pesimista = nivel predicho peor.
- Devuelve `{n, biasBefore, biasAfter (medianas de err), typBefore, typAfter (medianas de |err|), hits, pessimistic}`.

Visible en "Tu conexión" (tarjeta `#conn-fidelity`). **Éxito** (por red, con `n ≥ 8`):
`|biasAfter| ≤ ln 1,5` **y** `hits/n ≥ 0,7` **y** `typAfter ≤ 0,8·typBefore`. La tarjeta lo marca con clase `ok`.

## 5. Diseño (firmas)
/Users/monti/Documents/Dev/streamonte/ui/src/health-calib.js (sin imports; sigue importable desde node):
```js
export const levelOf = (ratio) => (ratio >= 2 ? 0 : ratio >= 1 ? 1 : 2);
export function rawPrediction(ev, kind /* 'tracker'|'counted'|'measured' */) /* → Mbps | null */;
export function basisOf(ev) /* → kind | null */;
export function learnBias(samples, nowMs, linkMbps) /* → {tracker, counted, measured}: {bias, factor, n, nEff} */;
export function fidelity(samples, linkMbps) /* → {n, biasBefore, biasAfter, typBefore, typAfter, hits, pessimistic} | null */;
export function notePrediction(hash, ev) /* guarda cfg.pred[hash] = {...ev, at} */;
export function trackPlayback(row, ev) /* ev = respaldo (evidenceOf); usa cfg.pred[hash] fresca si hay */;
export function healthCalibration(rows) /* agrega: measuredFactor, bias, learnable; mantiene seedMbps,
                                           trackerSeedMbps, capMbps, capFrom, n, trackerN, samples, source */;
```
/Users/monti/Documents/Dev/streamonte/ui/src/catalog.js: `function evidenceOf(hash)` (privada).
Rust: `PlaybackRow.seeds: u32`.

UI (ids): `#conn-fidelity` (tarjeta). Botones existentes sin cambio: `#speed-retest`, `#speed-seed-edit`, `#speed-seed-input`,
`#speed-seed-fix`, `#speed-seed-auto`, `#speed-reset`.

### Migración de muestras viejas (`learnable`)
- Con `ev` y `real_mbps` → tal cual (peso 0,5 si `short`).
- Viejas (sin `ev`), de reproducción/background con `measured_secs ≥ 120` → `ev = {counted_seeds: seeds ?? null,
  counted_leech: null, tracker_seeds: tracker_seeds ?? null, tracker_leechers: tracker_leechers ?? null, analysis_mbps: null,
  need_mbps: null}`, `real_mbps = sustainedMbps(l)`, peso 0,5 (su p25 incluye el arranque → pesimista). Sin `need` no entran
  a `fidelity`, sí al sesgo.
- Viejas con `measured_secs < 120` y las de la biblioteca (`source: 'análisis'`) → fuera del aprendizaje.
- Nada se reescribe en storage: se adapta al leer; las nuevas pisan por hash.

## 6. Pasos

### Paso 1 — Rust: seeders reales en la fila de reproducción
- /Users/monti/Documents/Dev/streamonte/crates/core/src/playback.rs:92 (después de `pub peers: u32,`):
  ```rust
      /// De esos, los que tienen el archivo completo (`Stats::seeds`): la salud aprendida los muestra.
      pub seeds: u32,
  ```
- /Users/monti/Documents/Dev/streamonte/crates/core/src/playback.rs:324 y /Users/monti/Documents/Dev/streamonte/crates/core/src/playback/kept.rs:232
  (después de `peers: 0,`): `seeds: 0,`.
- /Users/monti/Documents/Dev/streamonte/crates/core/src/playback/flow.rs:303 y :395 (después de `row.peers = stats.peers;`):
  `row.seeds = stats.seeds;`.
- Verificar: `cargo build -p streamonte-core && cargo test -p streamonte-core playback` (sin errores; `PlaybackRow` no se
  construye en otro lado: grep `PlaybackRow {` da solo esos 2 sitios).

### Paso 2 — health-calib.js: modelo puro
En /Users/monti/Documents/Dev/streamonte/ui/src/health-calib.js, después de `median` (:57), agregar exactamente:
```js
// ---------- corrección aprendida análisis → reproducción (idea 4, 2026-11-16) ----------
/** Ventana de "lo real": segundos 120–300 de descarga activa (sin el arranque). Con menos de
 *  WIN_MIN ahí (se cortó antes), la ventana corta 30→fin con medio peso: si no, lo que anduvo mal
 *  y se abandonó no entraría nunca. */
const WIN_FROM = 120, WIN_TO = 300, WIN_MIN = 60, SHORT_FROM = 30, SHORT_MIN = 30;
/** Muestras equivalentes del "sin sesgo" y vida media de una muestra (días). */
const PRIOR_N = 2, HALF_LIFE_DAYS = 30;
const BIAS_MIN = -Math.log(4), BIAS_MAX = Math.log(20);
const MIN_PRED_MBPS = 0.5;
const KINDS = ['tracker', 'counted', 'measured'];

export const levelOf = (ratio) => (ratio >= 2 ? 0 : ratio >= 1 ? 1 : 2);

/** Predicción SIN corregir de una evidencia, en Mbps (null si no la hay): lo que diría el modelo base. */
export function rawPrediction(ev, kind) {
  if (!ev) return null;
  if (kind === 'measured') return ev.analysis_mbps > 0 ? ev.analysis_mbps : null;
  const [s, l] = kind === 'tracker' ? [ev.tracker_seeds, ev.tracker_leechers] : [ev.counted_seeds, ev.counted_leech];
  if (s == null || (kind === 'tracker' && !(s > 0))) return null; // 0 de tracker: no confiable (`trackersWin`)
  return Math.max(MIN_PRED_MBPS, (s + (l ?? 0) / 6) * DEFAULT_SEED_MBPS);
}
/** La evidencia que usa `health()` del catálogo, en su mismo orden. */
export const basisOf = (ev) => KINDS.slice().reverse().find((k) => rawPrediction(ev, k) != null) ?? null;

function weightedMedian(pts) {
  const s = [...pts].sort((a, b) => a[0] - b[0]);
  const half = s.reduce((t, [, w]) => t + w, 0) / 2;
  let acc = 0;
  for (const [x, w] of s) { acc += w; if (acc >= half) return x; }
  return 0;
}

/** Sesgo aprendido por evidencia: mediana ponderada (por antigüedad) de ln(real ÷ predicción),
 *  contraída hacia 0 con PRIOR_N muestras equivalentes. Topadas por la línea y pesimistas: fuera. */
export function learnBias(samples, nowMs, link) {
  const out = {};
  for (const kind of KINDS) {
    const pts = [];
    for (const s of samples) {
      const pred = rawPrediction(s.ev, kind);
      if (!pred || !(s.real_mbps > 0)) continue;
      const r = Math.log(s.real_mbps / pred);
      if (link && s.real_mbps >= 0.85 * link && r <= 0) continue;
      const age = Math.max(0, nowMs - Date.parse(s.measured_at)) / 864e5;
      pts.push([r, (s.weight ?? 1) * 0.5 ** (age / HALF_LIFE_DAYS)]);
    }
    const nEff = pts.reduce((t, [, w]) => t + w, 0);
    const bias = pts.length ? Math.min(BIAS_MAX, Math.max(BIAS_MIN, (nEff * weightedMedian(pts)) / (nEff + PRIOR_N))) : 0;
    out[kind] = { bias, factor: Math.exp(bias), n: pts.length, nEff };
  }
  return out;
}

/** Qué tan fiel fue la salud en esta red: cada muestra se predice con lo aprendido SOLO de las
 *  anteriores. err = ln(predicción ÷ real): < 0 = pesimista. */
export function fidelity(samples, link) {
  const asc = [...samples].sort((a, b) => Date.parse(a.measured_at) - Date.parse(b.measured_at));
  const rows = [];
  asc.forEach((s, i) => {
    const kind = basisOf(s.ev);
    const need = s.ev?.need_mbps;
    if (!kind || !(need > 0)) return;
    const raw = rawPrediction(s.ev, kind);
    const k = learnBias(asc.slice(0, i), Date.parse(s.measured_at), link)[kind].factor;
    const cap = (x) => (link && kind !== 'measured' ? Math.min(x, link) : x);
    const after = cap(raw * k), real = levelOf(s.real_mbps / need), got = levelOf(after / need);
    rows.push({ before: Math.log(cap(raw) / s.real_mbps), after: Math.log(after / s.real_mbps), hit: got === real, pess: got > real });
  });
  if (!rows.length) return null;
  const med = (f) => median(rows.map(f));
  return {
    n: rows.length, biasBefore: med((r) => r.before), biasAfter: med((r) => r.after),
    typBefore: med((r) => Math.abs(r.before)), typAfter: med((r) => Math.abs(r.after)),
    hits: rows.filter((r) => r.hit).length, pessimistic: rows.filter((r) => r.pess).length,
  };
}

/** Muestra lista para aprender (migración al leer: ver spec 04 §5). Null = no aprende. */
function learnable(l) {
  if (l.ev && l.real_mbps > 0) return { ...l, weight: l.short ? 0.5 : 1 };
  if (l.source === 'análisis' || !(l.measured_secs >= WIN_FROM)) return null;
  return { ...l, weight: 0.5, real_mbps: sustainedMbps(l),
    ev: { counted_seeds: l.seeds ?? null, counted_leech: null, tracker_seeds: l.tracker_seeds ?? null, tracker_leechers: l.tracker_leechers ?? null, analysis_mbps: null, need_mbps: null } };
}
```
- Verificar: self-check del §7 (pasa).

### Paso 3 — health-calib.js: `healthCalibration` con el sesgo
Reemplazar el cuerpo de `healthCalibration` (/Users/monti/Documents/Dev/streamonte/ui/src/health-calib.js:64-87) por:
```js
export function healthCalibration(rows) {
  const cfg = load();
  const samples = measurements(rows, cfg.since, cfg.bg)
    .sort((a, b) => Date.parse(b.measured_at) - Date.parse(a.measured_at));
  const fastest = samples.length >= MIN_SAMPLES ? Math.max(...samples.map((l) => (l.max_speed_bps * 8) / 1e6)) : null;
  const capMbps = linkMbps ?? fastest;
  const capFrom = linkMbps ? 'test' : fastest ? 'measured' : null;
  const learn = samples.map(learnable).filter(Boolean);
  // Sesgo aprendido (idea 4): lo real de min 2–5 vs lo que predijo el análisis, por evidencia.
  const bias = learnBias(learn, Date.now(), linkMbps);
  const manual = cfg.seedMbps > 0;
  return {
    capMbps, capFrom, samples, learnable: learn, bias,
    n: bias.counted.n, trackerN: bias.tracker.n,
    seedMbps: manual ? cfg.seedMbps : DEFAULT_SEED_MBPS * bias.counted.factor,
    trackerSeedMbps: manual ? cfg.seedMbps : DEFAULT_SEED_MBPS * bias.tracker.factor,
    measuredFactor: bias.measured.factor,
    source: manual ? 'manual' : bias.counted.n ? 'measured' : 'default',
  };
}
```
- Borrar el comentario/JSDoc viejo de :59-63 y reemplazarlo por uno que liste los campos nuevos (`learnable`, `bias`,
  `measuredFactor`). Actualizar el encabezado :1-7 (una línea: "desde 2026-11-16 aprende el sesgo análisis→reproducción
  por evidencia; ver spec 04").
- Verificar: con storage vacío la app muestra `seedMbps = 3` y `trackerSeedMbps = 3` (igual que hoy sin mediciones).

### Paso 4 — health-calib.js: captura (foto, ventana, muestra)
- Después de `addSample`, agregar:
  ```js
  const PRED_TTL_MS = 6 * 3600e3, MAX_PRED = 60;
  /** Foto de lo que sabía el análisis al tocar ▶/⤓ (el panel está abierto): la usa la reproducción
   *  aunque después se cierre el panel. */
  export function notePrediction(hash, ev) {
    const cfg = load();
    const all = { ...cfg.pred, [hash]: { ...ev, at: new Date().toISOString() } };
    const keep = Object.entries(all).sort((a, b) => Date.parse(b[1].at) - Date.parse(a[1].at)).slice(0, MAX_PRED);
    save({ ...cfg, pred: Object.fromEntries(keep) });
  }
  ```
- `trackPlayback` (:97-117) → firma `trackPlayback(row, ev)`:
  - init (:99): `{ id, name, sum: 0, n: 0, max: 0, speeds: [], win: [], incoming: 0, ev: null }` y, solo al crear `t`:
    `const p = load().pred?.[hash]; t.ev = p && Date.now() - Date.parse(p.at) < PRED_TTL_MS ? p : ev;`
    (`hash = row.key.split(':')[0]`, calcularlo al principio). La evidencia queda fija para esa reproducción.
  - Borrar las líneas de `t.seeds`, `t.tracker_seeds`, `t.tracker_leechers` (:100-102) y `t.real_peers` (:112, init :99).
  - Después de `t.speeds.push` (:110):
    ```js
    if (t.n > SHORT_FROM && t.n <= WIN_TO && (row.progress ?? 0) < 0.95)
      t.win.push([t.n, row.speed_bps, row.seeds ?? 0, row.peers ?? 0, row.incoming_peers ?? 0]);
    ```
  - Reemplazar la condición de guardado (:115): `if (t.ev && t.n % 10 === 0 && t.n <= WIN_TO + 10) addSample(hash, t);`
    (el `else dispatchEvent` queda).
- `addSample` (:134-140) → construye la muestra así (el resto igual):
  ```js
  const full = t.win.filter(([s]) => s > WIN_FROM);
  const short = full.length < WIN_MIN;
  const w = short ? t.win : full;
  if (w.length < (short ? SHORT_MIN : WIN_MIN)) return;
  const col = (i) => w.map((x) => x[i]);
  const sample = { name: t.name, source: t.source, ev: t.ev, real_mbps: (sustained(col(1)) * 8) / 1e6, short, window_secs: w.length,
    real_seeds: Math.max(...col(2)), real_peers: Math.max(...col(3)), real_incoming: Math.max(...col(4)),
    avg_speed_bps: t.sum / t.n, sustained_bps: sustained(t.speeds), max_speed_bps: t.max, measured_secs: t.n,
    measured_at: new Date().toISOString(), network };
  ```
- `measuringNow` (:126-129): reemplazar `seeds: t.seeds, tracker_seeds: t.tracker_seeds` por `ev: t.ev, secs: t.n`.
- `recalibrate` (:145): `export const recalibrate = () => { const { seedMbps, ...rest } = load(); save(rest); };`
  (hoy pierde `net`, y perdería `pred`).
- Verificar: reproducir algo analizado 6 min; en devtools `JSON.parse(localStorage['streamonte.health']).bg[hash]` tiene
  `ev`, `real_mbps`, `window_secs ≥ 60`, `short: false`, `real_seeds > 0`. Cortar otra a los 90 s → `short: true`.

### Paso 5 — catalog.js: evidencia, foto y corrección de lo medido
En /Users/monti/Documents/Dev/streamonte/ui/src/catalog.js:
- Import (:11): agregar `levelOf, notePrediction`.
- Antes de `measurePlayback` (:750), agregar:
  ```js
  /** Lo que el análisis sabía de una opción (idea 4): del panel abierto si está; si no, de la fila de
   *  la biblioteca (análisis `live` y trackers `scrape`). */
  function evidenceOf(hash) {
    const c = state.update?.candidates.find((x) => x.info_hash === hash);
    const live = rowsOf(hash).find((x) => x.live && !x.live.partial)?.live ?? null;
    const scrape = rowsOf(hash).find((x) => x.scrape)?.scrape ?? null;
    const n = counted.get(hash);
    const bps = c && neededBps(c);
    return {
      tracker_seeds: c ? seedsOf(c) : scrape?.seeders ?? null,
      tracker_leechers: c ? c.leechers ?? null : scrape?.leechers ?? null,
      counted_seeds: n?.reached ? n.seeds : live?.seeds > 0 ? live.seeds : null,
      counted_leech: n?.reached ? Math.max(0, n.peers - n.seeds) : live?.seeds > 0 ? Math.max(0, live.peers - live.seeds) : null,
      analysis_mbps: live?.avg_speed_bps > 0 ? toMbps(live.avg_speed_bps) : null,
      need_mbps: bps ? toMbps(bps) : c ? TYPICAL_MBPS[c.resolution] ?? null : live?.duration_secs ? toMbps(live.file_size / live.duration_secs) : null,
      res: c?.resolution ?? null,
    };
  }
  ```
  (`live.seeds > 0`: filas viejas traen 0 por `serde(default)` y no se distinguen de "0 contados".)
- `measurePlayback` (:753-760): reemplazar las líneas de `c` y `trackPlayback(...)` por `trackPlayback(row, evidenceOf(hash));`
  y borrar el comentario "sin panel, no calibran".
- `toggleBg` (:789) y `playOption` (:1230): justo ANTES de `await api.catalogAdd(...)`, `notePrediction(hash, evidenceOf(hash));`.
- `health()` (:714-721):
  ```js
  const fromAnalysis = !(now?.n >= MIN_SECS) && !!measuredBps; // lo del análisis se corrige; lo de ahora no
  const corr = fromAnalysis ? cal.measuredFactor : 1;
  const supply = measuredBps ? toMbps(measuredBps) * corr : cal.capMbps ? Math.min(raw, cal.capMbps) : raw;
  const ratio = supply / need;
  const level = levelOf(ratio);
  return { level, ratio, supply, need, exact: !!bps, measured: !!measuredBps, corr, seeds, leech, cal, basis, perSeed };
  ```
- `healthBadge` (:728 desestructurar, :736 texto): desestructurar `corr`; en la rama `measured` agregar
  `${corr !== 1 ? ` (lo del análisis × ${nf1(corr)}, aprendido de tus reproducciones)` : ''}` después de `Mbps`.
- Verificar: con panel CERRADO, reproducir desde *Mis magnets* algo analizado → la muestra tiene `ev.analysis_mbps`/
  `counted_seeds` del `live`. Con panel abierto y ▶ → `cfg.pred[hash]` existe y la muestra copia esa `ev`.

### Paso 6 — speed.js: "Tu conexión"
En /Users/monti/Documents/Dev/streamonte/ui/src/speed.js:
- Import (:10): agregar `basisOf, fidelity, rawPrediction`; quitar `MIN_SAMPLES` si deja de usarse.
- `perSeedNote` (:76-78): `manual → 'Fijado a mano'`; con `cal.n` → `Aprendido de ${cal.n} reproducciones en esta red (×${nf1(cal.bias.counted.factor)} sobre ${DEFAULT_SEED_MBPS})`;
  sin → `Sin reproducciones en esta red: ${DEFAULT_SEED_MBPS} Mbps (se aprende solo)`.
- Línea de trackers (:85): `Con seeders de trackers: ${nf1(cal.trackerSeedMbps)} Mbps por seeder (${cal.trackerN} reproducciones)`.
  Agregar debajo: `Medición del análisis: ×${nf1(cal.measuredFactor)} (${cal.bias.measured.n} reproducciones)`.
- "Midiendo:" (:87): sufijo `now[0].ev ? '' : ' (sin datos del análisis: no cuenta)'`.
- Nueva tarjeta, entre `incoming` y `how`:
  ```js
  const f = fidelity(cal.learnable, cal.capFrom === 'test' ? cal.capMbps : null);
  const ok = f && f.n >= 8 && Math.abs(f.biasAfter) <= Math.log(1.5) && f.hits / f.n >= 0.7 && f.typAfter <= 0.8 * f.typBefore;
  const dir = (x) => (x < 0 ? `pesimista ×${nf1(Math.exp(-x))}` : `optimista ×${nf1(Math.exp(x))}`);
  const fid = el('div', { id: 'conn-fidelity', class: `conn-card ${ok ? 'ok' : ''}` },
    el('span', { class: 'conn-main' },
      el('span', { class: 'conn-title' }, f ? `Fidelidad: acertó ${f.hits} de ${f.n} niveles` : 'Fidelidad: sin datos'),
      el('span', { class: 'conn-sub' }, f
        ? `Sin aprender: ${dir(f.biasBefore)} (error típico ×${nf1(Math.exp(f.typBefore))}). Con lo aprendido: ${dir(f.biasAfter)} (×${nf1(Math.exp(f.typAfter))}). ${f.pessimistic} veces dijo menos de lo que anduvo.`
        : 'Se calcula al reproducir 3 min algo cuya salud se estimó.')));
  ```
  y sumar `fid` a `pop.replaceChildren(...)` (:128) entre `incoming` y `how`.
- Hint (:112): reemplazar la última oración por `Cada reproducción (minutos 2 a 5) compara lo que predijo el análisis con lo que bajó de verdad y corrige la estimación, aparte para cada red (casa, trabajo…).`
- Lista de mediciones (:117-120): si `l.ev`, texto
  `predijo ${nf1(p)} → real ${nf1(l.real_mbps)} Mbps (×${nf1(l.real_mbps / p)}) · reales ${l.real_seeds} seeders / ${l.real_peers} peers (${l.real_incoming} entrantes)${l.short ? ' · corta' : ''} · ${ago(l.measured_at)}`
  con `p = rawPrediction(l.ev, basisOf(l.ev))` (si `p` es null: `real ${nf1(l.real_mbps)} Mbps · sin predicción`); si no, el texto de hoy.
  `cal.samples` sigue listando todas (incluidas las del análisis).
- CSS: en /Users/monti/Documents/Dev/streamonte/ui/styles.css:368 agregar el selector `.conn-card.ok .conn-title` a la regla de `.conn-incoming.open .conn-title` (verde).
- Verificar: abrir "Tu conexión" con 0 muestras (texto "sin datos", sin errores en consola) y con ≥ 1 muestra nueva.

### Paso 7 — Verificación final
- Self-check §7 pasa. `cargo test -p streamonte-core` pasa.
- Manual: reproducir 2 opciones analizadas ≥ 5 min en la misma red → `#conn-fidelity` muestra n=2 y `bias.counted.n = 2`;
  la salud de otra opción contada sube de nivel si el sesgo era pesimista.

## 7. Self-check del modelo (node, sin archivos)
```sh
node --input-type=module -e "
import assert from 'node:assert/strict';
const { learnBias, rawPrediction, fidelity, basisOf } = await import('file:///Users/monti/Documents/Dev/streamonte/ui/src/health-calib.js');
const now = Date.parse('2026-11-16T12:00:00Z');
const at = (d) => new Date(now - d * 864e5).toISOString();
const tr = { tracker_seeds: 2, tracker_leechers: 3, counted_seeds: null, counted_leech: null, analysis_mbps: null, need_mbps: 4.15 };
const s = (real, ev = tr, d = 0) => ({ real_mbps: real, ev, weight: 1, measured_at: at(d) });
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, a + ' vs ' + b);
near(rawPrediction(tr, 'tracker'), 7.5); assert.equal(basisOf(tr), 'tracker');
let b = learnBias([], now, null); assert.equal(b.tracker.factor, 1); assert.equal(b.measured.factor, 1);
b = learnBias([s(55)], now, null); near(b.tracker.bias, Math.log(55 / 7.5) / 3); assert.equal(b.counted.n, 0);
const e = (r) => s(7.5 * Math.exp(r));
near(learnBias([e(1.8), e(2.0), e(2.2)], now, null).tracker.bias, 1.2);
near(learnBias([e(1.8), e(2.0), e(2.2), s(0.1)], now, null).tracker.bias, 1.2); // atípico: no se cae
near(learnBias([s(55, tr, 30)], now, null).tracker.nEff, 0.5);                     // vida media 30 días
assert.equal(learnBias([s(95, { ...tr, tracker_seeds: 60 })], now, 100).tracker.n, 0); // topada por la línea
assert.ok(learnBias(Array.from({ length: 50 }, () => s(1e4)), now, null).tracker.bias <= Math.log(20) + 1e-9);
const f = fidelity(Array.from({ length: 8 }, (_, i) => s(55, tr, 8 - i)), null);
assert.equal(f.n, 8); assert.ok(f.biasBefore < 0 && f.typAfter < f.typBefore); assert.equal(f.hits, 7); assert.equal(f.pessimistic, 1);
console.log('ok');
"
```
(Requiere que health-calib.js siga sin `import` ni acceso a `window`/`localStorage` al cargar: hoy se cumple.)

## 8. Riesgos
- **Sesgo de selección**: solo se reproduce lo que parecía bueno → se aprende sobre las predicciones altas; por regresión a
  la media eso tira el factor hacia abajo (conservador, no rompe). Lo contrario: abandonar lo que anda mal antes de 2 min lo
  excluiría → mitigado con la ventana corta (medio peso). `⤓` sobre opciones "Puede cortarse" da muestras fuera de la selección.
- **Pocas muestras por red** (≈ 1 por película): con `PRIOR_N = 2` el efecto es lento (1/3 con 1 muestra). Es a propósito.
- **Velocidad limitada por el reproductor**: si librqbit bajara solo al ritmo del stream, `real` sería cota inferior.
  Supuesto (no verificado): el archivo seleccionado baja completo y el lookahead solo prioriza. Si es falso, censurar también
  cuando `real ≤ 1,2·need`.
- **Archivos chicos en red rápida** terminan antes del min 2 (1,4 GB a 55 Mbps ≈ 3,4 min): caen en ventana corta o la
  ventana completa queda corta; `progress < 0.95` corta el endgame.
- Red `null` (test todavía sin responder): las muestras sin red se toman como de la red actual (regla existente).
- localStorage borrado = se pierde lo aprendido (igual que hoy).

## 9. Decisiones
Cerradas en este spec: localStorage (no `LibraryEntry`); factor multiplicativo en log por evidencia; ventana min 2–5 con
corta a medio peso; mediana ponderada + contracción `PRIOR_N = 2` + vida media 30 días; sin estratificar por resolución;
las mediciones del análisis (`live`) dejan de contar como "lo real".
Abiertas:
- **D-A1** Constantes (`PRIOR_N`, vida media, 0,85·link, clamp ln 4/ln 20): elegidas a ojo; revisar con n ≥ 15.
- **D-A2** Unificar con /Users/monti/Documents/Dev/streamonte/crates/core/src/playback/calibration.rs (global, sin red, misma
  idea para el semáforo de *Mis magnets*): ¿mover allí la red o borrar uno? Fuera de alcance.
- **D-A3** Mostrar salud con base "tracker" (sin conteo) cuando `bias.tracker.nEff ≥ 5` y la fidelidad da `ok`: hoy no se
  muestra (hallazgo 1). Cambia el orden y los íconos: decisión de producto.
- **D-C3** Estratificar por resolución/fuente: con n ≥ 30 por red; el campo `res` ya queda guardado.

## 10. Estimación
varios módulos (3 JS + 3 Rust triviales) · media (estadística simple, estado por reproducción, migración al leer) ·
investigar (cuántas reproducciones por red llegan a la ventana; si el stream limita la descarga; magnitud del sesgo de selección).

## 11. Relación con otras ideas
- **3 (medición con tope)**: produce la evidencia `measured` más seguido; este spec aprende su `k_measured` (cuánto sube
  la medición corta al reproducir). Complementarias.
- **5 (extrapolar crecimiento)**: `real_peers`/`real_seeds` en min 2–5 son el "a 3 min" que 5 debe predecir: estas muestras
  le sirven de verdad de referencia para ajustar τ por red.
- **8 (rango X–Y)**: la dispersión de `r` por evidencia (MAD de la mediana ponderada) da el ancho del rango; `fidelity` es
  la métrica para decir si el rango está calibrado.
