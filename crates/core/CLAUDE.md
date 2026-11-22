# streamonte-core — núcleo de Streamonte (sin Tauri)

Biblioteca Rust: biblioteca de magnets, análisis de swarms, catálogo/addons, reproducción en mpv/VLC, limpieza, subtítulos. La UI (`/Users/monti/Documents/Dev/streamonte/src-tauri/` + `ui/`) solo habla con `app::AppCore` y recibe `events::CoreEvent`. Capas y reglas de dependencia (sin ciclos): `src/lib.rs:1-19`. Feature `rqbit` (default) activa el motor embebido (`Cargo.toml`).

## Mapa de `src/` (rutas desde `/Users/monti/Documents/Dev/streamonte/crates/core/src/`)
Con carpeta (ver su `CLAUDE.md`):
- `analyzer.rs` + `analyzer/` — cola de medición en vivo (scrape → swarm → velocidad/duración), `analyzer.rs:48 AnalyzeScope`, `:168 AnalyzerDeps`. → `analyzer/CLAUDE.md`
- `catalog/` — Cinemeta, TMDB, TorBox, addons, top, temporadas. → `catalog/CLAUDE.md`
- `engine/` — motor torrent (rqbit embebido / webtorrent sidecar), `engine/mod.rs`. → `engine/CLAUDE.md`
- `playback.rs` + `playback/` — orquesta motor + precarga + player (`playback.rs:51 PlaybackId`, `:149 StartRequest`, `:174 PlaybackDeps`). → `playback/CLAUDE.md`
- `subtitles.rs` + `subtitles/` — proveedores, ranking, merge ASS, sesión mpv. → `subtitles/CLAUDE.md`

Archivos sueltos, nivel 0 (base):
- `error.rs:9 CoreError`, `:71 user_message` (la UI muestra esto), `:6 Result`.
- `events.rs:14 CoreEvent`, `:137 EventSink` (lo implementa src-tauri), `:142 NullSink`.
- `fsutil.rs:13 read_json`, `:33 write_json_atomic`, `:66 quarantine` (JSON atómico; corrupto se aparta).
- `paths.rs:15 AppPaths` (carpetas; `:113 video_subtitles_dir`, `:82 subtitles_memory_file`), `:172 Executable`, `:206 locate` (mpv/vlc/webtorrent), `:227 bundled_mpv`.
- `config.rs:14 Config` (+ `:418 ConfigStore`, `:334 SubtitleLanguage`, `:275 PlayerKind`, `:120 EngineConfig`); `config.json`, campos con `serde(default)`.
- `logger.rs:49 init`, `:32 DIAG_*`; `activity.rs:45 set_sink`, `:51 layer`, `:209 redact` (log en vivo para la burbuja de actividad).
- `datacache.rs:20 DataCache` (`cache/datos/`, tope `:17 MAX_BYTES`); `rebrand.rs:17 migrate` (tstream → streamonte, una vez; privado).

Nivel 1 (puros, sin red):
- `magnet.rs:15 InfoHash`, `:71 Magnet`, `:158 extract_all`; `video_key.rs:21 VideoKey` (hash + video dentro del pack).
- `release.rs:26 parse_release_name`, `:93 season_episodes` (parser propio, sin regex); `audio.rs:100 spanish_variant`, `:211 spanish_track`, `:331 from_release` (idiomas de audio, regla única latino/España).
- `ranking.rs:73 sort_key`, `:96 content_kind` (necesita/margen/semáforo); `speedtest.rs:42 SpeedTest` (Cloudflare).

Nivel 2 (E/S):
- `http.rs` (privado) `:47 send`, `:71 get_bytes`, `HttpError`, `Limits` — mecánica HTTP de catálogo y subtítulos.
- `secrets.rs:35 set_secret`, `:66 secret` (keychain; debug → `dev-secrets.json`); `external.rs:6 open_external`.
- `library.rs:83 LibraryEntry`, `:129 LibraryRowView`, `:21 Group` (`library.json`); `trackers.rs:54 scrape_batch` (UDP BEP 15), `:360 shared_list`.
- `player.rs:191 MpvControl`, `:157 LaunchRequest`, `:235 PlayerSession`, `:31 resolve_player`, `:73 install_mpv`; `mpv_ipc.rs:43 MpvIpc` (privado, JSON IPC).
- `cleanup.rs:77 Cleanup`, `:24 OWNER_FILE`/`:27 KEPT_FILE` (huérfanos, limpieza segura); `clipboard.rs:58 ClipboardSource`, `:129 platform_source` (Win32/NSPasteboard); `incoming.rs:38 check` (puerto entrante).
- `preload.rs:95 plan`, `:140 run` (precarga inicio + índice MP4 antes de abrir el player).

Nivel 4:
- `app.rs:192 AppCore` (`:218 start`, `:224 start_with`) — cablea todo; cada `pub fn/async fn` = 1 comando Tauri. Tipos de vista: `:52 LibraryView`, `:60 SubtitleFound`, `:109 CatalogSubtitles`.
- `intake.rs:44 Intake` (privado) — entrada de magnets: pegar, portapapeles, `:25 CopiedMagnet`.

## Cómo lo expone a src-tauri
- `src-tauri/src/lib.rs:9` crea `AppCore::start(Arc<dyn EventSink>)`; `TauriSink` emite `core://event` (`lib.rs:21`). `src-tauri/src/commands.rs` = un `#[tauri::command]` por método de `AppCore`, registrados en `src-tauri/src/lib.rs:64 generate_handler!`.
- También importa tipos directos: `analyzer::AnalyzeScope`, `catalog::*`, `config::*`, `library::LibraryRowView`, `playback::*`, `video_key::VideoKey`, `player::{players_status, install_mpv}`, `incoming::IncomingCheck`, `CoreError` (`commands.rs:7-23`).
- Largo = tarea tokio + `CoreEvent` (NFR-10); nada bloquea.

## Reglas / trampas
- Un módulo solo depende de su nivel o inferior (`lib.rs:1-19`); excepciones listadas ahí (`release` → `engine::is_video`, `subtitles::SUBTITLE_EXTENSIONS`).
- Sin `regex`: patrones a mano (`Cargo.toml`). Sin deps nuevas sin preguntar.
- Secretos nunca en `config.json`/logs; debug builds no usan keychain (`secrets.rs:100 dev_store`).
- Golden compartido con la web: la salida de Rust es la fuente de verdad (`/Users/monti/Documents/Dev/streamonte/packages/golden/`).

## Tests
- Unit: `#[cfg(test)] mod tests` dentro de cada `src/**.rs`.
- Integración: `/Users/monti/Documents/Dev/streamonte/crates/core/tests/it/main.rs` (un solo binario) registra `mod acceptance; catalog_mock; common; config_updates; golden`. Nueva prueba = agregar el `mod` ahí.
  - `acceptance.rs` — trazabilidad CA `fr_xx_…`/`t_xx_…` (red = a mano; FR-06 `#[ignore = "network"]`: `cargo test -- --ignored network`).
  - `catalog_mock.rs` — T-31 fan-out de addons (rápido/lento/caído) con HTTP local; `config_updates.rs` — `AppCore::update_config` sin pisarse (HTTP local); `common.rs` — carpeta temporal.
  - `golden.rs` — `release.json`, `excluded.json` desde `packages/golden/` (`include_str!`). `sub_lang.json` se prueba en `src/subtitles/providers/lang.rs:55`.
- Aparte: `tests/logger.rs` (suscriptor `tracing` global). Fixtures: `tests/fixtures/subtitles/`.
- Correr: `cargo nextest run -p streamonte-core <filtro>`; todo: `sh scripts/check.sh full` (rápido: `sh scripts/check.sh`).
- `examples/` (`cargo run -p streamonte-core --example <n>`, red real): `analyze` (magnets por CLI), `play`, `bench` (webtorrent vs rqbit), `keep_test` (FR-12), `announce_probe` (peers entrantes), `subs_merge`, `subtitle_key`.
