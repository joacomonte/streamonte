# tests — escenas (contratos + visual) y fixtures
Pruebas de pantalla sin red, con un solo runner: `scripts/scenes.mjs`. Los tests unitarios viven junto al código.

## Para X → andá a Y
- Ids/textos que una pantalla debe tener: `tests/scenes/<app>-<pantalla>.json` (campo `must`; formato en el encabezado de `scripts/scenes.mjs`). `status:"regressed"` = faltan a propósito, se restauran después. Correr: `sh scripts/contracts.sh [--changed] [nombre]` (alias de `scenes.mjs --contracts`).
- Regresión visual: escenas `tests/scenes/shot-*.json` (campo `shot`) contra `tests/visual/baseline/` (PNG oscuros); detalle en `tests/visual/README.md`. Correr: `node scripts/visual.mjs` (alias de `scenes.mjs --shots`).
- Escenas `web-apodo-*.json` (apodo y código de animales): entran con la sesión de `scripts/lib/web-apodo.mjs`. La bienvenida del desktop no tiene escena (mock `?nonick`).
- Todo junto con un solo vite por app: `sh scripts/verify-ui.sh [--changed|--all]`.
- Respuestas HTTP de la web sin red (TMDB, addons, OS): `tests/fixtures/http/` (con `HTTP_FIXTURES`). Las de `/api/*` de las capturas web: `tests/fixtures/http/api/`.
- Mocks del desktop: `ui/mock/` (no acá; los de eventos y comandos los usan las escenas de desktop).

## Regrabar
- Baselines: `node scripts/visual.mjs --update --only <x>` y commitear los PNG. Solo si el cambio visual es intencional; macOS.
- Fixtures HTTP: se graban con red (key de TMDB). Solo si cambia la forma de la respuesta.
- Escenas: editar el JSON a mano al cambiar un id o texto.
- Ids de la ficha (`TITLE_IDS`): `packages/ui/src/title/CLAUDE.md`.

## Trampas
- Las escenas levantan vite: no en paralelo con otro pesado (`scripts/lib/heavy-lock.sh`, lo toma `verify-ui.sh`).
- `LIVE=1` suma escenas con TorBox real (`"live": true`, lentas, necesitan key).
