# analyzer/ — cola de análisis y conteo de seeders

Mide cada magnet (scrape → fase rápida → velocidad real sostenida → duración con mpv) y vuelca a `library`. Una sola tarea de fondo, de a un torrent (medir en paralelo reparte el ancho de banda y los resultados dejan de ser comparables). Base: `/Users/monti/Documents/Dev/streamonte/crates/core/src/analyzer/` (+ raíz `../analyzer.rs`).

## Mapa
- `../analyzer.rs:48 AnalyzeScope` · `:66 AnalyzerState` · `:93 SpeedProgress` · `:112 MeasurePhase` · `:144 QuickInfo` · `:159 MeasureCtl` · `:168 AnalyzerDeps` · `:179 trait Measurer` (scrape/measure/quick; real = LiveMeasurer, tests = Fake) · `:207 AnalyzerHandle` (`spawn:213`, `spawn_with:219`, enqueue/pause/resume/cancel/finish/pause_one/resume_one/restart/cancel_one → canal mpsc(64))
- `queue.rs:27 enum Command` · `:50 Stop` · `:69 Stage` (Pending/Queued/Running/Held) · `:80 Job` · `:90 Queue` · `:121 run` (loop) · `:170 handle` · `:270 enqueue` · `:320 scrape_pending` · `:376 quick_pending` · `:434 start_next` · `:505 finish_current` · `:600 fail` · `:632 report` · `:678 counters` (N de M) · `:759 apply_quick` (fusiona sin pisar velocidad medida)
- `live.rs:25 LiveMeasurer` (`scrape:43`, `measure:60`, `quick:106`) · `:199 reserve_dir` / `:217 release_dir` (carpeta de análisis FR-06d)
- `pipeline.rs:161 quick_one` · `:233 measure_with` · `:52 add_deselected` · `:78 metadata_and_file` · `:96 preload_file` · `:123 probe` (mpv sin ventana) · plazos `:29-38`
- `speed.rs:74 sample_speed` (única impura) · `:166 still_rising` · `:176 is_stable` · `:204 sustained_speed` · `:38 partial_measurement` · `:163 WARMUP`
- `swarm.rs:121 count` (seeders/peers reales desde el catálogo) · `:204 count_one` · `:348 census` (DHT) · `:43 Depth` Quick/Deep · `:72 Depth::plan` (concurrency, ventanas)
- `subs.rs:39 SubsCtx::prefetch` (subs en español al analizar, 1 búsqueda por VIDEO) · `:152 copy_next_to_video`
- `names.rs:22 fetch_names` (nombre real al pegar; solo metadatos, un motor)

## Flujo
- Pedir: `App::analyze` (app.rs:445) → `AnalyzerHandle::enqueue` → `Queue::run:121` → `handle:170` → `enqueue:270` → `scrape_pending:320` (`Measurer::scrape` → `trackers::scrape_batch`) → `quick_pending:376` (`quick_one:161`) → `start_next:434` (tokio::spawn `measure_with:233`) → `finish_current:505` → `library` + `CoreEvent::AnalyzerProgress/Queue`
- Velocidad: `measure_with` → `sample_speed:74` (1 muestra/s, descarta WARMUP) → corta si `is_stable` (≥15 muestras, últimos 10 s ±15 %) entre min y max, estira si `still_rising` → `sustained_speed` (mediana 2ª mitad) → `probe` (duración/audio/subs)
- Pausa: `cancel` token → `Stop::Requeue/Hold` → `partial_measurement` guarda parcial (≥3 muestras `speed.rs:35`); "Listo" = `finish` token (medición válida)
- Seeders: `App::catalog_swarm` (app.rs:1021,1031) → `swarm::count` → motor propio (`create_for_playback` si `announce_early`, si no `create`) → `count_one` → `on_count` → `CoreEvent` (events.rs:72,80)

## Conexiones
- Llama a: `engine::create/add_cached_or_magnet/wait_metadata` (`../engine/`), `trackers`, `player::probe_media`, `library`, `cleanup`, `subtitles::session::fetch`, `preload`.
- La llaman: `app.rs:280` (spawn), `app.rs:1024-1114` (swarm), `intake.rs:205` (fetch_names), `events.rs:7,72,80`; `examples/analyze.rs`, `tests/it/acceptance.rs:353`. UI recibe todo por `core://event` (`src-tauri/src/lib.rs:22`).

## Reglas / trampas
- Pasted/QuickOnly NO miden velocidad (bajaba el video entero, decenas de GB): `analyzer.rs:48`.
- Estado de un hash vive solo en su `Job` (queue.rs:80); "ya pedido" = `jobs.contains_key`. No agregar colecciones paralelas (desfasaban contadores/pausa).
- Medición parcial nunca pisa una completa (`queue.rs:1441` test).
- Reintentos: `cfg.analyzer.retries` (queue.rs:580); fallido tras agotarlos.
- Swarm: conexiones ≈ concurrency × max_peers; >~300 satura routers (swarm.rs:50); el motor tiene 40 permisos de E/S (ver `../engine/rqbit/CLAUDE.md`).
- `fetch_names` NO usa pipeline a propósito (names.rs:19); borra datos al sacar el torrent.
- Carpeta de análisis se conserva (`reserve_dir`); si ya está tomada → carpeta descartable que se borra.

## Tests
- `queue.rs:803` (Fake Measurer, `#[tokio::test(start_paused = true)]`: el tiempo avanza solo al esperar), `speed.rs:220` (puros), `subs.rs:177`.
- `cargo nextest run -p streamonte-core analyzer` · completo: `sh scripts/check.sh full`.
