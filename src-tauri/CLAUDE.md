# src-tauri — cáscara Tauri 2 (crate `streamonte`, lib `streamonte_app`)
Crea la ventana, arranca `AppCore`, expone comandos y reenvía eventos. Sin lógica de negocio: cada comando = 1 llamada a `AppCore`.

## Para X → andá a Y
- Comando nuevo → `src/commands.rs` (fn) + `src/lib.rs` (`invoke_handler`) + `ui/src/core.ts`; receta en `docs/recetas/comando-nuevo.md`.
- Comandos de la web (`web_code_set`, `nick_*`) → `crate::app::web` en el core (`crates/core/src/web.rs` habla con la web).
- Cierre de la app, plugins, evento `core://event` → `src/lib.rs`.
- Ventana, CSP, updater, recursos → `tauri.conf.json`; permisos → `capabilities/default.json`; mpv empaquetado → `mpv/`.

## Relación
Usa `crates/core` (`AppCore`, `CoreEvent`); lo usa `ui/src/core.ts` (espejo 1:1: `xxxYyy` = `xxx_yyy`). Unos pocos comandos no se llaman igual que el método de `AppCore` (`library_get`→`library`, `config_set_*`→`set_*`): `rg` en `commands.rs`.

## Trampas
- Comando sin sumar al `invoke_handler`: falla en runtime.
- `fn` sin async corre en el hilo principal y congela la ventana: disco, almacén seguro y procesos van por `blocking()`.
- `capabilities/default.json` = permisos de plugin (eventos, updater, process); los comandos propios no van ahí. La UI no tiene fs ni shell. Args de `invoke` en camelCase se mapean a snake_case.
- `on_close` sale siempre con `exit(0)` aunque el core falle.
- Errores a la UI `{message, detail}`; `detail` es para el log.
- La UI se compila en `release.yml`, no en `beforeBuildCommand` (Tauri lo corre en otro cwd).

## Cómo se prueba
Sin tests propios: `sh scripts/check.sh` (src-tauri se chequea solo si cambió).
