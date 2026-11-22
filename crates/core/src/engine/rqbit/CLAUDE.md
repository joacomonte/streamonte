# engine/rqbit/ — submódulos del motor librqbit embebido

Parte de `../rqbit.rs` (`RqbitEmbedded`, `rqbit.rs:74`): librqbit corre dentro del proceso, sin sidecar. Base: `/Users/monti/Documents/Dev/streamonte/crates/core/src/engine/rqbit/`.

## Mapa
- `net.rs:49 session_opts` (SessionOptions: DHT, UPnP, puerto) · `:40 free_port` (prueba v4 y v6) · `:22 DHT_OWNER` / `:24 DhtLease::take` (un solo dueño del DHT persistente) · `:88 net_line` · `:152 log_peers` (log de peers para "Detalle")
- `fastresume.rs:15 Bitfield` (`restore:23`, `save:35`) — guarda `.streamonte-piezas.bitv` (`:12 BITV_FILE`) junto a los datos para no re-hashear
- `http.rs:14 serve_http` · `:30 handle_http` · `:107 parse_range` · `:129 mime_of` — `GET /<handle>/<idx>` con Range, solo 127.0.0.1
- En `../rqbit.rs`: `spawn:125` · `add:269` · `prioritize_ranges:436` · `hold_peers:497` · `dht_census:530` · `select_file:573` · `remove:702` · `shutdown:747` · `hold_port:103`

## Flujo
- spawn: `DhtLease::take` → `free_port` → `session_opts` → `Session::new_with_opts` (si falla con escucha/DHT: reintenta sin ambos, `rqbit.rs:154`) → `TcpListener` 127.0.0.1:0 → `serve_http`
- add: `Bitfield::restore` → `only_files = []` → resolver en segundo plano (add devuelve enseguida; `torrent_rx:210` espera el watch)
- precarga: `prioritize_ranges` abre un stream por rango y lo lee hasta el final → `EngineEvent::RangeReady`; librqbit prioriza ~32 MB tras cada stream

## Reglas / trampas
- `runtime_worker_threads = 40` (rqbit.rs:149): cada stream retiene 1 permiso de E/S (8 por defecto) y `hold_peers` deja uno abierto por torrent; con 8 la tanda se traba. Alcanza para ~30 torrents.
- Solo `Drop`/`shutdown` cancelan la sesión: las tareas guardan `Arc<Inner>`, sin `shutdown()` la sesión vive para siempre (rqbit.rs:81).
- `shutdown`: `session.stop()` timeout 5 s (rqbit.rs:764) + ~1 s fijo de librqbit; en tests usar `drop(e)` (fastresume.rs:107,123).
- Seleccionado = trackers ven `left > 0` y dan seeders; sin selección se anuncia completo y dan casi solo leechers (rqbit.rs:499, hold_peers).
- `state_dir` = `rqbit-state/<pid>-<n>` junto a la carpeta temporal; si la app muere queda en %TEMP% (`shortcut` rqbit.rs:136).
- librqbit borra su bitfield al quitar el torrent: por eso fastresume lo copia junto a los datos (`link_or_copy:43`).
- `http.rs:18`: sleep 100 ms tras error de accept, evita girar al 100 % CPU.

## Tests
- `fastresume.rs:55` (`#[tokio::test(flavor = "multi_thread")]`, usa `wait_metadata` 30 s), `http.rs:133`, `net.rs:181`.
- `cargo nextest run -p streamonte-core rqbit` (feature `rqbit` por defecto) · completo: `sh scripts/check.sh full`.
