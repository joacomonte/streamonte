# engine/ — interfaz TorrentEngine + motores
`TorrentEngine` (trait) es lo único que ven `playback`, `preload` y `analyzer` (`Arc<dyn TorrentEngine>`). Motor = `EngineConfig::kind` (default `Rqbit`).

## Para X → andá a Y
- Contrato, `pick_file`, fábricas (`create`, `create_for_playback`) → `mod.rs`.
- Motor embebido librqbit → `rqbit.rs` y `rqbit/` (`rqbit/CLAUDE.md`).
- Sidecar webtorrent (JSON-RPC por stdin/stdout, `docs/engine-protocol.md`) → `webtorrent.rs`.

## Relación
Lo crean `analyzer` (análisis) y `playback/flow.rs` (escucha + DHT); mpv lee `http://127.0.0.1:<puerto>/<handle>/<idx>`.

## Trampas (contrato de toda impl)
- `add` arranca SIEMPRE sin nada seleccionado; `select_file` recién selecciona.
- `prioritize_ranges` es EXCLUSIVO; al completar un rango emite `RangeReady` (`preload::run` lo espera).
- HTTP solo en 127.0.0.1; `remove(delete_data)` detiene todo y borra la carpeta.
- Un solo dueño del DHT persistente por proceso (`DhtLease`). Sin feature `rqbit` → `Unsupported`.
