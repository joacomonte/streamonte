# web/src/lib/server — módulos solo-servidor
TMDB, IMDb, addons de torrents, TorBox, OpenSubtitles y Neon. Los `api/*/+server.ts` son delgados y llaman acá.

## Para X → andá a Y
- Fachada HTTP (`route`, `Fail`, `get`) → `http.ts`, `http-route.ts`, `fetch.ts`; params → `params.ts`; idioma → `lang.ts`.
- TMDB: ficha, listas, personas → `tmdb.ts` (fachada de `tmdb/`: `client` `cache` `lists` `title`). IMDb: puntajes → `imdb.ts`; subgéneros → `interests.ts`; premios → `awards.ts`.
- Torrents de addons → `torrents.ts`. TorBox → `torbox.ts` (`torbox/`: `client` `link` `tracks`). MKV → `mkv.ts`. Magnet pegado → `magnet.ts`.
- Subtítulos (OS.org y premium) → `subs.ts`. Keys → `keys.ts`; carpeta de datos → `config.ts`. Tracking/intentos → `track.ts`, `intentos.ts`.

## Relación
Reglas con golden contra Rust: `parse`, `otherFilm`, `merge`, `parseTracks`, subs, `constraints`, `detail`, `peopleOf`, `providersAr`, `showStatus`, `isSpanishSub`, `normalize` de awards (`packages/golden/CLAUDE.md`). La regla de latino se importa de `packages/ui/src/latino.ts` por ruta relativa (`node --test` no resuelve `$ui`).

## Trampas
- `config.ts dataDir()`: `.data` local, `/tmp/.data` con `VERCEL`; cada cold start re-baja IMDb (~60 MB). Se lee en cada llamada.
- `torbox/client.ts download`: el link lleva la key → no cachear ni loguear; por eso `tracks` recibe `ids`.
- `keep()` y `detail().excluded` = `is_excluded` del desktop.
- `subs.ts` UA `VLSub 0.11.1` es el único que acepta OS.org anónimo. Solo `POST /api/premium/[id]` gasta cuota.
- Tests nuevos importan `http-route.ts`/`fetch.ts`, no `http.ts` (arrastra `@sveltejs/kit`).

## Cómo se prueba
`*.test.ts` junto al código; `golden.test.ts` y `tmdb.test.ts` hacen `chdir` a un tmp y `delete VERCEL`. `pnpm test` en `web/`.
