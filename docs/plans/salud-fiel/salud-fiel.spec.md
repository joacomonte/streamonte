# SPEC — Salud fiel de magnets (`salud-fiel`) · integrado

_Generado el 2026-11-16 sobre el árbol de trabajo de /Users/monti/Documents/Dev/streamonte (con cambios sin commit). Integra los 8 specs parciales de /Users/monti/Documents/Dev/streamonte/docs/plans/salud-fiel/ (01–08) y los reemplaza: ante una contradicción manda ESTE archivo._

> Modo multi-agente en un solo archivo (pedido: escribir solo este spec). Los contratos van como código en §5, los work packages (WP) en cada fase con `owns`, modelo y effort, y el "checker" de cada WP es su bloque **Verificación** (comandos con salida esperada). No hay carpeta `salud-fiel.spec/` ni `check.py`: si el orquestador la quiere, la genera copiando §5 y los bloques de verificación tal cual.

## 0. Resumen

- **Problema**: el catálogo predice con un análisis más pobre que la reproducción (sin entrantes, 30 conexiones, 1–2 min en el enjambre, cuenta seeders en vez de medir Mbps) y con `3 Mbps por seeder` fijo hasta tener 3 mediciones → dice "Puede cortarse" a cosas que andan a 55 Mbps.
- **Fase 1 (barata, sin experimentos)**: cada reproducción compara lo que predijo el análisis con lo que bajó en sus minutos 2–5 y **aprende el sesgo por red y por evidencia** (idea 4); la salud se muestra **siempre como rango** "lo–hi Mbps · de dónde sale · confianza" con "Buena probable" cuando el p75 alcanza (idea 8). Más datos: `seeds` en la fila de reproducción, direcciones conocidas (`seen`, idea 7a), `completed`, log de velocidad por peer (idea 6).
- **Fase 2 (detrás de 2 experimentos)**: un **único motor de análisis por título** que arranca solo al abrirlo, **escucha y se anuncia** (idea 1) y **mide Mbps reales con tope 2,5× por torrent** en paralelo con presupuesto de ancho de banda (idea 3), ~60 s; peers rápidos como capa (idea 6). Al ▶ se apaga ordenado y la reproducción hereda puerto, DHT, peers, `.torrent` y lo bajado (FR-06d).
- **Fase 3 (experimental)**: censo DHT y tamaño del enjambre (idea 7b), curva de crecimiento (idea 5) solo si la sonda no alcanza.
- **Fase 4 (condicional)**: motor vivo minutos con re-sonda (idea 2) solo si tras la Fase 2 la fidelidad sigue < 75 %.
- Objetivo medible: nivel mostrado al tocar ▶ = nivel real (min 2–5) en ≥ 75 % y pesimistas ≤ 10 %, con resultado ≤ 60 s p50 desde abrir el título.

## 1. Arquitectura final

```
abrir título
  └─ catalog_streams → fuentes + scrape de trackers (hoy) ─┐
                                                            ▼
  [F1] salud inmediata por trackers: predict(ev, cal) → rango + "probable" + "sin calibrar"
                                                            │ update.done (grupo de resolución abierto)
                                                            ▼
  [F2] catalog_probe(top 10 del grupo) ── UN motor de análisis (analyzer/probe.rs)
        • escucha + UPnP + DHT persistente si engine.announce_early (idea 1; toma DhtLease si está libre)
        • .torrent en caché primero (sus entrantes no se pierden mientras resuelve)
        • metadatos (regla B26) → hold_peers → sonda: select_file con tope 2,5×pide (idea 3)
          presupuesto de ancho de banda (link) · ≤ 10×20 conexiones · ≤ 1,5 GB · corte duro 120 s
        • por segundo: seeds/peers/entrantes/seen (7a), bytes por peer (6) → eventos de progreso
        • cada 5 s save_peers; al final save_peers + lo bajado queda en analysis_dir (FR-06d)
                                                            ▼
  salud mostrada = predict(ev, cal): medición > sonda > max(contados, trackers) × sesgo aprendido (F1)
                                                            │ ▶ / ⤓ / Retomar
                                                            ▼
  notePrediction(hash, ev) (foto de lo mostrado) → stop_catalog_analysis(): cancela y espera ≤ 5 s
  (libera puerto, DhtLease, ancho de banda y la reserva de analysis_dir) → playback.start
  (create_for_playback: mismo primer puerto libre, initial_peers de la caché, adopta analysis_dir)
                                                            ▼
  reproducción: trackPlayback guarda por segundo [seg, Mbps, seeds, peers, entrantes] en seg 30–300
                                                            ▼
  aprendizaje: muestra {ev, real_mbps = p25 seg 120–300 (corta 30→fin, medio peso)} → learnBias por
  red y por evidencia → próxima salud corregida · tarjeta "Fidelidad" en Tu conexión (prequencial)
```

## 2. Reglas para todos los ejecutores

- R1. Raíz /Users/monti/Documents/Dev/streamonte. librqbit (/Users/monti/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/librqbit-9.1.0/) solo lectura: **sin parches**.
- R2. Prohibido `git commit`, `push`, ramas, PRs. Prohibido escribir en /Users/monti/Documents/Dev/streamonte/mem.db (las anotaciones son gate humano, §13).
- R3. **Sin dependencias nuevas** (Rust ni JS). Ninguna fase las necesita.
- R4. Tests: solo los listados en cada WP (tests unitarios Rust en el mismo archivo y self-checks node con `assert`).
- R5. Cada WP edita solo sus `owns`. Necesitar algo ajeno → frenar y reportar.
- R6. Anclas: por contenido (función / línea de código literal). Los números de línea "(hoy :N)" son una pista del árbol del 2026-11-16; si no coinciden pero el contenido sí, seguir por contenido; si el contenido no coincide, frenar.
- R7. **Riesgo de merge**: hay cambios sin commit de OTRA sesión en /Users/monti/Documents/Dev/streamonte/crates/core/src/app.rs, /Users/monti/Documents/Dev/streamonte/crates/core/src/config.rs, /Users/monti/Documents/Dev/streamonte/crates/core/src/engine/mod.rs, /Users/monti/Documents/Dev/streamonte/crates/core/src/engine/rqbit.rs, /Users/monti/Documents/Dev/streamonte/crates/core/src/incoming.rs, /Users/monti/Documents/Dev/streamonte/crates/core/src/activity.rs, /Users/monti/Documents/Dev/streamonte/ui/src/dialogs.js (puerto propio por instalación, "Verificar puerto" con `hold_port`). Antes de un WP que toque alguno: `git -C /Users/monti/Documents/Dev/streamonte diff --stat` y confirmar que las anclas del WP siguen; no revertir nada de esos cambios.
- R8. Textos de UI en español rioplatense, literales del spec. Todo elemento interactivo nuevo con `id`.
- R9. Estilo: el del archivo (comentario de una línea con el porqué y fecha `2026-11-xx`).
- R10. Ante un fallo de verificación: un intento de arreglo; si sigue, frenar y reportar.
- R11. Reporte de cada WP: estado DONE/BLOCKED, archivos tocados, salida de las verificaciones, desvíos con motivo o "sin desvíos".
- Estado base verificado hoy ~16:30, ANTES de la implementación paralela de §2b: `cargo check -p streamonte-core --all-targets` verde (9,7 s); `node --check` de /Users/monti/Documents/Dev/streamonte/ui/src/catalog.js, /Users/monti/Documents/Dev/streamonte/ui/src/health-calib.js y /Users/monti/Documents/Dev/streamonte/ui/src/speed.js sin salida.
- Comandos de verificación usados en todo el spec:
  - `cargo check -p streamonte-core --all-targets` y `cargo clippy -p streamonte-core --all-targets` (desde /Users/monti/Documents/Dev/streamonte)
  - `cargo test -p streamonte-core <filtro>`
  - `cargo check -p streamonte` (crate de /Users/monti/Documents/Dev/streamonte/src-tauri/) cuando se tocan comandos Tauri
  - `node --check <archivo.js>`

## 2b. Estado real del árbol: implementación paralela EN CURSO (detectada 2026-11-16 17:00)

Mientras se escribía este spec, otra sesión implementó (sin commit, archivos modificados hasta las 16:59) buena parte de los specs parciales. Al arrancar (16:2x) solo estaba el cambio de `trackerSeedMbps`. Snapshot a las 17:00:

| Pieza | Estado sin commit | Qué hace este spec |
|---|---|---|
| 03 paso 1: `AddOptions.download_bps` → `ratelimits`; `runtime_worker_threads = 40` siempre | hecho (sin el piso de 64 KiB/s) | WP0 = verificar + **Δ0**: `opts.download_bps.map(\|b\| b.max(65_536)).and_then(…)` (F2) |
| 01 entero: `announce_early` (default `true`), conteo escuchando, `SwarmCount.incoming`, arranque solo `startEarly` (10 mejores), toggle | hecho **sin correr el experimento** | Se conserva. X1 se corre igual: si NO SIGUE, **Δ5** = default `announce_early: false` en config.rs (C2) |
| 04 + 08: `learnBias`, `notePrediction`, `trackPlayback(row, ev)`, ventana 120–300, `perSeedBand`/`supplyRange`, `health()` con rango y "probable", `#conn-fidelity`, `PlaybackRow.seeds` | hecho, como dos capas (banda por seeder × factor) | WP1-C/D/E pasan a **deltas Δ1–Δ4** (abajo); el resto se verifica contra §5.1 |
| 07 fase 1: `known_peers`, `SwarmCount.known`, `completed`, censo DHT (`dht_census`, `catalog_census`, `runCensus`), `streamonte.census-log`, `unlikely` con censo | hecho **sin E0** | Se conserva (solo tooltips, registro y "no muerto"); P2a/P2b siguen detrás de E0–E3 (WP3-A) |
| 06 (bytes por peer), 03 sonda (`probe.rs`), 05 (curva), 02 (motor vivo), binarios de X1/X2 | no hecho | WP1-R paso 4, WP2-A…D, WP3-B, WP4, WP0-X1/X2 |

**Regla para todo ejecutor**: antes de cada WP, correr
`cd /Users/monti/Documents/Dev/streamonte && git diff --stat && for p in announce_early known_peers download_bps PeerBytes peer_rates dht_census probe.rs learnBias perSeedBand predict shownLevel; do echo "$p: $(grep -rln "$p" crates src-tauri/src ui/src | tr '\n' ' ')"; done`
y, paso por paso: si lo pedido ya está y cumple el contrato de §5, marcarlo "ya estaba" y seguir; si está distinto, aplicar solo el delta del WP; si el archivo cambió de forma que el ancla no aparece, frenar (R6/R7). No revertir trabajo de la otra sesión fuera de los deltas.

Deltas sobre lo implementado (Fase 1):
- **Δ1** (health-calib.js + catalog.js): una sola función de predicción para lo que se muestra y lo que se evalúa. Hoy `fidelity` evalúa `basisOf` sobre predicciones SIN corregir y sin "probable", mientras `health()` muestra la banda corregida con "probable": la tarjeta de fidelidad no mide lo que el usuario vio. Reemplazar `basisOf`, `perSeedBand`, `supplyRange`, `weightedMedian`, `fidelity` y el `bandOf`/`seedBand`/`trackerBand` de `healthCalibration` por el bloque de WP1-C paso 1 (`weightedQuantile`, `learnBias` con `lo`/`hi`, `rangeOf`, `predict`, `shownLevel`, `fidelity`); `health()` del catálogo pasa a WP1-D paso 4 (usa `predict` y `shownLevel`; desaparece `corr`, ahora es el factor de `measured` dentro de `predict`). Verificación: goldens de WP1-C.
- **Δ2** `learnable` de muestras viejas: `counted_seeds: l.seeds > 0 ? l.seeds : null` (hoy `l.seeds ?? null`: un 0 viejo tapa a los trackers).
- **Δ3** `trackPlayback`: guardar solo si alguna evidencia predice (`KINDS.some((k) => rawPrediction(t.ev, k) != null)`); hoy `t.ev &&` es siempre verdadero (evidenceOf devuelve un objeto) y guarda muestras que no enseñan.
- **Δ4** `KINDS = ['measured', 'probe', 'counted', 'tracker']` y `rawPrediction` con `probe` (prepara Fase 2; sin efecto mientras `probe_mbps` sea null).

## 3. Decisiones fijas (con el porqué) — resuelve los conflictos entre specs

| # | Tema | Decisión | Por qué |
|---|---|---|---|
| C1 | Ideas 1, 2 y 3 | **Un solo motor de análisis por título** (`analyzer/probe.rs`): escucha/anuncia (1) y sondea con tope (3). La 2 (motor vivo minutos + re-sonda) queda como **extensión del mismo motor** en Fase 4, no como módulo aparte (`HealthWatch` descartado). Handoff = el de la 2 variante (b): apagar el motor de análisis antes de crear el de reproducción; se hereda puerto (primer libre), DhtLease, peers en caché (`save_peers`), `.torrent` en caché y `analysis_dir` (FR-06d). | El tope y `peer_limit` por torrent solo se fijan al agregar (F3), así que reproducir "en el mismo motor" igual obligaría a quitar y re-agregar; dos motores de análisis (conteo + vigía) duplican conexiones al router y compiten por los mismos peers. |
| C2 | Idea 1 sin experimento favorable | Si X1 da NO SIGUE o gris: el motor de análisis usa `engine::create` (sin escucha), no se agrega `announce_early` ni el toggle; el arranque solo al abrir el título **se mantiene** (gana tiempo igual). Con `only_files=[]` anunciamos `left=0` (F7): se acepta en v1. Los `.torrent` en caché van primero en la cola (F8). | El arranque automático no depende de la escucha; anunciarse como leecher exige bajar antes de tener metadatos o parchear librqbit. |
| C3 | ADR-30 y puerto/DhtLease | ADR-30 pasa a: "escuchan la reproducción, Verificar puerto y el motor de análisis del catálogo con `engine.announce_early`; análisis rápido, nombres, censo y herramientas no". El motor de análisis toma el `DhtLease` si está libre (DHT tibio = metadatos más rápidos). **Al ▶/⤓/Retomar se apaga el análisis** (cancel + espera ≤ 5 s) antes de `playback.start`: la reproducción toma el mismo primer puerto libre y el lease. `runtime_worker_threads = 40` en todos los motores. | Sin apagarlo, la reproducción queda en otro puerto, sin DHT persistente y compitiendo por ancho de banda con 10 sondas a 2,5×; además `adopt_analysis` falla mientras la carpeta está reservada (F12). 40 permisos: el motor con escucha hoy queda en 8 y `hold_peers` retiene uno por torrent (F10). |
| C4 | Ideas 4 y 5 y `calibration.rs` | **Una sola capa de corrección**: la de la idea 4, un factor por evidencia (`measured`, `probe`, `counted`, `tracker`) aprendido sobre la predicción **tal como se mostró** (`predict`). Si en Fase 3 se activa la curva (5), entra como otra evidencia con su propio factor; el `projSeedMbps` de la 5 se descarta. /Users/monti/Documents/Dev/streamonte/crates/core/src/playback/calibration.rs (global, semáforo de *Mis magnets*) **convive sin cambios** (decisión abierta D9 para unificar). | Corregir dos veces la misma magnitud infla; el semáforo de *Mis magnets* es otro producto y cambiarlo excede el pedido. |
| C5 | Qué es "lo real" | Solo reproducción o ⤓: p25 de Mbps/seg en **seg 120–300** de descarga activa (`progress < 0,95`), ≥ 60 s → peso 1; si se cortó antes, **30→fin** con ≥ 30 s → peso 0,5. Las mediciones del análisis (`live` de la biblioteca) y las sondas **no** son muestras de aprendizaje (son predicción); siguen sirviendo para el techo `fastest`. | Sin la ventana corta, lo que anduvo mal y se abandonó no entra (sesgo optimista); con el análisis como "real" se aprende de sí mismo. p25 = B24. |
| C6 | Regla B6 y cuándo se muestra la salud | (a) Las mediciones mandan; entre seeders contados y de trackers gana **el p50 más alto** (con 0 contados los trackers no entran). (b) La salud se muestra **siempre** que se conozca algún seeder, como rango con confianza. (c) "Mejor opción" (B8) sigue exigiendo análisis terminado del grupo y nivel 0 **sin "probable"**; en Fase 2 "terminado" = sonda automática del grupo terminada. Son las recomendaciones de D1, D2, D3: si el usuario elige otra cosa, cambian solo las líneas marcadas. | Todas las fuentes subestiman (tabla de 00-contexto); sin salud visible el usuario elige a ciegas hasta analizar. |
| C7 | `seeds` en `PlaybackRow` | Un solo paso (WP1-R), lo usan la ventana de lo real (4) y la serie para la curva (5). | Pedido por 4 y 5. |
| C8 | Ideas 6 y 7 | 6 = capa sobre la sonda (bytes por peer = Δ`fetched_bytes`; `robust = total − top1`) + log por peer en reproducción desde Fase 1. 7a = `peer_stats.seen` expuesto en Fase 1 (sin extender la ventana del conteo). `completed` del scrape se guarda en el candidato (solo registro). 7b censo DHT = Fase 3 experimental. 7c announce UDP **descartado** salvo que E2 lo pida. | Sin descarga no hay velocidad por peer (F14); `seen` cuesta 3 líneas; el announce suma exposición a 40 enjambres por poco. |
| C9 | Presupuesto global | Conexiones TCP ≤ 300 en simultáneo: análisis 10 × 20 (entrantes incluidas: `peer_limit` las cuenta, F9) + reproducción 100 (no conviven: C3). Datos ≤ 1,5 GB por título analizado. Tiempo: corte duro 120 s por tanda; objetivo p50 ≤ 60 s. Privacidad: IP listada en trackers/DHT de ≤ 10 enjambres por título abierto, ~30 min (F11), detrás de `engine.announce_early`. | B26 (routers caseros se saturan con 25×30); pedido de ~1 min. |
| C10 | Arranque lento | No se toca `try_steal` ni la precarga de subtítulos. Efecto lateral buscado de la Fase 2: la sonda baja el inicio del archivo en `analysis_dir` → la reproducción lo adopta (anexo §14). | Fuera del alcance de la salud. |

## 4. Hechos verificados (fuente)

Rutas de librqbit abreviadas solo en esta tabla como `R9` = /Users/monti/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/librqbit-9.1.0/src.

| # | Hecho | Fuente |
|---|---|---|
| F1 | `AddTorrentOptions.ratelimits: LimitsConfig { upload_bps, download_bps: Option<NonZeroU32> }` y `.peer_limit` por torrent; `librqbit::limits` es `pub`. | R9/session.rs:285, :291; R9/limits.rs:10-13; R9/lib.rs:61 |
| F2 | El limitador por torrent se aplica antes de pedir cada chunk (también el de sesión); `bps` < 16 KiB falla. | R9/torrent_state/live/mod.rs:1706-1720; R9/limits.rs:34-37 |
| F3 | Tope por torrent y semáforo de peers se crean al pasar a live; sin setter. | R9/torrent_state/live/mod.rs:216, :266 |
| F4 | `peer_stats` (`AggregatePeerStats`) trae `seen` (direcciones únicas: DHT, trackers, PEX, caché, entrantes) junto a `live`/`live_seeders` que Streamonte ya lee. | R9/torrent_state/live/peers/stats/mod.rs:12-24; /Users/monti/Documents/Dev/streamonte/crates/core/src/engine/rqbit.rs (`stats`, `live_seeders`) |
| F5 | `per_peer_stats_snapshot(Default::default())` → por dirección `counters.fetched_bytes`, `incoming_connections`; no hay velocidad por peer. | R9/torrent_state/live/mod.rs:756 |
| F6 | Sin escucha, la sesión anuncia el puerto falso 4240 a los trackers. | R9/session.rs:1591 |
| F7 | Con `only_files=[]` el torrent está "terminado" (left=0) y sin stream corta a los seeders; `hold_peers` lo evita. | 01 §L5/L8 (R9/torrent_state/live/mod.rs:827-848); /Users/monti/Documents/Dev/streamonte/crates/core/src/engine/rqbit.rs `hold_peers` |
| F8 | Una entrante para un torrent que todavía resuelve metadatos se descarta ("didn't find a matching torrent"). | R9/session.rs:957 |
| F9 | `add_incoming_peer` usa el mismo semáforo de peers: lleno → descarta la entrante. | R9/torrent_state/live/mod.rs:370-381 |
| F10 | `runtime_worker_threads = 40` hoy solo si `!playback`; cada stream retiene un permiso. | /Users/monti/Documents/Dev/streamonte/crates/core/src/engine/rqbit.rs (`spawn`, `if !playback`) |
| F11 | Quitar un torrent no manda `stopped`: el tracker lo lista hasta vencer (~30–60 min). | 01 §L9 (librqbit-tracker-comms-9.1.0/src/tracker_comms.rs:406-410), no re-verificado |
| F12 | `adopt_analysis` falla si `analysis_dir` está reservada (`try_reserve`). | /Users/monti/Documents/Dev/streamonte/crates/core/src/playback/kept.rs (`adopt_analysis`) |
| F13 | `DhtLease`: un dueño de `dht.json` por proceso; `free_port` = primer libre del rango. | /Users/monti/Documents/Dev/streamonte/crates/core/src/engine/rqbit/net.rs |
| F14 | `hold_peers` pide a lo sumo la última pieza: sin descarga, Δ por peer ≈ 0. | /Users/monti/Documents/Dev/streamonte/crates/core/src/engine/rqbit.rs (`hold_peers`) |
| F15 | PEX cada 60 s; DHT re-consulta cada 60 s. | R9/torrent_state/live/mod.rs:931; librqbit-dht-9.1.0/src/lib.rs:24 |
| F16 | `PlaybackAction` tiene `ResumeDownload` (no `Resume`); ⤓ entra por el mismo comando `play` (`background: true`). | /Users/monti/Documents/Dev/streamonte/crates/core/src/playback.rs (`enum PlaybackAction`); /Users/monti/Documents/Dev/streamonte/ui/src/api.js (`playBackground`) |
| F17 | Modelo de la Fase 1 verificado con node: caso real (trackers 2·3, 4K 1,4 GB/45 min, real 55) → rango 3,75–60, p50 7,5, nivel 1 → "Buena probable"; 8 reproducciones iguales → fidelidad 8/8, error típico ×7,3 → ×2,0. | self-check de WP1-C (corrido en el scratchpad de esta sesión sobre una copia de health-calib.js + el bloque de §5.1) |

## 5. Contratos (código)

### 5.1 /Users/monti/Documents/Dev/streamonte/ui/src/health-calib.js — API pura (Fase 1, usada por Fases 2–3)

Evidencia `ev` (la arma `evidenceOf` del catálogo; la foto se guarda al tocar ▶/⤓):
```js
ev = {
  tracker_seeds, tracker_leechers,   // seedsOf(c) / c.leechers, o scrape de la fila; null si no hay
  counted_seeds, counted_leech,      // seedsCounted(c) y sus leechers; null sin conteo
  analysis_mbps,                     // live.avg_speed_bps de la biblioteca en Mbps; null
  probe_mbps, probe_capped, probe_cap_mbps, // Fase 2: sostenido de la sonda, ¿llegó al tope?, tope; null/false/null en Fase 1
  need_mbps,                         // lo que pide (neededBps o TYPICAL_MBPS); null si no se sabe
  res,                               // '2160p'…; se guarda, no se estratifica
  known, completed,                  // registro (idea 7): direcciones conocidas al contar, completed del scrape
  at,                                // ISO, solo en la foto `pred`
}
```
Exports nuevos (código literal en WP1-C):
```js
export const levelOf = (ratio) => /* 0 ≥ 2×, 1 ≥ 1×, 2 */;
export function rawPrediction(ev, kind /* 'measured'|'probe'|'counted'|'tracker' */) /* Mbps | null */;
export function learnBias(samples, nowMs, linkMbps) /* {[kind]: {bias, factor, n, nEff, lo, hi}} */;
export function predict(ev, cal /* {bias, manual, capMbps} */) /* {kind, lo, p50, p75, hi, conf: 'baja'|'media'|'alta'} | null */;
export function shownLevel(range, needMbps) /* {level, shown, probable} */;
export function fidelity(samples, linkMbps) /* {n, biasBefore, biasAfter, typBefore, typAfter, hits, pessimistic, optimistic, inBand} | null */;
export function notePrediction(hash, ev);
export function trackPlayback(row, ev);                 // firma nueva (antes: row, seeds, trackerSeeds, trackerLeechers)
export function healthCalibration(rows) /* {capMbps, capFrom, samples, learnable, bias, manual, n, trackerN, seedMbps, trackerSeedMbps, measuredFactor, source} */;
```
Muestra guardada en `localStorage['streamonte.health'].bg[hash]`:
```js
{ name, source, network, measured_at, measured_secs, ev, real_mbps, short, window_secs,
  real_seeds, real_peers, real_incoming, avg_speed_bps, sustained_bps, max_speed_bps }
```

### 5.2 Rust — Fase 1
```rust
// /Users/monti/Documents/Dev/streamonte/crates/core/src/playback.rs — struct PlaybackRow
pub seeds: u32,
// /Users/monti/Documents/Dev/streamonte/crates/core/src/engine/mod.rs — struct Stats
#[serde(default)]
pub known_peers: Option<u32>,
// /Users/monti/Documents/Dev/streamonte/crates/core/src/engine/mod.rs
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PeerBytes { pub addr: std::net::SocketAddr, pub fetched_bytes: u64, pub incoming: bool, pub client: Option<String> }
// trait TorrentEngine
async fn peer_bytes(&self, _handle: TorrentHandle) -> Option<Vec<PeerBytes>> { None }
// /Users/monti/Documents/Dev/streamonte/crates/core/src/analyzer/swarm.rs — struct SwarmCount
pub known: u32,
// /Users/monti/Documents/Dev/streamonte/crates/core/src/catalog/normalize.rs — struct StreamCandidate
#[serde(default)]
pub completed: Option<u32>,
// /Users/monti/Documents/Dev/streamonte/crates/core/src/analyzer/peer_rates.rs (nuevo)
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct PeerRates { pub rates_bps: Vec<f64>, pub idle: u32, pub secs: f64 }
pub fn peer_rates(a: &[PeerBytes], b: &[PeerBytes], secs: f64) -> PeerRates;
pub fn rates_line(a: &[PeerBytes], b: &[PeerBytes], secs: f64) -> String;
```

### 5.3 Rust — Fase 0/2
```rust
// /Users/monti/Documents/Dev/streamonte/crates/core/src/engine/mod.rs — struct AddOptions (Fase 0)
/// Tope de bajada de ESTE torrent (bytes/s), fijo al agregar (librqbit no lo cambia después).
/// webtorrent lo ignora. `None` = sin tope.
pub download_bps: Option<u32>,

// /Users/monti/Documents/Dev/streamonte/crates/core/src/config.rs — struct EngineConfig (Fase 2, solo si X1 SIGUE)
pub announce_early: bool, // default true (D4)

// /Users/monti/Documents/Dev/streamonte/crates/core/src/analyzer/probe.rs (nuevo, Fase 2)
#[derive(Debug, Clone, Deserialize)]
pub struct ProbeItem { pub hash: InfoHash, pub need_bps_hint: Option<f64> }
#[derive(Debug, Clone, Default, PartialEq, Serialize)]
pub struct ProbeResult {
    pub reached: bool, pub seeds: u32, pub peers: u32, pub known: u32, pub incoming: u32,
    pub started: bool, pub skipped: bool,
    pub need_bps: Option<f64>, pub cap_bps: f64, pub cap_by_link: bool,
    pub ttfb_secs: Option<f64>, pub ramp_secs: Option<f64>,
    pub sustained_bps: f64, pub max_bps: f64, pub secs: f64,
    pub hit_cap: bool, pub link_limited: bool, pub peer_limited: bool,
    pub peer_rates: Option<crate::analyzer::peer_rates::PeerRates>,
}
pub async fn probe(
    paths: &AppPaths, cfg: &Config,
    items: Vec<(Magnet, FilePick, Option<f64>)>, runtime_secs: Option<u32>, link_bps: Option<f64>,
    cancel: CancellationToken,
    on_update: impl Fn(InfoHash, ProbeResult, bool) + Send + Sync + 'static,
) -> HashMap<InfoHash, ProbeResult>;

// /Users/monti/Documents/Dev/streamonte/crates/core/src/analyzer/swarm.rs (extraído de count_one, Fase 2)
pub(super) async fn wait_alive_metadata(
    engine: &dyn TorrentEngine, handle: TorrentHandle, progress: &(dyn Fn(u32) + Sync),
) -> Option<Arc<Metadata>>;

// /Users/monti/Documents/Dev/streamonte/crates/core/src/events.rs — enum CoreEvent
CatalogProbeProgress { hash: InfoHash, probe: crate::analyzer::probe::ProbeResult }, // "catalog-probe-progress"
CatalogProbed { hash: InfoHash, probe: crate::analyzer::probe::ProbeResult },        // "catalog-probed"

// /Users/monti/Documents/Dev/streamonte/crates/core/src/app.rs — AppCore
analysis_engine: Arc<tokio::sync::Mutex<()>>, // lo retiene catalog_probe mientras vive su motor
pub async fn catalog_probe(&self, video_id: &str, items: Vec<ProbeItem>, runtime_secs: Option<u32>, link_mbps: Option<f64>)
    -> Result<std::collections::HashMap<InfoHash, ProbeResult>>;
async fn stop_catalog_analysis(&self); // cancela swarm_cancel y espera ≤ 5 s el lock de analysis_engine
pub async fn set_network(&self, incoming: bool, upnp: bool, announce_early: bool) -> Result<()>; // solo si X1 SIGUE
```
Tauri: `catalog_probe(video_id: String, items: Vec<ProbeItem>, runtime_secs: Option<u32>, link_mbps: Option<f64>) -> CmdResult<HashMap<InfoHash, ProbeResult>>`; `config_set_network(incoming, upnp, announce_early)` si X1 SIGUE.
UI api: `catalogProbe: (videoId, items, runtimeSecs, linkMbps) => invoke('catalog_probe', { videoId, items, runtimeSecs, linkMbps })`; `setNetwork: (incoming, upnp, announceEarly) => invoke('config_set_network', { incoming, upnp, announceEarly })`.

### 5.4 Ids de UI
Nuevos: `#conn-fidelity` (tarjeta, F1), `#set-announce` (toggle, F2 si X1 SIGUE), `cat-probe-live-<hash>` (span en vivo, F2). Cambia de forma, mismo id: `cat-health-<hash>` (botón con ícono + texto). Fase 4: `#cat-live-status`, `#cat-live-stop`.

## 6. Fase 0 — experimentos (compuertas)

**Objetivo**: decidir con números si el motor de análisis escucha (X1) y si la sonda con tope predice la reproducción mejor que contar seeders (X2). **Usuario**: nada cambia. **Estimación**: un módulo (engine) + 2 binarios de ejemplo · baja · **experimental** (cuántas entrantes llegan; si 30 s con tope predicen minutos de reproducción).

### WP0 — Plomería del tope (sonnet · medium · tanda 0.1) — a las 17:00 ya hecho salvo Δ0 (§2b): verificar y aplicar Δ0
**owns**: /Users/monti/Documents/Dev/streamonte/crates/core/src/engine/mod.rs, /Users/monti/Documents/Dev/streamonte/crates/core/src/engine/rqbit.rs, /Users/monti/Documents/Dev/streamonte/crates/core/src/playback/flow.rs, /Users/monti/Documents/Dev/streamonte/crates/core/src/analyzer/pipeline.rs, /Users/monti/Documents/Dev/streamonte/crates/core/src/analyzer/names.rs, /Users/monti/Documents/Dev/streamonte/crates/core/src/engine/rqbit/fastresume.rs, /Users/monti/Documents/Dev/streamonte/crates/core/examples/bench.rs. R7 aplica (engine/mod.rs y rqbit.rs).
1. `AddOptions` (en engine/mod.rs, después de `pub initial_peers: Vec<std::net::SocketAddr>,`): agregar el campo de §5.3.
2. Completar `download_bps: None,` en los 5 literales `AddOptions {`: /Users/monti/Documents/Dev/streamonte/crates/core/src/playback/flow.rs (hoy :80), /Users/monti/Documents/Dev/streamonte/crates/core/src/analyzer/pipeline.rs (`add_deselected`, hoy :66), /Users/monti/Documents/Dev/streamonte/crates/core/src/analyzer/names.rs (hoy :69), /Users/monti/Documents/Dev/streamonte/crates/core/src/engine/rqbit/fastresume.rs (test, hoy :86), /Users/monti/Documents/Dev/streamonte/crates/core/examples/bench.rs (hoy :197).
3. En rqbit.rs, dentro de `let add_opts = AddTorrentOptions {` después de `initial_peers: …,`:
   ```rust
            // Tope por torrent (salud fiel, 2026-11-16): librqbit lo fija al agregar; < 16 KiB/s falla.
            ratelimits: librqbit::limits::LimitsConfig {
                download_bps: opts.download_bps.map(|b| b.max(65_536)).and_then(std::num::NonZeroU32::new),
                upload_bps: None,
            },
   ```
4. En rqbit.rs `spawn`, reemplazar el bloque `if !playback { … opts.runtime_worker_threads = Some(40); }` por:
   ```rust
        // Cada stream retiene uno de estos permisos de E/S (8 por defecto): el análisis retiene uno
        // por torrent con `hold_peers` (también escuchando, salud fiel) y la reproducción no llega a 40.
        // shortcut: alcanza para tandas de hasta ~30 torrents; más, subirlo.
        opts.runtime_worker_threads = Some(40);
   ```
   (si `playback` queda sin uso, el compilador lo marca: no, se sigue usando en `listen_port`).
**Verificación**: `cargo check -p streamonte-core --all-targets` verde; `cargo test -p streamonte-core` mismo resultado que la base; `grep -c "download_bps: None" /Users/monti/Documents/Dev/streamonte/crates/core/src/playback/flow.rs /Users/monti/Documents/Dev/streamonte/crates/core/src/analyzer/pipeline.rs /Users/monti/Documents/Dev/streamonte/crates/core/src/analyzer/names.rs /Users/monti/Documents/Dev/streamonte/crates/core/src/engine/rqbit/fastresume.rs /Users/monti/Documents/Dev/streamonte/crates/core/examples/bench.rs` → 1 por archivo.

### X1 — ¿Llegan entrantes si el análisis escucha? (binario `announce_probe`)
- WP0-X1 (sonnet · medium · tanda 0.2, en paralelo con WP0-X2) **owns**: /Users/monti/Documents/Dev/streamonte/crates/core/examples/announce_probe.rs (nuevo). Diseño literal: /Users/monti/Documents/Dev/streamonte/docs/plans/salud-fiel/01-anunciarse-temprano.spec.md §2.2 (estructura `Probe`, `run`, `probe_one`), con `AddOptions { …, download_bps: None }`. Verificación: `cargo build -p streamonte-core --release --example announce_probe` verde.
- Corre el usuario (gate humano): app cerrada, "Verificar puerto" = abierto, 3 títulos (uno 4K con trackers ≤ 3 seeds), 10 magnets por título, `--secs 60`, alternando `--order ab` / `ba`. ≥ 25 torrents con metadatos en ambos modos.
- Métricas: G1 = % con ≥ 1 entrante a 60 s (modo escucha); G2 = mediana `peers_b / max(peers_a,1)`; G3 = mediana segundos hasta la primera entrante.
- **SIGUE** si G1 ≥ 40 % y G2 ≥ 1,25 → Fase 2 con `announce_early`. **NO SIGUE** si G1 < 20 % → C2. **Gris** → repetir con `--secs 120`; si recién ahí pasa, C2 en Fase 2 y el dato alimenta la compuerta de Fase 4.

### X2 — ¿La sonda con tope predice la reproducción? (binario `salud_probe`)
- WP0-X2 (sonnet · high · tanda 0.2) **owns**: /Users/monti/Documents/Dev/streamonte/crates/core/examples/salud_probe.rs (nuevo). Patrón de /Users/monti/Documents/Dev/streamonte/crates/core/examples/analyze.rs (config real con `ConfigStore`, `AppPaths::resolve`). Uso:
  `cargo run -p streamonte-core --release --example salud_probe -- --runtime-min <N> [--listen] [--probe-secs 30] [--real-secs 240] <magnet>...` (≤ 10 magnets de UN título; app cerrada).
  Por magnet, en SERIE (dos conexiones desde la misma IP falsean):
  1. Motor A = `engine::create_for_playback` si `--listen`, si no `engine::create`; `max_connections = 20`. `add_cached_or_magnet` sin tope en `<downloads>/<hash>-<pid>-sonda`; `wait_metadata` 90 s (sin metadatos → fila "sin metadatos", siguiente). `save_torrent_cache`; `pick_file(FilePick { index: None, episode: None })` (archivo de video más grande); `need = file.size / (runtime_min·60)` bytes/s; `cap = 2,5·need`.
  2. `remove` y volver a agregar desde la caché con `download_bps: Some(cap as u32)` (el tope se fija al agregar: F3). `select_file(file)`. Muestras de 1 s con `stats` (`received_bytes` Δ, `seeds`, `peers`, `incoming_peers`) desde el primer byte durante `--probe-secs`. Sin byte a los 15 s → `started = false`.
  3. Resumen de la sonda (MISMA definición que la Fase 2, `summarize` de WP2-A): `sustained` = mediana de la segunda mitad de las muestras; `hit_cap` = las últimas 8 muestras ≥ 0,9·cap. `save_peers(connected_peers)`; `remove { delete_data: true }`; `shutdown`.
  4. Motor B = `engine::create_for_playback`, `max_connections` de la config (100). `add_cached_or_magnet` (trae los peers de 3) con `download_bps: Some((3.0·need) as u32)` (censura en 3×: alcanza para saber el nivel y acota datos), `select_file`, muestras de 1 s durante `--real-secs`. `real` = p25 de las muestras con segundo en (120, real_secs]; `real_capped` = real ≥ 0,9·3·need. Máximos de peers/seeds/entrantes. `remove { delete_data: true }`; `shutdown`.
  5. Fila: `hash need_mbps probe_mbps hit_cap probe_seeds probe_peers real_mbps real_capped real_peers real_incoming nivel_sonda nivel_conteo nivel_real`, con `nivel_sonda = hit_cap ? 0 : levelOf(probe/need)`, `nivel_conteo = levelOf((seeds + (peers−seeds)/6)·3 Mbps / need)`, `nivel_real = levelOf(real/need)` (0 si `real_capped`).
  Resumen al final: n, F1 = % `nivel_sonda == nivel_real`, base = % `nivel_conteo == nivel_real`, F2 = % de `hit_cap` con `nivel_real == 0`, F3 = mediana |ln(probe/real)| en filas sin `hit_cap` ni `real_capped`, L1 = mediana de (muestras de las últimas 8 s ÷ cap) en filas `hit_cap`.
  Funciones puras con `#[cfg(test)]` en el mismo ejemplo: `fn summarize_probe(samples: &[f64], cap: f64) -> (f64, bool)` y `fn p25_window(samples: &[(u64, f64)], from: u64, to: u64) -> Option<f64>`; tests: corte al tope con 8 s ≥ 0,9; p25 con la regla `sorted[floor((n−1)·0,25)]`.
  Verificación del WP: `cargo test -p streamonte-core --release --example salud_probe` verde; `cargo build … --example salud_probe` verde.
- Corre el usuario: ≥ 15 torrents en ≥ 4 títulos (incluir 2 4K tipo el caso real); con `--listen` si X1 SIGUE. Datos por torrent ≤ `real_secs · 3 · need` (1080p ≈ 0,7 GB, 4K web ≈ 2 GB).
- **PASA** si L1 ∈ [0,85; 1,15] **y** F2 ≥ 90 % **y** F1 ≥ 75 % **y** F1 ≥ base + 15 pp. F3 es informativo (lo corrige el factor `probe` de la Fase 1).
- **NO PASA** → la Fase 2 se reduce a WP2-B (sin sonda: el motor de análisis es el conteo de hoy arrancado solo y escuchando si X1 SIGUE, como 01 §7 Paso 5 sobre `countSeeds`) y se habilita WP3-B (curva). Si solo falla L1 (limitador oscila): subir `HOLD_SECS` a 10 y bajar el umbral de tope a 0,8 en WP2-A y repetir X2 una vez.

### X3 — ¿La velocidad depende de 1–2 peers? (sin código propio; corre con la Fase 1 instalada)
Con el log por peer de WP1-R (paso 4), 10 reproducciones: anotar `top1/total` y cuántos peers dan > 0,5 Mbps. **PASA** si en ≥ 5 de 10 `top1/total > 0,6` → se construye WP2-D (regla `robust`). Si no, el log queda como diagnóstico y WP2-D se descarta.

## 7. Fase 1 — corrección aprendida + rango + datos (sin compuerta)

**Objetivo**: que la salud deje de ser sistemáticamente pesimista en cada red y se vea siempre, con su incertidumbre. **Qué ve el usuario**: en cada opción con seeders conocidos (sin analizar también) un botón "▂▄▆ 3,8–60 Mbps · trackers · sin calibrar"; "Buena probable" / "Puede alcanzar"; tras unas reproducciones, la salud se corrige sola y "Tu conexión" muestra la tarjeta **Fidelidad** ("acertó 7 de 8 niveles…"). **Estimación**: varios módulos (3 JS + 2 CSS + 5 Rust chicos) · media (estadística simple, estado por reproducción, migración al leer, orden con "probable") · investigar (cuántas reproducciones por red llegan a la ventana; sesgo de selección).

Tanda 1.1 en paralelo: WP1-R, WP1-C, WP1-D, WP1-E. Tanda 1.2: WP1-Z (opus · high).

### WP1-R — Rust: datos para aprender y diagnóstico por peer (sonnet · high) — a las 17:00 pasos 1, 2, 3 y 5 ya hechos (con `SwarmCount.incoming` extra de 01, se conserva): verificar; falta el paso 4
**owns**: /Users/monti/Documents/Dev/streamonte/crates/core/src/playback.rs, /Users/monti/Documents/Dev/streamonte/crates/core/src/playback/kept.rs, /Users/monti/Documents/Dev/streamonte/crates/core/src/playback/flow.rs, /Users/monti/Documents/Dev/streamonte/crates/core/src/engine/mod.rs, /Users/monti/Documents/Dev/streamonte/crates/core/src/engine/rqbit.rs, /Users/monti/Documents/Dev/streamonte/crates/core/src/engine/rqbit/net.rs, /Users/monti/Documents/Dev/streamonte/crates/core/src/engine/webtorrent.rs, /Users/monti/Documents/Dev/streamonte/crates/core/src/analyzer.rs, /Users/monti/Documents/Dev/streamonte/crates/core/src/analyzer/swarm.rs, /Users/monti/Documents/Dev/streamonte/crates/core/src/analyzer/peer_rates.rs (nuevo), /Users/monti/Documents/Dev/streamonte/crates/core/src/catalog/normalize.rs, /Users/monti/Documents/Dev/streamonte/crates/core/src/catalog/aggregate.rs. R7 aplica.
1. **`seeds` en la fila** (C7): en playback.rs `struct PlaybackRow`, después de `pub peers: u32,` agregar `/// De esos, los que tienen el archivo completo (`Stats::seeds`): ventana de "lo real" (salud fiel).` + `pub seeds: u32,`. Agregar `seeds: 0,` después de `peers: 0,` en los dos literales (playback.rs, `PlaybackRow {` hoy :315; kept.rs `kept_row`, hoy :221). En flow.rs, después de cada `row.peers = stats.peers;` (2 lugares) agregar `row.seeds = stats.seeds;`.
2. **`known_peers`** (7a): en engine/mod.rs `struct Stats`, después de `pub incoming_peers: u32,`: doc "Direcciones únicas conocidas del enjambre (DHT + trackers + PEX + caché + entrantes), conectadas o no. `None` si el motor no lo informa." + `#[serde(default)] pub known_peers: Option<u32>,`. rqbit.rs `stats`: antes de `incoming_peers: torrent` agregar `known_peers: s.live.as_ref().map(|l| l.snapshot.peer_stats.seen),`. webtorrent.rs (`Ok(Stats {`): `known_peers: None,`.
3. **`SwarmCount.known`**: agregar `/// Direcciones únicas conocidas al terminar (máximo): ver `Stats::known_peers`.` + `pub known: u32,` al struct; en los literales sin metadatos (`SwarmCount { seeds: 0, peers: dht_peers, reached: false }` y `… peers: found, …`) poner `known: dht_peers` / `known: found`; en `let mut best = SwarmCount { … reached: true }` poner `known: 0`. En el bucle de conteo, dentro del `if let Ok(Ok(s)) = …`, ANTES del `if s.peers > best.peers || …`, agregar `best.known = best.known.max(s.known_peers.unwrap_or(0));` (no extiende la ventana: B26 intacto). Antes de `metadata.save_torrent_cache(` agregar `tracing::info!(hash = %magnet.info_hash.to_hex(), seeds = best.seeds, peers = best.peers, known = best.known, "conteo del enjambre");`.
4. **Bytes por peer + log** (6): tipo `PeerBytes` y método de trait de §5.2 (después de `connected_peers` en el trait). En net.rs: `pub(super) fn peer_bytes_of(t: &ManagedTorrent) -> Option<Vec<crate::engine::PeerBytes>>` = `t.live()?.per_peer_stats_snapshot(Default::default()).peers` mapeado (clave `String` → `SocketAddr` con `parse().ok()`, descartar las que no parsean; `incoming = counters.incoming_connections > 0`; `client = client_name.clone()` — si el campo no existe con ese nombre en `PeerStats`, frenar). rqbit.rs: `async fn peer_bytes` = `net::peer_bytes_of(&self.inner.resolved(handle).ok()?)`. Archivo nuevo peer_rates.rs con `PeerRates`, `peer_rates` y `rates_line` de §5.2: `r_i = (b.fetched − a.fetched o 0 si no estaba en a) / secs`; `rates_bps` = los 8 `r_i > 0` más altos, descendente; `idle` = presentes en a y b con Δ = 0; `secs <= 0` → default. `rates_line` = `"por peer: " + top 5 "IP:puerto 12,3 Mbps (cliente, entrante)"` separados por " · " + `" · total X Mbps"`. Tests en el mismo archivo: Δ simple, peer nuevo en b, idle, orden, corte a 8, secs 0. Registrar `pub mod peer_rates;` en analyzer.rs (junto a `pub mod swarm;`). En `log_peers` (net.rs): guardar el `Option<Vec<PeerBytes>>` anterior y en cada vuelta (10 s) emitir una línea más con `rates_line(&prev, &now, secs)` por el mismo canal que `peer_line`.
5. **`completed`** (7): en normalize.rs `struct StreamCandidate`, después de `pub leechers: Option<u32>,`: `/// Descargas completas que informa el scrape (solo registro, salud fiel). ` + `#[serde(default)] pub completed: Option<u32>,`; `completed: None` en los literales que marque el compilador (incluye tests de normalize.rs y aggregate.rs). aggregate.rs `set_scrape`: `c.completed = Some(s.completed);`.
**Verificación**: `cargo check -p streamonte-core --all-targets` y `cargo clippy -p streamonte-core --all-targets` sin errores nuevos; `cargo test -p streamonte-core peer_rates` verde; `cargo test -p streamonte-core` mismo resultado que la base; `grep -c "row.seeds = stats.seeds" /Users/monti/Documents/Dev/streamonte/crates/core/src/playback/flow.rs` → 2; `cargo check -p streamonte` verde.

### WP1-C — health-calib.js: modelo, captura y calibración (sonnet · high) — a las 17:00 implementado en otra forma: aplicar Δ1–Δ4 (§2b) usando los bloques de abajo como texto final
**owns**: /Users/monti/Documents/Dev/streamonte/ui/src/health-calib.js. Base = el archivo tal como esté (con `sustainedMbps` y `median`); los pasos de abajo describen el estado FINAL: lo que ya coincida se deja.
1. Después de `const median = …` pegar literal el bloque de abajo (verificado, F17):
```js
// ---------- salud fiel, Fase 1 (2026-11-16): corrección aprendida + rango ----------
// Spec: docs/plans/salud-fiel/salud-fiel.spec.md. Lo "real" es lo que bajó una reproducción en
// sus minutos 2 a 5; cada evidencia del análisis aprende cuánto se equivoca en esta red.
/** Ventana de "lo real" (segundos de descarga activa): 120–300; si se cortó antes, 30→fin a medio peso. */
const WIN_FROM = 120, WIN_TO = 300, WIN_MIN = 60, SHORT_FROM = 30, SHORT_MIN = 30;
/** Muestras equivalentes del "sin sesgo" y vida media de una muestra (días). */
const PRIOR_N = 2, HALF_LIFE_DAYS = 30;
const BIAS_MIN = -Math.log(4), BIAS_MAX = Math.log(20);
const MIN_PRED_MBPS = 0.5;
const LEECH = 1 / 6;
/** Evidencias: mediciones (mandan, en este orden) y estimaciones por seeders. */
const KINDS = ['measured', 'probe', 'counted', 'tracker'];
/** Banda sin muestras propias, × la predicción corregida: [lo, p75, hi]. Por seeders es amplia
 *  (el ×8 ≈ la única medición real de seedboxes); una medición, angosta. */
const PRIOR_BAND = { seeds: [0.5, 4, 8], measured: [0.8, 1.5, 2.5] };

export const levelOf = (ratio) => (ratio >= 2 ? 0 : ratio >= 1 ? 1 : 2);

/** Predicción SIN corregir de una evidencia, en Mbps (null si no la hay). */
export function rawPrediction(ev, kind) {
  if (!ev) return null;
  if (kind === 'measured') return ev.analysis_mbps > 0 ? ev.analysis_mbps : null;
  if (kind === 'probe') return ev.probe_mbps > 0 ? ev.probe_mbps : null;
  const [s, l] = kind === 'tracker' ? [ev.tracker_seeds, ev.tracker_leechers] : [ev.counted_seeds, ev.counted_leech];
  if (s == null || (kind === 'tracker' && !(s > 0))) return null; // 0 de tracker: no confiable (`trackersWin`)
  return Math.max(MIN_PRED_MBPS, (s + (l ?? 0) * LEECH) * DEFAULT_SEED_MBPS);
}

/** Cuantil ponderado de `[[x, peso]]` (el primero cuyo peso acumulado llega a `p` del total). */
function weightedQuantile(pts, p) {
  const s = [...pts].sort((a, b) => a[0] - b[0]);
  const total = s.reduce((t, [, w]) => t + w, 0);
  let acc = 0;
  for (const [x, w] of s) { acc += w; if (acc >= total * p) return x; }
  return 0;
}

/** Sesgo aprendido por evidencia: mediana ponderada (por antigüedad) de ln(real ÷ predicción),
 *  contraída hacia 0 con PRIOR_N muestras equivalentes; `lo`/`hi` = cuartiles de esos ln menos la
 *  mediana (ancho del rango). Las topadas por la línea que dan pesimista no enseñan: fuera. */
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
    const m = pts.length ? weightedQuantile(pts, 0.5) : 0;
    const bias = pts.length ? Math.min(BIAS_MAX, Math.max(BIAS_MIN, (nEff * m) / (nEff + PRIOR_N))) : 0;
    out[kind] = { bias, factor: Math.exp(bias), n: pts.length, nEff,
      lo: pts.length ? weightedQuantile(pts, 0.25) - m : 0, hi: pts.length ? weightedQuantile(pts, 0.75) - m : 0 };
  }
  return out;
}

/** Rango corregido de una evidencia: `{kind, lo, p50, p75, hi, conf}` en Mbps, o null sin ella. */
function rangeOf(ev, kind, cal) {
  const raw = rawPrediction(ev, kind);
  if (raw == null) return null;
  const bySeeds = kind === 'counted' || kind === 'tracker';
  const cap = (x) => (bySeeds && cal.capMbps ? Math.min(x, cal.capMbps) : x);
  if (bySeeds && cal.manual) { const v = cap((raw / DEFAULT_SEED_MBPS) * cal.manual); return { kind, lo: v, p50: v, p75: v, hi: v, conf: 'media' }; }
  const b = cal.bias?.[kind] ?? { factor: 1, nEff: 0, lo: 0, hi: 0 };
  // Sonda que llegó al tope: lo medido es un piso (bajaría más sin tope).
  if (kind === 'probe' && ev.probe_capped) { const v = raw * Math.max(1, b.factor); return { kind, lo: v, p50: v, p75: v, hi: v, conf: 'alta' }; }
  const p50 = raw * b.factor;
  let lo, p75, hi, conf;
  if (b.nEff >= MIN_SAMPLES) {
    const w = 1 / (2 * Math.sqrt(b.nEff)); // pocas muestras: los cuartiles subestiman la dispersión
    [lo, p75, conf] = [p50 * Math.exp(b.lo) * (1 - w), p50 * Math.exp(b.hi), 'media'];
    hi = p75 * (1 + w);
  } else {
    const [fl, f75, fh] = bySeeds ? PRIOR_BAND.seeds : PRIOR_BAND.measured;
    [lo, p75, hi, conf] = [p50 * fl, p50 * f75, p50 * fh, 'baja'];
  }
  return { kind, lo: cap(lo), p50: cap(p50), p75: cap(p75), hi: cap(hi), conf };
}

/** Lo que el catálogo muestra de una opción (`health()`) y lo que `fidelity` evalúa: las
 *  mediciones mandan (B6); si no, entre seeders contados y de trackers gana el p50 más alto (todas
 *  subestiman, ver spec); con 0 contados los trackers no entran. `cal` = {bias, manual, capMbps}. */
export function predict(ev, cal) {
  for (const kind of ['measured', 'probe']) { const r = rangeOf(ev, kind, cal); if (r) return r; }
  const counted = rangeOf(ev, 'counted', cal);
  const tracker = ev?.counted_seeds === 0 ? null : rangeOf(ev, 'tracker', cal);
  return [counted, tracker].filter(Boolean).reduce((a, b) => (!a || b.p50 > a.p50 ? b : a), null);
}

/** Nivel del p50 y nivel mostrado: sube uno ("probable") si el p75 alcanza el de arriba. */
export function shownLevel(r, need) {
  const level = levelOf(r.p50 / need);
  const probable = r.conf !== 'alta' && level > 0 && levelOf(r.p75 / need) < level;
  return { level, shown: probable ? level - 1 : level, probable };
}

/** Qué tan fiel fue la salud en esta red: cada muestra se predice con lo aprendido SOLO de las
 *  anteriores. err = ln(predicción ÷ real): < 0 = pesimista. */
export function fidelity(samples, link) {
  const asc = [...samples].sort((a, b) => Date.parse(a.measured_at) - Date.parse(b.measured_at));
  const rows = [];
  asc.forEach((s, i) => {
    const need = s.ev?.need_mbps;
    if (!(need > 0)) return;
    const before = predict(s.ev, { bias: {}, capMbps: link });
    const after = predict(s.ev, { bias: learnBias(asc.slice(0, i), Date.parse(s.measured_at), link), capMbps: link });
    if (!before || !after) return;
    const real = levelOf(s.real_mbps / need), got = shownLevel(after, need).shown;
    rows.push({ before: Math.log(before.p50 / s.real_mbps), after: Math.log(after.p50 / s.real_mbps), hit: got === real, pess: got > real, opt: got < real,
      inBand: after.lo <= s.real_mbps && s.real_mbps <= after.hi });
  });
  if (!rows.length) return null;
  const med = (f) => median(rows.map(f));
  const count = (f) => rows.filter(f).length;
  return { n: rows.length, biasBefore: med((r) => r.before), biasAfter: med((r) => r.after),
    typBefore: med((r) => Math.abs(r.before)), typAfter: med((r) => Math.abs(r.after)),
    hits: count((r) => r.hit), pessimistic: count((r) => r.pess), optimistic: count((r) => r.opt), inBand: count((r) => r.inBand) };
}

/** Muestra lista para aprender (migración al leer, nada se reescribe). Null = no aprende: las del
 *  análisis (son predicción) y las viejas de menos de 2 min. */
function learnable(l) {
  if (l.ev && l.real_mbps > 0) return { ...l, weight: l.short ? 0.5 : 1 };
  if (l.source === 'análisis' || !(l.measured_secs >= WIN_FROM)) return null;
  // Viejas: su p25 incluye el arranque (pesimista) → medio peso.
  return { ...l, weight: 0.5, real_mbps: sustainedMbps(l),
    ev: { counted_seeds: l.seeds > 0 ? l.seeds : null, counted_leech: null, tracker_seeds: l.tracker_seeds ?? null,
      tracker_leechers: l.tracker_leechers ?? null, analysis_mbps: null, probe_mbps: null, need_mbps: null } };
}
```
2. Reemplazar el cuerpo completo de `healthCalibration` (y su JSDoc) por:
```js
/** `rows`: filas de la biblioteca. `bias` = sesgo aprendido por evidencia (salud fiel); `manual` =
 *  Mbps por seeder fijados a mano o null; `seedMbps`/`trackerSeedMbps` = 3 Mbps × su factor (para
 *  "Tu conexión"); `capMbps` = techo (test de velocidad o lo más rápido medido); `samples` = todas
 *  las mediciones (techo y lista); `learnable` = las que enseñan. */
export function healthCalibration(rows) {
  const cfg = load();
  const samples = measurements(rows, cfg.since, cfg.bg)
    .sort((a, b) => Date.parse(b.measured_at) - Date.parse(a.measured_at));
  const fastest = samples.length >= MIN_SAMPLES ? Math.max(...samples.map((l) => (l.max_speed_bps * 8) / 1e6)) : null;
  const capMbps = linkMbps ?? fastest;
  const capFrom = linkMbps ? 'test' : fastest ? 'measured' : null;
  const learn = samples.map(learnable).filter(Boolean);
  const bias = learnBias(learn, Date.now(), linkMbps);
  const manual = cfg.seedMbps > 0 ? cfg.seedMbps : null;
  return {
    capMbps, capFrom, samples, learnable: learn, bias, manual,
    n: bias.counted.n, trackerN: bias.tracker.n,
    seedMbps: manual ?? DEFAULT_SEED_MBPS * bias.counted.factor,
    trackerSeedMbps: manual ?? DEFAULT_SEED_MBPS * bias.tracker.factor,
    measuredFactor: bias.measured.factor,
    source: manual ? 'manual' : bias.counted.n ? 'measured' : 'default',
  };
}
```
3. Reemplazar `trackPlayback` completa (y su JSDoc) por:
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

/** Cada fila de reproducción del núcleo (~1 s). `ev` = evidencia de respaldo (`evidenceOf` del
 *  catálogo); si hay una foto de ▶/⤓ de menos de 6 h, manda esa. Guarda por segundo, en los segundos
 *  30–300 de descarga activa, `[seg, bytes/s, seeds, peers, entrantes]`: la ventana de "lo real". */
export function trackPlayback(row, ev) {
  const hash = row.key.split(':')[0];
  let t = playing.get(row.key);
  if (!t || t.id !== row.id) {
    t = { id: row.id, name: row.name, sum: 0, n: 0, max: 0, speeds: [], win: [], incoming: 0 };
    const p = load().pred?.[hash];
    t.ev = p && Date.now() - Date.parse(p.at) < PRED_TTL_MS ? p : ev;
    playing.set(row.key, t);
  }
  t.source = row.state.kind === 'background' ? 'background' : 'reproducción';
  t.done = (row.progress ?? 0) >= 0.999;
  t.active = ['playing', 'background'].includes(row.state.kind) && !t.done;
  if (!t.active) return;
  t.sum += row.speed_bps;
  t.n += 1;
  t.max = Math.max(t.max, row.speed_bps);
  if (t.speeds.length < 3600) t.speeds.push(row.speed_bps);
  t.incoming = Math.max(t.incoming, row.incoming_peers ?? 0);
  if (t.n > SHORT_FROM && t.n <= WIN_TO && (row.progress ?? 0) < 0.95)
    t.win.push([t.n, row.speed_bps, row.seeds ?? 0, row.peers ?? 0, row.incoming_peers ?? 0]);
  noteIncoming(t);
  // Cada 10 s hasta el fin de la ventana se guarda (pisa la anterior de ese torrent).
  const predicts = KINDS.some((k) => rawPrediction(t.ev, k) != null);
  if (predicts && t.n % 10 === 0 && t.n <= WIN_TO + 10) addSample(hash, t);
  else window.dispatchEvent(new Event('health-calib-changed'));
}
```
4. `measuringNow`: reemplazar `seeds: t.seeds, tracker_seeds: t.tracker_seeds,` por `ev: t.ev,`.
5. Reemplazar `addSample` completa por:
```js
function addSample(hash, t) {
  const full = t.win.filter(([s]) => s > WIN_FROM);
  const short = full.length < WIN_MIN;
  const w = short ? t.win : full;
  if (w.length < (short ? SHORT_MIN : WIN_MIN)) return;
  const col = (i) => w.map((x) => x[i]);
  const cfg = load();
  const sample = { name: t.name, source: t.source, ev: t.ev, real_mbps: (sustained(col(1)) * 8) / 1e6, short, window_secs: w.length,
    real_seeds: Math.max(...col(2)), real_peers: Math.max(...col(3)), real_incoming: Math.max(...col(4)),
    avg_speed_bps: t.sum / t.n, sustained_bps: sustained(t.speeds), max_speed_bps: t.max, measured_secs: t.n,
    measured_at: new Date().toISOString(), network };
  const all = { ...cfg.bg, [hash]: sample };
  const keep = Object.entries(all).sort((a, b) => Date.parse(b[1].measured_at) - Date.parse(a[1].measured_at)).slice(0, MAX_SAMPLES);
  save({ ...cfg, bg: Object.fromEntries(keep) });
}
```
6. `recalibrate`: `export const recalibrate = () => { const { seedMbps, ...rest } = load(); save(rest); };` (hoy pierde `net`; perdería `pred`).
7. Encabezado del archivo: agregar una línea "Desde 2026-11-16 (salud fiel) aprende el sesgo análisis→reproducción por evidencia y da rangos: ver docs/plans/salud-fiel/salud-fiel.spec.md."
**Queda igual a propósito**: `measurements`, `MIN_SECS`, `resetCalibration` (sigue borrando `net`/`pred`: comportamiento existente, mencionado en §11), `incomingStatus`, `noteIncoming`, `speedOf`, `sustained`.
**Verificación** (goldens; desde /Users/monti/Documents/Dev/streamonte):
```sh
node --check /Users/monti/Documents/Dev/streamonte/ui/src/health-calib.js && node --input-type=module -e "
import assert from 'node:assert/strict';
const { learnBias, rawPrediction, predict, shownLevel, fidelity } = await import('file:///Users/monti/Documents/Dev/streamonte/ui/src/health-calib.js');
const now = Date.parse('2026-11-16T12:00:00Z');
const at = (d) => new Date(now - d * 864e5).toISOString();
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, a + ' vs ' + b);
const tr = { tracker_seeds: 2, tracker_leechers: 3, counted_seeds: null, counted_leech: null, analysis_mbps: null, probe_mbps: null, need_mbps: 1.4e9 * 8 / 2700 / 1e6 };
const s = (real, ev = tr, d = 0) => ({ real_mbps: real, ev, weight: 1, measured_at: at(d) });
near(rawPrediction(tr, 'tracker'), 7.5);
const p0 = predict(tr, { bias: {}, capMbps: null });
assert.deepEqual([p0.kind, p0.lo, p0.p50, p0.p75, p0.hi, p0.conf], ['tracker', 3.75, 7.5, 30, 60, 'baja']);
assert.deepEqual(shownLevel(p0, tr.need_mbps), { level: 1, shown: 0, probable: true });
assert.equal(predict(tr, { bias: {}, capMbps: 40 }).hi, 40);
let b = learnBias([], now, null); assert.equal(b.tracker.factor, 1);
b = learnBias([s(55)], now, null); near(b.tracker.bias, Math.log(55 / 7.5) / 3);
const e = (r) => s(7.5 * Math.exp(r));
near(learnBias([e(1.8), e(2.0), e(2.2)], now, null).tracker.bias, 1.2);
near(learnBias([e(1.8), e(2.0), e(2.2), s(0.1)], now, null).tracker.bias, 1.2);
near(learnBias([s(55, tr, 30)], now, null).tracker.nEff, 0.5);
assert.equal(learnBias([s(95, { ...tr, tracker_seeds: 60 })], now, 100).tracker.n, 0);
assert.ok(learnBias(Array.from({ length: 50 }, () => s(1e4)), now, null).tracker.bias <= Math.log(20) + 1e-9);
const r3 = predict(tr, { bias: learnBias([e(1.8), e(2.0), e(2.2)], now, null), capMbps: null });
near(r3.p50, 7.5 * Math.exp(1.2)); assert.equal(r3.conf, 'media');
near(r3.lo, r3.p50 * Math.exp(-0.2) * (1 - 1 / (2 * Math.sqrt(3))));
assert.equal(predict({ ...tr, counted_seeds: 0, counted_leech: 4 }, { bias: {} }).kind, 'counted');
assert.equal(predict({ ...tr, counted_seeds: 5, counted_leech: 0 }, { bias: {} }).kind, 'counted');
assert.equal(predict({ ...tr, counted_seeds: 1, counted_leech: 0 }, { bias: {} }).kind, 'tracker');
assert.equal(predict({ ...tr, analysis_mbps: 12 }, { bias: {} }).kind, 'measured');
const pc = predict({ ...tr, probe_mbps: 25, probe_capped: true }, { bias: {} });
assert.deepEqual([pc.kind, pc.p50, pc.conf], ['probe', 25, 'alta']);
assert.equal(shownLevel(pc, 10).probable, false);
near(predict(tr, { bias: {}, manual: 10 }).p50, 25);
const f = fidelity(Array.from({ length: 8 }, (_, i) => s(55, tr, 8 - i)), null);
assert.equal(f.n, 8); assert.ok(f.biasBefore < 0 && f.typAfter < f.typBefore);
assert.deepEqual([f.hits, f.pessimistic, f.optimistic, f.inBand], [8, 0, 0, 4]);
console.log('ok');"
```
→ imprime `ok`. Además: `grep -n "export function trackPlayback(row, ev)" /Users/monti/Documents/Dev/streamonte/ui/src/health-calib.js` → 1 línea.

### WP1-D — catalog.js + catalog.css: evidencia, salud con rango, orden (sonnet · high) — a las 17:00 casi todo hecho con la versión de 08: aplicar Δ1 (pasos 4–5), conservar `knownLine`/censo de la otra sesión en el tooltip
**owns**: /Users/monti/Documents/Dev/streamonte/ui/src/catalog.js, /Users/monti/Documents/Dev/streamonte/ui/catalog.css. Usa el contrato §5.1 (no lo implementa).
1. Imports: `import { humanBytes, mbps, nf, nf1, playbackText } from './format.js';` y `import { MIN_SECS, healthCalibration, notePrediction, predict, shownLevel, speedOf, trackPlayback } from './health-calib.js';`.
2. `seedsCounted`: cambiar `?? rowsOf(c.info_hash).find((e) => e.live)?.live.seeds ?? null;` por `?? rowsOf(c.info_hash).find((e) => e.live?.seeds > 0)?.live.seeds ?? null;` (una fila vieja trae 0 por `serde(default)` y no es "0 contados": si no, taparía a los trackers).
3. Antes de `function health(c)`: agregar
```js
/** Lo que el análisis sabe de una opción (salud fiel): de los candidatos del panel si está; si no, de
 *  la fila de la biblioteca (análisis `live` y trackers `scrape`). Entrada de `predict` (la salud que
 *  se muestra) y foto que se guarda al tocar ▶/⤓ (`notePrediction`), así se aprende de lo mostrado. */
function evidenceOf(hash, c = state.update?.candidates.find((x) => x.info_hash === hash)) {
  const live = rowsOf(hash).find((x) => x.live && !x.live.partial)?.live ?? null;
  const scrape = rowsOf(hash).find((x) => x.scrape)?.scrape ?? null;
  const sc = c ? seedsCounted(c) : live?.seeds > 0 ? live.seeds : null;
  const bps = c && neededBps(c);
  return {
    tracker_seeds: c ? seedsOf(c) : scrape?.seeders ?? null,
    tracker_leechers: c ? c.leechers ?? null : scrape?.leechers ?? null,
    counted_seeds: sc,
    counted_leech: sc == null ? null : c ? leechersOf(c) ?? 0 : Math.max(0, live.peers - live.seeds),
    analysis_mbps: live?.avg_speed_bps > 0 ? toMbps(live.avg_speed_bps) : null,
    probe_mbps: null, probe_capped: false, probe_cap_mbps: null, // Fase 2 (sonda con tope)
    need_mbps: bps ? toMbps(bps) : c ? TYPICAL_MBPS[c.resolution] ?? 3 : live?.duration_secs ? toMbps(live.file_size / live.duration_secs) : null,
    res: c?.resolution ?? null,
    known: counted.get(hash)?.known ?? null,
    completed: c?.completed ?? null,
  };
}
```
4. Reemplazar `health` completa (mantener `LEECH_SHARE` si otro código lo usa; si queda sin uso, borrarla) y su JSDoc por:
```js
/** Salud del stream (salud fiel, 2026-11-16): un RANGO de Mbps contra lo que pide (tamaño ÷
 *  duración). Lo que baja ahora manda; si no, `predict` (medición > sonda > el p50 más alto entre
 *  seeders contados y de trackers) corregido con lo aprendido en esta red. `level` = nivel del p50
 *  (0 ≥ 2×, 1 ≥ 1×, 2); `shown` sube uno si el p75 alcanza ("probable"). Null sin seeders conocidos
 *  o si nadie respondió al contar. */
function health(c) {
  if (knownSeeds(c) == null || counted.get(c.info_hash)?.reached === false) return null;
  const bps = neededBps(c);
  const cal = renderCal ?? healthCalibration(state.library.values());
  const ev = evidenceOf(c.info_hash, c);
  const pb = playbackOf(c.info_hash);
  const now = pb && speedOf(pb.key);
  // Lo que baja ahora (reproduciendo o ⤓, ≥ MIN_SECS) es lo real: manda, sin corregir (B6).
  const nowMbps = now?.n >= MIN_SECS ? toMbps(now.avg) : null;
  const r = nowMbps ? { kind: 'now', lo: nowMbps, p50: nowMbps, p75: nowMbps, hi: nowMbps, conf: 'alta' } : predict(ev, cal);
  if (!r) return null;
  const need = ev.need_mbps;
  return { ...shownLevel(r, need), range: r, basis: r.kind, conf: r.conf, ratio: r.p50 / need, supply: r.p50, need, exact: !!bps, ev, cal };
}
```
5. Reemplazar `healthBadge` y `signalSvg` (y sus JSDoc) por:
```js
const HEALTH_TEXT = [['Buena salud', 'Buena probable'], ['Puede cortarse', 'Puede alcanzar'], ['Mala salud', 'Mala salud']];
const HEALTH_SRC = { now: 'bajando ahora', measured: 'medido', probe: 'medido con tope', counted: 'seeders contados', tracker: 'trackers' };
const mbpsN = (v) => nf(v >= 10 ? Math.round(v) : v);
/** Salud como rango (salud fiel): ícono + "lo–hi Mbps" + de dónde sale, siempre que se conozca algún
 *  seeder. `compact` (reproduciendo) o lo que baja ahora: solo el ícono (la velocidad ya se ve). */
function healthBadge(c, compact = false) {
  const h = health(c);
  if (!h) return null;
  const { shown, probable, range: r, conf, basis, need, exact, ev, cal } = h;
  const text = HEALTH_TEXT[shown][probable ? 1 : 0];
  const cls = ['cat-health-good', 'cat-health-fair', 'cat-health-risky'][shown];
  const span = r.hi / Math.max(r.lo, 0.1) < 1.25 ? `~${mbpsN(r.p50)} Mbps` : `${mbpsN(r.lo)}–${mbpsN(r.hi)} Mbps`;
  const src = `${HEALTH_SRC[basis]}${conf === 'baja' ? ' · sin calibrar' : ''}`;
  const asks = exact ? `pide ~${Math.round(need)}` : `un ${resLabel(resKey(c))} suele pedir ~${Math.round(need)} (el real se sabe al analizarlo)`;
  const k = cal.bias?.[basis]?.factor ?? 1;
  const learned = Math.abs(k - 1) > 0.05 ? ` Corregido ×${nf1(k)} con lo que anduvieron tus reproducciones en esta red.` : '';
  const why = basis === 'now' ? 'Es lo que está bajando ahora.'
    : basis === 'measured' ? `Medido al analizarlo: ${mbpsN(ev.analysis_mbps)} Mbps.${learned}`
      : basis === 'probe' ? `Medido bajando el inicio con tope de ${mbpsN(ev.probe_cap_mbps)} Mbps${ev.probe_capped ? ': llegó al tope, sobra.' : '.'}${learned}`
        : basis === 'counted' ? `${ev.counted_seeds} seeders contados y ${ev.counted_leech} leechers.${learned}`
          : `${ev.tracker_seeds} seeders y ${ev.tracker_leechers ?? 0} leechers según los trackers.${learned}`;
  const internet = cal.capMbps && r.hi >= cal.capMbps ? ` Tope: tu internet, ${Math.round(cal.capMbps)} Mbps.` : '';
  const tip = `${text}: entre ${mbpsN(r.lo)} y ${mbpsN(r.hi)} Mbps, lo más probable ~${mbpsN(r.p50)}; ${asks} (${nf1(h.ratio)}×).\n${why}${internet}\nConfianza: ${conf}.${conf === 'alta' ? '' : ' Cargar en background (⤓) la mide de verdad.'}\nTocá para verificarla de nuevo.`;
  const attrs = { id: `cat-health-${c.info_hash}`, title: tip, 'aria-label': `${text}, ${span}, ${src}, confianza ${conf}: verificar de nuevo`, onclick: () => reanalyze([c.info_hash]) };
  const svg = signalSvg(3 - shown, probable);
  if (compact || basis === 'now') {
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
6. `optionRow`: en la línea `pbStatus ? el('span', { class: 'cat-mini-stats' }, healthBadge(c), …` cambiar `healthBadge(c)` por `healthBadge(c, true)`. La de `healthBadge(c) ?? (busy ? null : verifyButton(c))` no cambia.
7. `sortOptions`, dentro de `key`, reemplazar desde `const h = health(c);` hasta el `return [...]` por:
```js
    const h = health(c);
    const lvl = h?.shown ?? 3;
    const good = lvl === 0;
    const bySize = good && !h.probable && h.exact && !c.is_pack; // el peso de un pack es de varios episodios
    return [-tierOf(c), lvl, h?.probable ? 1 : 0, good && !bySize ? 1 : 0, bySize ? -(c.size_bytes ?? 0) : -(h?.ratio ?? -1)];
```
   y en su JSDoc cambiar "por salud" por "por salud mostrada (las seguras antes que las probables)". Tier 1 sigue por `bySeeds` (D7).
8. `measurePlayback`: reemplazar sus 3 primeras líneas (`const hash = …`, el comentario de trackers, `const c = …` y `trackPlayback(row, …)`) por `const hash = row.key.split(':')[0];` + `trackPlayback(row, evidenceOf(hash));`.
9. `toggleBg` (rama sin `b`) y `playOption`: justo ANTES de `const [row] = await api.catalogAdd(…)`, agregar `notePrediction(hash, evidenceOf(hash));`.
10. "Mejor opción" (`const confirmed = … health(c)?.level === 0;`): reemplazar `health(c)?.level === 0` por `(() => { const h = health(c); return h?.level === 0 && !h.probable; })()` (B8: lo probable no se recomienda). `anyGood` igual (usa `level`).
11. catalog.css, después de la regla `button.cat-health-ic:hover`:
```css
/* Salud como rango (salud fiel, 2026-11-16): ícono + "lo–hi Mbps" + de dónde sale. */
.cat-health { display: inline-flex; align-items: center; gap: 6px; min-height: 44px; padding: 2px 8px 2px 4px; border: none; border-radius: 10px; background: none; cursor: pointer; text-align: left; }
.cat-health:hover { background: color-mix(in srgb, var(--text) 8%, transparent); }
.cat-health:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
.cat-health .cat-health-ic { cursor: inherit; }
.cat-health-txt { display: flex; flex-direction: column; gap: 1px; line-height: 1.2; white-space: nowrap; }
.cat-health-range { font-size: 12.5px; font-weight: 600; color: var(--text); font-variant-numeric: tabular-nums; }
.cat-health-src { font-size: 11px; font-weight: 500; color: var(--muted); }
/* Probable: la barra más alta, a medias. */
.cat-health-ic rect.on.maybe { fill-opacity: .4; }
```
**Queda igual a propósito**: `knownSeeds`, `tierOf`, `bySeeds`, `lightOf`, `bgText`, `heavyBadge`, `verifyButton`, `runDeep`, `countSeeds` (los toca la Fase 2), `TOP`, `FINALISTS`.
**Verificación**: `node --check /Users/monti/Documents/Dev/streamonte/ui/src/catalog.js` sin salida; `grep -c "evidenceOf(" /Users/monti/Documents/Dev/streamonte/ui/src/catalog.js` ≥ 5; `grep -n "cal.seedMbps\|perSeed" /Users/monti/Documents/Dev/streamonte/ui/src/catalog.js` → nada.

### WP1-E — speed.js + styles.css: "Tu conexión" con fidelidad (sonnet · medium) — a las 17:00 la tarjeta existe: ajustar a la `fidelity` nueva (campos `optimistic`, `inBand`; criterio `ok` de abajo)
**owns**: /Users/monti/Documents/Dev/streamonte/ui/src/speed.js, /Users/monti/Documents/Dev/streamonte/ui/styles.css.
1. Import de health-calib: agregar `fidelity, predict` (quitar los que queden sin uso al final; `MIN_SAMPLES` deja de usarse).
2. `perSeedNote`: `cal.source === 'manual' ? 'Fijado a mano' : cal.n ? `Aprendido de ${cal.n} reproducciones en esta red (×${nf1(cal.bias.counted.factor)} sobre ${DEFAULT_SEED_MBPS})` : `Sin reproducciones en esta red: ${DEFAULT_SEED_MBPS} Mbps (se aprende solo)``.
3. Línea "Con seeders de trackers": `` `Con seeders de trackers: ${nf1(cal.trackerSeedMbps)} Mbps por seeder (${cal.trackerN} reproducciones)` `` y debajo `el('span', { class: 'conn-sub' }, `Medición del análisis: ×${nf1(cal.measuredFactor)} (${cal.bias.measured.n} reproducciones)`)`.
4. "Midiendo:": sufijo `now[0].ev ? '' : ' (sin datos del análisis: no cuenta)'`.
5. Tarjeta nueva entre `incoming` y `how` (y sumarla a `pop.replaceChildren(…)` en ese orden):
```js
  // Fidelidad (salud fiel): lo que dijo la salud al tocar ▶ vs lo que bajó en los minutos 2–5.
  const f = fidelity(cal.learnable, cal.capFrom === 'test' ? cal.capMbps : null);
  const ok = f && f.n >= 8 && Math.abs(f.biasAfter) <= Math.log(1.5) && f.hits / f.n >= 0.75 && f.pessimistic / f.n <= 0.1;
  const dir = (x) => (x < 0 ? `pesimista ×${nf1(Math.exp(-x))}` : `optimista ×${nf1(Math.exp(x))}`);
  const fid = el('div', { id: 'conn-fidelity', class: `conn-card ${ok ? 'ok' : ''}` },
    el('span', { class: 'conn-main' },
      el('span', { class: 'conn-title' }, f ? `Fidelidad: acertó ${f.hits} de ${f.n} niveles` : 'Fidelidad: sin datos'),
      el('span', { class: 'conn-sub' }, f
        ? `Sin aprender: ${dir(f.biasBefore)} (error típico ×${nf1(Math.exp(f.typBefore))}). Con lo aprendido: ${dir(f.biasAfter)} (×${nf1(Math.exp(f.typAfter))}). Dijo menos de lo que anduvo ${f.pessimistic} veces y más ${f.optimistic}; lo real cayó dentro del rango ${f.inBand} de ${f.n}.`
        : 'Se calcula al reproducir 2 minutos algo cuya salud se mostró.')));
```
6. Hint de `how`: reemplazar la última oración (desde "Cada reproducción de más de") por `Cada reproducción (minutos 2 a 5) compara lo que mostró la salud con lo que bajó de verdad y corrige la estimación, aparte para cada red (casa, trabajo…).`. En `conn-formula`, `seeders × ${nf1(cal.seedMbps)}` queda (ya es 3 × factor).
7. Lista de mediciones: si `l.ev`, texto `` `predijo ${nf1(p)} → real ${nf1(l.real_mbps)} Mbps (×${nf1(l.real_mbps / p)}) · reales ${l.real_seeds} seeders / ${l.real_peers} peers (${l.real_incoming} entrantes)${l.short ? ' · corta' : ''} · ${ago(l.measured_at)}` `` con `const p = predict(l.ev, { bias: {}, capMbps: null })?.p50` (si `p` es null: `` `real ${nf1(l.real_mbps)} Mbps · sin predicción · ${ago(l.measured_at)}` ``); si no, el texto de hoy.
8. styles.css: a la regla `.conn-incoming.open .conn-title { color: var(--green); }` agregarle el selector `.conn-card.ok .conn-title`.
**Verificación**: `node --check /Users/monti/Documents/Dev/streamonte/ui/src/speed.js` sin salida; `grep -c "conn-fidelity" /Users/monti/Documents/Dev/streamonte/ui/src/speed.js` → 1.

### WP1-Z — Integración Fase 1 (opus · high, tanda 1.2)
**owns**: los archivos de WP1-R…E (solo correcciones de integración).
**Verificación final**: todos los comandos de WP1-R…E; `cargo check -p streamonte` verde; en la app (`cargo tauri dev` desde /Users/monti/Documents/Dev/streamonte/src-tauri/, gate humano): (1) título sin analizar → cada opción con seeders muestra rango "trackers · sin calibrar"; las sin seeders, "Verificar salud"; (2) con "Tu conexión" vacío: fidelidad "sin datos", sin errores de consola; (3) ▶ en una opción → `JSON.parse(localStorage['streamonte.health']).pred[hash]` existe; a los 3 min `bg[hash]` tiene `ev`, `real_mbps`, `short: false`, `real_seeds`; (4) cortar otra a los 90 s → `short: true`; (5) "Ver detalle" de una reproducción muestra la línea "por peer:" cada 10 s.

## 8. Fase 2 — un motor de análisis: arranca solo, escucha, mide con tope (compuerta: X2 PASA; escucha solo si X1 SIGUE)

**Objetivo**: reemplazar "contar seeders 1–4 min al apretar" por "medir Mbps reales ~60 s desde que se abre el título", con los peers que llegan solos. **Qué ve el usuario**: al abrir un título, sin clic, las 10 mejores del grupo abierto pasan a "midiendo ↓ X Mbps · N peers"; al terminar, salud "~X Mbps · medido con tope" o "Llegó al tope: sobra"; ▶ arranca con lo ya bajado. Ajustes → Red: toggle de anunciarse (si X1). **Estimación**: varios módulos (analyzer nuevo, swarm, app, events, config, Tauri, 4 archivos UI) · alta (presupuesto de ancho de banda compartido, ventana adaptativa, cancelación cooperativa, ciclo de vida puerto/lease/carpeta) · investigar (comportamiento real del limitador; X2 lo baja a conocido).

Tanda 2.1 en paralelo: WP2-A, WP2-B, WP2-C. Tanda 2.2: WP2-Z (opus · high). Después de X3: WP2-D.

### WP2-A — `analyzer/probe.rs` (sonnet · high)
**owns**: /Users/monti/Documents/Dev/streamonte/crates/core/src/analyzer/probe.rs (nuevo), /Users/monti/Documents/Dev/streamonte/crates/core/src/analyzer/swarm.rs, /Users/monti/Documents/Dev/streamonte/crates/core/src/analyzer.rs, /Users/monti/Documents/Dev/streamonte/crates/core/src/analyzer/speed.rs (solo visibilidad).
1. swarm.rs: extraer de `count_one` el bucle de metadatos (desde `let meta = engine.metadata(handle);` hasta el `let Some(metadata) = got else {…}` sin su cuerpo) a `wait_alive_metadata` (§5.3): `progress(n)` se llama donde hoy se emite `SwarmCount { seeds: 0, peers: dht_peers, reached: false }`. `count_one` lo llama y conserva su rama `None` (conteo de la DHT). Mismas constantes (B26). Test: ninguno nuevo (comportamiento igual); `cargo test -p streamonte-core swarm` verde.
2. probe.rs: constantes (no van a config.json):
```rust
const CAP_FACTOR: f64 = 2.5;         // "llega a 2,5× lo que pide" = buena con confianza
const MAX_PEERS: u32 = 20;           // 10 × 20 = 200 conexiones (B26: 300 saturaba routers)
pub const PROBE_CONCURRENCY: usize = 10;
const TTFB_MAX_SECS: u64 = 15;
const MIN_SECS: usize = 10;          // = MIN_SECS de health-calib.js
const HOLD_SECS: usize = 8;          // 8 s seguidos ≥ 0,9 × tope = llegó
const MAX_SECS: usize = 30;
const TOTAL_SECS: u64 = 120;         // corte duro de la tanda (lo no medido: skipped)
const MAX_TOTAL_BYTES: u64 = 1_500_000_000;
const LINK_SHARE: f64 = 0.85;
const DEFAULT_LINK_MBPS: f64 = 50.0;
const PEERS_SAVE_SECS: u64 = 5;      // la caché de peers fresca aunque ▶ corte la sonda
```
   Tipos y `probe` de §5.3. Funciones puras con tests en el archivo: `fn cap_bps(need_bps: f64, link_bps: f64) -> (f64, bool)` (= `clamp(CAP_FACTOR·need, 65 536, LINK_SHARE·link)`, `true` si recortó el link); `enum Stop { Continue, HitCap, Stable, MaxSecs }` + `fn should_stop(samples: &[f64], cap: f64) -> Stop` (HitCap: ≥ MIN_SECS muestras y las últimas HOLD_SECS ≥ 0,9·cap; Stable: ≥ 15 y `!still_rising`; MaxSecs: ≥ MAX_SECS); `fn summarize(samples: &[(f64, bool)], cap: f64, peers: u32) -> (f64, f64, bool, bool, bool)` = (sustained = mediana de la segunda mitad de las no saturadas si quedan ≥ 6, si no de todas — MISMA definición que X2; max; hit_cap; link_limited = no llegó al tope y > 30 % saturadas; peer_limited = no llegó al tope y peers ≥ MAX_PEERS); `fn ramp_secs(samples: &[f64], sustained: f64) -> Option<f64>`; `struct Budget` con `async fn take(&self, bps: f64, until: Instant) -> bool` y `fn give(&self, bps: f64)` (Mutex<f64> + Notify). Visibilidad `pub(super)` para `still_rising` y `median` de speed.rs.
3. `probe()` — flujo (de 03 §4.3 con estos cambios):
   - Motor: `engine_cfg.max_connections = MAX_PEERS`; `create_for_playback` si `cfg.engine.announce_early && cfg.engine.incoming` (campo existe solo si X1 SIGUE; si no, siempre `create`). Error → mapa vacío.
   - Orden: los items con `paths.torrent_cache_file(&hash).is_file()` primero (F8); `Semaphore(PROBE_CONCURRENCY)` (FIFO).
   - Por item: carpeta = `reserve_dir` de live.rs con tag `probe` (FR-06d; si está reservada, descartable). `add_cached_or_magnet` con `download_bps: Some(cap_hint)`, `cap_hint = cap_bps(need_hint)` (need_hint = `need_bps_hint` o 375 000 bytes/s = 3 Mbps). `wait_alive_metadata` (progreso → `on_update(hash, {reached:false, peers:n,..}, false)`). Sin metadatos → `{reached:false, peers}` final. Con metadatos: guardar `.torrent` en caché; `pick_file(pick)`; `need_bps = file.size / runtime_secs` (o hint); si `cap_bps(need) > 1,05·cap_hint`: `save_peers`, `remove`, re-agregar (desde la caché) con el tope correcto. Si `progress ≥ 0,999` → `skipped`. `hold_peers` hasta que `budget.take(cap)` dé lugar (si vence TOTAL_SECS o se superó MAX_TOTAL_BYTES → `skipped` con lo contado). `select_file`; bucle de 1 s con `stats` (timeout 2 s): bps por Δ`received_bytes`, máximos de seeds/peers/`known_peers`/`incoming_peers`, saturación (Σ bps de todos ≥ 0,9·link), re-reserva a los 6 s (`clamp(1,3·mediana(últimos 5), 0,25·cap, cap)`, nunca crece), `save_peers` cada PEERS_SAVE_SECS, evento de progreso cada 2 s, `should_stop`. Sin primer byte a TTFB_MAX_SECS → `started = false`.
   - **Cancelación cooperativa**: cada tarea mira `cancel.is_cancelled()` en cada vuelta y sale por el camino normal de cierre (no `abort`): `save_peers(connected_peers)`, `remove { delete_data: false }`, `budget.give`, `release_dir(keep = la de análisis)`. El bucle principal, ya cancelado, espera las tareas ≤ 4 s y recién ahí `abort_all`.
   - Fin: `engine.shutdown()`. Log `tracing::info!` por item ("medición con tope": hash, need, cap, ttfb, ramp, sostenida, hit_cap, link_limited, peers, seeds, known, incoming, secs) y uno de resumen (medidos, salteados, segundos, bytes).
**Verificación**: `cargo test -p streamonte-core probe` verde (tests de `cap_bps`, `should_stop`, `summarize`, `ramp_secs`, `Budget` take/give/timeout); `cargo check -p streamonte-core --all-targets`, `cargo clippy -p streamonte-core --all-targets` sin errores nuevos.

### WP2-B — App, eventos, config, Tauri, Ajustes (sonnet · medium)
**owns**: /Users/monti/Documents/Dev/streamonte/crates/core/src/app.rs, /Users/monti/Documents/Dev/streamonte/crates/core/src/events.rs, /Users/monti/Documents/Dev/streamonte/crates/core/src/config.rs, /Users/monti/Documents/Dev/streamonte/crates/core/src/engine/rqbit/net.rs (solo comentario ADR-30), /Users/monti/Documents/Dev/streamonte/crates/core/src/engine/mod.rs (solo comentarios ADR-30), /Users/monti/Documents/Dev/streamonte/src-tauri/src/commands.rs, /Users/monti/Documents/Dev/streamonte/src-tauri/src/lib.rs, /Users/monti/Documents/Dev/streamonte/ui/src/api.js, /Users/monti/Documents/Dev/streamonte/ui/index.html, /Users/monti/Documents/Dev/streamonte/ui/src/dialogs.js, /Users/monti/Documents/Dev/streamonte/ui/src/app.js. R7 aplica (app.rs, config.rs, engine/mod.rs, dialogs.js).
1. events.rs: los dos eventos de §5.3 junto a `CatalogSwarmProgress` (mismo `serde` que los vecinos).
2. app.rs: campo `analysis_engine: Arc<tokio::sync::Mutex<()>>` (init `Arc::default()` junto a `swarm_cancel`). `catalog_probe` (después de `catalog_swarm`): `let cancel = self.swarm_cancel.lock().expect("swarm").clone();` ANTES de `let _alive = self.analysis_engine.clone().lock_owned().await;` (dos pedidos se serializan: nunca dos motores de análisis); `VideoId::parse(video_id)?`; por hash: `self.catalog.candidate(&video, &hash)` → `FilePick { index: c.file_idx, episode: video.episode() }` y `Magnet` de `self.catalog.magnets_of`; llama `probe(…)` emitiendo `CatalogProbed` (done) / `CatalogProbeProgress`. `stop_catalog_analysis` (privada): `std::mem::take(&mut *self.swarm_cancel.lock().expect("swarm")).cancel();` + `let _ = tokio::time::timeout(Duration::from_secs(5), self.analysis_engine.lock()).await;`. En `play` agregar `self.stop_catalog_analysis().await;` antes de `self.playback.start(req)`; en `playback_action`, si `matches!(action, PlaybackAction::ResumeDownload)`, lo mismo antes de `act` (F16).
3. **Solo si X1 SIGUE**: config.rs `EngineConfig`: después de `pub utp: bool,` el campo de §5.3 con doc "Salud fiel (2026-11-16): el motor de análisis del catálogo escucha con el puerto real y se anuncia a trackers y DHT; la IP queda listada ~30 min en los enjambres de las 10 mejores opciones del título abierto." y `announce_early: true` en el `Default` (junto a `utp: true`). `set_network(&self, incoming, upnp, announce_early)` → `c.engine.announce_early = announce_early;`. commands.rs `config_set_network` con el 3er parámetro; api.js `setNetwork` de §5.3. index.html, después de la línea de `#set-upnp`: `<label class="setting-check"><input id="set-announce" type="checkbox"> Analizar apenas abro un título y anunciarme a los peers (más fiel; tu IP queda listada ~30 min en los enjambres de las 10 mejores opciones)</label>`. dialogs.js: al cargar `$('#set-announce').checked = engine.announce_early; $('#set-announce').disabled = !engine.incoming;`; al guardar, mismo `disabled` y pasar `$('#set-announce').checked` como 3er argumento. app.js: `$('#set-announce').addEventListener('change', saveNetwork);`. Comentarios ADR-30 (net.rs encabezado, rqbit.rs `spawn`, engine/mod.rs `create`/`create_for_playback`, config.rs `incoming`): agregar "y el motor de análisis del catálogo con `announce_early` (salud fiel)".
4. commands.rs: `#[tauri::command] pub async fn catalog_probe(core: Core<'_>, video_id: String, items: Vec<ProbeItem>, runtime_secs: Option<u32>, link_mbps: Option<f64>) -> CmdResult<HashMap<InfoHash, ProbeResult>>`; registrar en lib.rs junto a `commands::catalog_swarm,`. api.js: `catalogProbe` de §5.3 junto a `catalogSwarm`.
**Verificación**: `cargo check -p streamonte-core --all-targets`, `cargo check -p streamonte`, `cargo test -p streamonte-core config` verdes; `node --check` de api.js, dialogs.js, app.js sin salida; si X1 SIGUE: un `config.json` sin `announce_early` carga con `true` (test existente de config).

### WP2-C — catalog.js: arranque solo, sonda en la salud (sonnet · high)
**owns**: /Users/monti/Documents/Dev/streamonte/ui/src/catalog.js.
1. Estado junto a `counted`: `/** Sondas con tope (salud fiel F2): hash → ProbeResult final. */ const probed = new Map();` y `const liveProbe = new Map();` (parcial).
2. `countSeeds`: reemplazar `const found = await api.catalogSwarm(todo, true);` por
```js
    const cal = renderCal ?? healthCalibration(state.library.values());
    const items = todo.map((h) => { const c = state.update?.candidates.find((x) => x.info_hash === h); const bps = c && neededBps(c); return { hash: h, need_bps_hint: bps ?? ((TYPICAL_MBPS[c?.resolution] ?? 3) * 1e6) / 8 }; });
    const found = await api.catalogProbe(video, items, state.side.runtime ? state.side.runtime * 60 : null, cal.capFrom === 'test' ? cal.capMbps : null);
```
   y en el `for`: `if (found[h]) probed.set(h, found[h]);` y `counted.set(h, found[h] ? { seeds: found[h].seeds, peers: found[h].peers, reached: found[h].reached, known: found[h].known } : { seeds: 0, peers: 0, reached: false })` respetando la condición de `stopped` existente. En `finally`, también `liveProbe.delete(h)`.
3. Eventos en el `switch` de `onCoreEvent`: `case 'catalog-probe-progress':` = igual que `catalog-swarm-progress` con `liveProbe.set(event.hash, event.probe)` y `liveCount.set(event.hash, { seeds: event.probe.seeds, peers: event.probe.peers, reached: event.probe.reached })`; `case 'catalog-probed':` = igual que `catalog-swarm-counted` + `probed.set(event.hash, event.probe)` + `counted.set` del punto 2.
4. `evidenceOf`: reemplazar la línea `probe_mbps: null, …` por
```js
    ...((p) => (p?.started && p.secs >= MIN_SECS && !p.link_limited
      ? { probe_mbps: toMbps(p.sustained_bps), probe_capped: p.hit_cap, probe_cap_mbps: toMbps(p.cap_bps) }
      : { probe_mbps: null, probe_capped: false, probe_cap_mbps: null }))(probed.get(hash)),
```
5. Arranque solo (C2). **Si `startEarly` ya existe (01, §2b)**: conservarla con estos cambios y saltear el bloque de abajo: filtro `inScope(c, openRes)`; en `onStreams` quitar la condición `cfg.engine.announce_early && cfg.engine.incoming` (D6: arranca siempre; si escucha lo decide el núcleo) y llamar `startEarly()` directo; el estado `d.status`/`d.hashes` como en `runEarly`. Si no existe, junto a `TOP`:
```js
/** Salud fiel F2: al llegar las opciones se miden solas las EARLY_TOP mejores por trackers del grupo
 *  abierto (una tanda de probe::PROBE_CONCURRENCY). "Chequear" mide el resto. */
const EARLY_TOP = 10;
function startEarly() {
  const ranked = (state.update?.candidates ?? []).filter((c) => inScope(c, openRes) && !unlikely(c) && !counted.has(c.info_hash) && !counting.has(c.info_hash))
    .sort((a, b) => (seedsOf(b) ?? -1) - (seedsOf(a) ?? -1));
  const hashes = ranked.slice(0, EARLY_TOP).map((c) => c.info_hash);
  if (hashes.length) runEarly(hashes);
}
async function runEarly(hashes) {
  const d = state.side.deep;
  d.status = 'run'; d.res = openRes; d.hashes = hashes; deepDone.clear();
  await countSeeds(hashes);
  if (state.side?.deep === d) { d.status = d.stopped ? null : 'done'; d.stopped = false; renderStreamsOnly(); }
}
```
   En `onStreams`, después de `state.update = update;`: `if (update.done && !state.side.earlyStarted) { state.side.earlyStarted = true; startEarly(); }`; en `loadStreams`, junto a `state.side.subsStarted = false;`: `state.side.earlyStarted = false;`. (Si `inScope(c, openRes)` con `openRes = null` incluye todas, se usa así; no tocar `inScope`.)
6. Fila mientras mide: si `liveProbe.get(hash)?.started`, `el('span', { id: `cat-probe-live-${c.info_hash}`, class: 'cat-speed', role: 'status' }, `↓ ${mbps(lp.max_bps)} · ${lp.peers} peers`)` en el lugar de `light.text` de la celda de peso.
7. Textos: `DEEP_ETA = '~1 min'`; tooltip de `verifyButton`: "Mide la velocidad real de este torrent bajando el inicio con tope (~30 s). Deja guardados sus metadatos, peers y lo bajado: si después lo elegís, arranca más rápido."; `reanalyze` también `probed.delete(h)`; `finalists` ordena por `probed.get(h)?.sustained_bps ?? 0` y después seeds.
**Verificación**: `node --check /Users/monti/Documents/Dev/streamonte/ui/src/catalog.js` sin salida; `grep -c "api.catalogSwarm" /Users/monti/Documents/Dev/streamonte/ui/src/catalog.js` → 0.

### WP2-Z — Integración Fase 2 (opus · high)
Verificación manual (gate humano, `cargo tauri dev`): (1) abrir una película con 4K/1080p → sin clic, 10 filas "midiendo", log con "medición con tope" por torrent, panel "hecho" p50 ≤ 60 s / p90 ≤ 90 s (anotar en §12); (2) Monitor de Actividad: bajada total ≤ link; conexiones ≤ ~200; (3) ▶ a mitad → en ≤ 5 s arranca, log de la reproducción "reuso lo bajado al analizar (FR-06d)" y peers iniciales > 0, mismo puerto que el análisis si X1 SIGUE (`rqbit red: entrantes: escucha … puerto`); (4) cerrar el panel a mitad → no quedan carpetas `*-probe` en downloads; `analysis_dir` queda; (5) toggle apagado → el motor no escucha (log sin "escucha").
**Queda igual a propósito**: `swarm::count`, `App::catalog_swarm`, `api.catalogSwarm` sin uso desde la UI (D11: borrar tras validar métricas); `measure_with` y análisis rápido de finalistas; `TOP = 15`.

### WP2-D — Peers rápidos sobre la sonda (compuerta X3 PASA) (sonnet · medium)
**owns**: /Users/monti/Documents/Dev/streamonte/crates/core/src/analyzer/probe.rs, /Users/monti/Documents/Dev/streamonte/ui/src/catalog.js.
- probe.rs: snapshot `engine.peer_bytes(h)` al primer byte + 5 s y al final → `ProbeResult.peer_rates = Some(peer_rates(&a, &b, dt))`.
- catalog.js `health`: si `basis === 'probe'` y `probed.get(hash)?.peer_rates` y `level === 0`: `robust = (Σ rates − rates[0])·8/1e6`; si `robust < need` → `level = 1`, `shown` recalculado con `shownLevel` y `concentrated = true`. Tooltip: "N peers dieron datos; el mejor ~X Mbps, sin él quedan ~Y." y si `concentrated`: "Depende de un solo peer: si se va, puede cortarse."
**Verificación**: `cargo test -p streamonte-core probe`; `node --check` catalog.js.

## 9. Fase 3 — tamaño del enjambre y curva (experimental)

**Objetivo**: cubrir lo que la sonda no ve (opciones fuera del top, torrents que no arrancan, enjambres que crecen a los minutos). **Usuario**: tooltips "La red conoce ~N direcciones"; un 0/0 de trackers con direcciones en la DHT deja de saltearse como muerto. **Estimación**: varios módulos (engine, swarm, app, Tauri, catalog.js, health-calib.js) · media (búsquedas DHT concurrentes con plazo y cancelación) · experimental (si `known`/censo correlacionan con Mbps reales; si la llegada de peers es exponencial).

### WP3-A — Censo DHT + `known` como evidencia (sonnet · high) — a las 17:00 el censo y el registro ya están (07 pasos 1–6): quedan E0–E3 y P2a/P2b
Diseño de /Users/monti/Documents/Dev/streamonte/docs/plans/salud-fiel/07-enjambre-pex-dht.spec.md §2b, §3, pasos 7–8, con estos cambios: (a) el censo usa motor `engine::create` (sin escucha) y el `swarm_cancel` (como ya está); (b) la Fase 2 no lo espera; (c) P2a como en 07 paso 8; (d) P2b NO es `Math.max(raw, rawKnown)`: es una evidencia nueva `known` en `KINDS` (después de `counted`) con `rawPrediction(ev, 'known') = Math.max(MIN_PRED_MBPS, ev.known * LEECH * DEFAULT_SEED_MBPS)` (cada dirección conocida pesa como un leecher), su propio factor aprendido, y entra al `max` de `predict` solo si `cal.incomingOpen` (= `incomingStatus()?.open`, nuevo campo de `healthCalibration`). Se implementa solo si E3 pasa.
Compuertas: E0 (≥ 80 % de candidatos con trackers > 0 tienen censo > 0 en 12 s; si no, 20 s; si tampoco, sin P2a) y E2/E3 de 07 §4 paso 7. **owns**: los de 07 pasos 3–8 (engine/mod.rs, rqbit.rs, swarm.rs, app.rs, commands.rs, lib.rs, api.js, catalog.js, health-calib.js). Anuncio UDP (07 paso 9): descartado.

### WP3-B — Curva del enjambre (compuerta: X2 NO PASA, o en uso ≥ 30 % de sondas con `started = false`) (sonnet · high)
Diseño literal de /Users/monti/Documents/Dev/streamonte/docs/plans/salud-fiel/05-extrapolar-enjambre.spec.md T2, T3, T5, T7–T10 con estos cambios: (a) T1 ya hecho (WP1-R); (b) T4 y T6 se reemplazan: la serie del conteo va en `ev.curve` (WP1-D `evidenceOf` + mapa `curves` de T5) y la proyección es una evidencia `projected` en `KINDS` con su propio factor aprendido (C4); `projSeedMbps` y `useCurve` por dispersión se descartan; la compuerta de uso queda en `curveState(net).ok` (G1+G2 de 05); (c) T8/T9 (ventana corta de 20 s) solo si la Fase 2 no se construyó.

## 10. Fase 4 — motor vivo (idea 2) (compuerta: tras 2 semanas de Fase 2, fidelidad < 75 % con los errores concentrados en pesimistas cuyo `real_incoming` > 0 o `real_peers` > 2× los de la sonda)

**Objetivo**: que el análisis pase minutos en el enjambre como la reproducción. **Usuario**: la salud se sigue actualizando mientras el panel está abierto ("En vivo · N s · X entrantes"), con botón Detener. **Estimación**: varios módulos (probe.rs, app, Tauri, catalog.js) · alta (ciclo de vida largo, re-sonda, disco) · experimental.
Diseño: extensión de `probe.rs`, no módulo nuevo. Al terminar la tanda, el motor NO se apaga: mantiene `hold_peers` de los `WATCH_N = 8` mejores del grupo, emite `CatalogProbeProgress` cada 5 s (seeds/peers/entrantes/known) y a los `REPROBE_AFTER_SECS = 120` re-sonda los 3 de mayor `sustained_bps` (tope ya fijado al agregar: si el tope quedó corto, re-agregar como en WP2-A). Fin: ▶ (C3), cerrar panel/otro título, `MAX_MINUTES = 10`, o `#cat-live-stop` (`<button id="cat-live-stop">Detener</button>` junto a `<span id="cat-live-status">Salud en vivo · N opciones · M midiendo</span>` en la cabecera del grupo; llama `api.catalogStopSwarm()`). Presupuesto de disco: el de WP2-A más 2 GB. Experimento previo: ejemplo de 02 §6 paso 3 adaptado a `probe()` (criterios (i)–(iv) de 02).

## 11. Config y constantes (defaults)

| Dónde | Nombre | Default | Fase |
|---|---|---|---|
| /Users/monti/Documents/Dev/streamonte/crates/core/src/config.rs `EngineConfig` | `announce_early` | `true` (D4) | 2, solo si X1 SIGUE |
| /Users/monti/Documents/Dev/streamonte/crates/core/src/analyzer/probe.rs | `CAP_FACTOR` 2,5 · `MAX_PEERS` 20 · `PROBE_CONCURRENCY` 10 · `TTFB_MAX_SECS` 15 · `MIN_SECS` 10 · `HOLD_SECS` 8 · `MAX_SECS` 30 · `TOTAL_SECS` 120 · `MAX_TOTAL_BYTES` 1,5 GB · `LINK_SHARE` 0,85 · `DEFAULT_LINK_MBPS` 50 · `PEERS_SAVE_SECS` 5 | constantes | 2 |
| /Users/monti/Documents/Dev/streamonte/ui/src/health-calib.js | `WIN_FROM` 120 · `WIN_TO` 300 · `WIN_MIN` 60 · `SHORT_FROM` 30 · `SHORT_MIN` 30 · `PRIOR_N` 2 · `HALF_LIFE_DAYS` 30 · clamp ln 4 / ln 20 · `PRIOR_BAND` · `PRED_TTL_MS` 6 h · `MAX_PRED` 60 | constantes | 1 |
| /Users/monti/Documents/Dev/streamonte/ui/src/catalog.js | `EARLY_TOP` 10 · `DEEP_ETA` "~1 min" | constantes | 2 |
| localStorage `streamonte.health` | claves nuevas `pred`, muestras con `ev` | — | 1 |

## 12. Métricas de éxito globales (se leen en `#conn-fidelity` y en el log)

| Métrica | Hoy (caso real) | Objetivo | Cómo |
|---|---|---|---|
| Nivel mostrado al ▶ = nivel real (min 2–5), por red, n ≥ 15 | caso 4K: falla | ≥ 75 % | `fidelity().hits / n` |
| Pesimistas ("dijo peor y anduvo mejor") | — | ≤ 10 % | `pessimistic / n` |
| Optimistas ("dijo mejor y anduvo peor") | — | ≤ 5 % | `optimistic / n` |
| Error mediano ln(pred/real) con lo aprendido | −1,99 (×7,3 pesimista) | dentro de ±ln 1,5 | `biasAfter` |
| Error típico | ×7,3 | ≤ ×1,8 y ≤ 0,8 × el sin aprender | `typAfter` |
| Real dentro del rango | — | ≥ 70 % | `inBand / n` |
| Tiempo abrir título → salud medida de las 10 del grupo | 1–4 min y solo con clic | p50 ≤ 60 s, p90 ≤ 90 s | log "medición con tope" (resumen) |
| Costo por título | 300 conexiones, ~0 datos | ≤ 200 conexiones, ≤ 1,5 GB | log de resumen + Monitor de Actividad |

## 13. Decisiones abiertas para el usuario

| # | Decisión | Opciones | Recomendación | Bloquea |
|---|---|---|---|---|
| D1 | Regla B6 entre evidencias | (a) gana el p50 más alto entre contados y trackers (salvo 0 contados) · (b) contados siempre mandan (hoy) | (a): todas subestiman; la fidelidad (`optimistic`) avisa si se pasa | WP1-C (`predict`), WP1-D |
| D2 | Mostrar salud sin análisis profundo | (a) siempre que haya seeders, con rango y "sin calibrar" · (b) solo con conteo (hoy) | (a): es lo que corrige el "Puede cortarse" antes de analizar | WP1-D pasos 4–5 |
| D3 | "Mejor opción" (B8) | (a) grupo analizado + nivel 0 sin "probable" (F1); en F2 "analizado" = sonda automática terminada · (b) igual a hoy | (a) | WP1-D paso 10, WP2-C paso 5 |
| D4 | `announce_early` por defecto (si X1 SIGUE) | `true` · `false` (opt-in) | `true`: la fidelidad es la prioridad; el análisis ya expone la IP al conectarse | WP2-B paso 3 |
| D5 | ▶/⤓/Retomar apaga el análisis del catálogo | (a) sí, espera ≤ 5 s · (b) el análisis sigue (puerto distinto, sin DHT persistente, compite por ancho de banda) | (a) | WP2-B paso 2 |
| D6 | Arranque solo al abrir el título | (a) sí, 10 mejores del grupo abierto · (b) solo con "Chequear" | (a): sin eso no hay "~1 min desde abrir" | WP2-C paso 5 |
| D7 | Datos por título analizado | 1,5 GB sin aviso · aviso en redes medidas · menos (TOP 6) | 1,5 GB sin aviso (la sonda corta al llegar al tope) | WP2-A constantes |
| D8 | Anunciarse como leecher (`left > 0`) | no · seleccionar el archivo al agregar desde `.torrent` en caché | no (v1); revisar si X1 muestra pocos seeders entrantes | nada |
| D9 | Unificar con /Users/monti/Documents/Dev/streamonte/crates/core/src/playback/calibration.rs | convivir · mover la red a Rust y borrar uno | convivir (otro producto: semáforo de *Mis magnets*) | nada |
| D10 | Parche a librqbit (flags de PEX "seed", `upload_only`, choke por peer) | no · fork | no (mantenimiento de un fork) | nada |
| D11 | Borrar `swarm::count` / `catalog_swarm` / `catalogSwarm` | tras 2 semanas con métricas OK · nunca | tras métricas OK | nada |
| D12 | `resetCalibration` borra también `net` y `pred` (hoy pasa con `net`) | dejar · conservar `net` | conservar `net` y `pred` (τ/entrantes son de la red, no mediciones) — cambio de una línea, fuera de este spec | nada |
| D13 | Anotar en mem.db: ADR-30 cambia (C3), B6 cambia (D1), B8 (D3), salud siempre visible (D2), resultados de X1/X2/X3 | — | anotar tras cada OK | gate humano |

## 14. Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| Router casero saturado | 10×20 conexiones, motores de análisis serializados (lock), reproducción y análisis no conviven (C3) |
| Ancho de banda: 10 sondas tapan la red | `Budget` sobre el link medido, re-reserva hacia abajo, guardia de saturación (`link_limited` no aprende) |
| Optimismo por la regla del máximo + "probable" | "Mejor opción" no usa "probable"; métrica `optimistic` en `#conn-fidelity`; D1 reversible |
| Sesgo de selección (solo se reproduce lo que parecía bueno) | ventana corta a medio peso; ⤓ sobre opciones flojas da muestras; contracción `PRIOR_N` |
| Pocas reproducciones por red | contracción al 0 y banda amplia "sin calibrar" mientras `nEff < 3` |
| Velocidad de reproducción limitada por el reproductor (lo real sería cota inferior) | X2 lo mide sin mpv (`select_file`); si `real ≈ 1,2·need` siempre, censurar también ahí |
| IP listada ~30 min en ≤ 10 enjambres por título | toggle `announce_early`, texto explícito; solo el grupo abierto |
| Entrantes descartadas mientras resuelve un magnet (F8) | `.torrent` en caché primero |
| ▶ más lento por esperar el apagado (≤ 5 s) | espera acotada; en la práctica la adopción de lo bajado compensa |
| `adopt_analysis` falla por reserva colgada | cancelación cooperativa (no `abort`) con `release_dir` |
| Merge con la otra sesión (puerto propio, Verificar puerto) | R7; "Verificar puerto" (`hold_port`) abre el primer puerto del rango: si el análisis lo tiene tomado, la verificación falla → WP2-B: `AppCore::check_incoming` ("Verificar" de Ajustes › Red, /Users/monti/Documents/Dev/streamonte/crates/core/src/app.rs) llama primero `self.stop_catalog_analysis().await` |
| Calibración vieja (seedMbps de conteos sin escucha) | migración: viejas a medio peso; `probe` y `counted` aprenden factores aparte |

## 15. Descartado de los specs parciales (y por qué)

- 02: módulo `HealthWatch`, `reconcile`, `WATCH_N` como motor separado, `LiveHealthConfig` en config.json, `peer_limit` en `AddOptions` → un solo motor (C1); `max_connections` por motor alcanza. Lo útil queda en la Fase 4.
- 01: arranque solo del **conteo** con `create_for_playback` y `SwarmCount.incoming` → reemplazado por la sonda (`ProbeResult.incoming`); vuelve solo si X2 NO PASA.
- 03: `addProbeSample` (sondas como muestras de calibración) → una sonda es predicción, no realidad (C5). `engine::create` fijo en la sonda → depende de X1. `TOTAL_SECS = 60` → 120 (los metadatos solos pueden tardar 90 s, B26).
- 04: `basisOf` con orden fijo → `predict` con la regla del máximo (D1), compartida con `fidelity`. Umbral `hits/n ≥ 0,7` → 0,75 + pesimistas ≤ 10 %.
- 05: `projSeedMbps`, compuerta G3 por dispersión, storage `streamonte.swarmcurve` con `plays` → doble corrección (C4); la ventana de "lo real" de 04 ya guarda la serie por segundo de la reproducción.
- 06: seedbox por ASN, `peer_bytes` en webtorrent, regla con `fast` absoluto, campos `analysis_robust_mbps` en la calibración → dependencias nuevas / sin valor medido; la regla `robust` queda tras X3.
- 07: announce UDP propio (7c), extender la ventana del conteo con `known`, `census-log` aparte, P2b como `Math.max` → exposición extra / cambia tiempos B26 / duplicaba el registro de 04.
- 08: bandas por cuantiles del factor por seeder (`perSeedBand`, `supplyRange`, línea "Rango por seeder" del popover) → el rango sale de los residuos de la misma corrección de 04 (una sola base).

## 16. Anexo — arranque lento (C10)

La Fase 2 deja el inicio del archivo bajado en `analysis_dir` y la reproducción lo adopta (FR-06d): la precarga de cabeza ya está al dar ▶. No se tocan `try_steal` (exige `peer_avg_time`, /Users/monti/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/librqbit-9.1.0/src/piece_tracker.rs:190) ni el hash de subtítulos en la precarga.

## 17. Grafo de trabajo

```yaml
# compuertas: [wp0-x1, wp0-x2] → gate humano X1/X2 · wp2-* solo si X2 PASA · wp2-d solo si X3 PASA
# wp3-a experimental · wp3-b solo si X2 NO PASA o ≥ 30 % started=false · wp4 solo con la compuerta de §10
order: [[wp0], [wp0-x1, wp0-x2], [wp1-r, wp1-c, wp1-d, wp1-e], [wp1-z], [wp2-a, wp2-b, wp2-c], [wp2-z], [wp2-d], [wp3-a], [wp3-b], [wp4]]
work_packages:
  - id: wp0
    model: sonnet
    effort: medium
    owns: [/Users/monti/Documents/Dev/streamonte/crates/core/src/engine/rqbit.rs]
  - id: wp0-x1
    model: sonnet
    effort: medium
    owns: [/Users/monti/Documents/Dev/streamonte/crates/core/examples/announce_probe.rs]
  - id: wp0-x2
    model: sonnet
    effort: high
    owns: [/Users/monti/Documents/Dev/streamonte/crates/core/examples/salud_probe.rs]
  - id: wp1-r
    model: sonnet
    effort: high
    owns: [/Users/monti/Documents/Dev/streamonte/crates/core/src/playback.rs, /Users/monti/Documents/Dev/streamonte/crates/core/src/playback/kept.rs, /Users/monti/Documents/Dev/streamonte/crates/core/src/playback/flow.rs, /Users/monti/Documents/Dev/streamonte/crates/core/src/engine/mod.rs, /Users/monti/Documents/Dev/streamonte/crates/core/src/engine/rqbit.rs, /Users/monti/Documents/Dev/streamonte/crates/core/src/engine/rqbit/net.rs, /Users/monti/Documents/Dev/streamonte/crates/core/src/engine/webtorrent.rs, /Users/monti/Documents/Dev/streamonte/crates/core/src/analyzer.rs, /Users/monti/Documents/Dev/streamonte/crates/core/src/analyzer/swarm.rs, /Users/monti/Documents/Dev/streamonte/crates/core/src/analyzer/peer_rates.rs, /Users/monti/Documents/Dev/streamonte/crates/core/src/catalog/normalize.rs, /Users/monti/Documents/Dev/streamonte/crates/core/src/catalog/aggregate.rs]
  - id: wp1-c
    model: sonnet
    effort: high
    owns: [/Users/monti/Documents/Dev/streamonte/ui/src/health-calib.js]
  - id: wp1-d
    model: sonnet
    effort: high
    owns: [/Users/monti/Documents/Dev/streamonte/ui/src/catalog.js, /Users/monti/Documents/Dev/streamonte/ui/catalog.css]
  - id: wp1-e
    model: sonnet
    effort: medium
    owns: [/Users/monti/Documents/Dev/streamonte/ui/src/speed.js, /Users/monti/Documents/Dev/streamonte/ui/styles.css]
  - id: wp1-z
    model: opus
    effort: high
    owns: [(correcciones de integración en los owns de wp1-r, wp1-c, wp1-d, wp1-e)]
  - id: wp2-a
    model: sonnet
    effort: high
    owns: [/Users/monti/Documents/Dev/streamonte/crates/core/src/analyzer/probe.rs, /Users/monti/Documents/Dev/streamonte/crates/core/src/analyzer/swarm.rs, /Users/monti/Documents/Dev/streamonte/crates/core/src/analyzer.rs, /Users/monti/Documents/Dev/streamonte/crates/core/src/analyzer/speed.rs]
  - id: wp2-b
    model: sonnet
    effort: medium
    owns: [/Users/monti/Documents/Dev/streamonte/crates/core/src/app.rs, /Users/monti/Documents/Dev/streamonte/crates/core/src/events.rs, /Users/monti/Documents/Dev/streamonte/crates/core/src/config.rs, /Users/monti/Documents/Dev/streamonte/crates/core/src/engine/rqbit/net.rs, /Users/monti/Documents/Dev/streamonte/crates/core/src/engine/mod.rs, /Users/monti/Documents/Dev/streamonte/src-tauri/src/commands.rs, /Users/monti/Documents/Dev/streamonte/src-tauri/src/lib.rs, /Users/monti/Documents/Dev/streamonte/ui/src/api.js, /Users/monti/Documents/Dev/streamonte/ui/index.html, /Users/monti/Documents/Dev/streamonte/ui/src/dialogs.js, /Users/monti/Documents/Dev/streamonte/ui/src/app.js]
  - id: wp2-c
    model: sonnet
    effort: high
    owns: [/Users/monti/Documents/Dev/streamonte/ui/src/catalog.js]
  - id: wp2-z
    model: opus
    effort: high
    owns: [(correcciones de integración en los owns de wp2-a, wp2-b, wp2-c)]
  - id: wp2-d
    model: sonnet
    effort: medium
    owns: [/Users/monti/Documents/Dev/streamonte/crates/core/src/analyzer/probe.rs, /Users/monti/Documents/Dev/streamonte/ui/src/catalog.js]
  - id: wp3-a
    model: sonnet
    effort: high
    owns: [/Users/monti/Documents/Dev/streamonte/crates/core/src/analyzer/swarm.rs, /Users/monti/Documents/Dev/streamonte/ui/src/catalog.js, /Users/monti/Documents/Dev/streamonte/ui/src/health-calib.js]
  - id: wp3-b
    model: sonnet
    effort: high
    owns: [/Users/monti/Documents/Dev/streamonte/ui/src/swarm-curve.js, /Users/monti/Documents/Dev/streamonte/ui/src/catalog.js, /Users/monti/Documents/Dev/streamonte/ui/src/health-calib.js, /Users/monti/Documents/Dev/streamonte/ui/src/speed.js, /Users/monti/Documents/Dev/streamonte/crates/core/src/analyzer/swarm.rs]
  - id: wp4
    model: opus
    effort: high
    owns: [/Users/monti/Documents/Dev/streamonte/crates/core/src/analyzer/probe.rs, /Users/monti/Documents/Dev/streamonte/crates/core/src/app.rs, /Users/monti/Documents/Dev/streamonte/src-tauri/src/commands.rs, /Users/monti/Documents/Dev/streamonte/src-tauri/src/lib.rs, /Users/monti/Documents/Dev/streamonte/ui/src/api.js, /Users/monti/Documents/Dev/streamonte/ui/src/catalog.js]
```
Nota de paralelismo: WP0 y WP1-R tocan engine/mod.rs y rqbit.rs → nunca en la misma tanda (WP0 va antes). WP2-A y WP2-B no comparten archivos (los comentarios ADR-30 de rqbit.rs `spawn` van en WP2-B solo si WP2-A no lo toca: WP2-A no toca rqbit.rs).

## 18. Gates humanos
Correr X1, X2, X3 y anotar sus números acá (G1 = __, G2 = __, G3 = __ · F1 = __, base = __, F2 = __, F3 = __, L1 = __ · X3 = __/10); probar en la app (WP1-Z, WP2-Z); anotar en mem.db (D13); commit/push. Ningún agente los ejecuta.

## 19. No verificado
- Las anclas y "(hoy :N)" se verificaron sobre el árbol de ~16:30; a las 17:00 otra sesión seguía editando (§2b). No se re-verificó que el árbol de 17:00 compile ni que sus versiones de 01/04/07/08 pasen los goldens de WP1-C (por diseño no los pasan hasta aplicar Δ1).
- Comportamiento de los trackers con `left = 0` y si UPnP mapea antes de que lleguen entrantes (lo mide X1).
- Que el limitador de librqbit sostenga ~0,9–1,0 × tope sin oscilar con la ventana de pedidos en vuelo (lo mide X2, L1).
- Que la reproducción baje a máxima velocidad tras la precarga y no al ritmo del stream (X2 lo evita midiendo sin mpv; supuesto para las muestras de la app).
- F11 (`stopped` al quitar) tomado de 01 sin releer tracker_comms.rs. Nombre exacto del campo `client_name` en `PeerStats` (WP1-R paso 4 frena si no existe).
- Tiempo de arranque de la DHT en frío para el censo (E0).
