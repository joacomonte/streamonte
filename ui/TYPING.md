# Tipado de la UI (JS + JSDoc)

Chequeo: `cd /Users/monti/Documents/Dev/streamonte/ui && npm run check` (svelte-check + `tsc -p tsconfig.js.json`, ~2 s).

Config: `/Users/monti/Documents/Dev/streamonte/ui/tsconfig.js.json` (lib dom, checkJs, strict). Globales del webview
(`window.__TAURI__`): `/Users/monti/Documents/Dev/streamonte/ui/src/globals.d.ts`. Primera línea de cada archivo: `// @ts-check`.

Convenciones
- Typedefs compartidos solo en `/Users/monti/Documents/Dev/streamonte/ui/src/types.js` (solo `@typedef`, `export {}`).
  Usarlos con `@param {import('./types.js').Meta} m` o `/** @typedef {import('./types.js').Meta} Meta */` arriba del archivo.
- Las formas de las respuestas del núcleo (structs Rust con serde) están en `types.js`; `api.js` tipa cada función con ellas.
- Sin `any` (salvo bordes con APIs externas), sin `@ts-ignore`. Para nulos de DOM: `/** @type {HTMLInputElement} */ (el)` o guard.
- Nombres de campo = los del JSON (snake_case, como los manda serde).
- `types.js` ya tiene las formas de todo `api.js` y de los eventos (`CoreEvent`); si falta una, agregala al final (append-only).

Helpers de `dom.js` para tipar el DOM
- `$('#x')` → `HTMLElement` (no null: asume que existe). `$input('#x')` → `HTMLInputElement`, `$button('#x')` → `HTMLButtonElement`;
  otro tipo: cast JSDoc `/** @type {HTMLDialogElement} */ ($('#dlg'))`.
- `el(tag, attrs, ...hijos)` devuelve el tipo del tag (`el('button')` → `HTMLButtonElement`); `on*` = listener, `null/false` no se ponen. Tipo de hijos: `ElChild` (exportado).
- `api.*` ya devuelve `Promise<…>` tipado; eventos: `onCoreEvent((ev) => …)` con `CoreEvent` (unión por `type`, narrowing con `switch`).
- `PlaybackState` y `EntryStatus` son un objeto con campos opcionales (`fraction`, `position_secs`, `message`, `reason`), no unión.
- Evitar imports circulares con `dom.js` ↔ `activity.js` (activity usa `document.querySelector` a propósito).

Tests: `cd ui && npm test` (`node --test`, `*.test.js`; el stub `ui/src/test-stub.js` va PRIMERO en los que importan i18n/format/api).
Sin @types/node: los módulos `node:*` que usan los tests se declaran mínimos al final de `globals.d.ts` (`assert` es `any`).
