# packages/golden — vectores Rust ↔ web
`<nombre>.json` = `[{ "in", "out", "nota"?, "diverge"?, "rust"?, "web"? }]`. **Rust manda**: el JSON sigue a Rust.

## Para X → andá a Y (lado Rust ↔ lado web)
- `release` — `catalog/normalize.rs parse` ↔ `web/.../torrents.ts parse` (lector Rust: `crates/core/tests/it/golden.rs`).
- `spanish_variant` — `audio.rs` ↔ `packages/ui/src/latino.ts` (sin `diverge`: una sola regla de latino).
- `other_film`, `merge` — `catalog/aggregate.rs` ↔ `torrents.ts`.
- `excluded`, `providers_ar`, `people` — `tmdb.rs` / `cinemeta.rs` ↔ `tmdb/cache.ts`, `tmdb/title.ts`.
- `show_status` — `seasons.rs` ↔ `tmdb/title.ts`. `awards` — `catalog/awards.rs` ↔ `server/awards.ts`.
- `sub_lang` — `subtitles/providers/lang.rs` ↔ `torbox/client.ts isSpanishSub`. `mkv` — `catalog/mkv.rs` ↔ `server/mkv.ts`.
- `interests`, `small_poster` — `catalog/interests.rs` ↔ `server/interests.ts`. `opensubs_org` — `opensubtitles_org.rs` ↔ `server/subs.ts`.
- Lector web: `web/src/lib/server/golden.test.ts`. Los pares exactos: `rg -n '<nombre>.json'`.

## Agregar o cambiar uno
Cambio en Rust → actualizar el JSON → `cargo nextest run -p streamonte-core golden` y `pnpm test` en `web/` (o `sh scripts/check.sh full`).

## Trampas
- No editar un golden para que pase la web: el caso lleva `diverge` (se salta en web y se lista al final).
- `include_str!` usa rutas relativas a la profundidad del `.rs`: moverlo rompe el path.
- Sin golden por no haber equivalente puro en la web: `torbox.rs` `in_cache`/`main_video`/`pick_audio` e `imdb_index`.
