# packages — código compartido desktop + web
Sin build propio; `.vercelignore` lo sube a Vercel con `web/`.
- `ui/` — TS y Svelte compartidos, y `ui/css/` → `packages/ui/CLAUDE.md`.
- `golden/` — vectores Rust ↔ web → `packages/golden/CLAUDE.md`.

## CSS compartido (`packages/ui/css/`)
- `tokens.css` (`:root`, solo oscuro; si un nombre tenía dos valores ganó el de la web) · `base.css` (reset) · `components.css` (`.btn` `.chip` `.pill` `.badge` `.sheet` `.menu` `.fade-dark`…) · `settings.css` (`.st-*`, Ajustes) · `options.css` (fila de opciones `.cat-*`).
- Consumidores: `web/src/app.css` y `ui/src/main.ts`.

## Trampas
- Tarjeta/baldosa con imagen de fondo: fade a oscuro (`--fade-dark`, `.fade-dark`), no tintes de color (ej. `catalog/GenrePicker.svelte`).
- CSS sin prefijo: cuidado con colisiones; el layout de cada pantalla va scoped en su componente.
- CSS sin test: verificar con `scripts/shot.mjs`.
