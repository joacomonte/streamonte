# Idea 7 — Tamaño real del enjambre sin conectarse a todos (PEX + DHT + announce)

Spec para implementar sin decidir nada. Contexto y reglas: /Users/monti/Documents/Dev/streamonte/docs/plans/salud-fiel/00-contexto.md.
Librqbit: `R=/Users/monti/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f` (todas las rutas de librqbit abajo son `$R/...` absolutas).

## Veredicto
- (a) **Contador de direcciones únicas: sí, casi gratis.** librqbit ya junta DHT + trackers + PEX + caché en un único mapa por torrent y lleva el contador `seen`; solo hay que exponerlo. No cuesta tiempo ni conexiones.
- (b) **Censo DHT suelto (sin TCP) para todos los candidatos: sí, pero experimental.** Es poco código (la DHT ya está en el motor del analizador); el valor (si ve peers que los trackers no ven y si eso predice la reproducción) se mide antes de darle peso.
- (c) **Announce UDP a trackers: condicional.** Aporta poco sobre el scrape y expone la IP en 40 torrents. Se implementa solo si el experimento E2 lo justifica. `completed` se guarda solo para el experimento.
- Nada cambia la salud ni el orden hasta pasar los criterios numéricos de E3 (paso 7). Hasta ahí solo se muestra en tooltips y se registra.

## 1. Verificación en la fuente (librqbit 9.1.0)

### PEX
- Anunciamos `ut_pex` en el handshake extendido: `$R/librqbit-peer-protocol-9.1.0/src/extended/mod.rs:34-38` (`my()` → `ut_pex: Some(..)`).
- **Recepción**: `$R/librqbit-9.1.0/src/torrent_state/live/mod.rs:1112-1122` (`ExtendedMessage::UtPex` → `on_pex_message`, se ignora si el torrent es privado). `on_pex_message` en `:2037-2053`: **suma `dropped_peers()` y `added_peers()`** y llama `add_peer_if_not_seen(peer.addr)` para cada una.
- `add_peer_if_not_seen` (`live/mod.rs:730-741`) → `peers.add_if_not_seen` (`$R/librqbit-9.1.0/src/torrent_state/live/peers/mod.rs:41-55`): inserta en `states: DashMap<SocketAddr, Peer>` si no estaba, incrementa `stats.queued` y **`stats.seen`**, y manda la dirección a `peer_queue_tx` (se intentará conectar, con el tope `peer_limit`).
- Los flags de PEX (`added.f`, bit "seed") existen en el mensaje (`$R/librqbit-peer-protocol-9.1.0/src/extended/ut_pex.rs:55-60`) pero librqbit **los descarta** (solo usa `peer.addr`). Saber "es seeder" sin conectar requeriría parchear librqbit → descartado.
- **Envío**: `task_send_pex_to_peer` (`live/mod.rs:922-1000`): primer mensaje a los 10 s, después cada 60 s (`PEX_MESSAGE_INTERVAL`), máx. 50 direcciones, solo de `live_outgoing_peers`. Se lanza por peer en `live/mod.rs:1191-1206` si el remoto soporta `ut_pex`.
- PEX solo corre con el torrent **live** (después de los metadatos). Mientras se resuelve un magnet (`$R/librqbit-9.1.0/src/dht_utils.rs:30-100`) no hay PEX.

### A dónde van TODAS las direcciones (una sola cuenta)
- `make_peer_rx` (`$R/librqbit-9.1.0/src/session.rs:1542-1601`) une DHT `get_peers` + `TrackerComms` (announce) + `initial_peers` + LSD.
- Al resolver un magnet, las direcciones consumidas vuelven al stream (`session.rs:1274-1284`, `seen_peers`), y `spawn_peer_adder` (`$R/librqbit-9.1.0/src/torrent_state/mod.rs:684-722`) las pasa por `add_peer_if_not_seen`.
- Entrantes: `add_incoming_peer` (`live/mod.rs:370-410`) también incrementa `seen` (`:410`). En el analizador no hay entrantes (no escucha, ADR-30).
- ⇒ **`peer_stats.seen` = direcciones únicas conocidas por torrent (DHT ∪ trackers ∪ PEX ∪ caché ∪ entrantes)**, monótono (los `Dead` no se borran del mapa).
- Contadores disponibles (`$R/librqbit-9.1.0/src/torrent_state/live/peers/stats/mod.rs:12-24`): `queued, connecting, live, live_tcp, live_utp, live_socks, live_seeders, seen, dead, not_needed, steals`. Se leen por torrent con `torrent.stats().live.snapshot.peer_stats` (`live/mod.rs:743-753`), igual que hoy `live`/`live_seeders` en /Users/monti/Documents/Dev/streamonte/crates/core/src/engine/rqbit.rs:581 y :610.
- Inflan `seen` (aceptado, se calibra contra lo real): PEX `dropped` (peers que ya se fueron), el mismo peer por IPv4 e IPv6, y la caché de peers del conteo anterior (`initial_peers` = `load_peers`, /Users/monti/Documents/Dev/streamonte/crates/core/src/engine/mod.rs:365).

### DHT `get_peers`
- `Dht::get_peers(info_hash, announce_port)` (`$R/librqbit-dht-9.1.0/src/dht.rs:1376-1382`) → `RequestPeersStream` (`:200-260`): búsqueda recursiva v4 y v6 (`max_depth 4`, `useful_nodes_limit 256`), re-consulta cada 60 s (`REQUERY_INTERVAL`, `$R/librqbit-dht-9.1.0/src/lib.rs:24`) mientras viva el stream. Se cancela al soltarlo (`Drop`, `:241-246`).
- Con `announce_port = None` **no se manda `announce_peer`** (`dht.rs:124-127` corta antes): consulta pura.
- Límite global por instancia de DHT: 250 consultas/s (`dht.rs:80-92`, env `DHT_QUERIES_PER_SECOND`).
- `dht.stats()` (`dht.rs:51-57`, `:1388`) da `routing_table_size` y `outstanding_requests` (sirve para loguear el arranque en frío).
- Uso actual: /Users/monti/Documents/Dev/streamonte/crates/core/src/engine/rqbit.rs:302-320 lanza un `get_peers(id, None)` propio por magnet para contar direcciones mientras faltan metadatos. **Hallazgo**: librqbit ya hace su propio `get_peers` en `make_peer_rx` (`session.rs:1553-1556`) ⇒ cada magnet del análisis hace **dos** búsquedas DHT. No se toca en este spec (mencionado; candidato a limpiar en otra tarea).
- El analizador tiene DHT sin persistencia (/Users/monti/Documents/Dev/streamonte/crates/core/src/engine/rqbit/net.rs:55-63, `dht_file: None`) ⇒ arranca en frío cada vez (bootstrap de varios segundos; se mide en E0).

### Trackers
- librqbit **siempre anuncia** a los trackers (`TrackerComms::start(..., self.announce_port().unwrap_or(4240), ...)`, `session.rs:1585-1592`); el analizador anuncia con puerto falso 4240 (comentario en /Users/monti/Documents/Dev/streamonte/crates/core/src/engine/rqbit/net.rs:65). Es decir: **hoy el análisis profundo ya expone la IP a los trackers de cada torrent contado**, la DHT no.
- Scrape propio: /Users/monti/Documents/Dev/streamonte/crates/core/src/trackers.rs:50-97 (máximo entre trackers, trae `completed`). **`completed` se pierde**: `set_scrape` (/Users/monti/Documents/Dev/streamonte/crates/core/src/catalog/aggregate.rs:82-87) solo copia seeders/leechers.
- No hay announce UDP propio (solo `ACTION_CONNECT`/`ACTION_SCRAPE`, trackers.rs:31-33); `transact` (trackers.rs:166-197) sirve para agregarlo.

## 2. Diseño

### 2a. Contador de direcciones únicas (`known`)
- `engine::Stats.known_peers: Option<u32>` — rqbit: `Some(peer_stats.seen)`; webtorrent: `None`.
- `SwarmCount.known: u32` — máximo de `known_peers` durante la ventana de conteo; sin metadatos, = `peers` (lo que vio la DHT). Va en el evento y el resultado de `catalog_swarm` (sin comando nuevo).
- Señal clave: `known − peers` = direcciones que existen pero no aceptaron nuestra conexión saliente (en su mayoría detrás de NAT). **Esas son las que al reproducir con puerto abierto entran solas** (caso real del contexto: 7–12 peers, mayoría entrantes). Por eso su peso depende de `incomingStatus().open` de la red.
- Log por torrent al terminar el conteo (para E1): `tracing::info!("swarm {hash}: peers={} seeds={} known_meta={} known_fin={}")` — `known_meta` = `known` al tener metadatos, `known_fin` al final; la diferencia ≈ PEX + re-consulta DHT.

### 2b. Censo DHT (prefiltro sin TCP)
- **Cuándo**: al abrir un título, apenas `update.done` (fuentes + scrape listos), una vez por video. Corre en paralelo a que el usuario mire la lista: no suma tiempo al análisis profundo.
- **Cuántos**: `CENSUS_MAX = 40` candidatos (todas las resoluciones), los primeros por `seedsOf` desc; sin excluir `unlikely` (justamente los 0/0 son los que la DHT puede salvar).
- **Plazo**: `CENSUS_SECS = 12` (DHT en frío ~3–6 s + 1–2 rondas de búsqueda). Valor fijo; E0 dice si alcanza.
- **Cómo**: un motor del analizador propio (`engine::create`, sin escucha ni persistencia), `get_peers(id, None)` para los 40 a la vez, `HashSet<SocketAddr>` por hash hasta el plazo, se sueltan los streams (cancela las búsquedas) y `shutdown`. Cortable con el mismo `swarm_cancel` (cambiar de video / Detener).
- **Router**: cero TCP. UDP acotado por el limitador de librqbit (≤ 250 consultas/s ⇒ ≤ ~3000 consultas en 12 s). Las 40 búsquedas comparten ese límite; no se toca.
- **Resultado**: `HashMap<InfoHash, u32>` (direcciones únicas DHT por hash). Falta en el mapa = 0.

### 2c. Announce UDP + `completed` (condicional, paso 9)
- `completed` del scrape pasa a `StreamCandidate.completed: Option<u32>` (paso 5) solo para registrarlo en el log del experimento.
- Announce (solo si E2 lo aprueba): `trackers::announce_batch(hashes, trackers, timeout) -> HashMap<InfoHash, Vec<SocketAddr>>`, BEP 15 `action=1`, `event=0`, `numwant=200`, `port=4240` (el mismo falso de hoy), y al recibir la respuesta un segundo announce `event=3 (stopped)` para darse de baja. Máx. 8 trackers UDP por hash (los del magnet primero). Las direcciones se unen al `HashSet` del censo antes de contar.

### 2d. Uso en salud y orden (`catalog.js`)
Fase 1 (pasos 1–6, sin peso):
- `census: Map<hash, n>` en la UI. Tooltip de seeds (`seedsTip`) y de salud suman: "La red conoce ~N direcciones (DHT/trackers/PEX); no todas aceptan conexión."
- `runDeep`: un `unlikely` (trackers 0/0) con `census ≥ 1` **no** se marca `'dead'` (entra al ranking normal). Único cambio de comportamiento de la fase 1.
- Log local `streamonte.census-log` (localStorage, máx. 300 filas, la más nueva primero) al terminar cada `countSeeds`: `{at, network, hash, res, trackerSeeds, trackerLeechers, completed, census, seeds, peers, known, level}` (`level` = `health(c)?.level` con la fórmula vigente).
- Muestras de calibración (`health-calib.js`): `known_peers` y `dht_peers` por reproducción.

Fase 2 (paso 8, solo si E3 pasa; cada parte se activa por separado según su criterio):
- **Orden de TOP (P2a)**: `runDeep` elige `TOP=15` como unión: los 10 mejores por `seedsOf` + los 5 mejores por `census` que no estén ya. Desempate de `bySeeds` sin cambios.
- **Salud (P2b)**: en `health()`, si `basis === 'counted'`, la red tiene entrantes abiertos (`incomingStatus()?.open`), y `n.known > n.peers`: `rawKnown = n.known × cal.knownMbps`; `raw = Math.max(raw, rawKnown)` (solo corrige subestimación). `cal.knownMbps` = mediana por red de `sustainedMbps / known_peers` de las muestras con `known_peers > 0`, mínimo `MIN_SAMPLES`; sin muestras suficientes, no se aplica. Tooltip: "Le llegarían ~X Mbps (N direcciones conocidas × Y Mbps; con tu puerto abierto muchas entran solas)".
- Sin conteo profundo (`tierOf = 1`): el censo no da salud (sigue el criterio "salud solo con conteo profundo").

### 2e. Calibración contra lo real (idea 4) y criterio para darle peso
- Lo real = muestras que ya guarda `trackPlayback` (sostenido p25 de una reproducción ≥ 10 s, por red). Se les agrega `known_peers` (del conteo) y `dht_peers` (del censo).
- **Correlación esperada**: `known` vs Mbps sostenidos: positiva moderada (Spearman 0,4–0,7) con puerto abierto; débil con puerto cerrado. `census` vs `counted.peers`: alta (≥ 0,6) si la DHT ve lo mismo que el enjambre. `completed` vs Mbps: débil (< 0,3, es histórico).
- Se mide en E1–E3 (paso 7) con Spearman en la consola de devtools (fragmento en el paso 7). Spearman y no Pearson: los conteos son muy asimétricos.

## 3. Firmas

Rust (núcleo):
```rust
// /Users/monti/Documents/Dev/streamonte/crates/core/src/engine/mod.rs — struct Stats
/// Direcciones únicas conocidas del enjambre (DHT + trackers + PEX + caché), conectadas o no.
/// `None` si el motor no lo informa (webtorrent).
#[serde(default)]
pub known_peers: Option<u32>,

// trait TorrentEngine
/// Censo sin conectarse: direcciones únicas que da la DHT (`get_peers` sin anunciarse) para cada
/// hash durante `secs`. `None` si el motor no tiene DHT propia (webtorrent).
async fn dht_census(&self, _hashes: &[InfoHash], _secs: u64) -> Option<HashMap<InfoHash, u32>> {
    None
}

// /Users/monti/Documents/Dev/streamonte/crates/core/src/analyzer/swarm.rs
pub struct SwarmCount { pub seeds: u32, pub peers: u32, pub reached: bool, pub known: u32 }
pub const CENSUS_SECS: u64 = 12;
pub async fn census(paths: &AppPaths, cfg: &Config, hashes: Vec<InfoHash>, cancel: CancellationToken)
    -> HashMap<InfoHash, u32>;

// /Users/monti/Documents/Dev/streamonte/crates/core/src/app.rs
pub async fn catalog_census(&self, hashes: &[InfoHash]) -> HashMap<InfoHash, u32>;
```
Tauri: `catalog_census(hashes: Vec<InfoHash>) -> CmdResult<HashMap<InfoHash, u32>>`. Sin eventos nuevos (`catalog-swarm-progress/counted` ya llevan `count.known`).
UI: `api.catalogCensus(hashes)`; `CENSUS_MAX = 40`; Map `census`; `state.side.censusStarted`.
IDs UI: no hay elementos interactivos nuevos. La línea "~N en la red" va solo en tooltips existentes (`cat-seeds-<hash>`, `cat-health-<hash>`).

## 4. Pasos (con anclas y verificación)

1. **`Stats.known_peers`.**
   - /Users/monti/Documents/Dev/streamonte/crates/core/src/engine/mod.rs:219 — después de `incoming_peers`, agregar el campo (firma arriba).
   - /Users/monti/Documents/Dev/streamonte/crates/core/src/engine/rqbit.rs:612 — antes de `incoming_peers: torrent`, `known_peers: s.live.as_ref().map(|l| l.snapshot.peer_stats.seen),`.
   - /Users/monti/Documents/Dev/streamonte/crates/core/src/engine/webtorrent.rs:443 — `known_peers: None,`.
   - /Users/monti/Documents/Dev/streamonte/crates/core/src/playback/calibration.rs:290 ya usa `..Default::default()`: sin cambios.
   - Verificar: `cargo check -p streamonte-core --all-features` y `cargo test -p streamonte-core`.

2. **`SwarmCount.known` + log.** /Users/monti/Documents/Dev/streamonte/crates/core/src/analyzer/swarm.rs
   - :49-56 agregar `pub known: u32` con doc "Direcciones únicas conocidas (DHT + trackers + PEX), conectadas o no".
   - :169 y :189 → `known: dht_peers` / `known: found` (sin metadatos, lo de la DHT).
   - :203 → `known: 0`; en el bucle :206-219, si `let Some(k) = s.known_peers` y `k > best.known` → `best.known = k; last_rise = sec; progress(best)` (una dirección nueva también es novedad: extiende la ventana igual que hoy un peer nuevo). Guardar `known_meta` = primer `known_peers` leído.
   - Antes de :223 (`save_torrent_cache`), el `tracing::info!` de 2a.
   - Verificar: `cargo check`; correr la app, "Encontrar el mejor torrent" en un título popular; en el log debe salir `known_fin ≥ peers` y en devtools el evento `catalog-swarm-counted` con `count.known`.

3. **`dht_census` en el trait y rqbit.**
   - /Users/monti/Documents/Dev/streamonte/crates/core/src/engine/mod.rs:290 (después de `connected_peers`) — método por defecto `None` (firma arriba; `use std::collections::HashMap` e `InfoHash` ya importados o agregarlos).
   - /Users/monti/Documents/Dev/streamonte/crates/core/src/engine/rqbit.rs:533 (después de `connected_peers`) — implementación:
     ```rust
     async fn dht_census(&self, hashes: &[InfoHash], secs: u64) -> Option<HashMap<InfoHash, u32>> {
         use futures_util::StreamExt;
         let dht = self.inner.session.get_dht()?.clone();
         let deadline = tokio::time::Instant::now() + Duration::from_secs(secs);
         let tasks = hashes.iter().map(|h| {
             let mut peers = dht.get_peers(Id20::new(*h.as_bytes()), None); // sin announce_peer
             let h = *h;
             async move {
                 let mut seen = HashSet::new();
                 while let Ok(Some(a)) = tokio::time::timeout_at(deadline, peers.next()).await {
                     seen.insert(a);
                 }
                 (h, seen.len() as u32) // al soltar `peers` se cancela la búsqueda
             }
         });
         let out = futures_util::future::join_all(tasks).await.into_iter().collect();
         let st = dht.stats();
         tracing::info!(n = hashes.len(), rt = st.routing_table_size, "censo DHT listo");
         Some(out)
     }
     ```
   - webtorrent: nada (usa el default).
   - Verificar: `cargo check`; `futures_util` ya se usa en rqbit.rs:309.

4. **`census` + comando.**
   - /Users/monti/Documents/Dev/streamonte/crates/core/src/analyzer/swarm.rs — al final del archivo (antes de tests si hay), `CENSUS_SECS` y `pub async fn census(...)`: `engine::create(&cfg.engine, paths)`; `tokio::select!` entre `engine.dht_census(&hashes, CENSUS_SECS)` y `cancel.cancelled()`; `engine.shutdown()`; devolver el mapa o vacío. No crea carpetas (el censo no agrega torrents).
   - /Users/monti/Documents/Dev/streamonte/crates/core/src/app.rs:608 (después de `catalog_swarm`) — `catalog_census`: mismo `swarm_cancel` (`:594`), `hashes.to_vec()`, `cfg` clonado.
   - /Users/monti/Documents/Dev/streamonte/src-tauri/src/commands.rs:245 — `#[tauri::command] pub async fn catalog_census(core: Core<'_>, hashes: Vec<InfoHash>) -> CmdResult<HashMap<InfoHash, u32>> { Ok(core.catalog_census(&hashes).await) }`.
   - /Users/monti/Documents/Dev/streamonte/src-tauri/src/lib.rs:89 — registrar `commands::catalog_census,`.
   - /Users/monti/Documents/Dev/streamonte/ui/src/api.js:55 — `catalogCensus: (hashes) => invoke('catalog_census', { hashes }),` con doc "Censo DHT sin conectarse (~12 s): {hash: direcciones}".
   - Verificar: `cargo build`; en devtools `await api.catalogCensus([<hash popular>])` devuelve > 0 en ≤ 13 s.

5. **`completed` en el candidato (solo registro).**
   - /Users/monti/Documents/Dev/streamonte/crates/core/src/catalog/normalize.rs:28 — `#[serde(default)] pub completed: Option<u32>,` después de `leechers` (agregar `completed: None` donde se construya `StreamCandidate`: `cargo check` los marca, incluido el test de /Users/monti/Documents/Dev/streamonte/crates/core/src/catalog/aggregate.rs:375-395).
   - /Users/monti/Documents/Dev/streamonte/crates/core/src/catalog/aggregate.rs:85 — `c.completed = Some(s.completed);`.
   - Verificar: `cargo test -p streamonte-core`; el candidato en `catalog-streams` trae `completed`.

6. **UI fase 1.** /Users/monti/Documents/Dev/streamonte/ui/src/catalog.js y /Users/monti/Documents/Dev/streamonte/ui/src/health-calib.js
   - Cerca de `counted` (:644): `const census = new Map(); const CENSUS_MAX = 40;`.
   - :421-422 (`loadStreams`): `state.side.censusStarted = false; census.clear();`.
   - :436 (`onStreams`): si `update.done && update.candidates.length && !state.side.censusStarted` → `censusStarted = true; runCensus(video)`. `runCensus`: toma los `CENSUS_MAX` primeros por `seedsOf` desc, `api.catalogCensus(...)`, si sigue el mismo `videoId` carga `census` (los que faltan = 0) y `renderStreamsOnly()`. Errores → `showError`.
   - :1192 (`runDeep`): `todo.filter((c) => unlikely(c) && !(census.get(c.info_hash) > 0))`.
   - `seedsTip` (:838-848) y `tipText` de `healthBadge` (:735-737): agregar la línea de 2d si `census.get(hash)` o `counted.get(hash)?.known` > 0 (`known` manda si existe).
   - `countSeeds` (:1009-1034), al terminar el `for`: agregar filas a `streamonte.census-log` (2d) con `safeGet/safeSet` (ya usados en el archivo) y `JSON` en try/catch; `network` sale de health-calib (exportar un getter `currentNetwork()` en /Users/monti/Documents/Dev/streamonte/ui/src/health-calib.js junto a `setLinkMbps`).
   - :757 (`measurePlayback`): `trackPlayback(row, counted.get(hash)?.seeds, c && seedsOf(c), c?.leechers, counted.get(hash)?.known, census.get(hash))`.
   - health-calib.js:97 `trackPlayback(row, seeds, trackerSeeds, trackerLeechers, known, dht)` → `t.known_peers = known > 0 ? known : null; t.dht_peers = dht ?? null;` (junto a :100) y en `sample` (:136) agregar `known_peers: t.known_peers, dht_peers: t.dht_peers`.
   - Verificar (manual): abrir un título; a los ~12 s el tooltip de seeds de las opciones sin analizar dice "~N direcciones"; un 0/0 con censo > 0 ya no queda "salteado por muerto"; tras un análisis, `JSON.parse(localStorage['streamonte.census-log'])` tiene filas; tras reproducir ≥ 20 s, la muestra en `streamonte.health` trae `known_peers`.

7. **Experimento (sin código nuevo; criterio numérico).** Una red, puerto con entrantes abiertos (Tu conexión) y, aparte, una sesión con UPnP apagado.
   - **E0 – plazo del censo**: en 10 títulos, log "censo DHT listo": ≥ 80 % de los candidatos con `seedsOf > 0` deben tener `census > 0`. Si no, subir `CENSUS_SECS` a 20 y repetir; si con 20 tampoco, el censo no sirve como prefiltro → saltear P2a.
   - **E1 – cuánto suma PEX**: del log del paso 2, mediana de `(known_fin − known_meta) / known_meta` en ≥ 30 torrents contados. Solo informativo (dice si vale ampliar la ventana; no decide nada acá).
   - **E2 – censo vs. enjambre/trackers**: con `census-log` (≥ 10 títulos, ≥ 100 filas): Spearman(census, peers) y Spearman(trackerSeeds, peers). Además: ¿en cuántos títulos hay una opción `level 0` que **no** estaba en el top-15 por trackers pero sí en el top-5 por censo? (para medirlo, usar "Analizar N más" hasta cubrir todo el grupo).
     - **P2a se activa** si Spearman(census, peers) ≥ 0,6 **y** (supera al de trackers por ≥ 0,1 **o** aparece esa opción en ≥ 3 de 10 títulos).
     - **Paso 9 (announce) se hace** solo si en ≥ 30 % de las filas `census = 0` y `trackerSeeds + trackerLeechers ≥ 5` (la DHT no ve lo que los trackers sí).
   - **E3 – peso en la salud**: ≥ 15 muestras de `streamonte.health` con `known_peers` en la red abierta. Spearman(known_peers, sustained Mbps) vs Spearman(seeds, sustained Mbps). Recalcular offline cada muestra con la fórmula P2b.
     - **P2b se activa** si ρ(known) ≥ 0,5, ρ(known) ≥ ρ(seeds) + 0,1, y con P2b los casos "dijo nivel ≥ 1 y real ≥ 2×" bajan ≥ 50 % sin sumar más de 1 caso "dijo nivel 0 y real < 1×".
   - Fragmento para la consola (no se commitea):
     ```js
     const rank = (xs) => { const s = xs.map((x, i) => [x, i]).sort((a, b) => a[0] - b[0]); const r = []; s.forEach(([, i], k) => (r[i] = k)); return r; };
     const spearman = (a, b) => { const ra = rank(a), rb = rank(b), n = a.length; return 1 - (6 * ra.reduce((s, x, i) => s + (x - rb[i]) ** 2, 0)) / (n * (n * n - 1)); };
     const S = Object.values(JSON.parse(localStorage['streamonte.health']).bg).filter((s) => s.known_peers);
     spearman(S.map((s) => s.known_peers), S.map((s) => s.sustained_bps));
     ```
   - Anotar resultados en /Users/monti/Documents/Dev/streamonte/mem.db (tipo B, tags `salud,enjambre`) previo OK del usuario.

8. **Fase 2 (condicional, por parte).**
   - P2a: /Users/monti/Documents/Dev/streamonte/ui/src/catalog.js:1194-1196 — `ranked` = unión de 2d (10 por `seedsOf` + 5 por `census` no repetidos), el resto `'rest'`.
   - P2b: /Users/monti/Documents/Dev/streamonte/ui/src/health-calib.js — en `healthCalibration` (:80-86) calcular `knownMbps` (mediana por red de `sustainedMbps(l) / l.known_peers`, `null` con < `MIN_SAMPLES`) y devolverlo en `base`. /Users/monti/Documents/Dev/streamonte/ui/src/catalog.js:717-718 — `rawKnown` y `Math.max` de 2d (`incomingStatus` ya existe en health-calib.js; importarlo). Tooltip de :735-737 con la línea de P2b cuando `rawKnown` gane.
   - Verificar: con el caso del contexto (4K 1,4 GB, "2 seeds · 3 leechers") la salud pasa de mala/justa a buena si `known` alto y puerto abierto; con UPnP apagado no cambia.

9. **Announce UDP (condicional, E2).** /Users/monti/Documents/Dev/streamonte/crates/core/src/trackers.rs
   - `const ACTION_ANNOUNCE: u32 = 1;` junto a :31-33; `pub async fn announce_batch(...)` (2c) reutilizando `udp_host_port`, `transact` y el connect de `scrape_tracker` (:109-160); respuesta: `interval, leechers, seeders` + pares IPv4 de 6 bytes desde el byte 20.
   - Unir en `swarm::census` (direcciones del announce ∪ DHT por hash) — `dht_census` pasa a devolver los `HashSet` en vez de `u32` (cambio de firma solo dentro de rqbit/swarm).
   - Verificar: test con el tracker falso de trackers.rs:223 extendido a `ACTION_ANNOUNCE`; manual: censo de un título con trackers vivos sube respecto de solo DHT.

## 5. Privacidad
- `get_peers` sin `announce_port`: no nos registra como peer (nadie nos encuentra por la DHT), pero los ~100–300 nodos consultados ven **nuestra IP + el info_hash** (nodos espía de la DHT lo loguean). Mismo nivel que el análisis profundo de hoy, extendido de 15 a 40 hashes por título.
- Announce (paso 9): el tracker registra IP + info_hash y nos lista a otros (con puerto falso 4240) hasta el `stopped`. El análisis profundo de hoy **ya lo hace** con los 15 contados (`session.rs:1585-1592`); el paso 9 lo extendería a 40 por título. Por eso es condicional.
- No hay VPN/proxy en juego; si el usuario usara uno a nivel sistema, todo esto pasa por ahí igual.

## 6. Riesgos
- **PEX lento**: los clientes mandan PEX cada ~60 s; con ventanas de 12–85 s llega 0–1 ronda. `known` puede ser casi solo DHT + trackers (E1 lo mide). Sigue sirviendo como "tamaño".
- **Inflado de `seen`** (PEX `dropped`, v4+v6 duplicados, caché vieja): se absorbe con la calibración por red (`knownMbps` es un ratio medido), no se corrige.
- **DHT en frío** en cada motor del analizador: el censo y el conteo profundo arrancan cada uno su DHT; si se solapan, ~500 consultas/s UDP. Router: sin TCP, pero entradas NAT UDP (~3000 en 12 s). Si E0 muestra cortes de red, bajar `CENSUS_MAX` a 25.
- **Doble búsqueda DHT por magnet** ya existente (rqbit.rs:302-320 + session.rs:1553): suma carga; fuera de alcance.
- Correlación débil ⇒ la fase 2 no se activa y el trabajo queda como información en tooltips + datos para las ideas 4/5.

## 7. Decisiones abiertas (para el usuario, no para quien implementa)
- ¿Permitir que el analizador **lea** (sin escribir) `dht.json` de la reproducción para evitar el arranque en frío? Toca ADR-30; fuera de este spec.
- ¿Paso 9 aunque E2 no lo pida, por gusto? Default del spec: no.
- Mostrar el censo en la fila (no solo tooltip). Default: solo tooltip (la regla vigente es "salud solo con conteo profundo").

## 8. Estimación
- Fase 1 (pasos 1–6): **varios módulos** (engine, analyzer, app, tauri, catalog.js, health-calib.js) · **media** (búsquedas DHT concurrentes con plazo/cancelación; lo demás es plomería) · **investigar** (tiempo de bootstrap DHT en frío, E0).
- Experimento (7): sin código · baja · **experimental** (no se sabe si `known`/censo correlacionan con Mbps reales; depende de la red y del puerto).
- Fase 2 (8): un módulo (UI) · baja · conocido una vez pasado E3.
- Paso 9: un archivo · media (parseo BEP 15 + baja `stopped`) · investigar (trackers que no devuelven peers a `port=4240` o ignoran `stopped`).

## 9. Relación con otras ideas
- **Idea 1 (anunciarse temprano)**: `known − peers` estima cuántos entrarían solos si nos anunciamos con puerto abierto; el censo es la versión "sin anunciarse" y sirve para elegir a qué 10–15 anunciarse.
- **Idea 5 (extrapolar crecimiento)**: `known` es el techo natural de la curva de peers (no se puede llegar a más direcciones de las conocidas); la serie de `known` en el conteo es la entrada de la curva.
- **Idea 6 (peers rápidos)**: ortogonal: 7 mide cantidad sin conectar; 6 mide calidad conectando. Juntas: `known × fracción rápida`.
- Idea 4 es el mecanismo de calibración que usa este spec (muestras por red en health-calib.js).
