# ui — UI del escritorio (webview de Tauri, Svelte 5 + TS con Vite)
Habla con el core SOLO vía `src/core.ts` (ver `src-tauri/CLAUDE.md`). Lo compartido con la web vive en `packages/ui/`.

## Para X → andá a Y (`ui/src/`)
- Arranque → `main.ts` (CSS, mock) → `boot.ts` (diálogos, luego `initApp` e `initCatalog`).
- Comando del core → `core.ts` (espejo de `commands.rs`) + `types.ts` (serde); `Api` compartida → `tauriApi.ts` + `tauri-adapt.ts`.
- Eventos `core://event` → `live.svelte.ts` (`startLive`) y `catalog.ts`; estado puro → `live.ts`, `activity-feed.ts`.
- Catálogo desktop: ficha `catalog-side.ts` · lista/orden/panel `catalog-options.ts` · pasos latino/TorBox `catalog-flow.ts` · pruebas y análisis `catalog-tests.ts` · subs `catalog-subs.ts` · magnet `catalog-magnet.ts` · estado `catalog-state.ts`.
- Diálogos y acciones → `dialog-flows.ts`, `confirm-queue.ts`; pantallas → `components/CLAUDE.md`.
- Velocidad/salud → `speed*.ts`, `health-store.ts`. Idioma → `i18n.ts`. Updater → `updater.ts`.
- Mock del navegador → `mock-tauri.ts` + `ui/mock/`. CSS global (`styles.css`, `catalog.css`) tiende a 0: lo nuevo, scoped o en `packages/ui/css/`.

## Relación
Usa `packages/ui/src/` por `$ui`. El "clique" de `catalog*.ts` (vía `catalog-state.ts`) sigue hasta N3-ui-bus.

## Trampas
- Mock: sin `__TAURI__` responde con `mock/<cmd>__<args>.json` (slug = `record_fixtures.rs`); con id `tt…` solo la fixture de ese id. `?scenario=<nombre>` reproduce `mock/events__<nombre>.json`; `?live` suma una fila.
- `window.__TAURI__` solo en `core.ts` y `updater.ts`; la CSP no permite red desde la UI.
- `catalog-state.ts` no importa otros módulos del catálogo (ciclos). Puerto 1420 fijo.
- Tests que importan i18n/dom/core: `import './test-stub.ts'` PRIMERO.

## Cómo se prueba
`cd ui && pnpm test | lint | check`; `sh scripts/check.sh`. Convenciones: `TYPING.md`.
