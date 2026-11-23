# packages — código compartido desktop (Rust/Tauri) + web
CSS compartido, TS compartido (`ui/src/`) y vectores de prueba, sin build propio. Raíz: `/Users/monti/Documents/Dev/streamonte/packages/`; `.vercelignore` los sube a Vercel junto con `web/`.

## Mapa
- `ui/css/tokens.css` — `:3 :root` variables (claro) · `:85 @media (prefers-color-scheme: dark)`. Unión de `ui/styles.css` y `web/src/app.css`; si un nombre tenía dos valores, ganó el de la web (ej. `--display`).
- `ui/css/base.css` — reset, `:13 prefers-reduced-motion`.
- `ui/css/components.css` — `:4 .btn` · `:46 .chip` · `:69 .pill` · `:84 .badge` · `:99 .surface` · `:102 .list` · `:108 .skel` · `:118 .spin` · `:130 .bar` · `:134 .switch` · `:142 .sheet` · `:166 .menu`.
- `ui/css/settings.css` — Ajustes web y desktop: `.st` secciones, `.st-h`, `.st-list`/`.st-row` (nombre izq., control der.), `.st-chip` (estado), `.st-toggle`, `.st-btn`, `.st-link`, `.st-more` (desplegable).
- `ui/css/options.css` — fila y lista de opciones (`.cat-opt`, `.cat-tag`, `.cat-play`, `.cat-dock`, `.cat-tip`) de `packages/ui/src/options/OptionRow.svelte`.
- Consumidores: `web/src/app.css:2-6`, `ui/src/main.ts:4-10`.
- `ui/src/` — TS compartido (`$ui`) → `ui/CLAUDE.md` en `/Users/monti/Documents/Dev/streamonte/packages/ui/CLAUDE.md` · ← `web/src/lib/webApi.ts`, `ui/src/tauriApi.ts`.
- `golden/*.json` — `[{ "in", "out", "nota"?, "diverge"? }]`, Rust fuente de verdad. Rust ↔ web:
  - `release.json` — `crates/core/tests/it/golden.rs:15` ↔ `torrents.ts:33 parse`
  - `excluded.json` — `golden.rs:39` ↔ `tmdb.ts:104 detail`
  - `trailer.json` — `crates/core/src/catalog/tmdb.rs:996` ↔ `tmdb.ts:294 firstTrailer`
  - `providers_ar.json` — `tmdb.rs:1008` ↔ `tmdb.ts:269 providersAr`
  - `people.json` — `tmdb.rs:1018` ↔ `tmdb.ts:279 peopleOf`
  - `show_status.json` — `crates/core/src/catalog/seasons.rs:459` ↔ `tmdb.ts:287 showStatus`
  - `sub_lang.json` — `crates/core/src/subtitles/providers/lang.rs:57` ↔ `torbox.ts:13 isSpanishSub`
  - Lector web: `web/src/lib/server/golden.test.ts:28 golden`.

## Trampas
- No editar un golden para que pase la web: el JSON sigue a Rust y el caso lleva `diverge` (se salta en web y se lista al final).
- `include_str!` usa rutas relativas a la profundidad del `.rs`: moverlo rompe el path.
- CSS sin prefijo: cuidado con colisiones; el layout de cada pantalla va scoped en su componente.

## Flujo
Cambio en Rust → actualizar `golden/*.json` → `cargo nextest run -p streamonte-core` y `pnpm test` en `/Users/monti/Documents/Dev/streamonte/web/`.

## Tests
Golden web y Rust arriba; `packages/ui`: `cd /Users/monti/Documents/Dev/streamonte/packages/ui && pnpm test && pnpm check`; CSS sin test.
