# Idea 1 — Anunciarse temprano (puerto real, trackers + DHT) para los mejores candidatos

Spec listo para implementar sin decidir nada. Contexto: /Users/monti/Documents/Dev/streamonte/docs/plans/salud-fiel/00-contexto.md.
Líneas citadas: árbol del 2026-11-16 (con el cambio sin commit de `health-calib.js`). librqbit = /Users/monti/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/librqbit-9.1.0/src/ (abreviado `LQ/`), tracker-comms = …/librqbit-tracker-comms-9.1.0/src/ (`TC/`), DHT = …/librqbit-dht-9.1.0/src/ (`DHT/`).

**Veredicto: depende del experimento (Paso 0).** Si pasa, la implementación es chica: el motor del conteo profundo escucha con el puerto real y el conteo de los 10 mejores arranca solo apenas llegan las opciones.

## 1. Hechos verificados en la fuente

| # | Hecho | Dónde |
|---|---|---|
| L1 | Una `Session` con `listen` anuncia el puerto real a trackers (sin escucha manda 4240) y hace `announce_peer` en el DHT con ese puerto, apenas se agrega el torrent (`announce = !paused && !list_only`). No hace falta stream. | `LQ/session.rs:1245-1252`, `:1555`, `:1591`; `DHT/dht.rs:124-150` |
| L2 | El DHT re-consulta (y re-anuncia a los nodos cercanos con token) cada 60 s. | `DHT/lib.rs:24`, `DHT/dht.rs:358` |
| L3 | Entrantes: se aceptan solo si el torrent ya está en la sesión. Un magnet resolviendo metadatos todavía no está (`db.add_torrent` va después de `resolve_magnet`) → **las entrantes de ese lapso se descartan** ("didn't find a matching torrent"). Con el `.torrent` en caché no pasa. | `LQ/session.rs:957`, `:1272` vs `:1400` |
| L4 | `add_incoming_peer` NO mira si el torrent está "terminado": acepta mientras haya lugar en el semáforo de peers (`peer_limit`); lleno → descarta la entrante. | `LQ/torrent_state/live/mod.rs:370-381` |
| L5 | Con `only_files=[]` el torrent queda "terminado" (`needed_bytes == 0`). Sin streams, cada peer que tiene todo y no está interesado (un seeder) **se desconecta** al llegar. Con un stream abierto sobre un archivo incompleto (`hold_peers`) eso no pasa. | `LQ/torrent_state/live/mod.rs:827-829`, `:843-848`, `:1651-1661`; `/Users/monti/Documents/Dev/streamonte/crates/core/src/engine/rqbit.rs:494-517` |
| L6 | `task_peer_adder` descarta peers "por terminado" solo con la feature `disable-upload`, que no está prendida (`default-features = false, features = ["default-tls"]`). | `LQ/torrent_state/live/mod.rs:615`, `LQ/torrent_state/mod.rs:121-135`, `/Users/monti/Documents/Dev/streamonte/crates/core/Cargo.toml:27` |
| L7 | Entrante que muere no se reintenta; con torrent terminado y sin streams, ningún peer se re-encola. | `LQ/torrent_state/live/mod.rs:1343-1357` |
| L8 | **A los trackers les decimos que somos seeder**: `left = total − bajado`, con `total = selected_bytes` = 0 cuando `only_files=[]` → `left = 0`; UDP manda `EVENT_COMPLETED`. Durante la resolución del magnet el torrent no está en la sesión → stats por defecto, también `left = 0`. Muchos trackers no le pasan seeders a un seeder → por trackers llegan más que nada leechers. El DHT no tiene ese dato (los seeders nos ven igual por DHT). Pasa igual hoy en la reproducción (el torrent entra con `only_files=[]` y el re-anuncio es por intervalo). | `TC/tracker_comms.rs:59-66`, `:403-417`; `LQ/chunk_tracker.rs:63-65`; `LQ/session.rs:1785-1815`; `/Users/monti/Documents/Dev/streamonte/crates/core/src/engine/rqbit.rs:338-339` |
| L9 | Al quitar el torrent no se manda `stopped` (solo al pausar): el tracker nos lista hasta que vence (típico 30-60 min) y el DHT guarda el anuncio ~30 min. | `TC/tracker_comms.rs:406-410` |
| L10 | `runtime_worker_threads` = permisos de E/S (`block_in_place`), 8 por defecto; cada stream retiene uno. El motor del análisis usa 40 porque `hold_peers` deja uno por torrent; el de reproducción usa 8. | `LQ/session.rs:690-693`; `/Users/monti/Documents/Dev/streamonte/crates/core/src/engine/rqbit.rs:145-150` |
| L11 | Hoy: `spawn(dht_file: None)` = analizador, sin escucha ni DHT persistente (ADR-30); `Some` = reproducción: `DhtLease` (un dueño de `dht.json` por proceso), `free_port` (primer puerto libre de `listen_ports`), UPnP. Cada reproducción crea su propio motor. | `/Users/monti/Documents/Dev/streamonte/crates/core/src/engine/rqbit.rs:125-134`; `/Users/monti/Documents/Dev/streamonte/crates/core/src/engine/rqbit/net.rs:20-47`; `/Users/monti/Documents/Dev/streamonte/crates/core/src/engine/mod.rs:418-431`; `/Users/monti/Documents/Dev/streamonte/crates/core/src/playback/flow.rs:72` |
| L12 | El conteo profundo ya hace todo lo demás que pide la idea: `hold_peers` (L5), guarda `.torrent` + peers conectados (entrantes incluidos) para el play, y el play los usa como `initial_peers`. | `/Users/monti/Documents/Dev/streamonte/crates/core/src/analyzer/swarm.rs:191-228`; `/Users/monti/Documents/Dev/streamonte/crates/core/src/engine/mod.rs:358-366` |

**Respuesta directa:** sí, basta agregar los torrents a una `Session` con `listen` + UPnP, sin streams, para anunciarse (L1). Pero para que los seeders entrantes **se queden** hace falta el stream de `hold_peers` (L5), y para que lleguen entrantes hace falta tener los metadatos (L3).

## 2. Paso 0 — Experimento (obligatorio, decide si la idea sigue)

### 2.1 Qué mide
En la red del usuario, para los mismos torrents: peers/seeders/entrantes a 60 s **después de tener metadatos**, con el motor del análisis actual (sin escucha) vs. el mismo motor escuchando con el puerto real (`create_for_playback`). Corridas secuenciales (no simultáneas: muchos clientes rechazan dos conexiones de la misma IP y se falsearía la comparación).

### 2.2 Binario nuevo: /Users/monti/Documents/Dev/streamonte/crates/core/examples/announce_probe.rs
Patrón de /Users/monti/Documents/Dev/streamonte/crates/core/examples/analyze.rs (config real, `AppPaths::resolve`). Sin dependencias nuevas.

```rust
//! Experimento salud-fiel/01: ¿cuántos peers ENTRANTES llegan en N s si el motor del análisis
//! escucha y se anuncia con el puerto real, vs. el análisis actual (sin escucha)?
//! `cargo run -p streamonte-core --release --example announce_probe -- [--secs 60] [--order ab|ba] <magnet>...`
//! Con la app CERRADA. Hasta 10 magnets (= swarm::CONCURRENCY). Usa la config, la caché de
//! .torrent/peers y el dht.json reales; sus carpetas de descarga las borra al terminar.
// main: parsear args; assert!(magnets.len() <= 10); AppPaths::resolve(); ConfigStore::new(&paths).load();
// para cada modo en `order` ('a' = base sin escucha, 'b' = escuchando): run(); 30 s de pausa entre modos.
// Imprimir tabla por torrent y el resumen de §2.3.

#[derive(Default, Clone, Copy)]
struct Probe { meta_secs: Option<f32>, peers: u32, seeds: u32, incoming: u32, first_in: Option<u64> }

async fn run(listen: bool, magnets: &[Magnet], secs: u64, cfg: &Config, paths: &AppPaths) -> Vec<Probe> {
    let mut ecfg = cfg.engine.clone();
    ecfg.max_connections = 30; // = MAX_PEERS de analyzer/swarm.rs
    let engine = if listen { engine::create_for_playback(&ecfg, paths).await } else { engine::create(&ecfg, paths).await }
        .expect("motor");
    // tokio::task::JoinSet: una tarea por magnet con probe_one(engine.clone(), …); juntar en orden.
    // engine.shutdown().await al final.
}

async fn probe_one(engine: Arc<dyn TorrentEngine>, m: Magnet, secs: u64, cfg: Config, paths: AppPaths, tag: &str) -> Probe {
    // dir = paths.downloads_dir().join(format!("{}-{}-probe-{tag}", m.info_hash.to_hex(), std::process::id()))
    // h = engine::add_cached_or_magnet(&*engine, &paths.torrent_cache_file(&m.info_hash),
    //       m.with_trackers(&cfg.all_trackers()), AddOptions { trackers: cfg.all_trackers(), download_dir: dir.clone(), initial_peers: vec![] })
    // t0 = Instant::now(); meta = tokio::time::timeout(90 s, engine.metadata(h)); sin meta → Probe::default()
    // meta.save_torrent_cache(&paths.torrent_cache_file(..)) (así el 2º modo arranca igual que el 1º)
    // engine.hold_peers(h, índice del archivo más grande) con timeout 5 s (igual que swarm.rs:193-201)
    // for sec in 1..=secs: sleep 1 s; engine.stats(h) → máximos de peers, seeds, incoming_peers;
    //   first_in = primer `sec` con incoming_peers > 0
    // engine.remove(h, RemoveOptions { delete_data: false }); std::fs::remove_dir_all(dir)
}
```

### 2.3 Procedimiento y criterio numérico
1. En la app: Ajustes → Red → "Verificar puerto" debe dar **abierto**. Si da cerrado: el experimento no vale; si la red no se puede abrir, la idea **no sigue para esa red** (sin entrantes no hay nada que ganar).
2. Cerrar la app. 3 títulos distintos (uno debe ser del tipo del caso real: 4K, trackers con ≤ 3 seeds). Por título, copiar los 10 primeros magnets del catálogo y correr `--secs 60`, alternando `--order ab` / `--order ba` entre títulos.
3. Resumen que imprime el binario (solo torrents con metadatos en ambos modos, objetivo ≥ 25 en total):
   - **G1** = % de torrents con ≥ 1 entrante a 60 s (modo b).
   - **G2** = mediana de `peers_b / max(peers_a, 1)`.
   - **G3** = mediana de `first_in` (s desde metadatos).
   - Además: mediana de `seeds_b − seeds_a`.
4. Decisión:
   - **SIGUE** (implementar §4–§7) si **G1 ≥ 40 % y G2 ≥ 1,25**.
   - **NO SIGUE** si G1 < 20 %: archivar la idea; las entrantes del caso real llegan con más minutos (lo cubre la idea 2).
   - **Gris** (G1 20–40 % o G2 < 1,25): repetir con `--secs 120`. Si recién ahí cumple G1 y G2, no se implementa sola (la ventana del conteo es ≤ 85 s, `/Users/monti/Documents/Dev/streamonte/crates/core/src/analyzer/swarm.rs:46`): pasa a ser parte de la idea 2.
   - Si G3 > 45 s aunque pase: subir `WINDOW_DEEP.0` (mínimo) de 45 a 60 en el Paso 3.

Anotar los números en este archivo (sección 10) antes de seguir.

## 3. Decisión de diseño (tomada)
**El conteo profundo escucha, y para los 10 mejores arranca solo al llegar las opciones.** No se crea un motor "anunciador" aparte.

Por qué (lo más simple que hace todo lo pedido):
- El conteo ya agrega deseleccionado, retiene peers con un stream (L5), guarda `.torrent` + peers para el play (L12), se corta al cerrar/cambiar de video y tiene tope de conexiones (B-26 de mem.db: 10 a la vez, 30 por torrent). Solo le falta escuchar.
- Misma sesión = las entrantes cuentan directo como seeders/peers del análisis, sin sumar dos fuentes ni el problema de "dos conexiones desde la misma IP".
- "Antes" = el conteo arranca al llegar las opciones, sin esperar el clic en "Chequear"; "durante" = mientras cuenta; "en el play" = la caché de peers (`initial_peers`).

Descartado: motor anunciador separado que vive mientras el panel está abierto y le pasa el motor/handle a la reproducción. Más código (registro, traspaso de handle y carpeta, cortar al dar play) y compite con el conteo por los mismos peers. Queda como opción si el experimento muestra G3 alto (las entrantes tardan) y la idea 2 no se hace.

## 4. Conflictos: ADR-30, `DhtLease`, `free_port`, reproducción en curso
- **ADR-30** (no está en un documento: vive en comentarios de `/Users/monti/Documents/Dev/streamonte/crates/core/src/engine/rqbit/net.rs:1-2`, `/Users/monti/Documents/Dev/streamonte/crates/core/src/engine/rqbit.rs:120-124`, `/Users/monti/Documents/Dev/streamonte/crates/core/src/engine/mod.rs:418-419`, `/Users/monti/Documents/Dev/streamonte/crates/core/src/config.rs:100-101`) dice que el analizador no escucha. Se cambia a: "el conteo profundo escucha si `engine.announce_early`; el análisis rápido, nombres y herramientas siguen sin escuchar". Se actualizan esos comentarios.
- **Una sola Session compartida con la reproducción: no.** Cada reproducción tiene su motor (L11) y eso no se toca.
- **`DhtLease`**: el motor del conteo usa `create_for_playback`, así que toma el lease si está libre (bueno: arranca con la tabla DHT guardada, menos tiempo de metadatos). Si no está libre (hay una reproducción), cuenta sin persistir: el código ya lo maneja (`/Users/monti/Documents/Dev/streamonte/crates/core/src/engine/rqbit.rs:131-132`).
- **Puerto**: `free_port` elige el primer libre del rango. Con una reproducción activa el conteo toma el siguiente (p. ej. 41851) y pide su propio UPnP: anda. Si el usuario da ▶ mientras el conteo sigue, la reproducción toma el siguiente libre y pierde el lease mientras el conteo viva (≤ ~3 min): sale "DHT sin guardar" en su log. Se acepta (ver D2).
- **Permisos de E/S (L10)**: hoy el motor con `dht_file` tiene 8 y el conteo necesita uno por torrent retenido. Se usan 40 en todos los motores (cambio de una condición; en la reproducción solo sube un tope que no se alcanza).
- **`log_peers`**: con `dht_file`, cada torrent del conteo lanza el log de red cada 10 s a `EngineEvent::Log` (`/Users/monti/Documents/Dev/streamonte/crates/core/src/engine/rqbit.rs:375-387`). Nadie escucha esos eventos del motor del conteo: costo despreciable, se deja.

## 5. Privacidad
- Qué cambia: hoy el análisis ya conecta saliente a los mismos enjambres (los peers ven la IP). Lo nuevo es que la IP queda **listada** en trackers y DHT como peer de esos torrents (L1), visible para quien junte anuncios, y **sigue listada ~30 min** después de cerrar (L9).
- Cómo se acota:
  - Toggle `engine.announce_early` (Ajustes → Red), sin él todo queda como hoy.
  - Solo los 10 mejores por trackers (`EARLY_TOP = 10` = una tanda de `CONCURRENCY`).
  - Solo mientras el panel está abierto y en ese video: cerrar o cambiar de video corta el conteo (`/Users/monti/Documents/Dev/streamonte/crates/core/src/app.rs:766`, `:781-785`); y el conteo termina solo (≤ 90 s metadatos + ≤ 85 s).
  - El texto del toggle dice lo de la IP y los ~30 min.

## 6. Aprovechar a los entrantes
- **Análisis**: misma sesión → `Stats.seeds`/`peers` ya los incluyen (`/Users/monti/Documents/Dev/streamonte/crates/core/src/engine/rqbit.rs:597-615`). Se agrega `incoming` a `SwarmCount` para mostrarlo en la fila y medir el éxito.
- **Play**: `save_peers(connected_peers)` al final del conteo ya los guarda (`/Users/monti/Documents/Dev/streamonte/crates/core/src/analyzer/swarm.rs:225-228`) y la reproducción se conecta a ellos de entrada (`/Users/monti/Documents/Dev/streamonte/crates/core/src/engine/mod.rs:365`). Ojo: una entrante puede estar detrás de NAT y no aceptar la conexión saliente del play; los seedboxes sí. No se agrega nada.
- **Calibración**: `seedMbps` se aprendió con conteos sin escucha; con escucha hay más seeders contados → la salud puede inflarse hasta que la calibración se rehaga. Se resuelve en la idea 4 (ver §12); acá no se toca.

## 7. Implementación (solo si el Paso 0 da SIGUE)

### Paso 1 — Config `announce_early`
- /Users/monti/Documents/Dev/streamonte/crates/core/src/config.rs:110 (después de `utp`): 
  ```rust
  /// Salud fiel, idea 1 (2026-11-16): al abrir un título, contar a fondo los 10 mejores enseguida
  /// con el motor ESCUCHANDO: se anuncia con el puerto real a trackers y DHT y los peers se
  /// conectan solos (entrantes). Deja la IP listada ~30 min en esos enjambres.
  pub announce_early: bool,
  ```
  Default en `:124` (junto a `upnp`/`utp`): `announce_early: true` (D1). `#[serde(default)]` de `EngineConfig` (`:88`) cubre configs viejas.
- Verificación: `cargo test -p streamonte-core config` pasa; un `config.json` sin el campo carga con el default.

### Paso 2 — Motor del conteo escuchando
- /Users/monti/Documents/Dev/streamonte/crates/core/src/engine/rqbit.rs:145-150: sacar el `if !playback` y dejar `opts.runtime_worker_threads = Some(40);` para todos; ajustar el comentario ("el conteo retiene uno por torrent, también escuchando").
- /Users/monti/Documents/Dev/streamonte/crates/core/src/analyzer/swarm.rs:75: 
  ```rust
  // Idea 1: escuchando, los peers que ven el anuncio se conectan solos (entrantes).
  let created = if cfg.engine.announce_early {
      crate::engine::create_for_playback(&engine_cfg, paths).await
  } else {
      crate::engine::create(&engine_cfg, paths).await
  };
  let engine = match created { … igual que hoy … };
  ```
- Comentarios ADR-30 (§4): /Users/monti/Documents/Dev/streamonte/crates/core/src/engine/rqbit/net.rs:1-2, /Users/monti/Documents/Dev/streamonte/crates/core/src/engine/rqbit.rs:120-124, /Users/monti/Documents/Dev/streamonte/crates/core/src/engine/mod.rs:418-419 y :424-425, /Users/monti/Documents/Dev/streamonte/crates/core/src/config.rs:100-101: agregar "y el conteo profundo con `announce_early`".
- Verificación: `cargo test -p streamonte-core` pasa (incluye `un_solo_dueno_del_dht`, `puerto_ocupado_salta_al_siguiente_o_al_azar`). Con la app: contar a fondo un título → en el log general aparece `rqbit red: entrantes: escucha TCP+uTP en el puerto 4185x` y "successfully port forwarded".

### Paso 3 — `incoming` en `SwarmCount`
- /Users/monti/Documents/Dev/streamonte/crates/core/src/analyzer/swarm.rs:48-56: agregar `/// Conectados que se conectaron ellos (entrantes; solo con announce_early). pub incoming: u32,`.
- Constructores en `:169`, `:189`, `:203`: `incoming: 0`.
- `:211-215`: subir también con `s.incoming_peers > best.incoming` y `best.incoming = best.incoming.max(s.incoming_peers)`.
- Si el experimento dio G3 > 45 s: `WINDOW_DEEP` en `:46` → `(60, 85, 25)`.
- Verificación: `cargo build`; el evento `catalog-swarm-counted` trae `count.incoming`.

### Paso 4 — Ajustes → Red: toggle
- /Users/monti/Documents/Dev/streamonte/ui/index.html:86 (después de `#set-upnp`):
  `<label class="setting-check"><input id="set-announce" type="checkbox"> Analizar apenas abro un título y anunciarme a los peers (más fiel; tu IP queda listada ~30 min en los enjambres de las 10 mejores opciones)</label>`
- /Users/monti/Documents/Dev/streamonte/crates/core/src/app.rs:525-532: `set_network(&self, incoming: bool, upnp: bool, announce_early: bool)` y `c.engine.announce_early = announce_early;`.
- /Users/monti/Documents/Dev/streamonte/src-tauri/src/commands.rs:206-208: agregar el parámetro `announce_early: bool` y pasarlo.
- /Users/monti/Documents/Dev/streamonte/ui/src/api.js:111: `setNetwork: (incoming, upnp, announceEarly) => invoke('config_set_network', { incoming, upnp, announceEarly }),` (Tauri convierte camelCase → snake_case).
- /Users/monti/Documents/Dev/streamonte/ui/src/dialogs.js:125-127: `$('#set-announce').checked = engine.announce_early; $('#set-announce').disabled = !engine.incoming;`. `:136-138`: mismo `disabled` y pasar `$('#set-announce').checked` como 3er argumento.
- /Users/monti/Documents/Dev/streamonte/ui/src/app.js:106: `$('#set-announce').addEventListener('change', saveNetwork);`.
- Verificación: tildar/destildar, cerrar y reabrir Ajustes → persiste; `config.json` tiene `announce_early`.

### Paso 5 — Catálogo: arranque solo de los 10 mejores
- /Users/monti/Documents/Dev/streamonte/ui/src/catalog.js: junto a `TOP` (`:1044`):
  ```js
  /** Idea 1 (2026-11-16): con `engine.announce_early`, al llegar las opciones se cuentan a fondo
   *  solas las EARLY_TOP mejores por trackers (una tanda de swarm::CONCURRENCY), escuchando. */
  const EARLY_TOP = 10;
  function startEarly() {
    const ranked = (state.update?.candidates ?? []).filter((c) => inScope(c, null) && !unlikely(c) && !counted.has(c.info_hash))
      .sort((a, b) => (seedsOf(b) ?? -1) - (seedsOf(a) ?? -1));
    const hashes = ranked.slice(0, EARLY_TOP).map((c) => c.info_hash);
    if (hashes.length) countSeeds(hashes);
  }
  ```
- `onStreams` (`:432-442`), después de `state.update = update;`:
  ```js
  if (update.done && !state.side.earlyStarted) {
    state.side.earlyStarted = true;
    const video = state.side.videoId;
    api.config().then((cfg) => { if (cfg.engine.announce_early && cfg.engine.incoming && state.side?.videoId === video) startEarly(); }).catch(() => {});
  }
  ```
- Donde se resetea por video (`:422`, junto a `state.side.subsStarted = false;`): `state.side.earlyStarted = false;`.
- No se toca `runDeep`: su `todo` ya excluye lo contado y lo que se está contando (`:1190`), así "Chequear <resolución>" cuenta el resto.
- Fila: en el tooltip de contado (`:843`), si `scraped.incoming > 0` agregar `` ` ${scraped.incoming} se conectaron solos (entrantes).` `` al final del texto `Conectado al enjambre: …`.
- Verificación (app real, red con puerto abierto): abrir una película → sin clic, 10 filas pasan a "contando"; al terminar, tooltip con "N se conectaron solos" en varias; cerrar el panel a mitad → se cortan (no quedan carpetas `*-swarm` en `downloads`). Con el toggle apagado: nada arranca solo (comportamiento de hoy).

### Paso 6 — Registro de la decisión
- Pedirle al usuario anotar en /Users/monti/Documents/Dev/streamonte/mem.db (tipo D): "ADR-30 cambia: el conteo profundo escucha con `engine.announce_early`; arranca solo con los 10 mejores al abrir un título". No escribirlo sin OK.

## 8. Riesgos
- **R1 Router saturado** (B-26): el arranque solo suma una tanda de 10×30 conexiones por título abierto; si además el usuario aprieta "Chequear", son dos motores (20×30). Mitigación: `EARLY_TOP = 10`; si molesta, D4.
- **R2 Seeder a los ojos del tracker (L8)**: por trackers llegan sobre todo leechers; los seeders entrantes vienen por DHT. El experimento ya lo incluye (mide lo que hay). Arreglarlo exige seleccionar el archivo (baja datos) → D3.
- **R3 Magnets sin `.torrent` en caché (L3)**: las entrantes de los primeros 5-60 s se pierden. Los torrents ya contados alguna vez tienen caché.
- **R4 Salud inflada** con la calibración vieja (§6).
- **R5 IP listada ~30 min** tras cerrar (L9).
- **R6 Play durante el conteo**: puerto distinto y sin DHT persistente esa reproducción (§4).

## 9. Decisiones abiertas (para el usuario; cada una tiene default)
- **D1** Default del toggle tras un experimento exitoso: **`true`** (la fidelidad es la prioridad; el análisis ya expone la IP saliente). Alternativa: `false` (opt-in).
- **D2** Play mientras el conteo sigue: **dejar como hoy** (el conteo sigue hasta terminar). Alternativa: cortarlo al dar ▶ (libera puerto y lease, pero se pierde la caché de peers de ese conteo porque se aborta antes de `save_peers`).
- **D3** Anunciarse como leecher (`left > 0`): **no** en esta versión. Alternativa: seleccionar el archivo con tope de descarga por torrent (`AddTorrentOptions.ratelimits`, `LQ/session.rs:285`) → baja datos y suma un método al trait.
- **D4** Arrancar solo aunque el puerto dé cerrado (`incomingStatus()` en /Users/monti/Documents/Dev/streamonte/ui/src/health-calib.js:165): **sí** (igual gana tiempo: el análisis empieza antes). Alternativa: solo si la red tiene entrantes abiertas.

## 10. Métricas de éxito
- Experimento: G1 ≥ 40 %, G2 ≥ 1,25 (anotar aquí: G1 = __, G2 = __, G3 = __, Δseeds = __).
- En uso (2 semanas): en ≥ 50 % de los títulos con puerto abierto, alguna fila contada muestra `incoming > 0`; y la diferencia "salud estimada vs. salud real al reproducir" (la mide la idea 4) baja respecto de antes del cambio.
- Tiempo: desde abrir el título hasta 10 filas contadas ≤ ~2 min (hoy empieza recién al clic).

## 11. Estimación
- Experimento: un archivo nuevo · baja · **experimental** (no se sabe cuántas entrantes llegan en 60 s; depende de la red y de L3/L8).
- Implementación: varios módulos (motor, analizador, config, comando Tauri, Ajustes, catálogo), ~60 líneas · baja · conocido (lo que sube algo: el arranque solo interactúa con el embudo de `runDeep` y con la carga del router).

## 12. Interacción con las otras ideas
- **2 (salud en vivo)**: es la versión larga de esta; si se hace, su motor de fondo debería ser este mismo (escuchando) y vivir más que el conteo. Si el experimento da gris a 120 s, esta idea se absorbe en la 2.
- **3 (throughput con tope)**: medir en el motor que escucha da números más cercanos al play; correrla después del conteo temprano para no sumar otra tanda de conexiones al router.
- **4 (corrección aprendida)**: obligatoria para que esta no infle la salud (R4): las muestras deben guardar si el conteo escuchaba (`announce_early`) y aprender el sesgo aparte.
- También alimenta B-23 (entrantes por red): un `incoming > 0` del conteo podría marcar la red como "abierta"; no se hace acá.

---
No verificado: comportamiento real de los trackers con `left = 0` (L8 es lectura de código + práctica común de opentracker), y que UPnP alcance a mapear antes de que lleguen las entrantes (puede tardar hasta 20 s, B-28). Ambos los mide el experimento de hecho.
