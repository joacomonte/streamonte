# playback/ — reproducciones: motor + precarga + mpv, pausadas guardadas, calibración

Un motor propio por reproducción; al cerrar mpv / cambiar de video / cerrar la app la descarga queda **pausada y guardada** y se retoma. Base `/Users/monti/Documents/Dev/streamonte/crates/core/src/playback/` (+ `../playback.rs`).

## Mapa
- `../playback.rs:51 PlaybackId` · `:55 PlaybackState` · `:149 StartRequest` · `:174 PlaybackDeps` · `:184 Slot` · `:220 transition` · `:249 PlaybackManager` · `start:283` · `start_stream:423` · `act:522` · `stop_all:642` · `teardown:828`
- `flow.rs:122 run` (pasos 1–7) · `:45 stream` · `:433 background_download` · `:32 wait_answer` · `:513 prefetch_subtitles`
- `kept.rs:22 KeptRecord` · `:86 adopt_analysis` · `:139 take_kept` · `:199 save_kept` · `:246 migrated_key`
- `calibration.rs:93 Calibration` · `:33 calibration_factor` · `:55 CalibrationSampler` · `:163 record_calibration`

## Flujo
- `App::play` → `PlaybackManager::start:283` → `flow::run:122` (`create_for_playback` → `wait_metadata` → `preload::run` → `PlayerLauncher::launch`) → loop 1 s → cierre → `AskAfterClose` → `background_download` o pausa → `teardown:828` → `slot_to_kept`

## Trampas
- Estado solo vía `Slot::transition`/`set_state` (`playback.rs:220`); no escribir `row.state`.
- `slot_to_kept` entra a `kept` ANTES de salir de `slots` para que `wait_gone` la vea pausada (`kept.rs:173`).
- `start` y `start_stream` serializan con `shared.starting` (`playback.rs:284`).
- `teardown` solo guarda con `file_index` + magnet y sin pedido de borrar; si no, borra (`playback.rs:828`).
- Retomar: mpv arranca `RESUME_REWIND_SECS` antes (`flow.rs:25`). Sin respuesta al "¿seguir bajando?" → pausa (`flow.rs:27`). VLC: `showed_video` siempre false (`flow.rs:86`).
- `stop_all(true)` borra también las pausadas (`playback.rs:642`).

## Tests
- `flow.rs:633`, `kept.rs:259` (`manager_under`), `calibration.rs:200`. `cargo nextest run -p streamonte-core playback`.
