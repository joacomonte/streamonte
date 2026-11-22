# web/src/lib — librería del cliente (navegador + SSR)
Tipos, lógica pura de ranking, caché de navegador, i18n y componentes Svelte 5 (runes). Lo que toca TMDB/TorBox/DB vive en `server/` → `/Users/monti/Documents/Dev/streamonte/web/src/lib/server/CLAUDE.md`. Alias: `#lib/x.ts`.

## Mapa
- `types.ts` — `:4 Torrent` · `:21 Sub` · `:35 Ident` (magnet identificado) · `:50 Title`/`:51 Episodes`/`:52 Genres` (inferidos de `server/tmdb.ts`) · `:55 SeasonScore` · `:58 ApiError`.
- `torrent-rank.ts` — `:8 resOf` · `:11 QUALITY` (fuente→nombre/estrellas) · `:22 TYPICAL` Mbps por res cuando no hay duración · `:26 mbpsOf` (peso÷duración) · `:32 byQuality` (bitrate, luego fuente) · `:35 sourceOf` · `:39 groupOf` · `:43 level(sub,match)` calce de subs 0–3 · `:56 rank(subs,match)`.
- `audio.ts:12 audioOf(audios)` mejor audio en español · `:25 latStatus(t,info)` estado lat/likely/spain/check/none · `:31 LAT_BADGE` texto y tip de badges · `:7 Tracks`.
- `cinema.ts:6 onlyCinema(released)` estreno <21 días (`DAYS :3`) → avisa que aún no hay copias buenas.
- `saved.ts` — caché localStorage con TTL y versión por ruta (`V :11`): `:21 get` `:32 put` `:56 json(fetch,url,ttl)` GET a la API con caché (solo guarda ok) · `:70 recall`/`:77 remember` (para siempre) · `:87 wipe()` "Borrar caché" · `HOUR`/`DAY`.
- `catalog.svelte.ts` — estado global de Explorar: `:46 cat` ($state: filtros, items, página, búsqueda) · `:28 DEFAULTS` · `:78 loadMore()` (→ `/api/catalog`) · `:118 reset()` · `:130 relang()` · `:137 loadGenres(kind)` (→ `/api/genres`) · `KINDS/SORTS/BACK/VOTES/LANGS` (filtros) · filtros guardados en `sw.filters` `:26`.
- `i18n.svelte.ts` — `:17 i18n` ($state lang/titles) · `:20 t(texto,vars)` · `:22 loc()` · `:24 contentKey()` (clave de caché por idioma) · `:31 setLang` `:39 setTitles` (cookies `lang`/`titles`).
- `i18n/translate.ts:7 translate` · `:18 pickLangs(cookie,accept)` (compartido con servidor) · `:26 locale` · `i18n/en.ts` — diccionario es→en (clave = texto en español; falta → español).
- `nick.ts:10 cleanNick` · `:19 saveNick(raw)` (→ `/api/nick`, cookie `nick`) · `track.ts:2 track(accion,dato)` sendBeacon → `/api/track`.
- `tours.ts` — pasos de tutorial: `:22 device()` · `:36 welcomeSteps` · `:59 castSteps` · `:32 nickStep` · `:80 seen`/`:87 markSeen`.
- Componentes: `Torrents.svelte` (1540 líneas: pasos red→audio→lista `step :210`, `search :150` ← `/api/torrents`, `linkOf :328` ← `/api/link`, `probe :371` ← `/api/tracks`, `searchSubs :440` ← `/api/subs`, premium `:549-571` ← `/api/premium*`, copiar link/sub) · `Tour.svelte` (tutorial pantalla completa, `<dialog>`) · `Sheet.svelte` (hoja/diálogo) · `LangPicker.svelte` · `SeasonChart.svelte` (puntaje IMDb por temporada) · `AdminCode.svelte` (3 casillas → `/admin`) · `Icon.svelte` (paths SVG).
- `assets/favicon.svg` · `index.ts` vacío.

## Flujo
- Home: `catalog.svelte.ts loadMore` → `saved.json` → `/api/catalog` → items.
- Ficha: `t/[kind]/[id]/+page.ts` → `saved.json('/api/title/…')` → `<Torrents>` → `search` → lista ordenada por `byQuality` → `copyLink` (`linkOf`) → `searchSubs` → `rank` → copiar.

## Conexiones
- Importado por `src/routes/**`; no importa de `server/` salvo tipos (`import type` en `types.ts`).
- Equivalentes del desktop: `ui/src/catalog-options.js:851 QUALITY`, `ui/src/options-rank.js:51 TYPICAL_MBPS`, `crates/core/src/subtitles.rs` (level).

## Reglas / trampas
- `TYPICAL` (`torrent-rank.ts:22`): 1440p = "2K" (`Torrents.svelte:823`), 14 Mbps, alineado con el desktop; cambiarlo acá obliga a cambiar `ui/src/options-rank.js:51`.
- Orden de opciones = bitrate (`mbpsOf`), no resolución; sin `size` van al final (`byQuality :32`).
- `saved.ts V :11`: si cambia el formato de una respuesta, subir su versión (descarta solo ese dato).
- Textos de UI: siempre `t('texto en español')`; agregar su traducción en `i18n/en.ts`.
- `level()` (`torrent-rank.ts:43`) debe seguir a `crates/core/src/subtitles.rs`.
- `audio.ts`: una sola regla de audio latino (badges y búsqueda) — no duplicar en componentes.
- Elementos interactivos llevan `id` (regla global); `Sheet`/`Tour`/`LangPicker`/`AdminCode` lo reciben por prop.

## Tests / chequeos
`torrent-rank.test.ts`, `audio.test.ts`, `cinema.test.ts`, `i18n/i18n.test.ts`. `npm test` / `npm run check` en `/Users/monti/Documents/Dev/streamonte/web/`.
