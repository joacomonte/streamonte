# analyzer/ — cola de análisis y conteo de seeders

Mide cada magnet (scrape → fase rápida → velocidad sostenida → duración con mpv) y vuelca a `library`; de a un torrent (en paralelo los resultados no son comparables). Base `/Users/monti/Documents/Dev/streamonte/crates/core/src/analyzer/` (+ `../analyzer.rs`).

## Mapa
- `../analyzer.rs:48 AnalyzeScope` · `:66 AnalyzerState` · `:168 AnalyzerDeps` · `:179 trait Measurer` · `:207 AnalyzerHandle` (`spawn:213`; canal mpsc(64))
- `queue.rs:27 enum Command` · `:69 Stage` · `:80 Job` · `:90 Queue` · `:121 run` · `:270 enqueue` · `:320 scrape_pending` · `:376 quick_pending` · `:434 start_next` · `:505 finish_current` · `:759 apply_quick`
- `live.rs:25 LiveMeasurer` · `:199 reserve_dir` · `:217 release_dir`
- `pipeline.rs:161 quick_one` · `:233 measure_with` · `:123 probe` (mpv sin ventana)
- `speed.rs:74 sample_speed` · `:166 still_rising` · `:176 is_stable` · `:204 sustained_speed` · `:38 partial_measurement`
- `swarm.rs:121 count` · `:204 count_one` · `:348 census` · `:43 Depth`
- `subs.rs:39 SubsCtx::prefetch` · `names.rs:22 fetch_names`

## Flujo
- `App::analyze` → `enqueue` → `Queue::run:121` → `scrape_pending:320` → `quick_pending:376` → `start_next:434` (spawn `measure_with:233` → `sample_speed:74` → `sustained_speed` → `probe`) → `finish_current:505` → `library` + `CoreEvent`

## Trampas
- Pasted/QuickOnly NO miden velocidad (bajaban el video entero): `analyzer.rs:48`.
- Estado de un hash vive solo en su `Job` (`queue.rs:80`); no agregar colecciones paralelas (desfasaban contadores/pausa).
- Medición parcial nunca pisa una completa (`apply_quick`, `queue.rs:759`).
- Swarm: conexiones ≈ concurrency × max_peers; >~300 satura routers (`swarm.rs:50`); motor con 40 permisos de E/S (ver `../engine/rqbit/CLAUDE.md`).
- `fetch_names` NO usa pipeline a propósito (`names.rs:19`).

## Tests
- `queue.rs:803` (Fake Measurer, `start_paused`), `speed.rs:220`, `subs.rs:177`. `cargo nextest run -p streamonte-core analyzer`.
