# engine/rqbit/ — submódulos del motor librqbit embebido

Parte de `../rqbit.rs` (`RqbitEmbedded:74`); librqbit corre en proceso. Base `/Users/monti/Documents/Dev/streamonte/crates/core/src/engine/rqbit/`.

## Mapa
- `net.rs:49 session_opts` · `:40 free_port` · `:22 DHT_OWNER` · `:27 DhtLease::take` · `:152 log_peers`
- `fastresume.rs:15 Bitfield` (`.streamonte-piezas.bitv`, `:12 BITV_FILE`)
- `http.rs:14 serve_http` · `:30 handle_http` · `:107 parse_range`
- `../rqbit.rs`: `spawn:125` · `add:269` · `prioritize_ranges:436` · `hold_peers:497` · `select_file:573` · `remove:702` · `shutdown:747`

## Flujo
- spawn: `DhtLease::take` → `free_port` → `session_opts` → `Session::new_with_opts` (si falla, reintenta sin escucha/DHT) → `serve_http`

## Trampas
- `runtime_worker_threads = 40` (`rqbit.rs:149`): cada stream retiene 1 permiso de E/S (8 por defecto) y `hold_peers` otro; con 8 se traba.
- Solo `Drop`/`shutdown` cancelan la sesión (`rqbit.rs:81`). `shutdown` tarda ~1 s fijo (+ timeout 5 s, `rqbit.rs:764`); en tests `drop(e)` (`fastresume.rs:107`).
- Seleccionado = trackers ven `left > 0` y dan seeders (`rqbit.rs:499`).
- `state_dir` = `rqbit-state/<pid>-<n>`; si la app muere queda en %TEMP% (`rqbit.rs:136`).
- librqbit borra su bitfield al quitar el torrent: fastresume lo copia junto a los datos (`link_or_copy:43`).

## Tests
- `fastresume.rs:55`, `http.rs:133`, `net.rs:181`. `cargo nextest run -p streamonte-core rqbit`.
