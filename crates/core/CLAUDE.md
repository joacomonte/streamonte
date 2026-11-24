# streamonte-core — núcleo de Streamonte (sin Tauri)

Biblioteca Rust (magnets, análisis de swarms, catálogo/addons, mpv/VLC, limpieza, subtítulos). La UI (`/Users/monti/Documents/Dev/streamonte/src-tauri/` + `ui/`) solo habla con `app::AppCore` y recibe `events::CoreEvent`. Capas y dependencias: `src/lib.rs:1-19`. Motor: rqbit embebido.

## Mapa de `src/` (base `/Users/monti/Documents/Dev/streamonte/crates/core/src/`)
Con carpeta (ver su `CLAUDE.md`): `analyzer.rs`+`analyzer/` (cola de medición) · `catalog/` · `engine/` (rqbit) · `playback.rs`+`playback/` · `subtitles.rs`+`subtitles/`.

Nivel 0:
- `error.rs:9 CoreError` · `:71 user_message` (lo muestra la UI) · `events.rs:14 CoreEvent` · `:137 EventSink` · `:142 NullSink`
- `fsutil.rs:13 read_json` · `:33 write_json_atomic` · `:66 quarantine` · `paths.rs:15 AppPaths` · `:172 Executable` · `:206 locate` · `:227 bundled_mpv`
- `config.rs:14 Config` · `:120 EngineConfig` · `:275 PlayerKind` · `:334 SubtitleLanguage` · `:418 ConfigStore` (campos con `serde(default)`)
- `logger.rs:49 init` · `activity.rs:45 set_sink` · `:209 redact` · `datacache.rs:20 DataCache` · `rebrand.rs:17 migrate`

Nivel 1 (puros): `magnet.rs:15 InfoHash` · `:71 Magnet` · `video_key.rs:21 VideoKey` · `release.rs:26 parse_release_name` · `:93 season_episodes` · `audio.rs:100 spanish_variant` · `:211 spanish_track` · `ranking.rs:73 sort_key` · `speedtest.rs:42 SpeedTest`

Nivel 2 (E/S):
- `http.rs:47 send` · `secrets.rs:35 set_secret` · `:66 secret` · `library.rs:83 LibraryEntry` · `trackers.rs:54 scrape_batch`
- `player.rs:191 MpvControl` · `:157 LaunchRequest` · `:235 PlayerSession` · `mpv_ipc.rs:43 MpvIpc` · `cleanup.rs:77 Cleanup` · `clipboard.rs:58 ClipboardSource` · `incoming.rs:38 check` · `preload.rs:95 plan` · `:140 run`

Nivel 4: `app/mod.rs:81 AppCore` (`:109 start`; métodos por tema en `app/{catalog,torbox,subtitles,settings}.rs`) — cada `pub fn` = 1 comando Tauri · `intake.rs:44 Intake` (entrada de magnets).

## Trampas
- Un módulo solo depende de su nivel o inferior (`src/lib.rs:1-19`; excepciones listadas ahí).
- Sin `regex` (patrones a mano) y sin deps nuevas sin preguntar.
- Secretos nunca en `config.json`/logs; debug no usa keychain (`secrets.rs:100 dev_store`).
- Golden compartido con la web: la salida de Rust manda (`/Users/monti/Documents/Dev/streamonte/packages/golden/`).
- Largo = tarea tokio + `CoreEvent`; nada bloquea. src-tauri: `commands.rs` = 1 `#[tauri::command]` por método de `AppCore`.

## Tests
- Unit en cada `src/**.rs`; integración en `tests/it/main.rs` (un binario; nueva prueba = agregar `mod`). Red: `#[ignore = "network"]` → `cargo test -- --ignored network`. `examples/` con red real (`analyze`, `play`, `bench`, `keep_test`, `announce_probe`).
- Correr: `cargo nextest run -p streamonte-core <filtro>` · todo: `sh scripts/check.sh full`.
