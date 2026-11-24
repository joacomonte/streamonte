# analyzer/ — cola de análisis y conteo de seeders
Mide cada magnet (scrape → fase rápida → velocidad sostenida → duración con mpv), de a uno, y vuelca a `library`. Cola en `queue.rs` (con `../analyzer.rs`).

## Para X → andá a Y
- Orden/estado de la cola, pausa → `queue.rs` · medir un torrent → `pipeline.rs`, `live.rs`.
- Velocidad sostenida/estable → `speed.rs` · conteo de peers/seeders → `swarm.rs`.
- Subs precargados / nombres → `subs.rs`, `names.rs`.

## Relación
Usa `engine` (`TorrentEngine`), `library`, `catalog`. Lo llama `AppCore::analyze`; avisa con `CoreEvent`.

## Trampas
- Pasted/QuickOnly NO miden velocidad (bajaban el video entero).
- El estado de un hash vive solo en su `Job`: sin colecciones paralelas (desfasaban contadores y pausa).
- Una medición parcial nunca pisa una completa.
- Swarm: conexiones ≈ concurrencia × max_peers; >~300 satura routers. El motor tiene 40 permisos de E/S (`../engine/rqbit/CLAUDE.md`).
- `fetch_names` no usa el pipeline a propósito.

## Cómo se prueba
Unit con `Measurer` falso (`start_paused`). `cargo nextest run -p streamonte-core analyzer`.
