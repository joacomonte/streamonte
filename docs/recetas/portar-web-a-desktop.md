# Receta: llevar algo de la web al desktop (ejemplo: el apodo)
Regla: el desktop habla con la web solo vía `crates/core/src/web.rs`, y nada de keys en el binario (`CLAUDE.md` de la raíz). Capas, en orden:
1. **Web**: `web/src/routes/api/nick/+server.ts`, `api/nick/animales`, `api/desktop/torbox-key`. Lógica en `web/src/lib/server/apodo-session.ts`, `apodos.ts`, `apodo-cifrado.ts`. Candado en `web/src/hooks.server.ts`: 401 sin JSON = código malo; 429 no borra nada.
2. **Cliente HTTP**: `crates/core/src/web.rs`, el único (Cookie y Origin; secretos en el llavero).
3. **Núcleo**: `crates/core/src/app/web.rs` + `mod web` en `crates/core/src/app/mod.rs` + `pub mod web` en `crates/core/src/lib.rs`.
4. **Tauri**: `src-tauri/src/commands.rs` + `invoke_handler` en `src-tauri/src/lib.rs`.
5. **Tipos y core de la UI**: `ui/src/types.ts` + `ui/src/core.ts`.
6. **`Api` compartida**: `packages/ui/src/api.ts` → `ui/src/tauriApi.ts`, `web/src/lib/webApi.ts`, `packages/ui/test/fake-api.ts`.
7. **Mock**: `ui/src/mock-tauri.ts` (estado por URL, p. ej. `?nonick`).
8. **UI**: `packages/ui/src/animals/*`, `ui/src/nick-state.svelte.ts`, `ui/src/Welcome.svelte`, `ui/src/Greeting.svelte`; Perfil en `ui/src/components/Settings.svelte`.
9. **Textos**: `packages/ui/src/i18n/en.ts`.
10. **Escena y captura**: escena en `tests/scenes/` (si aplica) y `node scripts/shot.mjs <url del mock>`.
11. **Verificar**: ver "Verificación" en `CLAUDE.md` de la raíz.
