# playback/ — reproducciones: motor + precarga + mpv, pausadas guardadas, calibración

Orquesta cada reproducción (un motor propio por reproducción, para aislar fallas) y su ciclo de vida: al cerrar mpv / cambiar de video / cerrar la app la descarga queda **pausada y guardada** en disco y se retoma desde lo ya bajado. Base: `/Users/monti/Documents/Dev/streamonte/crates/core/src/playback/` (+ raíz `../playback.rs`, 903 líneas).

## Mapa
- `../playback.rs:51 PlaybackId` · `:55 PlaybackState` (FetchingMetadata/Preparing/Playing/DownloadPaused/Stopping/AskAfterClose/Background/Paused/Failed) · `:81 PlaybackRow` · `:111 PlaybackAction` · `:127 StreamRequest` · `:149 StartRequest` · `:174 PlaybackDeps` · `:184 Slot` (reproducción activa; `transition:220` única puerta para cambiar `row.state`) · `:239 Shared` · `:249 PlaybackManager`
- `../playback.rs`: `start:283` · `start_stream:423` (TorBox, sin motor) · `load_subtitle:491` · `act:522` · `rows:608` · `stop_all:642` · `active_dirs:699` · `on_app_close:719` · `teardown:828` (guarda o borra) · `slot_to_kept` (kept.rs:176)
- `flow.rs:122 run` — el flujo de UNA reproducción (pasos 1–7 comentados `:131-419`) · `:45 stream` · `:433 background_download` · `:32 wait_answer` · `:609 spawn_first_frame_watcher` · `:513 prefetch_subtitles`
- `kept.rs:22 KeptRecord` (`<carpeta>/.streamonte-kept.json`, `cleanup::KEPT_FILE`) · `:50 load_kept` · `:86 adopt_analysis` / `:102 merge_analysis` (reusa lo bajado al analizar, FR-06d) · `:139 take_kept` · `:163 delete_kept` · `:199 save_kept` · `:246 migrated_key`
- `calibration.rs:93 Calibration` (dueña de `calibration.json`, `paths.rs:75`) · `:126 factor` · `:33 calibration_factor` (mediana real÷predicho, acotada [0,5; 4]) · `:55 CalibrationSampler` · `:163 record_calibration`

## Flujo
- Play: `App::play` (app.rs:478) → `PlaybackManager::start:283` (pausa activas, `take_kept`, adopta/mezcla análisis) → `flow::run:122`:
  `create_for_playback` (`:150`) → `add_cached_or_magnet` (`:154`) → `wait_metadata` (`:173`) → `pick_file` → `preload::run` (`:267`) → `engine.stream_url` → `PlayerLauncher::launch` (`:325`, mpv IPC en `../player.rs` / `../mpv_ipc.rs`) → loop 1 s (`:368`): stats al panel, `time-pos`, muestras de calibración → cierre → `AskAfterClose` (espera `ASK_TIMEOUT` 120 s) → `background_download` o pausa → `teardown:828` → `slot_to_kept`
- Panel: cada cambio → `emit_row:801` → `CoreEvent::PlaybackUpdated`/`PlaybackRemoved`/`PlaybackLog` (events.rs:44) → `core://event` (`src-tauri/src/lib.rs:22`)
- Calibración: minutos 1–5 de reproducción (`calibration.rs:17-22`) → `record_calibration` → factor del semáforo (library.rs:234)

## Conexiones
- La llaman: `app.rs:479-538` (start/act/rows/stop_all/active_dirs/on_app_close/active_count), `app.rs:802-868` (start_stream), `src-tauri/src/commands.rs:116,131`; `examples/play.rs`, `examples/keep_test.rs`.
- Llama a: `engine::*` (`../engine/CLAUDE.md`), `preload::{plan,run}`, `player::PlayerLauncher`/`mpv_ipc`, `subtitles::session`, `cleanup` (`claim` dueño de carpeta, T-05), `library`, `fsutil::{read_json,write_json_atomic,biggest_file}`.

## Reglas / trampas
- Cambiar estado solo vía `Slot::transition`/`set_state` (playback.rs:220,234); no escribir `row.state` directo.
- `slot_to_kept` entra a `kept` ANTES de salir de `slots` para que `wait_gone` (playback.rs:784) la vea pausada (kept.rs:173).
- `start` y `start_stream` serializan con `shared.starting` (un start a la vez; playback.rs:284).
- `teardown` solo guarda si hay `file_index` + magnet y no se pidió borrar; si no, borra la carpeta (playback.rs:828).
- Retomar: mpv arranca `RESUME_REWIND_SECS` (3 s) antes y precarga también donde arranca (flow.rs:25,234).
- Sin respuesta al "¿seguir bajando?" → se pausa (flow.rs:27). VLC no avisa primer frame: `showed_video` siempre false (flow.rs:86).
- `stop_all(delete_data=false)` deja pausadas; `true` ("Borrar todo") borra también las pausadas (playback.rs:642).
- Registros viejos sin `key` se migran a su video (`kept.rs:246`).
- Log por reproducción: tope `LOG_LINES` 500 (playback.rs:48).

## Tests
- `flow.rs:633` (`start_paused`, `wait_answer`), `kept.rs:259` (`manager_under`: manager sobre `AppPaths::under(root)`, sin motor real), `calibration.rs:200`.
- `cargo nextest run -p streamonte-core playback` · completo: `sh scripts/check.sh full`.
