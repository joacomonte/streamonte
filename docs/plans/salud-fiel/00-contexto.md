# Salud fiel de magnets — contexto compartido para los specs (2026-11-16)

## Objetivo del usuario (prioridad máxima)
La "salud" que muestra el catálogo para cada opción de torrent debe ser FIEL a lo que después pasa al
reproducir: que no diga "Puede cortarse" y al reproducir resulte que anda mucho mejor o se conecta a
muchos más peers. Sin que el análisis tarde muchísimo (objetivo: ~1 min desde abrir el título).

## App
Streamonte: Tauri v2. Núcleo Rust en /Users/monti/Documents/Dev/streamonte/crates/core, UI vanilla JS en
/Users/monti/Documents/Dev/streamonte/ui/src. Motor torrent: librqbit 9.1.0 embebido (fuente:
/Users/monti/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/librqbit-9.1.0/ y librqbit-dht-9.1.0,
librqbit-core-9.1.0 al lado). Stream HTTP local → mpv.
Memoria del proyecto: /Users/monti/Documents/Dev/streamonte/mem.db (sqlite, tabla `entries`): leer decisiones
vigentes (tipos B/D) antes de proponer y no contradecirlas sin decirlo.

## Por qué hoy subestima (verificado en código)
| | Análisis | Reproducción |
|---|---|---|
| Conexiones entrantes | No (ADR-30: motor del analizador no escucha, rqbit.rs `spawn`, `dht_file: None`) | Sí + UPnP |
| Tiempo en el enjambre | 35–90 s metadatos + 12–85 s conteo | minutos (DHT/PEX suman) |
| Conexiones por torrent | 30 (`MAX_PEERS` en analyzer/swarm.rs) | 100 |
| Qué mide | seeders conectados | Mbps reales |
Caso real que falló: 4K 1,4 GB, trackers "2 seeds · 3 leechers", salud estimada mala/justa; reproduciendo
~55 Mbps con 7–12 peers, la mayoría ENTRANTES (UPnP abierto).

## Piezas existentes clave
- Salud y orden: /Users/monti/Documents/Dev/streamonte/ui/src/catalog.js (`health`, `knownSeeds`, `seedsCounted`,
  `leechersOf`, `tierOf`, `sortOptions`, `neededBps`, `healthBadge`, `runDeep`, `countSeeds`, `TOP`=15, `FINALISTS`).
- Calibración por red: /Users/monti/Documents/Dev/streamonte/ui/src/health-calib.js (`seedMbps` por seeder contado,
  NUEVO hoy sin commit: `trackerSeedMbps` por seeder de tracker, muestras con tracker_seeds/tracker_leechers/real_peers;
  entrantes por red `incomingStatus`). Popover: /Users/monti/Documents/Dev/streamonte/ui/src/speed.js.
  Ojo: hoy `health()` solo se muestra para opciones con conteo profundo.
- Conteo de enjambre: /Users/monti/Documents/Dev/streamonte/crates/core/src/analyzer/swarm.rs (CONCURRENCY=10, `hold_peers`,
  guarda .torrent y peers en caché para el play: `save_peers`/`load_peers` en engine/mod.rs).
- Medición real de throughput existente: `measure_with` en /Users/monti/Documents/Dev/streamonte/crates/core/src/analyzer/pipeline.rs
  y /Users/monti/Documents/Dev/streamonte/crates/core/src/analyzer/speed.rs; adopción de la carpeta del análisis al reproducir (FR-06d).
- Scrape UDP: /Users/monti/Documents/Dev/streamonte/crates/core/src/trackers.rs (máximo entre trackers, trae `completed`).
- Motor: /Users/monti/Documents/Dev/streamonte/crates/core/src/engine/mod.rs (trait `TorrentEngine`, `Stats` con seeds/peers/
  incoming_peers, `Metadata.piece_length`), /Users/monti/Documents/Dev/streamonte/crates/core/src/engine/rqbit.rs y
  /Users/monti/Documents/Dev/streamonte/crates/core/src/engine/rqbit/net.rs (`session_opts`, listen, UPnP, uTP, `log_peers`).
- Reproducción: /Users/monti/Documents/Dev/streamonte/crates/core/src/playback.rs, playback/flow.rs (precarga, subtítulos),
  /Users/monti/Documents/Dev/streamonte/crates/core/src/preload.rs. Config: /Users/monti/Documents/Dev/streamonte/crates/core/src/config.rs.
- Comandos Tauri: /Users/monti/Documents/Dev/streamonte/src-tauri/src/commands.rs; API UI: /Users/monti/Documents/Dev/streamonte/ui/src/api.js.

## Hechos de librqbit ya verificados
- piece_tracker.rs:190 `try_steal` exige `peer_avg_time` → sin robo de piezas al arrancar.
- torrent_state/streaming.rs: lookahead 32 MiB por stream, streams intercalados.
- torrent_state/live/mod.rs: torrent "terminado" sin streams (only_files=[]) desconecta seeders; entrantes muertos no se reintentan.
- limits.rs `LimitsConfig { download_bps, upload_bps }`; session.rs:466 tiene `ratelimits` en opciones (verificar si es por torrent).
- librqbit-dht 9.1.0: `get_peers(info_hash, announce_port)` existe; sin BEP 33.

## Las 8 ideas (cada subagente toma una)
1. Anunciarse temprano: al abrir un título, anunciarse (trackers + DHT) con puerto real escuchando para los top 10–15 candidatos, para que peers/seedboxes se conecten solos antes del análisis.
2. Salud en vivo: motor de fondo conectado (con tope) a los mejores candidatos desde que se abre el título; salud que se actualiza sola; al ▶ la reproducción hereda peers.
3. Medición de throughput con tope por torrent, en paralelo (10–15), ~20–30 s, "llega a 2,5× lo que pide" = buena con confianza.
4. Corrección aprendida análisis→reproducción por red: guardar lo predicho y lo logrado en min 2–5 y aprender el sesgo.
5. Extrapolar crecimiento del enjambre: ajustar curva de peers con 15–20 s y predecir a 3 min (τ por red).
6. Contar peers rápidos (velocidad por peer, seedboxes) en vez de seeders.
7. Tamaño del enjambre vía PEX (direcciones únicas) sin conectarse a todos.
8. Mostrar rango "X–Y Mbps" con confianza en vez de un nivel seco.
Combinación recomendada inicial: 1 + 3 + 4 (≈1 min total). Antes de construir: experimento de cuántos entrantes llegan en 60 s tras anunciarse.

## Reglas para los specs
- Español, breve, sin relleno. Rutas SIEMPRE absolutas.
- Solo lectura del código: no editar nada fuera de tu archivo de spec. No commitear. No agregar dependencias (si hace falta una, decirlo como decisión abierta).
- Estimar con los 3 ejes: alcance · complejidad · incertidumbre (decir qué la sube / qué es incierto).
- Formato de referencia (no obligatorio seguirlo entero): /Users/monti/.claude/skills/plan-spec/SKILL.md.
