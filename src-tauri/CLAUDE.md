# src-tauri — cáscara Tauri 2 (crate `streamonte`, lib `streamonte_app`)
Crea la ventana, arranca `AppCore`, expone comandos y reenvía eventos. Sin lógica de negocio: cada comando = 1 llamada a `AppCore`.

## Mapa
- `/Users/monti/Documents/Dev/streamonte/src-tauri/src/main.rs:5` `main` → `streamonte_app::run()`.
- `lib.rs:28` `run`: plugins `process:30` `updater:31` · `setup:32` (`AppCore::start`, `crates/core/src/app.rs:218`) · `on_window_event:41` · `invoke_handler:64-140` (TODOS los comandos) · `:15` `CLOSING` · `:18` `TauriSink` (emite `core://event`, :22).
- `commands.rs` (612): 75 `#[tauri::command]`, lista en `:46-606`. `:26` `Core` · `:27` `CmdResult` · `:30` `UiError{message,detail}` (:35 From<CoreError>) · `:163` `blocking()`.
- Nombre UI `api.xxxYyy` ↔ `xxx_yyy`; comando → `core.<mismo nombre>()` salvo: `library_get`→`library` · `library_remove`→`remove` · `library_add_selected`→`add_selected_magnets` · `playbacks_get`→`playbacks` · `config_get`→`config` · `config_set_*`→`set_*` · `api_key_set`→`set_api_key` · `opensubtitles_login_set`→`set_opensubtitles_login` · `install_mpv`→`streamonte_core::player::install_mpv` (sin AppCore).
- `tauri.conf.json` (devUrl 1420, `frontendDist ../ui/dist`, `withGlobalTauri`, CSP sin red directa, updater → GitHub), `capabilities/default.json`, `mpv/` (resource), `binaries/` y `gen/` gitignorados.

## Flujo
- Cierre: X → `lib.rs:41` `prevent_close`; con `active_playbacks` emite `ConfirmClose` (:53) → UI → `on_close` (`commands.rs:150`); sin ellas `on_close(StopAll)` + `CLOSING` + `exit(0)` (:56-62).

## Trampas
- Comando nuevo = 3 sitios: fn en `commands.rs` + `lib.rs:64-140` + `ui/src/api.js` (+ typedef en `ui/src/types.js`). Si falta en el handler, falla en runtime.
- `fn` sin async corre en el hilo principal y congela la ventana (`commands.rs:161-162`): disco/almacén seguro/procesos van por `blocking()` (:163).
- `capabilities/default.json`: solo `core:event:allow-listen/unlisten`, `process:allow-restart`, `updater:default`; permiso nuevo → ahí.
- Args de `invoke` en camelCase se mapean a snake_case (`fileIndex`→`file_index`).
- `on_close` (`commands.rs:150`) sale siempre con `exit(0)` aunque el core falle.
- Errores a la UI `{message, detail}`; la UI detecta por `detail` (p. ej. `torbox: código incorrecto`).

## Tests
Sin tests propios; `cd /Users/monti/Documents/Dev/streamonte && sh scripts/check.sh` (fmt + clippy + JS), `full` suma nextest. Eventos `CoreEvent`: `/Users/monti/Documents/Dev/streamonte/crates/core/src/events.rs`.
