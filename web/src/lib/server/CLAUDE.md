# web/src/lib/server — módulos solo-servidor
TMDB, IMDb, addons de torrents, TorBox, OpenSubtitles y Neon. Los `api/*/+server.ts` son delgados y llaman acá.

## Para X → andá a Y
- Fachada HTTP (`route`, `Fail`, `get`) → `http.ts`, `http-route.ts`, `fetch.ts`; params → `params.ts`; idioma → `lang.ts`.
- TMDB: ficha, listas, personas → `tmdb.ts` (fachada de `tmdb/`: `client` `cache` `lists` `title`). IMDb: puntajes → `imdb.ts`; subgéneros → `interests.ts`; premios → `awards.ts`.
- Torrents de addons → `torrents.ts` (`hacktorrent.ts`). Puntaje por capítulo → `episode-ratings.ts`. TorBox → `torbox.ts` (`torbox/`: `client` `link` `tracks`). MKV → `mkv.ts`. Magnet pegado → `magnet.ts`.
- Subtítulos (OS.org y premium) → `subs.ts`. Keys → `keys.ts`; carpeta de datos → `config.ts`. Tracking/intentos → `track.ts`, `intentos.ts`. Vistos → `vistos.ts`.
- Código de animales del apodo (hash, ayuda, espera de 15 s, alertas) → `apodos.ts`; cookie firmada, apodo verificado y `ownAnimals` → `apodo-session.ts`; par cifrado (AES-GCM, HKDF de `APODO_SECRET`) → `apodo-cifrado.ts`.

## Relación
Muchas reglas tienen golden contra Rust (`packages/golden/CLAUDE.md`). La de latino se importa de `packages/ui/src/latino.ts` por ruta relativa (`node --test` no resuelve `$ui`).

## Trampas
- Fuente única de datos (los demás remiten acá): `DATABASE_URL` (Neon; sin ella no hay tracking y `apodos.ts` guarda en memoria, se pierde al reiniciar). `config.ts dataDir()`: `.data` local, `/tmp/.data` con `VERCEL`; cada cold start re-baja IMDb (~60 MB). `keys.ts` usa siempre `.data`.
- Cuota premium de OpenSubtitles.com (por día): solo `POST /api/premium/[id]` la gasta, con toque del usuario.
- `route(fn, cache)`: con `cache` pone `Cache-Control` de CDN; `perLang` solo si la URL trae `l=<títulos>.<app>` (lo agrega `webApi.ts cachedFetch`; `hooks.server.ts` solo lo lee).
- `torbox/client.ts download`: el link lleva la key → no cachear ni loguear; por eso `tracks` recibe `ids`.
- `subs.ts` UA `VLSub 0.11.1` es el único que acepta OS.org anónimo.
- Apodo: confiar solo en `verifiedNick()` (cookie `apodo` firmada + versión del código), nunca en un apodo que mande el cliente.
- `route()`/`Fail` (`http-route.ts`) arrastran `@sveltejs/kit`: los tests importan `get` de `fetch.ts`, no `route`.

## Cómo se prueba
`*.test.ts` junto al código; `golden.test.ts` y `tmdb.test.ts` hacen `chdir` a un tmp y `delete VERCEL`. `pnpm test` en `web/`.
