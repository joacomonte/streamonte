# Spec 03 — Medición de throughput real con tope por torrent, en paralelo

Estado: listo para implementar (todas las decisiones tomadas salvo §10). Contexto y reglas:
/Users/monti/Documents/Dev/streamonte/docs/plans/salud-fiel/00-contexto.md.
Raíz librqbit: `L=/Users/monti/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/librqbit-9.1.0/src`.

## 1. Veredicto
Viable con librqbit 9.1.0 sin forks ni dependencias nuevas: **hay rate limit de bajada POR TORRENT**,
pero **solo se fija al agregar** (no se puede cambiar después). Reemplaza el conteo profundo
(`countSeeds` → `catalog_swarm`) por una medición real: para los `TOP` candidatos, bajar el inicio del
archivo con tope = 2,5 × lo que pide el video, 10–30 s cada uno, en paralelo según la velocidad de
internet. "Llegó al tope" = salud buena con confianza; "se quedó en X" = X es su velocidad real.

## 2. Verificación en la fuente (librqbit 9.1.0)
| Hecho | Ancla |
|---|---|
| `LimitsConfig { upload_bps, download_bps: Option<NonZeroU32> }`; `Limits` = `governor` `Quota::per_second(bps)` (ráfaga = 1 s de cuota). | `$L/limits.rs:10-13`, `:21-24`, `:34-40` |
| **Por torrent**: `AddTorrentOptions.ratelimits: LimitsConfig` (con `#[serde(default)]`). | `$L/session.rs:284-285` |
| Se copia a `ManagedTorrentOptions.ratelimits`. | `$L/session.rs:1369`, `$L/torrent_state/mod.rs:118` |
| Al pasar a "live" se crea un `Limits` propio del torrent. | `$L/torrent_state/live/mod.rs:216`, `:266` |
| **Cómo se aplica en download**: en el loop de pedidos de CADA peer, antes de pedir cada chunk (16 KiB) se espera `self.state.ratelimits.prepare_for_download(len)` (el del torrent, compartido por todos sus peers) y después el de la sesión. Limita la emisión de pedidos, no la recepción: con la ventana de pedidos en vuelo puede pasarse un poco unos instantes. | `$L/torrent_state/live/mod.rs:1706-1715` |
| De sesión: `SessionOptions.ratelimits` (global, `Session.ratelimits: Limits` pub con `set_download_bps`). | `$L/session.rs:466`, `:139`, `:810` |
| **No hay setter por torrent**: `TorrentStateLive.ratelimits` es privado y se recrea de `options` (inmutables) al pausar/reanudar. El tope se decide antes de `add`. | `$L/torrent_state/live/mod.rs:216`, `:266` |
| `bps < 16384` (un chunk) → `until_n_ready` falla (`RateLimitInsufficientCapacity`). Clampear ≥ 64 KiB/s. | `$L/limits.rs:37`, `$L/error.rs:96` |
| Peers por torrent: `AddTorrentOptions.peer_limit` o el de sesión (`peer_limit`, que Streamonte llena con `max_connections`). | `$L/session.rs:291`, `:1371`; /Users/monti/Documents/Dev/streamonte/crates/core/src/engine/rqbit/net.rs:81 |
| Sin archivo seleccionado y solo un stream, se piden **solo** las piezas de la ventana de 32 MiB del stream → con piezas de 16 MiB, 2 piezas en vuelo (1 peer por pieza; robo solo con `peer_avg_time`). Con `select_file`, la cola es el archivo entero en orden natural (secuencial desde el inicio). | `$L/torrent_state/streaming.rs:29`, `$L/piece_tracker.rs:134-156`, `$L/torrent_state/live/mod.rs:1452` |
| `fetched_bytes` (bytes de chunks recibidos, antes de verificar) = `Stats.received_bytes` en Streamonte. | `$L/torrent_state/live/mod.rs:749`; /Users/monti/Documents/Dev/streamonte/crates/core/src/engine/rqbit.rs:595-599 |

Consecuencias de diseño:
- Tope por `AddOptions` (campo nuevo) → `AddTorrentOptions.ratelimits`. No hacen falta sesiones separadas.
- Peers por torrent: alcanza con `max_connections = 20` en el motor de la medición (como hace /Users/monti/Documents/Dev/streamonte/crates/core/src/analyzer/swarm.rs:73-74). No se agrega `peer_limit` a `AddOptions`.
- Medir con `select_file` (no solo un stream): si no, en torrents de piezas grandes el stream limita a 1–2 peers y subestima (el mismo sesgo que hoy).
- El tope se calcula con lo que pide el video **antes** de tener metadatos (hint de la UI); si con el archivo real el tope quedó corto, se quita y re-agrega una vez (§4.3).
- Alternativas descartadas: una sesión por torrent (15 DHT, puertos, pesado); limitar la lectura del stream (no limita: la cola de `select_file` sigue pidiendo).

## 3. Qué se mide y dónde
- **Camino nuevo** `analyzer/probe.rs`, no `measure_with`: `measure_with` (/Users/monti/Documents/Dev/streamonte/crates/core/src/analyzer/pipeline.rs:215) es de a uno, precarga + mpv y alimenta la biblioteca. Se reusan sus piezas: `add_deselected`-like (con tope), `metadata_and_file` (pipeline.rs:76), `median`/`still_rising`/`sustained_speed` (/Users/monti/Documents/Dev/streamonte/crates/core/src/analyzer/speed.rs:186, :164, :202), `reserve_dir`/`release_dir` (/Users/monti/Documents/Dev/streamonte/crates/core/src/analyzer/live.rs:199, :217).
- **Dónde en el archivo: el inicio** (`select_file` → orden natural secuencial desde la pieza 0). Motivos: (a) es lo que el play pide primero y lo bajado sirve de precarga (FR-06d), (b) con `select_file` no se mide "solo la pieza 0": en 10–30 s son decenas de piezas en paralelo entre todos los peers. Sesgo conocido: leechers que streamean tienen más el inicio → leve optimismo en el inicio (aceptado: el play arranca ahí).
- **Contador**: `received_bytes` (no `downloaded_bytes`: con piezas de 16 MB avanza a saltos; ver comentario /Users/monti/Documents/Dev/streamonte/crates/core/src/engine/mod.rs:205-209). Base = valor al arrancar la bajada (puede haber datos de un análisis previo).
- **Arranque vs. velocidad** (choke/unchoke): se reportan por separado
  - `ttfb_secs`: desde `select_file` hasta `received_bytes > base`.
  - `ramp_secs`: desde el primer byte hasta el primer segundo ≥ 80 % de la sostenida final.
  - `sustained_bps`: `sustained_speed` (mediana de la 2.ª mitad) sobre muestras de 1 s **desde el primer byte** (no un WARMUP fijo).
  - Sin byte a los `TTFB_MAX_SECS` → `started = false` ("no arrancó"): distinto de "lento".

## 4. Algoritmo
### 4.1 Tope y paralelismo
- `need_bps`: con metadatos = `file.size / runtime_secs` (runtime de la ficha, que manda la UI; arregla packs con el archivo real). Sin runtime → `need_bps_hint` de la UI (`neededBps(c)` o `TYPICAL_MBPS`).
- `cap_bps = clamp(CAP_FACTOR × need_bps, 64 KiB/s, LINK_SHARE × link_bps)`. Si quedó recortado por el link → `cap_by_link = true`.
- `link_bps`: test de velocidad de la red (`cal.capFrom === 'test'`); si no, `cal.capMbps` medido; si no, `DEFAULT_LINK_MBPS`.
- **Presupuesto de ancho de banda** (`Budget`, Mutex<f64> + Notify): para empezar a bajar, un probe reserva `cap_bps`; libera al terminar. Paralelo = link ÷ tope de cada uno, como pide la idea.
- **Re-reserva dinámica**: a los 6 s de muestras, si va por debajo, devuelve lo que no usa: `reserva = clamp(1,3 × mediana(últimos 5 s), 0,25 × cap, cap)`; nunca crece. Así los lentos (la mayoría) no bloquean.
- **Guardia de saturación**: cada tick, cada probe publica su bps en un `Mutex<HashMap<InfoHash,f64>>`; si Σ ≥ 0,9 × link, ese segundo es `saturated` para todos. Si un probe termina debajo del tope con > 30 % de muestras saturadas → `link_limited = true` y la sostenida se calcula con las no saturadas (si quedan ≥ 6).
- **Conexiones**: `PROBE_CONCURRENCY = 10` torrents activos (metadatos o bajando) × `MAX_PEERS = 20` = 200 conexiones máx. (hoy: 10 × 30 = 300, swarm.rs:38-40).
### 4.2 Ventana adaptativa (por probe, muestras de 1 s desde el primer byte)
- Mínimo `MIN_SECS = 10` muestras (lo exige health-calib, `MIN_SECS`, /Users/monti/Documents/Dev/streamonte/ui/src/health-calib.js:15).
- **Corte temprano**: ≥ 10 muestras y las últimas `HOLD_SECS = 8` todas ≥ 0,9 × cap → `hit_cap = true`.
- **Estable debajo del tope**: ≥ 15 muestras y `!still_rising` → corta.
- **Extender**: si `still_rising` sigue hasta `MAX_SECS = 30` muestras.
- Sin primer byte a `TTFB_MAX_SECS = 15` → corta con `started = false`.
### 4.3 Flujo de un probe
1. Esperar slot (`Semaphore(PROBE_CONCURRENCY)`); si pasó `TOTAL_SECS - 15` desde el pedido → `skipped`.
2. `reserve_dir` (carpeta de análisis del hash, FR-06d) y `add_cached_or_magnet` con `download_bps = cap_hint` (con `need_bps_hint`).
3. Metadatos: `timeout(METADATA_SECS = 30, engine.metadata(h))`; corte a los 15 s si `waiting_on` = `Metadata { peers: Some(0) }` (patrón de swarm.rs:176-179). Sin metadatos → `reached = false`, `peers` = los de DHT.
4. `pick_file(pick)`; `need_bps` real; si `CAP_FACTOR × need_bps > cap_hint × 1,05` → `save_peers(connected_peers)`, `remove`, `add_cached_or_magnet` de nuevo con el tope correcto (`.torrent` ya en caché + peers iniciales, /Users/monti/Documents/Dev/streamonte/crates/core/src/engine/mod.rs:365).
5. Si el archivo ya está completo en disco (`progress ≥ 0,999`) → `skipped` (sin nada que medir).
6. `budget.take(cap)` (espera; si vence `TOTAL_SECS` → `skipped`), `select_file`, loop de 1 s con `engine.stats` (timeout 2 s): seeds/peers máx., bps, saturación, reglas 4.2, evento de progreso cada 2 s.
7. Fin: `save_peers(connected_peers)` (/Users/monti/Documents/Dev/streamonte/crates/core/src/engine/mod.rs:392), `remove(delete_data: false)`, `budget.give`, evento final. Tras todos: `engine.shutdown()` y `release_dir` (conserva la carpeta de análisis).
### 4.4 Presupuesto (estimado)
| Escenario | Paralelo (por tope) | Tiempo | Datos |
|---|---|---|---|
| 1080p (pide 8 → tope 20 Mbps), link 100 | 4 fijo, ~8 con re-reserva | ~45–60 s + metadatos | ~15 × 30 MB ≈ 450 MB |
| 4K web (20 → 50 Mbps), link 100 | 1–2, ~4 con re-reserva | 60 s alcanza ~6–10 de 15 | ~10 × 75 MB ≈ 750 MB |
| 1080p, link 300 | 10 (tope de conexiones) | ~35–45 s | ~450 MB |
- Tope duro: `TOTAL_SECS = 60` desde el pedido (lo no medido queda `skipped`, la UI lo muestra con salud estimada y "Analizar N más"); `MAX_TOTAL_BYTES = 1,5 GB` (no arranca nuevos al superarlo).
- Metadatos: corren en paralelo con las bajadas de otros (no usan ancho de banda); con `.torrent` en caché son instantáneos.

## 5. Diseño
### 5.1 Rust
`/Users/monti/Documents/Dev/streamonte/crates/core/src/analyzer/probe.rs` (nuevo; constantes como swarm.rs, no en config.json):
```rust
const CAP_FACTOR: f64 = 2.5; const MAX_PEERS: u32 = 20; const PROBE_CONCURRENCY: usize = 10;
const METADATA_SECS: u64 = 30; const TTFB_MAX_SECS: u64 = 15; const MIN_SECS: usize = 10;
const HOLD_SECS: usize = 8; const MAX_SECS: usize = 30; const TOTAL_SECS: u64 = 60;
const MAX_TOTAL_BYTES: u64 = 1_500_000_000; const LINK_SHARE: f64 = 0.85; const DEFAULT_LINK_MBPS: f64 = 50.0;

#[derive(Debug, Clone, Deserialize)]
pub struct ProbeItem { pub hash: InfoHash, pub need_bps_hint: Option<f64> }

#[derive(Debug, Clone, Default, PartialEq, Serialize)]
pub struct ProbeResult {
    pub reached: bool, pub seeds: u32, pub peers: u32,      // compatible con SwarmCount
    pub started: bool, pub skipped: bool,
    pub need_bps: Option<f64>, pub cap_bps: f64, pub cap_by_link: bool,
    pub ttfb_secs: Option<f64>, pub ramp_secs: Option<f64>,
    pub sustained_bps: f64, pub max_bps: f64, pub secs: f64,
    pub hit_cap: bool, pub link_limited: bool, pub peer_limited: bool, // peers == MAX_PEERS y debajo del tope
    pub file_index: Option<usize>, pub file_size: Option<u64>,
}

pub async fn probe(
    paths: &AppPaths, cfg: &Config,
    items: Vec<(Magnet, FilePick, Option<f64>)>, runtime_secs: Option<u32>, link_bps: Option<f64>,
    cancel: CancellationToken,
    on_update: impl Fn(InfoHash, ProbeResult, bool) + Send + Sync + 'static,
) -> HashMap<InfoHash, ProbeResult>;

// Puras (con tests):
fn cap_bps(need_bps: f64, link_bps: f64) -> (f64, bool);
enum Stop { Continue, HitCap, Stable, MaxSecs }
fn should_stop(samples: &[f64], cap: f64) -> Stop;
fn summarize(samples: &[(f64, bool /*saturated*/)], cap: f64, peers: u32) -> (f64 /*sustained*/, f64 /*max*/, bool /*hit_cap*/, bool /*link_limited*/, bool /*peer_limited*/);
fn ramp_secs(samples: &[f64], sustained: f64) -> Option<f64>;
struct Budget { free: std::sync::Mutex<f64>, notify: tokio::sync::Notify }
impl Budget { async fn take(&self, bps: f64, until: Instant) -> bool; fn give(&self, bps: f64); }
```
Otros cambios Rust:
- `AddOptions` + `pub download_bps: Option<u32>` — /Users/monti/Documents/Dev/streamonte/crates/core/src/engine/mod.rs:47-55. Callers con `download_bps: None`: /Users/monti/Documents/Dev/streamonte/crates/core/src/playback/flow.rs:80, /Users/monti/Documents/Dev/streamonte/crates/core/src/analyzer/pipeline.rs:66, /Users/monti/Documents/Dev/streamonte/crates/core/src/analyzer/names.rs:69, /Users/monti/Documents/Dev/streamonte/crates/core/src/engine/rqbit/fastresume.rs:86 (test).
- rqbit: en `add_opts` (/Users/monti/Documents/Dev/streamonte/crates/core/src/engine/rqbit.rs:319-327) `ratelimits: LimitsConfig { download_bps: opts.download_bps.and_then(NonZeroU32::new), upload_bps: None }` (import `librqbit::limits::LimitsConfig`: módulo `pub`, `$L/lib.rs:61`). webtorrent lo ignora (documentarlo en el campo).
- Visibilidad `pub(super)`: `metadata_and_file` (pipeline.rs:76), `median`/`still_rising`/`sustained_speed` + `SpeedSample` campos ya `pub(super)` (speed.rs:164, :186, :202), `reserve_dir`/`release_dir` (live.rs:199, :217).
- `mod probe;` → `pub mod probe;` en /Users/monti/Documents/Dev/streamonte/crates/core/src/analyzer.rs:18-24.
- Eventos en /Users/monti/Documents/Dev/streamonte/crates/core/src/events.rs (junto a :70-79): `CatalogProbeProgress { hash, probe: ProbeResult }`, `CatalogProbed { hash, probe: ProbeResult }` → `catalog-probe-progress` / `catalog-probed`.
- `App::catalog_probe(&self, video_id: &str, items: Vec<ProbeItem>, runtime_secs: Option<u32>, link_mbps: Option<f64>) -> Result<HashMap<InfoHash, ProbeResult>>` en /Users/monti/Documents/Dev/streamonte/crates/core/src/app.rs junto a `catalog_swarm` (:589): mismo `swarm_cancel` (Detener/cerrar lo corta, :776-787); `FilePick { index: c.file_idx, episode: video.episode() }` desde `self.catalog.candidate(&video, &hash)` (/Users/monti/Documents/Dev/streamonte/crates/core/src/catalog/mod.rs:579); `Magnet` como `magnets_of` (:564-577).
- Comando `catalog_probe` en /Users/monti/Documents/Dev/streamonte/src-tauri/src/commands.rs (junto a :238) y registro en /Users/monti/Documents/Dev/streamonte/src-tauri/src/lib.rs (lista de :90-100).
- Log: una línea `tracing::info!` por probe ("medición con tope": hash, need, cap, ttfb, ramp, sostenida, hit_cap, link_limited, peers, secs) y una de resumen (medidos, salteados, segundos, bytes).

### 5.2 UI
- /Users/monti/Documents/Dev/streamonte/ui/src/api.js (junto a :55): `catalogProbe: (videoId, items, runtimeSecs, linkMbps) => invoke('catalog_probe', { videoId, items, runtimeSecs, linkMbps })`.
- /Users/monti/Documents/Dev/streamonte/ui/src/catalog.js:
  - `const probed = new Map()` (hash → ProbeResult) y `liveProbe` (parcial), junto a `counted` (:635).
  - `countSeeds` (:1009): llama `api.catalogProbe(video, todo.map(h => ({hash: h, need_bps_hint: hint(c)})), state.side.runtime ? state.side.runtime*60 : null, link)` con `hint = neededBps(c) ?? (TYPICAL_MBPS[c.resolution] ?? 3) * 1e6 / 8` y `link = cal.capFrom === 'test' ? cal.capMbps : null`. Por cada resultado: `probed.set(h, r)` y `counted.set(h, {seeds: r.reached ? r.seeds : 0, peers: r.peers, reached: r.reached})`; `skipped` → no se marca `counted` (queda como 'rest').
  - Eventos (:1709-1721): `catalog-probe-progress` → `liveProbe` + `liveCount` (`{seeds, peers, reached}`) con el mismo redibujo de 400 ms; `catalog-probed` → igual que `catalog-swarm-counted` + `probed.set` + `addProbeSample(...)`.
  - `health(c)` (:702): `bps = probed.get(h)?.need_bps ?? neededBps(c)`; `measuredBps` = reproducción (≥ MIN_SECS) → **probe** (`started && secs >= MIN_SECS ? sustained_bps`) → biblioteca; devuelve además `capped = probe.hit_cap`, `probe`.
  - `healthBadge` (:726): tooltip medido: con `capped` "Llegó al tope de la prueba (~X Mbps, 2,5× lo que pide): sobra."; sin tope "Bajó a ~X Mbps sostenidos con N peers (arrancó en T s)"; `link_limited` "tu internet estaba ocupada con otras pruebas"; `peer_limited` "con más conexiones (al reproducir) puede dar más"; `!started` "no arrancó en 15 s".
  - `finalists` (:1050): ordenar por `probed.get(h)?.sustained_bps / need` y después seeds.
  - `reanalyze` (:1063): también `probed.delete(h)`.
  - Textos: `DEEP_ETA = '~1 min'` (:1047); subtítulo del panel "Midiendo la velocidad real de cada torrent" (:566); CTA "mide la velocidad real de las `TOP` mejores" (:599-600).
  - Fila: mientras mide, texto en vivo `"↓ X Mbps · N peers"` en un `span` con `id="cat-probe-live-${hash}"`. Ids existentes se mantienen (`cat-deep-go`, `cat-deep-stop`, `cat-health-${hash}`).
- /Users/monti/Documents/Dev/streamonte/ui/src/health-calib.js: extraer de `addSample` (:134-140) `keepSample(hash, sample)` (podar a `MAX_SAMPLES` y guardar) y exportar `addProbeSample(hash, p, trackerSeeds, trackerLeechers)` con `{name, source: 'medición', seeds: p.seeds, tracker_seeds, tracker_leechers, real_peers: p.peers, avg_speed_bps: p.sustained_bps, sustained_bps: p.sustained_bps, max_speed_bps: p.max_bps, measured_secs: p.secs, capped: p.hit_cap, measured_at, network}`; solo si `started && secs >= MIN_SECS && !link_limited`. Las con tope entran igual (cota inferior: sesgo conservador menor que excluir a los mejores).

### 5.3 Qué queda igual a propósito
- `swarm.rs`, `catalog_swarm`, `api.catalogSwarm`: sin uso desde la UI tras el cambio, **no se borran** hasta validar las métricas (§9); borrarlos es el paso de seguimiento.
- `measure_with`/analizador de la biblioteca y `quickAnalyze(finalists)`: igual (dan duración e idiomas con mpv).
- `TOP = 15`, `FINALISTS = 8`, `sortOptions`, umbral bueno ≥ 2× (mem.db B6): sin cambios. Llegar al tope (2,5×, medido ≥ 0,9 → ≥ 2,25×) cae siempre en "buena".
- Motor de la medición = `engine::create` (sin escucha, ADR-30). Ver decisión abierta D1.

## 6. Aprovechar lo bajado
- **FR-06d**: se baja en `analysis_dir(hash)` (`reserve_dir`); `adopt_analysis` (/Users/monti/Documents/Dev/streamonte/crates/core/src/playback/kept.rs:86-97) la renombra al dar ▶ y el bitfield (`fastresume.rs`, viaja con la carpeta) evita re-verificar (/Users/monti/Documents/Dev/streamonte/crates/core/src/playback/flow.rs:91). Como se baja desde el inicio, la precarga de cabeza (16 MiB, /Users/monti/Documents/Dev/streamonte/crates/core/src/config.rs:144) ya está. Si la carpeta está reservada (otro análisis del hash) se usa una descartable y no se adopta (comportamiento actual).
- **Caché de peers**: `save_peers` al terminar cada probe → el play se conecta de entrada (`load_peers`, < 30 min, engine/mod.rs:389-415). `.torrent` en caché vía `metadata_and_file`.
- Disco: lo no reproducido queda en `*-analisis` (lo limpia lo existente: Borrar caché / `library_remove` app.rs:318). Hasta ~1,5 GB por título analizado.

## 7. Pasos (en orden; verificación al final de cada uno)
1. `AddOptions.download_bps` + mapeo a `AddTorrentOptions.ratelimits` + callers con `None` (anclas §5.1). ✔ `cargo check -p streamonte-core --features rqbit` (o el feature por defecto del crate).
2. Visibilidades `pub(super)` (pipeline.rs:76, speed.rs:164/186/202, live.rs:199/217) y `pub mod probe;`. ✔ `cargo check`.
3. `probe.rs`: constantes, tipos, funciones puras + tests (`should_stop` corta a los 10 s con 8 s al tope; sigue si `still_rising`; `summarize` excluye saturadas y marca `link_limited`; `cap_bps` clampa por link y ≥ 64 KiB/s; `ramp_secs`). ✔ `cargo test -p streamonte-core probe`.
4. `probe.rs`: `Budget` + `probe()` (flujo §4.3). ✔ test con el motor falso si existe en `analyzer/queue.rs` tests; si no, test de `Budget` (take/give/timeout) y prueba manual del paso 6.
5. Eventos, `App::catalog_probe`, comando y registro. ✔ `cargo build` del workspace.
6. UI (`api.js`, `catalog.js`, `health-calib.js`). ✔ Manual: abrir una película con 4K y 1080p, "Encontrar el mejor torrent": en el log, líneas "medición con tope" con ttfb/sostenida; el panel termina ≤ ~75 s; tooltips de salud dicen "Medido"; Activity/monitor de red no supera el link; Detener corta todo; ▶ en una medida loguea "reuso lo bajado al analizar (FR-06d)".
7. Fidelidad: reproducir 3–5 opciones medidas (una con tope, otras sin) y comparar sostenida del probe vs. calibración de la reproducción (min 2–5) en "Tu conexión".

## 8. Riesgos
- **Sin entrantes ni tiempo en el enjambre** (ADR-30, 10–30 s): en enjambres que mejoran a los minutos (caso 4K de 00-contexto) "se quedó en X" sigue subestimando. Mitigado parcialmente por `peer_limited`/`ramp`; el arreglo de fondo es idea 1 (+ D1).
- 20 peers vs. 100 al reproducir: subestima enjambres de muchos peers lentos (`peer_limited` lo avisa).
- Tráfico: hasta 1,5 GB y 200 conexiones por análisis; en conexiones medidas/móviles molesta. Expone la IP a 15 enjambres (como hoy, R-11).
- Re-reserva dinámica puede saturar el link si un lento acelera → guardia de saturación, no prevención.
- Packs: `need` exacto solo con metadatos; si no llegan, no hay medición.
- `governor` deja una ráfaga de 1 s de cuota: primer segundo puede pasar el tope (las muestras del primer segundo se descartan si superan 1,2 × cap).
- Calibración mezcla probes (20 peers, segundos) con reproducciones (100 peers, minutos): puede bajar `seedMbps`; solo afecta a opciones no medidas.

## 9. Métricas de éxito
- Falsos pesimistas: de las opciones con salud ≠ buena tras el probe, < 10 % sostienen ≥ 2× lo pedido en los min 2–5 del play (dato: calibración de reproducción vs. `probed`).
- Error |probe − play min 2–5| / play: mediana ≤ 35 % en las sin tope.
- Tiempo desde "Encontrar el mejor torrent" a panel "hecho": p50 ≤ 60 s, p90 ≤ 80 s.
- Datos por análisis ≤ 1,5 GB; nunca > link sostenido (guardia).
- ▶ de una medida: primer frame más rápido que sin análisis (precarga ya hecha).

## 10. Decisiones abiertas
- **D1**: ¿motor de la medición con escucha + UPnP (`create_for_playback`) para sumar entrantes? Hoy contradice ADR-30 (el analizador no escucha); se vuelve natural si se hace la idea 1 (mismo motor anunciado temprano). Default de este spec: no.
- **D2**: borrar `swarm.rs` + `catalog_swarm` tras validar §9 (seguimiento).
- **D3**: ¿pedir confirmación o un aviso en redes medidas (datos)? Default: no.

## 11. Estimación
Varios módulos (core analyzer + engine + app/Tauri + UI) · complejidad **media-alta** (concurrencia con presupuesto compartido de ancho de banda, ventana adaptativa, re-add condicional) · incertidumbre **investigar/experimental**: si 10–30 s sin entrantes predicen lo que pasa a los minutos (el sesgo central de 00-contexto), y el comportamiento real del limitador con la ventana de pedidos en vuelo (que "llegar al tope" se vea como ≥ 0,9 × cap y no oscile).

## 12. Relación con otras ideas
- **1 (anunciarse temprano)**: complementaria y casi necesaria: los peers/entrantes que lleguen antes acortan metadatos y ttfb y quitan el sesgo de "recién conectado"; con D1 el probe corre en ese mismo motor.
- **2 (salud en vivo)**: el probe es su versión acotada en tiempo (con tope y fin); si se hace la 2, el probe es su primer tramo y la reproducción hereda peers igual que acá.
- **4 (corrección aprendida)**: el probe da el "predicho" por torrent; la 4 aprende el sesgo probe→play por red (más chico que estimado→play).
- **6 (peers rápidos)**: sale gratis del mismo probe (`per_peer_stats_snapshot` durante la bajada); no hace falta un camino aparte.
