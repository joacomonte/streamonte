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
- `golden/*.json` — `[{ "in", "out", "nota"?, "diverge"? }]`, Rust fuente de verdad. Rust ↔ web (por función, sin líneas; buscar con `rg`):
  - `release.json` — `/Users/monti/Documents/Dev/streamonte/crates/core/tests/it/golden.rs` `release` (`normalize::parse`: res/hdr/codec/source/atmos/hint/multi/spa/cam/size) ↔ `torrents.ts parse`
  - `spanish_variant.json` — `audio.rs spanish_variant` ↔ `/Users/monti/Documents/Dev/streamonte/packages/ui/src/latino.ts` (`spanishVariant`, `trackVariant`, `audioOf`) y la etiqueta de `torbox/tracks.ts spanishVariant`. Sin `diverge`: una sola regla de "latino", por palabra entera.
  - `other_film.json` — `aggregate.rs other_film` ↔ `torrents.ts otherFilm`
  - `merge.json` — `aggregate.rs Merged::add/sorted` ↔ `torrents.ts merge`
  - `excluded.json` — `golden.rs excluded` ↔ `tmdb/cache.ts detail`
  - `providers_ar.json` — `tmdb.rs golden_providers_ar` ↔ `tmdb/title.ts providersAr`
  - `people.json` — `tmdb.rs golden_people` ↔ `tmdb/title.ts peopleOf`
  - `show_status.json` — `seasons.rs golden_show_status` ↔ `tmdb/title.ts showStatus`
  - `awards.json` — `awards.rs normalize` ↔ `/Users/monti/Documents/Dev/streamonte/web/src/lib/server/awards.ts normalize` (entrada = `data` de IMDb GraphQL)
  - `sub_lang.json` — `subtitles/providers/lang.rs` ↔ `torbox/client.ts isSpanishSub`
  - `mkv.json` — `catalog/mkv.rs parse_tracks` ↔ `mkv.ts parseTracks` (entrada = head en hex)
  - `interests.json` / `small_poster.json` — `catalog/interests.rs constraints`/`small_poster` ↔ `interests.ts constraints`/`smallPoster` (la consulta se compara sin espacios ni comas)
  - `opensubs_org.json` — `opensubtitles_org.rs results`/`hms_secs` ↔ `subs.ts results`/`seconds`
  - Sin golden por no haber equivalente puro en la web: `torbox.rs` `in_cache`/`main_video`/`pick_audio` (la web los hace inline en `torbox/client.ts cached` y `torbox/link.ts`) e `imdb_index` (`seasons.rs build_index` ↔ `imdb.ts buildIndex`, que lee y escribe archivos).
  - Lector web: `web/src/lib/server/golden.test.ts golden`.

## Trampas
- No editar un golden para que pase la web: el JSON sigue a Rust y el caso lleva `diverge` (se salta en web y se lista al final).
- `include_str!` usa rutas relativas a la profundidad del `.rs`: moverlo rompe el path.
- Convención: toda tarjeta/baldosa con imagen de fondo usa el fade a oscuro (`--fade-dark` en `ui/css/tokens.css`, clase `.fade-dark` en `ui/css/components.css`; transparente arriba, casi negro abajo, texto blanco), no tintes de color; hoy: `ui/src/catalog/GenrePicker.svelte`.
- CSS sin prefijo: cuidado con colisiones; el layout de cada pantalla va scoped en su componente.

## Flujo
Cambio en Rust → actualizar `golden/*.json` → `cargo nextest run -p streamonte-core` y `pnpm test` en `/Users/monti/Documents/Dev/streamonte/web/`.

## Tests
Golden web y Rust arriba; `packages/ui`: `cd /Users/monti/Documents/Dev/streamonte/packages/ui && pnpm test && pnpm check`; CSS sin test.
