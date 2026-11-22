# src-tauri — cáscara Tauri 2 (crate `streamonte`, lib `streamonte_app`)
Crea la ventana, arranca `AppCore` (crates/core), expone comandos a la UI y reenvía eventos. Sin lógica de negocio (`lib.rs:1-2`): cada comando = 1 llamada a `AppCore`.

## Mapa
- `/Users/monti/Documents/Dev/streamonte/src-tauri/src/main.rs:5` `main` → `streamonte_app::run()` (sin consola en release Windows, `:2`).
- `/Users/monti/Documents/Dev/streamonte/src-tauri/src/lib.rs:28` `run()`: plugins `process` (:30) y `updater` (:31); `setup` (:32) arranca el core; `on_window_event` (:41) intercepta cierre; `invoke_handler` (:64-140) lista TODOS los comandos.
- `lib.rs:18` `TauriSink` impl `EventSink` → `app.emit("core://event", CoreEvent)` (:22). `lib.rs:15` `CLOSING` (AtomicBool).
- `/Users/monti/Documents/Dev/streamonte/src-tauri/src/commands.rs` (612 líneas): 76 `#[tauri::command]`. `:26` `Core<'a>=State<'a,Arc<AppCore>>`; `:27` `CmdResult<T>=Result<T,UiError>`; `:29` `UiError{message,detail}` (:35 From<CoreError>: `user_message()` / `to_string()`); `:58` `ScopeArg`; `:163` `blocking()`.
- `/Users/monti/Documents/Dev/streamonte/src-tauri/tauri.conf.json`, `capabilities/default.json`, `build.rs`, `mpv/mpv.app` (resource `mpv/`), `binaries/` (gitignorado), `icons/`, `gen/` (gitignorado).

## Comandos (commands.rs:línea → AppCore; nombre UI en `ui/src/api.js` = camelCase)
- Biblioteca: library_get:46 → `library()` · library_remove:51 → `remove` · copied_magnet:99 · library_add_selected:103 → `add_selected_magnets`
- Análisis: analyze:75 (ScopeArg→AnalyzeScope) · analyzer_pause:86 · analyzer_cancel:90 · analyzer_resume:95
- Reproducción: play:109 (→`StartRequest`; `background` default false) · playback_action:129 · playbacks_get:137 · playback_log:141 · stop_all_and_clean:145 · on_close:150 · play_torbox:303 · playback_subtitle:323
- Limpieza/sistema: temp_usage:175 · clean_temp:180 · check_incoming:185 · logs_tail:189 · export_logs:194 · open_downloads_folder:199 · downloads_free_bytes:371 · data_cache_size:512 · clear_data_cache:516
- Config: config_get:206 · players_status:212 · install_mpv:217 (sin core: `streamonte_core::player::install_mpv`) · config_set_language:221 · config_set_equalizer:228 · config_set_network:235 · config_set_torbox_shared:246 · catalog_set_exclude_japanese:497
- Keys/login: api_key_set:254 → `set_api_key` · api_keys:259 · open_key_page:266 · opensubtitles_login_set:314 (las keys nunca vuelven a la UI)
- Catálogo: catalog_search:435 · catalog_people:440 · catalog_person_titles:448 · catalog_meta:456 · catalog_details:520 · catalog_similar:528 · catalog_season_ratings:536 · catalog_trending:544 · catalog_browse_top:549 · catalog_genres:573 · catalog_episodes:581 · catalog_poster:429
- Torrents/opciones: catalog_streams:460 (resultado por evento) · catalog_stop_streams:464 · catalog_swarm:285 · catalog_stop_swarm:501 · catalog_census:376 · catalog_swarm_saved:363 · catalog_torbox:294 · catalog_torbox_tracks:333 · catalog_link:352 · torbox_magnet:595 · torbox_magnet_download:606 · catalog_add:468 · speed_test:505
- Subtítulos/premium: catalog_subtitles:385 · catalog_subtitle_use:395 · save_subtitles:343 · premium_quota:405 · catalog_premium_search:410 · catalog_premium_use:419
- Addons: catalog_addons:477 · catalog_add_addon:481 · catalog_remove_addon:485 · catalog_set_addon_enabled:489 · catalog_reset_addons:493 · catalog_open_trailer:272 · catalog_open_imdb:278

## Flujo
- Arranque: `lib.rs:32` setup → `AppCore::start(sink)` (crates/core/src/app.rs:218) `block_on` → `app.manage(core)` (:35).
- Comando: UI `invoke` → `commands.rs` fn → `core.<fn>()` → `Result<_,CoreError>` → `UiError` (`?` vía From).
- Evento: core → `EventSink::emit` → `TauriSink` `lib.rs:21` → `core://event` → `ui/src/api.js:230` `onCoreEvent`.
- Cierre (FR-17/20): X → `lib.rs:41` `prevent_close`; con reproducciones activas (`active_playbacks`) emite `CoreEvent::ConfirmClose` (:53) y la UI responde `on_close` (commands.rs:150); sin ellas `on_close(StopAll)` + `CLOSING=true` + `exit(0)` (:56-62).

## Eventos
Único canal `core://event` (payload `CoreEvent`, tag `type` kebab-case; definición en `/Users/monti/Documents/Dev/streamonte/crates/core/src/events.rs`): library-entry-updated/removed, analyzer-progress/queue, playback-updated/removed/log, catalog-streams/excluded/swarm-counted/swarm-progress/subtitles-progress, activity, confirm-close, speed-test, status. La shell solo emite ese + `ConfirmClose` propio (lib.rs:53).

## tauri.conf.json
- `build.devUrl http://127.0.0.1:1420` (Vite `strictPort`, ver `ui/vite.config.ts`); `frontendDist ../ui/dist`.
- `beforeDevCommand "cd ui && deno run -A npm:vite"`; `beforeBuildCommand "cd ui && deno install && deno run -A npm:vite build"`.
- `withGlobalTauri true` (UI usa `window.__TAURI__`); ventana `main` 1100x720 maximizada, min 760x480.
- CSP: `connect-src ipc: http://ipc.localhost` (+ `ws://127.0.0.1:1420` en devCsp); `img-src 'self' data: https:`. Sin red directa desde la UI.
- Bundle: nsis/dmg/app, `createUpdaterArtifacts`, updater → GitHub releases `latest.json`, `resources mpv/`, macOS `signingIdentity "-"`.

## Reglas / trampas
- Comando nuevo = 3 sitios: fn en `commands.rs` + registrar en `lib.rs:64-140` + `ui/src/api.js` (y typedef en `ui/src/types.js`). Si falta en el handler, falla en runtime.
- `fn` sin async corre en el hilo principal y congela la ventana (`commands.rs:161-162`): disco/almacén seguro/procesos van por `blocking()` (:163).
- `capabilities/default.json`: la UI solo tiene `core:event:allow-listen/unlisten`, `process:allow-restart`, `updater:default`. Sin fs/shell (NFR-01/16); permiso nuevo → ahí.
- Args de `invoke` llegan en camelCase y Tauri los mapea a snake_case (`fileIndex`→`file_index`, `videoId`→`video_id`).
- `on_close` (:150) sale siempre con `exit(0)` aunque el core falle (loguea y devuelve el error).
- Errores a la UI: `{message, detail}`; la UI detecta por `detail` (p. ej. `torbox: código incorrecto` en api.js).

## Tests / chequeos
- `cd /Users/monti/Documents/Dev/streamonte && sh scripts/check.sh` (fmt + clippy + JS); `sh scripts/check.sh full` suma nextest del core. Sin tests propios en src-tauri.
- Correr: `cd /Users/monti/Documents/Dev/streamonte/ui && deno run -A npm:vite` y `cargo run -p streamonte` (o `cargo tauri dev`, que lanza el beforeDevCommand).
