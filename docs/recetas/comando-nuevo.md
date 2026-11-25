# Receta: comando / endpoint nuevo y campo nuevo en la ficha

Ejemplo real de la cadena entera: el commit `0ff43ff` (premios: `awards`). Sus rutas son de antes de la reestructura; la lista de abajo es la de hoy.
Regla: ver la raíz (`CLAUDE.md`). Si la regla de dominio vive en Rust y en TS, suma golden (`packages/golden/CLAUDE.md`).

## A. Comando / endpoint nuevo (dato que la UI pide)
Contrato primero: `Api` y sus tipos son de la UI compartida.
1. `packages/ui/src/types.ts`: tipo de vista. `packages/ui/src/api.ts`: método en `Api` (`catalog` / `title` / `options` / `subs` / `premium?` / `magnet` / `recent` / `nick`).
2. **Desktop**
   - `crates/core/src/app/<tema>.rs` (`catalog` `torbox` `subtitles` `settings` `web`; si no encaja, `app/mod.rs`): `pub fn` en `AppCore`. La lógica va en su módulo de `crates/core/src/`.
   - `src-tauri/src/commands.rs`: `#[tauri::command]` (1 llamada a `AppCore`; disco/procesos por `blocking()`). `src-tauri/src/lib.rs`: sumarlo al `invoke_handler` (si falta, falla en runtime).
   - `ui/src/types.ts`: tipo serde (snake_case, enums kebab-case). `ui/src/core.ts`: una función (`xxxYyy` = `xxx_yyy`).
   - `ui/src/tauriApi.ts` (+ `ui/src/tauri-adapt.ts` si la forma difiere de la vista).
   - Mock del navegador: `crates/core/examples/record_fixtures.rs` (un `save(...)`) y `ui/mock/<cmd>__<args>.json`.
3. **Web**
   - `web/src/lib/server/<x>.ts`: la lógica. `web/src/routes/api/<x>/+server.ts`: delgado, con `route()` y validación de `params.ts`.
   - `web/src/lib/types.ts` (forma de la respuesta), `web/src/lib/webApi.ts` (fetch) y `web/src/lib/web-adapt.ts` (a la vista).
   - Ruta nueva de catálogo → `scripts/api-snapshot.mjs`; fixtures HTTP en `tests/fixtures/http/` (se graban con red).
4. Texto nuevo: `packages/ui/src/i18n/en.ts` (el español es la clave).
5. Si cambian ids/textos de pantalla: `tests/scenes/*.json`.

Mocks y fixtures se regraban solo si cambia la FORMA del dato (ver `tests/CLAUDE.md`).
Verificar: `sh scripts/check.sh`; con pantalla, `sh scripts/verify-ui.sh --changed`.

## B. Campo nuevo en la ficha (`TitleDetails`)
De dónde viene: Cinemeta = `Meta` (nombre, año, puntaje, reparto, premios); TMDB = `Details` (sinopsis, géneros, dónde verla, idioma original, gente, productoras).
- **Desktop**: `crates/core/src/catalog/tmdb.rs` `Details` (o `cinemeta.rs` `Meta`); si cambia la forma serializada, subir la versión de la caché (`tmdb-detalle-vN`, `ficha-vN`) → `ui/src/types.ts` (`Details`/`Meta`) → `ui/src/tauri-adapt.ts` `titleDetails`.
- **Web**: `web/src/lib/server/tmdb/client.ts` (tipo crudo) → `tmdb/title.ts` `title` (lo arma) → `web/src/lib/types.ts` `Title` → `web/src/lib/web-adapt.ts` `titleDetails`.
- **Compartido**: `packages/ui/src/types.ts` `TitleDetails` → `packages/ui/src/title/TitleView.svelte` (o `title-state.ts` si es lógica) → `i18n/en.ts`.
- Regla en Rust y TS (reparto, estado de serie, plataformas): golden (`providers_ar`, `people`, `show_status`).
- Mocks: `ui/mock/catalog_details__*` y `catalog_meta__*` (solo si cambió la forma), `tests/scenes/*ficha*.json`.
