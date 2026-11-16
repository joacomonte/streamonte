# Idea 2 — Salud en vivo (spec) · 2026-11-16

Contexto y reglas: /Users/monti/Documents/Dev/streamonte/docs/plans/salud-fiel/00-contexto.md.

## 0. Veredicto
Viable con handoff **(b)**: motor de fondo que **escucha** (puerto real + UPnP + DHT persistente), 8 candidatos × 30
conexiones, "sondas" de throughput con tope por torrent (la idea 3 como primitiva) y, al ▶, apagado ordenado que deja
peers + `.torrent` + carpeta con lo bajado (inicio del archivo) para que la reproducción los herede (FR-06d) **en el
mismo puerto**. Reproducir en el mismo motor (a) se descarta: el tope y el límite de peers por torrent son
inmutables (ver §1), así que igual habría que quitar y re-agregar el torrent.
Gate: experimento del paso 3 antes de tocar UI.

## 1. Verificación en la fuente (librqbit 9.1.0)

| Hecho | Ancla |
|---|---|
| `LimitsConfig { upload_bps, download_bps }` (token bucket `governor`, `Quota::per_second`) | /Users/monti/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/librqbit-9.1.0/src/limits.rs:9-13,20-24 |
| `set_download_bps` existe y cambia en caliente (swap del limiter) | /Users/monti/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/librqbit-9.1.0/src/limits.rs:42-48,81-83 |
| **Sesión**: `SessionOptions.ratelimits` → `Session.ratelimits: Limits` es `pub` ⇒ `session.ratelimits.set_download_bps(..)` en caliente, **compartido por todos los torrents** de la sesión | /Users/monti/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/librqbit-9.1.0/src/session.rs:466, :139, :810 |
| **Por torrent**: `AddTorrentOptions.ratelimits` y `.peer_limit` | /Users/monti/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/librqbit-9.1.0/src/session.rs:285, :291, copiado a `ManagedTorrentOptions` en :1369-1371 |
| El tope por torrent se construye **solo al pasar a live** (`Limits::new(options.ratelimits)`), campo privado, opciones `pub(crate)` sin setter ⇒ **no se cambia en caliente** (ni pause/unpause: relee las mismas opciones) | /Users/monti/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/librqbit-9.1.0/src/torrent_state/live/mod.rs:216, :266; /Users/monti/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/librqbit-9.1.0/src/torrent_state/mod.rs:111-122, :189 |
| Cada pedido de chunk pasa por el bucket del torrent **y** el de la sesión (aplica a streams también) | /Users/monti/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/librqbit-9.1.0/src/torrent_state/live/mod.rs:1708-1720 |
| `peer_limit` = semáforo creado al pasar a live (también inmutable); cubre salientes y **entrantes** (`try_acquire` en `add_incoming_peer`) | /Users/monti/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/librqbit-9.1.0/src/torrent_state/live/mod.rs:289-291, :370-376 |
| "Terminado" = piezas seleccionadas completas y ningún stream abierto sobre archivo incompleto; con `only_files=[]` está terminado de entrada | /Users/monti/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/librqbit-9.1.0/src/torrent_state/live/mod.rs:827-848 |
| Terminado ⇒ peer que muere no se reencola (:1343) y a un seeder no interesado se lo corta (:1651-1660) | /Users/monti/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/librqbit-9.1.0/src/torrent_state/live/mod.rs:1343-1347, :1651-1660 |

Consecuencias:
- **Mantener seeders sin bajar el archivo**: ya resuelto por `hold_peers` (stream parado al final del archivo más
  grande ⇒ torrent "no terminado"; baja como mucho la última pieza):
  /Users/monti/Documents/Dev/streamonte/crates/core/src/engine/rqbit.rs:494-517. Lo usa el conteo:
  /Users/monti/Documents/Dev/streamonte/crates/core/src/analyzer/swarm.rs:191-202.
- **Ojo**: `prioritize_ranges` aborta TODAS las `range_tasks`, incluida la de `hold_peers`
  (/Users/monti/Documents/Dev/streamonte/crates/core/src/engine/rqbit.rs:447-449). La sonda debe re-llamar `hold_peers` al terminar.
- Cada stream retiene un permiso de E/S; el motor de reproducción usa 8 por defecto y solo el no-reproducción sube a 40
  (/Users/monti/Documents/Dev/streamonte/crates/core/src/engine/rqbit.rs:145-150). 8 holds + 3 sondas > 8 ⇒ el motor de fondo necesita 40.
- Tope por torrent = fijo al agregar ⇒ se calcula antes de agregar (`cap_bps` lo manda la UI). Tope de sesión no se usa
  (bucket compartido = sondas paralelas se roban ancho de banda y la medición deja de ser por torrent).

## 2. Handoff a reproducción: (a) vs (b)

Hoy: cada reproducción crea su motor (`create_for_playback`,
/Users/monti/Documents/Dev/streamonte/crates/core/src/playback/flow.rs:72), agrega en `slot.dir` (:76-86), y al parar
quita + `shutdown` (/Users/monti/Documents/Dev/streamonte/crates/core/src/playback.rs:704-712). `add_cached_or_magnet` ya
carga `.torrent` y peers en caché < 30 min (/Users/monti/Documents/Dev/streamonte/crates/core/src/engine/mod.rs:358-415).
FR-06d adopta `analysis_dir(hash)` por rename (/Users/monti/Documents/Dev/streamonte/crates/core/src/playback/kept.rs:86-97,
/Users/monti/Documents/Dev/streamonte/crates/core/src/paths.rs:161-164).

| | (a) mismo motor de fondo | (b) caché de peers + carpeta + **mismo puerto** (elegida) |
|---|---|---|
| Conexiones | Igual hay que quitar y re-agregar (tope y peer_limit=30 inmutables) ⇒ se pierden | Se pierden; se reconecta con `initial_peers` (segundos) |
| Entrantes | Puerto/UPnP/DHT siguen | Mismo puerto: se apaga el de fondo primero y `free_port` toma el primero libre del rango = el mismo (/Users/monti/Documents/Dev/streamonte/crates/core/src/engine/rqbit/net.rs:40-47); trackers/DHT ya tienen ese puerto |
| Cambios | PlaybackManager no debe apagar un motor ajeno, carpeta fija al agregar (`output_folder`), Cleanup/dueño, varias reproducciones en una sesión | ~40 líneas: `stop(keep)` + rename a `analysis_dir` antes de `play` |
| Riesgo | Alto (ciclo de vida compartido) | Bajo; costo ≤ 5 s si `session.stop` tarda (/Users/monti/Documents/Dev/streamonte/crates/core/src/engine/rqbit.rs:724) |

Hereda: `.torrent` (sin metadatos), peers conectados, piezas del inicio (lo bajado por las sondas, con su bitfield
por enlace duro: /Users/monti/Documents/Dev/streamonte/crates/core/src/engine/rqbit/fastresume.rs:31-38), puerto, tabla DHT (lease liberado al apagar, :727).

## 3. Qué número es la "salud en vivo"

Por candidato, el núcleo emite `LiveHealth` (ver §5). La UI decide así (orden de prioridad en `health()`):
1. Reproducción/carga en curso (como hoy).
2. **Sonda** con ≥ 15 s útiles: `supply = probe_bps`. Si `probe_bps ≥ 0,9 × cap_bps` ⇒ "llegó al tope":
   ratio = `cap/need` (con cap = 2,5×need ⇒ **buena con confianza**). Si no llegó al tope, ratio = medido/need.
3. Sin sonda todavía: estimación actual con **seeders vivos** (incluye entrantes) × `seedMbps` (basis `counted`).
4. Nada: trackers (como hoy).
Entrantes: se muestran en el tooltip ("N entrantes") y alimentan `incomingStatus` como una reproducción (decisión mem 23).
A los ~30 s: número por 3 (seeders vivos); a medida que terminan sondas: medido. A ~2 min: segunda sonda de los 3 mejores.

## 4. Presupuesto y ciclo de vida

- **Conexiones**: `WATCH_N = 8` candidatos × `peer_limit = 30` = ≤ 240 (incluye entrantes). Referencia: 25×30=750
  saturaba, 10×30 se eligió como seguro (/Users/monti/Documents/Dev/streamonte/crates/core/src/analyzer/swarm.rs:35-40; mem 26).
  Mientras corre el vigía, `runDeep`/`countSeeds` **no** cuentan los hashes vigilados (no duplicar conexiones).
- **Ancho de banda**: sondas en paralelo `parallel = clamp(floor(0,8 × link / cap_mediano), 1, 3)`; `cap_bps =
  min(2,5 × need, 0,8 × link / parallel)`; sin test de velocidad: `parallel = 2`, sin clamp por link.
- **Disco**: sonda = rango desde el inicio del archivo de `cap × probe_secs × 1,2` bytes. Presupuesto total
  `disk_budget_mb = 2048`: si se pasaría, la sonda no arranca (queda la estimación por seeders). Todo en
  `downloads_dir/<hash>-<pid>-watch`; al parar se borra salvo el que se reproduce. Huérfanos tras crash: los limpia
  Cleanup (dueño = pid, /Users/monti/Documents/Dev/streamonte/crates/core/src/cleanup.rs:1-8).
- **CPU**: hash de piezas a ≤ ~150 Mbps agregados; despreciable frente a mpv.
- **Ciclo de vida**:
  - Arranca: `onStreams` con `update.done` y grupo de resolución abierto (y al cambiar `openRes` → reconcilia).
  - No arranca si hay una reproducción activa (no pausada ni fallida): devuelve `false`, la UI queda como hoy.
  - Cerrar panel / otro título: `catalog_stop_streams` / `catalog_streams` lo paran (borra todo).
  - ▶, retomar o ⤓ (cualquier `AppCore::play` / `Resume`): `stop(keep = hash)` **antes** de crear la reproducción.
  - Tope de vida `max_minutes = 10`: se para solo (emite el último estado con `done = true`; la UI lo congela).
  - Detener manual: botón `#cat-live-stop`.

## 5. Diseño

### Núcleo — archivo nuevo /Users/monti/Documents/Dev/streamonte/crates/core/src/analyzer/watch.rs
```rust
#[derive(Debug, Clone, Deserialize)]
pub struct WatchItem { pub hash: InfoHash, pub cap_bps: u32 }

#[derive(Debug, Clone, Copy, Serialize, Default, PartialEq)]
pub struct LiveHealth {
    pub secs: u32,            // desde que se agregó
    pub reached: bool,        // hay metadatos
    pub seeds: u32, pub peers: u32, pub incoming: u32,   // ahora (no máximo)
    pub probe_bps: Option<f64>,  // promedio s 4..fin de la última sonda (bytes/s, por received_bytes)
    pub probe_secs: u32,         // segundos útiles de esa sonda
    pub cap_bps: u32,
    pub probing: bool,
    pub done: bool,              // el vigía terminó: valores congelados
}

pub struct HealthWatch { /* engine, cancel, task, items: Arc<Mutex<HashMap<InfoHash, Slot>>>, reprobe: Arc<Mutex<HashSet<InfoHash>>> */ }

impl HealthWatch {
    /// Motor que escucha (create_for_playback) + reconciliación inicial. Err si no arranca el motor.
    pub async fn start(paths: &AppPaths, cfg: &Config, episode: Option<(u32, u32)>, items: Vec<(Magnet, u32)>,
                       parallel: usize, on_update: impl Fn(InfoHash, LiveHealth) + Send + Sync + 'static) -> Result<Self>;
    /// Agrega los nuevos, quita (y borra carpeta) los que ya no están. Mismo motor y puerto.
    pub async fn reconcile(&self, items: Vec<(Magnet, u32)>, parallel: usize);
    pub fn reprobe(&self, hash: InfoHash);
    /// Para todo. `keep`: guarda peers + .torrent y deja su carpeta como `analysis_dir(hash)` (si no existe ya).
    pub async fn stop(self, keep: Option<InfoHash>);
}
```
Por torrent (tarea): `add_deselected`-like con `AddOptions { download_bps: Some(cap), peer_limit: Some(30), .. }` en
`<hash>-<pid>-watch` (claim con Cleanup como /Users/monti/Documents/Dev/streamonte/crates/core/src/analyzer/pipeline.rs:52-73)
→ `metadata` (sin timeout duro; muerto si a 15 s `Waiting::Metadata{peers:Some(0)}`, como swarm.rs:176-179) → guarda
`.torrent` → `pick_file(FilePick{index:None, episode})` → `hold_peers` → loop 1 s: `stats()` → emite `LiveHealth` si cambió.
Sondas: semáforo `parallel`; ronda 1 a todos (orden de llegada de metadatos), ronda 2 a los 3 de mayor `probe_bps`
cuando `secs ≥ reprobe_after_secs`; `reprobe(hash)` encola una. Sonda: `prioritize_ranges(h, f, [start..end])` →
cada 1 s `received_bytes` → a los `probe_secs` o `RangeReady`: `prioritize_ranges(h, f, [])` + `hold_peers`. Ronda 2
empieza en el `end` de la 1.

### Cambios en código existente
- /Users/monti/Documents/Dev/streamonte/crates/core/src/engine/mod.rs:47-55 `AddOptions`: + `pub download_bps: Option<u32>`, `pub peer_limit: Option<u32>`.
  Constructores a completar con `None`: /Users/monti/Documents/Dev/streamonte/crates/core/src/playback/flow.rs:80,
  /Users/monti/Documents/Dev/streamonte/crates/core/src/analyzer/pipeline.rs:66, /Users/monti/Documents/Dev/streamonte/crates/core/src/analyzer/names.rs:69,
  /Users/monti/Documents/Dev/streamonte/crates/core/src/engine/rqbit/fastresume.rs:86, /Users/monti/Documents/Dev/streamonte/crates/core/examples/bench.rs:197.
- /Users/monti/Documents/Dev/streamonte/crates/core/src/engine/rqbit.rs:319-327: `ratelimits: LimitsConfig { download_bps: opts.download_bps.and_then(NonZeroU32::new), upload_bps: None }`, `peer_limit: opts.peer_limit.map(|n| n as usize)`.
- /Users/monti/Documents/Dev/streamonte/crates/core/src/engine/rqbit.rs:145-150: `runtime_worker_threads = Some(40)` siempre (quitar el `if !playback`; actualizar comentario).
- /Users/monti/Documents/Dev/streamonte/crates/core/src/analyzer.rs:24: + `pub mod watch;`.
- /Users/monti/Documents/Dev/streamonte/crates/core/src/config.rs:14-30 `Config`: + `pub live_health: LiveHealthConfig` con
  `#[serde(default)]` y defaults: `enabled: true, peers_per_torrent: 30, probe_secs: 25, reprobe_after_secs: 120, reprobe_top: 3, disk_budget_mb: 2048, max_minutes: 10`.
- /Users/monti/Documents/Dev/streamonte/crates/core/src/events.rs:70-80: + `CatalogLiveHealth { hash: InfoHash, health: LiveHealth }` (UI: `catalog-live-health`).
- /Users/monti/Documents/Dev/streamonte/crates/core/src/app.rs:107: + `health_watch: tokio::sync::Mutex<Option<HealthWatch>>`; métodos:
  `pub async fn catalog_watch(&self, video_id: &str, items: Vec<WatchItem>, parallel: usize) -> bool` (false si
  `!enabled`, motor no rqbit, o `self.playback.rows()` con alguna activa; si ya hay, `reconcile`),
  `pub async fn catalog_watch_reprobe(&self, hash: InfoHash)`, `async fn stop_watch(&self, keep: Option<InfoHash>)`.
  Llamar `stop_watch(None)` en `catalog_streams` (:762-765) y `catalog_stop_streams` (:781-785);
  `stop_watch(Some(req.key.info_hash))` al inicio de `play` (:366) y en `playback_action` cuando es `Resume` (:369).
- /Users/monti/Documents/Dev/streamonte/src-tauri/src/commands.rs (junto a :238): `catalog_watch(video_id, items, parallel) -> bool`, `catalog_watch_reprobe(hash)`; registrar en /Users/monti/Documents/Dev/streamonte/src-tauri/src/lib.rs:89-97.
- /Users/monti/Documents/Dev/streamonte/ui/src/api.js:55-57: `catalogWatch(videoId, items, parallel)`, `catalogWatchReprobe(hash)`.

### UI — /Users/monti/Documents/Dev/streamonte/ui/src/catalog.js
- Estado: `const watched = new Map()` (hash → LiveHealth). Constantes `WATCH_N = 8`, `CAP_RATIO = 2.5`, `PROBE_MIN_SECS = 15`.
- `startWatch()` (nueva): en `onStreams` (:432) cuando `update.done`, y al cambiar `openRes` (:1154-1156): toma los
  `WATCH_N` del grupo abierto por `seedsOf` sin `unlikely`, calcula `cap_bps`/`parallel` (§4, `neededBps` :674 o `TYPICAL_MBPS`), llama `api.catalogWatch`.
- Evento `catalog-live-health` en el switch (:1706+): `watched.set`, render con el mismo throttle de 400 ms que `liveRender`.
- `seedsCounted` (:515): primero `watched.get(h)?.reached ? seeds : …`. `tierOf` (:505): vigilado con `reached` ⇒ 2.
  `health` (:702): paso 2 de §3 (`probe` antes de `rowsOf(...).live`), devolver `measured: 'probe'`. `healthBadge` (:726):
  mostrar también si `watched.get(h)?.reached`; tooltip "En vivo · N s · X entrantes · sonda Y Mbps (tope Z)"; si
  vigilado, el click llama `api.catalogWatchReprobe(hash)` en vez de `reanalyze`. Id ya existe: `cat-health-<hash>`.
- `runDeep` (:1184): excluir de `todo` los hashes en `watched`.
- `sortOptions` (:485): sin cambios de forma (usa `tierOf`/`health`). "Mejor opción" (mem 8): pasa a valer cuando
  todos los vigilados del grupo tienen sonda ronda 1 o están muertos — **revisa la decisión mem 8**.
- Cabecera del grupo: `<span id="cat-live-status">Salud en vivo · N opciones · M midiendo</span>` + `<button id="cat-live-stop">Detener</button>` (llama `api.catalogWatch(videoId, [], 0)`: lista vacía = `stop_watch(None)` en el núcleo).
- `closeSide` (:224): `watched.clear()`.

## 6. Pasos de implementación

1. **Plumbing motor**. `AddOptions` + rqbit.rs:319 + rqbit.rs:145 + 5 constructores. Verif: `cargo build -p streamonte-core --all-features && cargo test -p streamonte-core` verdes; test nuevo en rqbit (junto a los de fastresume.rs:56+) que agrega un torrent con `download_bps = 256 KiB/s` no requiere red: solo assert de que compila/agrega (la velocidad se valida en 3).
2. **`analyzer/watch.rs` + config + evento** (sin app/UI). Verif: build; test unitario de la selección de ronda 2 (top `reprobe_top` por `probe_bps`) y del cálculo de rango de sonda.
3. **EXPERIMENTO (gate)**: ejemplo nuevo /Users/monti/Documents/Dev/streamonte/crates/core/examples/watch.rs (`--magnet` × N, `--cap-mbps`, `--play <i>`): imprime `LiveHealth` por segundo; a los 120 s hace `stop(keep)` y reproduce con `AppCore::play` (como /Users/monti/Documents/Dev/streamonte/crates/core/examples/play.rs) registrando velocidad p25 (decisión mem 24) en min 2–5, peers y entrantes. 6 títulos reales (≥ 15 torrents, incl. un 4K tipo el caso del contexto), con UPnP OK y con incoming apagado.
   Criterios (todos): (i) nivel (bueno/justo/malo vs need) de la sonda a 2 min = nivel en reproducción en ≥ 80 %; (ii) error mediano |sonda − reproducción|/reproducción ≤ 35 % cuando la sonda NO tocó el tope; (iii) handoff: `stop` ≤ 1,5 s p90 y la reproducción reusa el mismo puerto en ≥ 90 %; (iv) primera imagen ≤ la de sin handoff. Si (i) solo pasa a 2 min y no a 30 s: seguir, pero la UI marca "provisional" hasta la ronda 2. Si (i) < 60 % a 2 min: **parar** la idea 2 y priorizar la 4.
4. **App + comandos + api.js**. Verif: abrir título en `cargo tauri dev`, log `rqbit red: entrantes: escucha…` una sola vez, `catalog-live-health` llega (devtools), cerrar panel ⇒ carpetas `-watch` borradas (`ls` de downloads_dir).
5. **UI** (§5). Verif: a 30 s badges con número; a ~45–60 s badges "medido"; ▶ ⇒ log de la reproducción "reuso lo bajado al analizar (FR-06d)" + peers iniciales > 0; con reproducción activa abrir otro título ⇒ no arranca el vigía (comportamiento de hoy).
6. **Registrar en mem.db** (con OK): decisión nueva "salud en vivo" y revisión de la 8.

## 7. Riesgos
- La sonda del inicio del archivo compite con piezas "raras"; la velocidad del inicio puede no representar el resto (lo cubre la ronda 2).
- Cerrar el motor tarda hasta 5 s (rqbit.rs:724) ⇒ ▶ más lento en el peor caso (medido en 3-iii).
- Entrantes que no reintentan tras el corte (los vivos quedan muertos sin reintento, contexto) ⇒ parte se pierde en el handoff.
- Exposición de IP a 8 enjambres con puerto abierto (R-11 de config.rs:163) apenas se abre un título: hoy pasa solo al tocar "Analizar". Comunicarlo.
- Router casero: 240 conexiones + UPnP; si falla, bajar `WATCH_N` a 6.
- Otra reproducción/medición en `analysis_dir(hash)`: si existe, se borra la carpeta del vigía (no se fusiona).

## 8. Decisiones abiertas (para Joaquín)
1. ¿Arranque automático al abrir título (exposición de IP) o con un toggle en "Tu conexión"? Default propuesto: automático, `live_health.enabled` en config.
2. Revisión de mem 8 ("Mejor opción solo con análisis profundo terminado") → "con ronda 1 de sondas terminada".
3. ¿El vigía convive con una carga ⤓ en background? Propuesto: no (la ⤓ lo para con handoff).

## 9. Métricas de éxito
- Fidelidad: nivel de salud mostrado a 2 min = nivel real en reproducción (min 2–5) en ≥ 80 % (hoy subestima el caso 4K).
- Tiempo: número en ≥ 6 de 8 candidatos a 30 s; medido en ≥ 3 a 60 s.
- Handoff: peers a 10 s de reproducir ≥ 70 % de los del vigía; primera imagen no peor.
- Costo: ≤ 240 conexiones, ≤ 2 GB de disco temporal, 0 carpetas `-watch` tras cerrar.

## 10. Estimación
Varios módulos (engine, analyzer nuevo, app, comandos Tauri, catalog.js) · **alta** (concurrencia de sondas/permisos de E/S, ciclo de vida con puerto/DHT lease compartidos, handoff ordenado) · **experimental** (si la sonda de 25 s y la de 2 min predicen la reproducción, y cuántos entrantes sobreviven al handoff).

## 11. Relación con 1, 3 y 4
- **1 (anunciarse temprano)**: la 2 la **incluye**: el motor de fondo escucha con puerto real + UPnP y anuncia los 8 candidatos; la 1 sola es la 2 sin sondas ni handoff.
- **3 (throughput con tope)**: la 2 **subsume** a la 3 (la sonda es exactamente la 3, más persistencia y handoff). Orden recomendado: construir la 3 como pasos 1–2 de este spec (es la primitiva) y decidir con el experimento del paso 3 si vale el resto.
- **4 (corrección aprendida)**: complementaria, no la reemplaza: la 2 da el par "predicho (sonda 30 s / 2 min) → logrado (reproducción)" en el mismo puerto y red, que es la mejor muestra para aprender el sesgo restante.
