# Spec 05 — Extrapolar el crecimiento del enjambre (curva de peers → 3 min)

_2026-11-16 · solo diseño, código sin tocar · ejecutor: sesión fresca de Claude Code. Contexto y reglas: /Users/monti/Documents/Dev/streamonte/docs/plans/salud-fiel/00-contexto.md._

## Veredicto (leer primero)
Sirve, pero **no por lo que parece**. El sesgo constante "análisis ve menos que reproducción" ya lo absorbe la calibración por red (`seedMbps` = mediana de sostenido ÷ seeders contados, /Users/monti/Documents/Dev/streamonte/ui/src/health-calib.js:85): multiplicar todos los conteos por un K no cambia nada. Lo que la curva aporta es:
1. **Ventana más corta**: contar 20 s en vez de 45–85 s tras los metadatos y proyectar (ahorro ≈ 25–65 s por tanda, 2 tandas para 15 torrents).
2. **Menos varianza por torrent**: distingue al que a los 20 s sigue subiendo del que ya se aplanó.
Todo queda detrás de compuertas automáticas por red: si los datos no muestran que la proyección dispersa menos que el conteo crudo, la app se comporta igual que hoy.

## Instrucciones para el ejecutor
- Tareas EN ORDEN; marcá el checkbox al terminar cada una. Si el "estado actual" no coincide con el código, FRENÁ y reportá.
- Verificación después de cada tarea; si falla, un intento de arreglo y si no, frená.
- Sin commits, sin dependencias nuevas, sin tests nuevos salvo el `selfCheck()` de T3.

## Qué serie temporal hay hoy (verificado)
| Fuente | Qué da | Dónde | Límite |
|---|---|---|---|
| Metadatos del análisis | direcciones de la DHT (`Waiting::Metadata{peers}`), 1/s | /Users/monti/Documents/Dev/streamonte/crates/core/src/analyzer/swarm.rs:159-183, /Users/monti/Documents/Dev/streamonte/crates/core/src/engine/rqbit.rs:424-429 | direcciones, no conexiones; no sirve para seeders (sin metadatos no se sabe quién está completo). Solo como señal de muerto (ya existe, `DEAD_SECS`). |
| Conteo del análisis | `stats()` cada 1 s → `best` (máximo corrido de seeds y peers) | swarm.rs:203-221 | `progress(best)` **solo se emite cuando sube** (swarm.rs:211-216) → la UI recibe una escalera, sin timestamp. t = 0 en el `progress(best)` de swarm.rs:204 (metadatos listos). Tope `MAX_PEERS = 30` (swarm.rs:40): si peers ≈ 30 el aplanamiento es del tope, no del enjambre. Sin entrantes (ADR-30). |
| Eventos a la UI | `catalog-swarm-progress` / `catalog-swarm-counted` con `SwarmCount{seeds,peers,reached}` | /Users/monti/Documents/Dev/streamonte/crates/core/src/app.rs:597-605, /Users/monti/Documents/Dev/streamonte/ui/src/catalog.js:1707-1721 | hoy no se guardan; `liveCount` se borra al terminar. |
| Reproducción | `Stats` cada 1 s → `PlaybackRow{peers, incoming_peers}` → evento `playback-updated` | /Users/monti/Documents/Dev/streamonte/crates/core/src/playback/flow.rs:297-307 (y fondo :390-397) | **`PlaybackRow` no lleva `seeds`** (Stats sí, /Users/monti/Documents/Dev/streamonte/crates/core/src/engine/mod.rs:215). Arranca con los peers que dejó el análisis (`initial_peers`, engine/mod.rs:365) y con entrantes + 100 conexiones: otra curva. La UI solo guarda el máximo de peers/entrantes (health-calib.js:111-112). |

**Qué falta registrar**: (a) la serie del conteo (eventos con timestamp de la UI, por red) — enseña τ; (b) la serie seeds/peers/entrantes por segundo de los primeros 5 min de cada reproducción — valida el horizonte de 3 min y alimenta la idea 4. Dónde: `localStorage['streamonte.swarmcurve']` por red (`{[red]: {analysis: [{at, pts}], plays: [{hash, at, t[], seeds[], peers[], incoming[]}]}}`), clave aparte de `streamonte.health` para que "Olvidar mediciones" (`resetCalibration`, health-calib.js:147, que guarda `{since}` y borra todo lo demás) no borre τ: τ es propiedad de la red, no un sesgo de mediciones. Tamaño: ≤ 40 series × ~90 puntos + 30 × 300 × 3 enteros ≈ 150 KB.

## Método de ajuste
Modelo (máximo corrido de conectados, t en s desde metadatos):  n(t) = n0 + A·(1 − e^(−t/τ)).
- n0 = primer valor (la conexión que dio los metadatos ya cuenta). Serie remuestreada a 1 punto/s en escalera.
- **τ fijo por red → A cerrado** (mínimos cuadrados): fᵢ = 1 − e^(−tᵢ/τ);  A = max(0, Σ(nᵢ − n0)·fᵢ / Σfᵢ²).
- Proyección: n̂(180) = clamp(n0 + A·(1 − e^(−180/τ)),  mín = máximo visto,  máx = 3·(máximo visto + 1)).
- Por qué τ fijo y no libre con 20 s: si τ ≫ 20 s la curva todavía es recta y solo se identifica la pendiente A/τ; N y τ por separado no. Aprender τ de series largas resuelve eso.
- **Aprender τ** (series de conteo completo, ≥ 45 s): grilla τ ∈ {5·√2ᵏ, k = 0..10} = 5…160 s; para cada τ, A cerrado y SSE; gana el SSE mínimo. Informativa solo si A ≥ 3 y τ ≤ T/1,5 (si no, la serie fue plana o seguía recta: no enseña nada). Se usa la serie de **peers** (enteros más grandes, menos ruido) y se descartan las que tocaron el tope (peers máx ≥ 27). τ_red = mediana de los informativos; hacen falta ≥ 5.
- Casos degenerados: 0 peers todo el tiempo → A = 0 → 0 (igual que hoy). Plana → se queda en lo visto. < 8 puntos → sin proyección (se usa el conteo crudo). Tope de conexiones → `capped`, se muestra "+". Salto de 1 seeder ruidoso → acotado por 3·(máx+1).

**Ejemplo** (verificado con Node): enjambre real n0 = 2, N = 12, τ = 40 s. Serie entera vista en 0..20 s: `2,2,2,3,3,3,3,4,4,4,4,4,5,5,5,5,5,5,6,6,6`. Con τ = 40: A = 10,0 → n̂(180) = 2 + 10,0·0,989 = **11,9** (real 11,9; a los 85 s el conteo actual vería 11). Con τ errado ±41 % (28 / 57 s): 9,6 / 14,9 → error −19 % / +25 %. La grilla sobre la serie de 85 s devuelve τ = 40 exacto.

## Cómo entra en la salud y el orden
- `health(c)` (/Users/monti/Documents/Dev/streamonte/ui/src/catalog.js:702): si `basis === 'counted'`, la red tiene la curva validada (`cal.useCurve`) y hay proyección del torrent → `supply = (Ŝ + max(0, P̂ − Ŝ)/6) · projSeedMbps`. Si no, idéntico a hoy. `sortOptions` (catalog.js:485) usa `health` → el orden cambia solo. `bySeeds`/`knownSeeds` siguen con lo contado (desempate y columna).
- **Calibración en la misma base**: `projSeedMbps` = mediana de sostenido ÷ Ŝ, con Ŝ recalculado al leer desde la serie guardada en cada muestra (`curve`) y el τ actual — sin esto se corregiría dos veces.
- **Análisis sin entrantes vs reproducción con entrantes**: la proyección predice lo que vería el motor del análisis (30 conexiones, sin entrantes) a los 3 min. El salto a reproducción (entrantes, 100 conexiones, `initial_peers`) es multiplicativo por red y lo absorbe `projSeedMbps` (calibrado por red, health-calib.js:19-21). Si se implementa la idea 4, su factor debe aprenderse con la salud **ya proyectada** y reemplaza a ese ajuste; no aplicar ambos sobre la misma magnitud.
- Compuertas (todas automáticas, por red): G1 ≥ 5 τ informativos; G2 mediana |ln((proyección desde 20 s al final + 1)/(final real + 1))| ≤ 0,3 en las series largas; G3 ≥ 3 reproducciones con serie y la dispersión (IQR) de ln(sostenido ÷ Ŝ) ≤ la de ln(sostenido ÷ seeders contados). G1+G2+G3 → `useCurve`. `useCurve` + serie larga de < 14 días → ventana corta. Si no hay serie larga reciente, el próximo análisis cuenta completo (re-aprende).

## Cuánto se acorta y con qué error
- Conteo tras metadatos: hoy `WINDOW_DEEP = (45, 85, 25)` (swarm.rs:46) → 45–85 s; con curva: 20 s fijos (`WINDOW`, swarm.rs:45, hoy **sin uso**: la UI siempre pide `deep = true`, catalog.js:1016). Ahorro 25–65 s por tanda; 15 torrents con `CONCURRENCY = 10` = 2 tandas → el análisis pasa de "1 a 4 min" a "1 a 2 min".
- Metadatos (35–90 s según novedades, swarm.rs:30-32): **no se acortan** con esta idea (antes de metadatos no hay seeders que contar). Eso es terreno de la idea 1.
- Error esperado: τ dentro de ±40 % → ±20–25 % en Ŝ; con Ŝ ≤ 5 domina el ruido entero (±1–2 seeders). Umbral aceptado G2 ≤ 0,3 (≈ ±35 %). Incierto hasta tener datos: si la llegada de peers no es exponencial (p. ej. tandas de tracker cada 30 min, o PEX en escalones), G2 falla y la curva nunca se activa.

## Diseño
- Ajuste en la **UI** (JS, sin dependencias): la red (hash del test de velocidad), la calibración y el guardado ya viven ahí; los eventos ya llegan. Rust solo: ventana corta y `seeds` en la fila de reproducción.
- Archivo nuevo /Users/monti/Documents/Dev/streamonte/ui/src/swarm-curve.js (puro salvo localStorage; no importa nada): `resample(pts, upTo) → {seeds[], peers[]}`, `fitRise(x, tau) → {n0, a}`, `extrapolate(x, tau, horizon) → number`, `project(pts, tau) → {seeds, peers, capped} | null`, `learnTau(x) → number | null`, `recordAnalysis(net, pts)`, `notePlayRow(net, row)`, `curveState(net) → {tau, taus, err, ok, fresh}`, `selfCheck() → 'ok'`.
- UI: sin controles nuevos. Tooltip del ícono de salud existente (`cat-health-${hash}`) dice "N contados → ~M proyectados a 3 min"; una línea en el popover Tu conexión con `id="speed-swarm-curve"`.

## Paso 0 — datos (criterio; corre solo, sin decisión humana)
La Fase A no cambia comportamiento y junta datos con el análisis actual (ventana larga). La curva se activa sola cuando G1+G2+G3 pasan. Revisión manual a las ~2 semanas de uso (o 10 análisis + 5 reproducciones de 5 min en una red), en la consola de la app:
```js
const m = await import('./swarm-curve.js'); const net = Object.keys(JSON.parse(localStorage['streamonte.swarmcurve']))[0]; m.curveState(net)
```
Reglas fijas: (1) si `taus ≥ 5` y `err > 0,3` → la forma no es exponencial: dejar la idea (no tocar constantes). (2) Con las `plays` guardadas: mediana de seeds(180 s)/seeds(300 s); si < 0,85 → `HORIZON_SECS = 300` (a los 3 min todavía crece). (3) Si nunca hay ≥ 5 τ informativos (casi todas planas antes de 45 s) → la ventana ya es demasiado larga para lo que hay: bajar `WINDOW_DEEP` (decisión abierta, fuera de este spec).

## Tareas

### Fase A — registro (sin cambio de comportamiento)

### [ ] T1 — `seeds` en la fila de reproducción (Rust)
**Archivos/anclas:**
- /Users/monti/Documents/Dev/streamonte/crates/core/src/playback.rs:91-94 — después de `pub peers: u32,` agregar:
```rust
    /// De esos, los que tienen el archivo completo: ver `Stats::seeds` (serie del enjambre, idea 5).
    pub seeds: u32,
```
- playback.rs:324 (`peers: 0,` dentro de `PlaybackRow { … FetchingMetadata …`) y /Users/monti/Documents/Dev/streamonte/crates/core/src/playback/kept.rs:232 (`peers: 0,`): agregar debajo `seeds: 0,`.
- /Users/monti/Documents/Dev/streamonte/crates/core/src/playback/flow.rs:303 y :395 (`row.peers = stats.peers;`): agregar debajo `row.seeds = stats.seeds;`.
**Verificación:** `cargo build -p streamonte-core && cargo build -p streamonte` (crate de /Users/monti/Documents/Dev/streamonte/src-tauri/) → compila; `grep -n "row.seeds = stats.seeds" /Users/monti/Documents/Dev/streamonte/crates/core/src/playback/flow.rs` → 2 líneas.

### [ ] T2 — `currentNetwork` en health-calib
**Archivo:** /Users/monti/Documents/Dev/streamonte/ui/src/health-calib.js, después de `setLinkMbps` (línea 26):
```js
/** Red actual (o null): la usa la curva del enjambre (`swarm-curve.js`), que guarda por red. */
export const currentNetwork = () => network;
```
**Verificación:** `node --check /Users/monti/Documents/Dev/streamonte/ui/src/health-calib.js` → sin salida.

### [ ] T3 — Módulo /Users/monti/Documents/Dev/streamonte/ui/src/swarm-curve.js (nuevo, completo)
```js
// Curva del enjambre (idea 5, 2026-11-16): los peers conectados crecen y se aplanan (DHT, trackers y
// PEX los van dando). Con los primeros `FIT_SECS` del conteo se ajusta n(t) = n0 + A·(1 − e^(−t/τ)) con
// τ aprendido por red y se proyecta a `HORIZON_SECS`. Puro salvo el guardado (localStorage, por red).

const KEY = 'streamonte.swarmcurve';
/** Segundos de conteo (desde metadatos) que usa la proyección; = `WINDOW` en swarm.rs. */
export const FIT_SECS = 20;
/** A cuánto se proyecta: ~3 min, cuando una reproducción ya juntó casi todo lo que va a ver. */
export const HORIZON_SECS = 180;
/** τ mientras la red no tiene uno aprendido (solo para las muestras de calibración; la salud no lo usa). */
export const DEFAULT_TAU = 40;
/** τ candidatos: 5 s a 160 s, ×√2. */
const TAU_GRID = Array.from({ length: 11 }, (_, k) => 5 * Math.SQRT2 ** k);
/** Menos puntos que esto: no se proyecta. */
const MIN_POINTS = 8;
/** Tope de la proyección: `MAX_GROWTH`·(máximo visto + 1). Con τ = 40 el ajuste da ~2,5× lo visto a 20 s. */
const MAX_GROWTH = 3;
/** Una serie larga enseña τ si duró al menos esto. */
const LEARN_MIN_SECS = 45;
/** τ informativos para usar la curva en la red. */
const MIN_TAUS = 5;
/** Error típico máximo (mediana de |ln((pred+1)/(real+1))|) de proyectar desde 20 s el final de las series largas. */
const MAX_ERR = 0.3;
/** Sin series largas más nuevas que esto, el próximo análisis vuelve a contar completo. */
const RELEARN_DAYS = 14;
const KEEP_ANALYSIS = 40;
const KEEP_PLAYS = 30;
const PLAY_SECS = 300;
/** 90 % de `MAX_PEERS` (30) de swarm.rs: tocó el tope de conexiones, el aplanamiento no es del enjambre. */
export const PEER_CAP = 27;

const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor((s.length - 1) / 2)]; };

/** Eventos `[[t, seeds, peers]]` (t en s desde metadatos, en orden) → un valor por segundo 0..T (escalera). */
export function resample(pts, upTo = Infinity) {
  const seeds = []; const peers = [];
  if (!pts.length) return { seeds, peers };
  const T = Math.floor(Math.min(upTo, pts[pts.length - 1][0]));
  let i = 0;
  for (let t = 0; t <= T; t++) {
    while (i + 1 < pts.length && pts[i + 1][0] <= t) i++;
    seeds.push(pts[i][1]); peers.push(pts[i][2]);
  }
  return { seeds, peers };
}

/** Mínimos cuadrados de A con τ fijo (cerrado): A = Σ(nᵢ − n0)·fᵢ / Σfᵢ², fᵢ = 1 − e^(−i/τ); A ≥ 0. */
export function fitRise(x, tau) {
  const n0 = x[0];
  let num = 0; let den = 0;
  x.forEach((n, t) => { const f = 1 - Math.exp(-t / tau); num += (n - n0) * f; den += f * f; });
  return { n0, a: den > 0 ? Math.max(0, num / den) : 0 };
}

/** Valor a `horizon` s de la serie por segundo `x`; nunca menos que lo visto ni más que el tope. */
export function extrapolate(x, tau, horizon = HORIZON_SECS) {
  const { n0, a } = fitRise(x, tau);
  const max = Math.max(...x);
  return Math.min(Math.max(n0 + a * (1 - Math.exp(-horizon / tau)), max), MAX_GROWTH * (max + 1));
}

/** Proyección a 3 min con los primeros `FIT_SECS`: `{seeds, peers, capped}` o null (serie corta). */
export function project(pts, tau) {
  const { seeds, peers } = resample(pts, FIT_SECS);
  if (seeds.length < MIN_POINTS) return null;
  const s = extrapolate(seeds, tau);
  return { seeds: s, peers: Math.max(extrapolate(peers, tau), s), capped: Math.max(...peers) >= PEER_CAP };
}

/** τ de una serie larga por grilla (SSE mínimo con A cerrado); null si no es informativa: subió
 *  menos de 3 o seguía casi recta (τ mayor que 2/3 de lo que duró). */
export function learnTau(x) {
  let best = null;
  for (const tau of TAU_GRID) {
    const { n0, a } = fitRise(x, tau);
    const sse = x.reduce((acc, n, t) => acc + (n - n0 - a * (1 - Math.exp(-t / tau))) ** 2, 0);
    if (!best || sse < best.sse) best = { sse, tau, a };
  }
  return best.a >= 3 && best.tau <= (x.length - 1) / 1.5 ? best.tau : null;
}

function load() {
  try { return JSON.parse(localStorage.getItem(KEY)) ?? {}; } catch { return {}; }
}
function save(v) {
  try { localStorage.setItem(KEY, JSON.stringify(v)); } catch { /* sin almacenamiento */ }
}

/** Guarda una serie de conteo completo (≥ `LEARN_MIN_SECS`) de la red `net`: enseña τ. */
export function recordAnalysis(net, pts) {
  if (!net || !pts.length || pts[pts.length - 1][0] < LEARN_MIN_SECS) return;
  const all = load();
  const n = all[net] ?? {};
  all[net] = { ...n, analysis: [{ at: Date.now(), pts }, ...(n.analysis ?? [])].slice(0, KEEP_ANALYSIS) };
  save(all);
}

/** Reproducciones en curso: row.id → serie por segundo de los primeros `PLAY_SECS`. */
const plays = new Map();
/** Cada fila de reproducción (~1 s): junta seeds/peers/entrantes y, al pasar los 5 min, la guarda
 *  (solo datos para validar el horizonte y la idea 4; no entra en la salud). */
export function notePlayRow(net, row) {
  if (!net || !['playing', 'background'].includes(row.state.kind)) return;
  const t = Math.round((Date.now() - Date.parse(row.started_at)) / 1000);
  let p = plays.get(row.id);
  if (!p) { p = { hash: row.info_hash, at: Date.now(), t: [], seeds: [], peers: [], incoming: [], saved: false }; plays.set(row.id, p); }
  if (p.saved) return;
  if (t <= PLAY_SECS) {
    p.t.push(t); p.seeds.push(row.seeds ?? 0); p.peers.push(row.peers ?? 0); p.incoming.push(row.incoming_peers ?? 0);
    return;
  }
  p.saved = true;
  const all = load();
  const n = all[net] ?? {};
  const { saved, ...serie } = p;
  all[net] = { ...n, plays: [serie, ...(n.plays ?? [])].slice(0, KEEP_PLAYS) };
  save(all);
}

/** Estado de la red: `tau` (mediana de los informativos, null con menos de `MIN_TAUS`), `taus`,
 *  `err` (mediana del error de proyectar desde 20 s el final de cada serie larga), `ok` (se puede
 *  usar) y `fresh` (hay una serie larga de los últimos `RELEARN_DAYS`). */
export function curveState(net) {
  const series = net ? load()[net]?.analysis ?? [] : [];
  const taus = series.map((s) => resample(s.pts).peers)
    .filter((p) => Math.max(...p) < PEER_CAP).map(learnTau).filter(Boolean);
  const tau = taus.length >= MIN_TAUS ? median(taus) : null;
  const errs = tau ? series.map((s) => {
    const { seeds } = resample(s.pts);
    const T = seeds.length - 1;
    return Math.abs(Math.log((extrapolate(seeds.slice(0, FIT_SECS + 1), tau, T) + 1) / (seeds[T] + 1)));
  }) : [];
  const err = errs.length ? median(errs) : null;
  const fresh = series.length > 0 && Date.now() - series[0].at < RELEARN_DAYS * 864e5;
  return { tau, taus: taus.length, err, ok: tau != null && err <= MAX_ERR, fresh };
}

/** Self-check con series sintéticas (Node: `node -e "import('…/swarm-curve.js').then((m) => m.selfCheck())"`). */
export function selfCheck() {
  const assert = (ok, msg) => { if (!ok) throw new Error(`swarm-curve: ${msg}`); };
  const ser = (n0, N, tau, T) => { const o = []; let b = 0; for (let t = 0; t <= T; t++) { b = Math.max(b, Math.round(n0 + (N - n0) * (1 - Math.exp(-t / tau)))); o.push(b); } return o; };
  const pts = (x) => x.map((n, t) => [t, n, n + 2]);
  const s = ser(2, 12, 40, 85); // n0 = 2, N = 12, τ = 40: a los 180 s ≈ 11,9
  const p = project(pts(s), 40);
  assert(p && p.seeds > 11.5 && p.seeds < 12.3, `proyección τ=40 dio ${p?.seeds}`);
  assert(project(pts(s), 40 * Math.SQRT2).seeds < 15.5, 'τ +41 % debería errar < +30 %');
  assert(Math.abs(learnTau(s) - 40) < 1, `learnTau dio ${learnTau(s)}`);
  assert(Math.abs(learnTau(ser(1, 8, 7, 85)) - 5 * Math.SQRT2) < 0.1, 'τ rápido');
  assert(learnTau(Array(86).fill(3)) === null, 'plana no enseña τ');
  assert(learnTau(ser(0, 60, 300, 85)) === null, 'todavía recta no enseña τ');
  assert(project(pts(Array(21).fill(3)), 40).seeds === 3, 'plana se queda');
  assert(project(pts(Array(21).fill(0)), 40).seeds === 0, 'cero se queda en cero');
  assert(project(pts(ser(0, 60, 300, 20)), 160).seeds <= 15, 'tope MAX_GROWTH');
  assert(project([[0, 0, 0], [5, 1, 1]], 40) === null, 'serie corta: null');
  assert(project(pts(Array(21).fill(28)), 40).capped, 'tope de conexiones');
  assert(resample([[0, 0, 0], [2.4, 3, 5], [4, 4, 6]]).seeds.join() === '0,0,0,3,4', 'escalera');
  return 'ok';
}
```
**Verificación:** `node --check /Users/monti/Documents/Dev/streamonte/ui/src/swarm-curve.js && node -e "import('/Users/monti/Documents/Dev/streamonte/ui/src/swarm-curve.js').then((m) => console.log(m.selfCheck()))"` → `ok` (el selfCheck cubre: proyección del ejemplo ≈ 11,9, τ errado, aprender τ = 40 y τ rápido, plana, cero, todavía recta, tope `MAX_GROWTH`, serie corta, tope de conexiones y escalera).

### [ ] T4 — `curve` en las muestras de calibración
**Archivo:** /Users/monti/Documents/Dev/streamonte/ui/src/health-calib.js
- Línea 97, firma: `export function trackPlayback(row, seeds, trackerSeeds, trackerLeechers) {` → `export function trackPlayback(row, seeds, trackerSeeds, trackerLeechers, curve = null) {`
- Después de `t.tracker_leechers = trackerLeechers ?? null;` (línea 102) agregar: `t.curve = curve; // serie del conteo (idea 5): la proyección se recalcula con el τ vigente`
- Línea 136, en el objeto `sample`, después de `real_peers: t.real_peers,` agregar `curve: t.curve,`.
**Verificación:** `node --check /Users/monti/Documents/Dev/streamonte/ui/src/health-calib.js` → sin salida.

### [ ] T5 — Registrar las series en el catálogo
**Archivo:** /Users/monti/Documents/Dev/streamonte/ui/src/catalog.js
1. Imports (línea 11): reemplazar por
```js
import { MIN_SECS, currentNetwork, healthCalibration, speedOf, trackPlayback } from './health-calib.js';
import { DEFAULT_TAU, FIT_SECS, curveState, notePlayRow, project, recordAnalysis } from './swarm-curve.js';
```
2. Después de `const liveCount = new Map();` (línea 649):
```js
/** Serie del conteo (idea 5): hash → {t0, pts: [[t, seeds, peers]]}, t en s desde metadatos. */
const curves = new Map();
/** Proyección a 3 min de lo contado en esta sesión (`swarm-curve.js`): hash → {seeds, peers, capped}. */
const projected = new Map();
/** Un punto: el primero con metadatos es t = 0 (el núcleo avisa solo cuando sube: escalera). */
function notePoint(hash, n) {
  const now = performance.now();
  if (!curves.has(hash)) curves.set(hash, { t0: now, pts: [] });
  const cv = curves.get(hash);
  cv.pts.push([Math.round((now - cv.t0) / 100) / 10, n.seeds, n.peers]);
}
/** Fin del conteo: cierra la serie, la guarda si fue completa (enseña τ) y proyecta. */
function finishCurve(hash, n) {
  notePoint(hash, n);
  const { pts } = curves.get(hash);
  recordAnalysis(currentNetwork(), pts);
  const p = project(pts, curveState(currentNetwork()).tau ?? DEFAULT_TAU);
  if (p) projected.set(hash, p);
}
```
3. `countSeeds` (línea 1012): `todo.forEach((h) => counting.add(h));` → `todo.forEach((h) => { counting.add(h); curves.delete(h); projected.delete(h); });`
4. Handler de eventos: en `case 'catalog-swarm-progress':` después de `liveCount.set(event.hash, event.count);` (línea 1712) agregar `if (event.count.reached) notePoint(event.hash, event.count);`. En `case 'catalog-swarm-counted':` como primera línea (antes de `counted.set(event.hash, event.count);`, línea 1716) agregar `if (event.count.reached && curves.has(event.hash)) finishCurve(event.hash, event.count);`.
5. `measurePlayback` (línea 757): `trackPlayback(row, counted.get(hash)?.seeds, c && seedsOf(c), c?.leechers);` → 
```js
  trackPlayback(row, counted.get(hash)?.seeds, c && seedsOf(c), c?.leechers, curves.get(hash)?.pts ?? null);
  notePlayRow(currentNetwork(), row);
```
**Verificación:** `node --check /Users/monti/Documents/Dev/streamonte/ui/src/catalog.js` → sin salida. En la app (`cargo tauri dev` desde /Users/monti/Documents/Dev/streamonte/src-tauri/): analizar un título; al terminar, en la consola `JSON.parse(localStorage['streamonte.swarmcurve'])` muestra `analysis` con series de t final ≥ 45; reproducir > 5 min agrega una entrada en `plays` con `seeds` no todo cero. La salud y el orden se ven igual que antes.

### Fase B — usar la curva (detrás de las compuertas)

### [ ] T6 — `useCurve` y `projSeedMbps` en la calibración
**Archivo:** /Users/monti/Documents/Dev/streamonte/ui/src/health-calib.js
1. Al principio (después del comentario de cabecera, antes de `export const DEFAULT_SEED_MBPS`): `import { DEFAULT_TAU, curveState, project } from './swarm-curve.js';`
2. Después de `const median = …` (línea 57): 
```js
/** Rango intercuartil: cuánto se dispersa una serie (compuerta G3 de la curva del enjambre). */
const spread = (xs) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(((s.length - 1) * 3) / 4)] - s[Math.floor((s.length - 1) / 4)]; };
```
3. En `healthCalibration`: después de `const cfg = load();` agregar `const curve = curveState(network);`. La línea `const base = { capMbps, capFrom, n, trackerN: tracked.length, samples };` → `const base = { capMbps, capFrom, n, trackerN: tracked.length, samples, tau: curve.tau, taus: curve.taus, useCurve: false, projSeedMbps: null };`
4. Reemplazar las dos últimas líneas de `healthCalibration` (`const seedMbps = median(…);` y su `return`) por:
```js
  const seedMbps = median(counted.map((l) => sustainedMbps(l) / l.seeds));
  // Curva del enjambre (idea 5): solo con τ validado en esta red y si, en las mismas reproducciones,
  // lo sostenido ÷ seeders proyectados dispersa menos que ÷ seeders contados.
  const proj = counted.filter((l) => l.curve && sustainedMbps(l) > 0)
    .map((l) => ({ l, s: project(l.curve, curve.tau ?? DEFAULT_TAU)?.seeds }))
    .filter((x) => x.s > 0);
  const useCurve = curve.ok && proj.length >= MIN_SAMPLES
    && spread(proj.map(({ l, s }) => Math.log(sustainedMbps(l) / s))) <= spread(proj.map(({ l }) => Math.log(sustainedMbps(l) / l.seeds)));
  const projSeedMbps = useCurve ? median(proj.map(({ l, s }) => sustainedMbps(l) / s)) : null;
  return { ...base, seedMbps, trackerSeedMbps: trackerSeedMbps ?? seedMbps, source: 'measured', useCurve, projSeedMbps };
```
**Verificación:** `node --check …/health-calib.js` → sin salida; `grep -c "useCurve" /Users/monti/Documents/Dev/streamonte/ui/src/health-calib.js` → 4.

### [ ] T7 — La salud usa lo proyectado
**Archivo:** /Users/monti/Documents/Dev/streamonte/ui/src/catalog.js, `health` (líneas 702-723).
- Reemplazar `const perSeed = basis === 'tracker' ? cal.trackerSeedMbps : cal.seedMbps;` por:
```js
  // Curva del enjambre (idea 5): con la curva validada en esta red, lo contado se reemplaza por lo
  // proyectado a 3 min, con su propio aporte calibrado (misma base: no se corrige dos veces).
  const proj = basis === 'counted' && cal.useCurve ? projected.get(c.info_hash) ?? null : null;
  const perSeed = proj ? cal.projSeedMbps : basis === 'tracker' ? cal.trackerSeedMbps : cal.seedMbps;
```
- `const raw = (seeds + leech * LEECH_SHARE) * perSeed;` → `const raw = proj ? (proj.seeds + Math.max(0, proj.peers - proj.seeds) * LEECH_SHARE) * perSeed : (seeds + leech * LEECH_SHARE) * perSeed;`
- En el `return { … }` agregar `proj` al final del objeto.
- `healthBadge` (línea 728): agregar `proj` al destructuring. En `tipText`, rama no medida, reemplazar el segmento `${seeds} ${basis === 'tracker' ? 'seeders de trackers' : 'seeders contados'} y ${leech} leechers × ${nf1(perSeed)} Mbps por seeder${internet}.` por:
```js
${proj ? `${seeds} seeders contados → ~${Math.round(proj.seeds)}${proj.capped ? '+' : ''} a los 3 min (curva del enjambre, τ ≈ ${Math.round(cal.tau)} s) × ${nf1(perSeed)} Mbps por seeder proyectado` : `${seeds} ${basis === 'tracker' ? 'seeders de trackers' : 'seeders contados'} y ${leech} leechers × ${nf1(perSeed)} Mbps por seeder`}${internet}.
```
**Verificación:** `node --check …/catalog.js` → sin salida. Con `useCurve` falso (sin datos), la app se ve idéntica.

### [ ] T8 — Ventana corta desde la UI
**Archivo:** /Users/monti/Documents/Dev/streamonte/ui/src/catalog.js
- Línea 1047 `const DEEP_ETA = '1 a 4 min'; // …` → 
```js
/** Conteo corto (idea 5): 20 s + proyección, solo con la curva validada en esta red y una serie
 *  larga de menos de 14 días (si no, se cuenta completo y se re-aprende τ). */
function shortWindow() {
  return !!(renderCal ?? healthCalibration(state.library.values())).useCurve && curveState(currentNetwork()).fresh;
}
const deepEta = () => (shortWindow() ? '1 a 2 min' : '1 a 4 min'); // 10 a la vez: metadatos hasta 90 s + conteo de 20 s (corto) o hasta 85 s
```
- Línea 600: `${DEEP_ETA}` → `${deepEta()}`.
- Línea 1016: `await api.catalogSwarm(todo, true);` → `await api.catalogSwarm(todo, !shortWindow());`
**Verificación:** `grep -n "DEEP_ETA" /Users/monti/Documents/Dev/streamonte/ui/src/catalog.js` → nada; `node --check` sin salida.

### [ ] T9 — `WINDOW` = 20 s (Rust)
**Archivo:** /Users/monti/Documents/Dev/streamonte/crates/core/src/analyzer/swarm.rs:41-45. Reemplazar el comentario y `const WINDOW: (u64, u64, u64) = (12, 25, 8);` por:
```rust
/// Ventana de conteo una vez que hay metadatos (máximo visto): `(mínimo, máximo, estable)` en
/// segundos. Profundo: sigue mientras aparezcan peers nuevos hasta 85 s (o corta tras 25 s sin
/// subir); enseña la curva del enjambre. Corto (idea 5, 2026-11-16): 20 s fijos y la UI proyecta a
/// 3 min (`ui/src/swarm-curve.js`, `FIT_SECS` = 20); la UI lo pide solo con la curva validada en la red.
const WINDOW: (u64, u64, u64) = (20, 20, 20);
```
**Verificación:** `cargo build -p streamonte-core` → compila; `cargo test -p streamonte-core` → mismo resultado que antes del cambio.

### [ ] T10 — Línea en Tu conexión
**Archivo:** /Users/monti/Documents/Dev/streamonte/ui/src/speed.js, en `how`, línea 112. El final de esa línea es `` (casa, trabajo…).`)); `` (cierra el `p` y el `div`). Reemplazar ese `));` final por `),` y agregar debajo:
```js
    el('p', { id: 'speed-swarm-curve', class: 'hint' }, cal.tau
      ? `Curva del enjambre: τ ≈ ${Math.round(cal.tau)} s (${cal.taus} análisis)${cal.useCurve ? ' · se proyecta a 3 min y el análisis cuenta 20 s' : ' · todavía no mejora la salud: se cuenta completo'}.`
      : 'Curva del enjambre: aprendiendo de los análisis (hacen falta 5 que suban y se aplanen).'));
```
**Verificación:** `node --check /Users/monti/Documents/Dev/streamonte/ui/src/speed.js` → sin salida; en la app, el popover muestra la línea.

## Verificación final
1. `cargo build -p streamonte-core && cargo build -p streamonte && cargo test -p streamonte-core` → ok.
2. `node -e "import('/Users/monti/Documents/Dev/streamonte/ui/src/swarm-curve.js').then((m) => console.log(m.selfCheck()))"` → `ok`.
3. App sin datos de curva: análisis igual que hoy (1 a 4 min), salud y orden iguales, popover dice "aprendiendo".
4. Forzar compuertas (solo prueba manual, sin guardar código): en la consola, sembrar `streamonte.swarmcurve` con 5 series sintéticas de 85 s y verificar que `curveState(red).ok === true`; luego `localStorage.removeItem('streamonte.swarmcurve')`.

## Riesgos
- **La llegada de peers no es exponencial** (anuncios de tracker cada 15–30 min, PEX en escalones): G2 falla y no se activa. Costo hundido: Fase A.
- **Evaluación optimista**: G2 usa el mismo τ aprendido de esas series (in-sample). Con 40 series el sesgo es chico; aceptado.
- **Timestamps de la UI**: el t sale de la llegada del evento (IPC, render) — error de ~0,1–0,5 s; irrelevante frente a τ ≈ decenas de s.
- **Máximo corrido**: con ruido sube más de lo real (un seeder que entra y sale cuenta). Mismo sesgo en todas las series: lo absorbe `projSeedMbps`.
- **Tope de 30 conexiones**: en torrents grandes la curva se aplana por el tope → `capped`, "+" en el tooltip; la salud ahí ya suele ser buena.
- **Columna de seeders más baja en modo corto** (contó 20 s): el número de la fila baja aunque la salud no; el tooltip lo explica. Si molesta, decisión abierta.
- **Muestras viejas**: sin `curve` no participan de G3; la curva tarda ≥ 3 reproducciones nuevas en poder activarse.

## Decisiones abiertas
- Horizonte 180 s vs 300 s: lo decide la regla (2) del Paso 0.
- ¿Mostrar el número proyectado en la columna de seeders y no solo en el tooltip? (hoy: no).
- `resetCalibration` no borra la curva (τ es de la red). Si el usuario espera "olvidar todo", agregar `localStorage.removeItem('streamonte.swarmcurve')` ahí.
- Código existente que noté y no toco: `WINDOW` estaba sin uso (la UI solo pide `deep = true`); `resetCalibration` ya borra hoy el estado de entrantes por red (`net`) porque guarda solo `{since}` (health-calib.js:147) — probablemente no intencional.

## Estimación
Varios módulos (Rust core playback + swarm, UI catalog/health-calib/speed + módulo nuevo) · complejidad media (ajuste numérico simple; lo delicado es la coherencia de bases en la calibración y las compuertas) · **experimental**: no se sabe si la curva real es exponencial ni si 20 s alcanzan; lo resuelven los datos de la Fase A (2 semanas de uso). Fase A ≈ medio día; Fase B ≈ medio día.

## Relación con otras ideas
- **Idea 1 (anunciarse temprano)**: acorta los metadatos y cambia la curva (con entrantes τ baja y N sube) → τ se aprende por red y re-aprende cada 14 días; si la 1 cambia la mecánica, borrar `streamonte.swarmcurve` al activarla.
- **Idea 2 (salud en vivo)**: la vuelve innecesaria: si el motor sigue conectado minutos, no hace falta proyectar; la serie de `plays` sí le sirve.
- **Idea 4 (corrección aprendida)**: complementaria. Esta reduce la varianza por torrent; la 4 corrige el sesgo análisis→reproducción. La 4 debe aprender sobre la salud ya proyectada y reemplazar el rol de `projSeedMbps` como absorbente del sesgo, no sumarse. Las `plays` de T5 son su insumo.

## Reporte final
Una línea por tarea, resultado de cada verificación y todo lo que no coincidió con el spec (o "nada").
