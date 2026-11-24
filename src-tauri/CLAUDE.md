# src-tauri — cáscara Tauri 2 (crate `streamonte`, lib `streamonte_app`)
Crea la ventana, arranca `AppCore`, expone comandos y reenvía eventos. Sin lógica de negocio: cada comando = 1 llamada a `AppCore`.

## Para X → andá a Y
- Comando nuevo → `src/commands.rs` (fn) + `src/lib.rs` (`invoke_handler`) + `ui/src/core.ts`; receta en `docs/recetas/comando-nuevo.md`.
- Cierre de la app, plugins, evento `core://event` → `src/lib.rs`.
- Ventana, CSP, updater, recursos → `tauri.conf.json`; permisos → `capabilities/default.json`; mpv empaquetado → `mpv/`.

## Relación
Usa `crates/core` (`AppCore`, `CoreEvent` en `events.rs`); lo usa `ui/src/core.ts` (espejo 1:1). Nombre UI `xxxYyy` = `xxx_yyy`; el comando llama a `core.<mismo nombre>()` salvo unas pocas excepciones (`library_get`→`library`, `config_set_*`→`set_*`, `api_key_set`→`set_api_key`, `install_mpv`→`player::install_mpv`: buscar con `rg`).

## Trampas
- Comando sin sumar al `invoke_handler`: falla en runtime.
- `fn` sin async corre en el hilo principal y congela la ventana: disco, almacén seguro y procesos van por `blocking()`.
- Permiso nuevo → `capabilities/default.json`. Args de `invoke` en camelCase se mapean a snake_case.
- `on_close` sale siempre con `exit(0)` aunque el core falle.
- Errores a la UI `{message, detail}`; `detail` es para el log.
- La UI se compila en `release.yml`, no en `beforeBuildCommand` (Tauri lo corre en otro cwd).

## Cómo se prueba
Sin tests propios: `sh scripts/check.sh` (src-tauri se chequea solo si cambió).
