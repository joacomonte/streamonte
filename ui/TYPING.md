# Tipado de la UI (TS estricto)

Todo `ui/src/` es TS (`.ts` y `.svelte` con `lang="ts"`); un solo chequeo: `cd /Users/monti/Documents/Dev/streamonte/ui && corepack pnpm check` (svelte-check con `ui/tsconfig.json`, estricto, ~2 s) y `pnpm lint` (oxlint).
Globales del webview (`window.__TAURI__`): `/Users/monti/Documents/Dev/streamonte/ui/src/globals.d.ts`.

Convenciones
- Tipos del núcleo (serde de Rust) solo en `/Users/monti/Documents/Dev/streamonte/ui/src/types.ts`; `import type { Meta } from './types.ts'`. Campos en snake_case, enums kebab-case. Si falta una forma, agregarla ahí.
- Un comando nuevo del núcleo = una función en `/Users/monti/Documents/Dev/streamonte/ui/src/core.ts` (`fooBar` ↔ `foo_bar`, `invoke<T>`), el tipo en `types.ts`, y `commands.rs` + `lib.rs`.
- Sin `any` (salvo el borde con el DOM, `ElAttr`), sin `@ts-ignore`. Nulos del DOM: `$<HTMLDialogElement>('#x')` o un guard.
- `PlaybackState` y `EntryStatus` son un objeto con campos opcionales (`fraction`, `position_secs`, `message`, `reason`), no unión.

Helpers de `dom.ts`
- `$('#x')` → `HTMLElement` (asume que existe); `$<T>('#x')` para otro tipo; `$input` y `$button` atajos.
- `el(tag, attrs, ...hijos)` devuelve el tipo del tag; `on*` = listener, `null/false` no se ponen. Hijos: `ElChild`.
- Eventos del núcleo: `core.onCoreEvent((ev) => …)` con `CoreEvent` (unión por `type`, narrowing con `switch`).

Tests: `cd /Users/monti/Documents/Dev/streamonte/ui && corepack pnpm test` (`node --test`, `*.test.ts`). `src/test-stub.ts` va PRIMERO en los que importan i18n/dom/core. Sin @types/node: los módulos `node:*` se declaran mínimos en `/Users/monti/Documents/Dev/streamonte/packages/ui/src/globals.d.ts`.
