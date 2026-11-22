# engine/ — interfaz TorrentEngine + motores

`TorrentEngine` (trait) es lo único que ven `playback`, `preload` y `analyzer`: reciben `Arc<dyn TorrentEngine>` de `create*`. Base: `/Users/monti/Documents/Dev/streamonte/crates/core/src/engine/`. Cambiar motor = `EngineConfig::kind` (config.rs:109 `EngineKind`, default `Rqbit`).

## Mapa
- `mod.rs:259 trait TorrentEngine` (add, metadata, waiting_on, prioritize_ranges, hold_peers, connected_peers, dht_census, select_file, stream_url, stats, pause/resume/remove, subscribe, shutdown) · `:239 EngineEvent` (RangeReady/Log/Error/Exited)
- `mod.rs:36-91` tipos: TorrentHandle, TorrentSource, AddOptions, FileInfo, Metadata, FilePick · `:95 pick_file` · `:155 largest_video` · `:165 save_torrent_cache` (caché .torrent FR-13)
- `mod.rs:339 wait_metadata` (timeout + diagnóstico `Waiting`) · `:375 add_cached_or_magnet` (reintenta UNA vez con magnet si el .torrent cacheado está roto) · `:409 save_peers` / `:420 load_peers`
- Fábricas: `mod.rs:438 create` (sin entrantes ni DHT persistente: análisis) · `:444 create_for_playback` (escucha + DHT en `paths.dht_file()`) · `:454 hold_port`/`:471 PortHold` ("Verificar puerto") · `:483 create_with` (match por `EngineKind`)
- `rqbit.rs:74 RqbitEmbedded` — librqbit embebido (ver `rqbit/CLAUDE.md`)
- `webtorrent.rs:39 WebtorrentSidecar` — sidecar Node, JSON-RPC 2.0 por stdin/stdout (`spawn:51`, `call:144`, `dispatch:297`); protocolo `docs/engine-protocol.md`, versión `:35`. Único con web seeds (BEP 19, config.rs:110)

## Flujo
- Reproducir: `playback/flow.rs:150 create_for_playback` → `add_cached_or_magnet:375` → `wait_metadata:339` → `pick_file` → `prioritize_ranges` (precarga) → `stream_url` → mpv lee `http://127.0.0.1:<puerto>/<handle>/<idx>` (Range)
- Rangos: `prioritize_ranges` es EXCLUSIVO → al completar rango verificado emite `EngineEvent::RangeReady` → `preload::run` espera eso
- Apagar: `shutdown` → `remove(delete_data:false)` por torrent → `session.stop()`; borrar datos = `remove(delete_data:true)` o `cleanup`

## Conexiones
- Llaman: `playback/flow.rs:150,154,173`, `analyzer/live.rs:73,116`, `analyzer/pipeline.rs:63`, `analyzer/swarm.rs:136,138,354`, `incoming.rs:46` (hold_port).
- Llama a: `librqbit` (feature `rqbit`, Cargo.toml:27), `node` + `engines/webtorrent-sidecar` (`paths::webtorrent_sidecar_script`), filesystem (`.torrent` cache, `.bitv`).
- Sin feature `rqbit`: `EngineKind::Rqbit` → `CoreError::Unsupported` (`mod.rs:497`).

## Reglas / trampas (contrato mod.rs:7-15, TODA impl)
- `add` arranca SIEMPRE sin nada seleccionado (`only_files = []`); `select_file` recién selecciona.
- Servidor HTTP solo 127.0.0.1 (NFR-16). `remove(delete_data)` detiene todo tráfico y borra carpeta.
- Sidecar muerto → `Error` + `Exited` y `cleanup` recupera (T-05); webtorrent: `kill_on_drop`, al cerrar stdin detiene SIN borrar datos.
- `shutdown` rqbit: `session.stop()` con timeout 5 s (rqbit.rs:764); librqbit mete ~1 s fijo → tests usan `drop(e)` (rqbit/fastresume.rs:107).
- Un solo dueño del DHT persistente por proceso (`rqbit/net.rs:22 DhtLease`); un 2º motor de reproducción cae a sin DHT persistente.
- `PEERS_MAX_AGE` 30 min (mod.rs:406): peers guardados viejos se descartan.

## Tests
- `mod.rs:503` (pick_file/episodio), `webtorrent`: sin tests unitarios; `rqbit/*` ver su CLAUDE.md.
- `cargo nextest run -p streamonte-core engine` · completo: `sh scripts/check.sh full`.
