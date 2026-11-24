# tests — contratos, visual y fixtures web
Pruebas de pantalla sin red. Los tests unitarios viven junto al código.

## Para X → andá a Y
- Ids/textos que una pantalla debe tener: `tests/contracts/<app>-<pantalla>.json` (formato en el encabezado de `scripts/shot.mjs`). `status:"regressed"` = faltan a propósito, se restauran después. Correr: `sh scripts/contracts.sh [--changed] [nombre]`.
- Regresión visual: `tests/visual/baseline/` (PNG oscuros) y `tests/visual/README.md`. Correr: `node scripts/visual.mjs`.
- Respuestas HTTP de la web sin red (TMDB, addons, OS): `tests/fixtures/web-http/` (con `HTTP_FIXTURES`); visual web: `tests/visual/fixtures/web/`.
- Mocks del desktop: `ui/mock/` (no acá).

## Regrabar
- Baselines: `node scripts/visual.mjs --update --only <x>` y commitear los PNG. Solo si el cambio visual es intencional; macOS.
- Fixtures HTTP: se graban con red (key de TMDB). Solo si cambia la forma de la respuesta.
- Contratos: editar el JSON a mano al cambiar un id o texto.
- Cambia un id de la ficha: afecta a las dos apps (`WEB_IDS`/`DESKTOP_IDS` en `packages/ui/src/title/title-state.ts`).

## Trampas
- Contratos y visual levantan vite: no en paralelo con otro pesado (`scripts/lib/heavy-lock.sh`).
- `LIVE=1` suma contratos con TorBox real (lentos, necesitan key).
