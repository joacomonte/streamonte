# web/src/lib/server — módulos solo-servidor
TMDB, IMDb, addons de torrents, TorBox, OpenSubtitles y Neon. Los endpoints de `/Users/monti/Documents/Dev/streamonte/web/src/routes/api/` son delgados y llaman acá.

## Mapa
- `http.ts` — fachada: re-exporta `Fail` `route` (`http-route.ts`: `route(fn, cache?)`, con `cache`: `Cache-Control` CDN `s-maxage` + `stale-while-revalidate`; `perLang` solo si la URL trae `l=<ui>.<títulos>`, que agrega `webApi.ts cachedFetch` y `hooks.server.ts` usa en vez de la cookie) y `get` (`fetch.ts`, timeout 12 s; con `HTTP_FIXTURES` carga `http-fixture.ts`, que graba/responde TMDB, addons y OS.org); define `srtResponse`. Los tests nuevos importan `http-route.ts`/`fetch.ts` para no arrastrar `@sveltejs/kit`. `lang.ts` — `langStore` · `LANG_PARAM` · `tx`. `params.ts` — `episode` · `imdbOrFail` · `hash40`/`checkHash40`/`isHash40` · `osHash`.
- `config.ts` — `dataDir()` (`.data`, o `/tmp/.data` con `VERCEL`) y `key(name)`: leen en cada llamada, no al cargar el módulo.
- `keys.ts` — `ENV` · `keys` · `setKeys`.
- `tmdb.ts` — fachada de `tmdb/`: `client.ts` (`tmdb`, tipos, `card`, `keep`) · `cache.ts` (`capped`, `detail`, `fillDetails`: fichas en `.data/`) · `lists.ts` (`discover`, `search`, `people`, `personTitles`, `imdbPage`) · `title.ts` (`providersAr`, `peopleOf`, `showStatus`, `title`, `namesOf`, `tmdbOf`, `season`).
- `interests.ts` — subgéneros de IMDb (GraphQL `caching.graphql.imdb.com`, header `x-imdb-client-name`): `interestList` (lista ordenada hasta 250) · `examples` (ejemplos por subgénero); `tmdb/lists.ts imdbPage` pasa una página de tt a tarjetas vía `/find`. Desktop: `crates/core/src/catalog/interests.rs`.
- `awards.ts` — premios de IMDb (GraphQL, como `interests.ts`): `awards(tt)` (memoria 1 día) · `normalize` (golden `awards.json` = `crates/core/src/catalog/awards.rs`) ← `routes/api/awards/[imdb]`.
- `imdb.ts` — `ratings` · `imdbOf` · `buildIndex` · `seasonScores`.
- `torrents.ts` — `ADDONS` · `parse` · `otherFilm` · `fileTorrent` · `merge` · `torrents`.
- `torbox.ts` — fachada de `torbox/`: `client.ts` (`key`, `tb`, `tbRoot`, `cached`, `checkFiles`, `mine`, `addMagnet`, `added`, `download`, `pick`, `isSpanishSub`) · `link.ts` (`link`, `hls`, `latinoByName`) · `tracks.ts` (`tracks`, `spanishVariant`, `spanishSubs`).
- `mkv.ts` — `parseTracks` · `tracksOf` · `isSpanish`. `magnet.ts` — `parseName` · `identify` · `status` · `download`.
- `subs.ts` — OS.org: `search` · `download`; OS.com premium: `premiumQuota` · `premiumSearch` · `premiumDownload` · `premiumFile`.
- `track.ts` — `sql` (null sin `DATABASE_URL`) · `track`. `intentos.ts attempt` (5 fallos/15 min por IP).

## Trampas
- `config.ts dataDir()`: `.data` local, `/tmp/.data` con `VERCEL` (`tmdb/cache.ts`, `imdb.ts`, `subs.ts`): cada cold start re-baja IMDb (~60 MB); `keys.ts` siempre `.data`.
- `torbox/client.ts download`: el link lleva la key → no cachear ni loguear; por eso `tracks` recibe `ids`.
- `keep()` (`tmdb/client.ts`) y `detail().excluded` (`tmdb/cache.ts`) = `is_excluded` del desktop; cambiar uno obliga a golden y Rust.
- Funciones con golden (`parse`, `otherFilm`, `merge`, `parseTracks`, `results`/`seconds` de `subs.ts`, `constraints` de `interests.ts`, `detail`, `peopleOf`, `providersAr`, `showStatus`, `isSpanishSub`) deben coincidir con Rust (`/Users/monti/Documents/Dev/streamonte/packages/golden/`).
- `subs.ts` UA `VLSub 0.11.1` es el único que acepta OS.org anónimo.
- Solo `POST /api/premium/[id]` gasta cuota premium.

## Flujo
`/api/torrents` → `torrents` → 4 addons → `merge` → `cached` (TorBox) → NDJSON; `/api/link` → `link` → `added` → `hls`/`download` → url https.

## Tests
`golden`, `torrents`, `torbox`, `tmdb`, `subs`, `mkv`, `magnet`, `imdb` `.test.ts`; `golden.test.ts` y `tmdb.test.ts` hacen `chdir` a un tmp y `delete VERCEL` (la carpeta de datos es relativa al cwd); `desktop-proxy.test.ts` prueba el stub sin build.
