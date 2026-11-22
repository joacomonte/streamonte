# engine/ — interfaz TorrentEngine + motores

`TorrentEngine` (trait) es lo único que ven `playback`, `preload` y `analyzer` (`Arc<dyn TorrentEngine>`). Base `/Users/monti/Documents/Dev/streamonte/crates/core/src/engine/`. Motor = `EngineConfig::kind` (`config.rs:109 EngineKind`, default `Rqbit`).

## Mapa
- `mod.rs:259 trait TorrentEngine` · `:239 EngineEvent` · `:95 pick_file` · `:155 largest_video` · `:165 save_torrent_cache` · `:339 wait_metadata` · `:375 add_cached_or_magnet` · `:409 save_peers` · `:420 load_peers`
- Fábricas: `mod.rs:438 create` (análisis) · `:444 create_for_playback` (escucha + DHT) · `:454 hold_port` · `:483 create_with`
- `rqbit.rs:74 RqbitEmbedded` (ver `rqbit/CLAUDE.md`) · `webtorrent.rs:39 WebtorrentSidecar` (JSON-RPC por stdin/stdout, `docs/engine-protocol.md`; único con web seeds)

## Flujo
- `playback/flow.rs:150 create_for_playback` → `add_cached_or_magnet:375` → `wait_metadata:339` → `pick_file` → `prioritize_ranges` → `stream_url` → mpv lee `http://127.0.0.1:<puerto>/<handle>/<idx>`

## Trampas (contrato `mod.rs:7-15`, toda impl)
- `add` arranca SIEMPRE sin nada seleccionado; `select_file` recién selecciona.
- `prioritize_ranges` es EXCLUSIVO; al completar un rango emite `RangeReady` (`preload::run` espera eso).
- HTTP solo 127.0.0.1; `remove(delete_data)` detiene todo y borra carpeta.
- Sidecar muerto → `Error` + `Exited`; `cleanup` recupera (T-05).
- Un solo dueño del DHT persistente por proceso (`rqbit/net.rs:22 DhtLease`).
- `PEERS_MAX_AGE` 30 min (`mod.rs:406`). Sin feature `rqbit` → `Unsupported` (`mod.rs:497`).

## Tests
- `mod.rs:503`; webtorrent sin unit tests. `cargo nextest run -p streamonte-core engine`.
