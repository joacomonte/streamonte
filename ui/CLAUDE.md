# ui — UI del escritorio (webview de Tauri, Svelte 5 + TS con Vite)
Habla con el core SOLO vía `src/core.ts` (ver `src-tauri/CLAUDE.md`). Lo compartido con la web vive en `packages/ui/`.

## Para X → andá a Y (`ui/src/`)
- Arranque → `main.ts` (CSS, mock) → `boot.ts` (diálogos, velocidad, apodo, bienvenida; después `initApp` e `initCatalog`). Apodo y bienvenida → `Welcome.svelte`, `Greeting.svelte`, `nick-state.svelte.ts`, `welcome-state.ts` (UI en `packages/ui/src/animals/CLAUDE.md`).
- Comando del core → `core.ts` (espejo de `commands.rs`) + `types.ts` (serde); `Api` compartida → `tauriApi.ts` + `tauri-adapt.ts`.
- Eventos `core://event` → `live.svelte.ts` (`startLive`) y `catalog.ts`; estado puro → `live.ts`, `activity-feed.ts`.
- Catálogo desktop: ficha `catalog-side.ts` · lista/orden/panel `catalog-options.ts` · pasos latino/TorBox `catalog-flow.ts` · pruebas y análisis `catalog-tests.ts` · subs `catalog-subs.ts` · magnet `catalog-magnet.ts` · estado `catalog-state.ts`.
- Diálogos y acciones → `dialog-flows.ts` (la cola de confirmaciones es `$ui/components/confirm-queue.ts`); pantallas → `components/CLAUDE.md`.
- Velocidad/salud → `speed*.ts`, `health-store.ts`. Idioma → `i18n.ts`. Updater → `updater.ts`.
- Mock del navegador → `mock-tauri.ts` + `ui/mock/`. CSS global (`ui/styles.css`, `ui/catalog.css`) tiende a 0: lo nuevo, scoped o en `packages/ui/css/`.

## Relación
Usa `packages/ui/src/` por `$ui`. Los `catalog*.ts` comparten estado por `catalog-state.ts`.

## Trampas
- Mock: sin `__TAURI__` responde con `mock/<cmd>__<args>.json` (slug = `record_fixtures.rs`); con id `tt…` solo la fixture de ese id. `?scenario=<nombre>` reproduce `mock/events__<nombre>.json`; `?live` suma una fila.
- `window.__TAURI__` solo en `core.ts` y `updater.ts`; la CSP (`connect-src` ipc) no permite fetch ni red desde la UI (las imágenes https sí cargan).
- `catalog-state.ts` importa de otros módulos del catálogo solo tipos (`import type`: evita ciclos). Puerto 1420 fijo; sin Vite la ventana de Tauri queda en blanco.
- Orden de `main.ts`: el mock va antes de `i18n.ts` (lee la config al cargar); `boot.ts` se importa dinámico, después.
- Los modelos reciben `typeof core` para probarse sin Tauri. Tests que importan i18n/dom/core: `import './test-stub.ts'` PRIMERO; `activity-feed.ts` y `live.ts` traducen con `$ui/i18n/runtime.ts`.

## Cómo se prueba
`cd ui && pnpm test | lint | check`; `sh scripts/check.sh`. Convenciones: `TYPING.md`.
