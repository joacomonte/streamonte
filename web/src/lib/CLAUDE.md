# web/src/lib — librería del cliente (navegador + SSR)
Tipos, ranking puro, caché de navegador, i18n y componentes Svelte 5. Lo que toca TMDB/TorBox/DB está en `/Users/monti/Documents/Dev/streamonte/web/src/lib/server/CLAUDE.md`.

## Mapa
- `types.ts` — `:4 Torrent` · `:21 Sub` · `:35 Ident` · `:50 Title` · `:55 SeasonScore` · `:58 ApiError`.
- `torrent-rank.ts` — `:11 QUALITY` · `:22 TYPICAL` · `:26 mbpsOf` · `:32 byQuality` · `:43 level` · `:56 rank`.
- `audio.ts` — `:12 audioOf` · `:25 latStatus` · `:31 LAT_BADGE`. `cinema.ts:6 onlyCinema` (estreno <21 días, `DAYS :3`).
- `saved.ts` — caché localStorage con TTL: `:11 V` · `:21 get` · `:32 put` · `:56 json` · `:70 recall` · `:77 remember` · `:87 wipe`.
- `catalog.svelte.ts` — estado de Explorar: `:28 DEFAULTS` · `:46 cat` · `:78 loadMore` · `:118 reset` · `:130 relang`.
- `i18n.svelte.ts` — `:17 i18n` · `:20 t` · `:22 loc` · `:24 contentKey` · `:31 setLang` · `:39 setTitles`. `i18n/translate.ts` — `:7 translate` · `:18 pickLangs`; `i18n/en.ts` diccionario es→en.
- `nick.ts:19 saveNick` · `track.ts:2 track` (sendBeacon → `/api/track`) · `tours.ts` — `:22 device` · `:36 welcomeSteps` · `:59 castSteps`.
- `Torrents.svelte` (1540 líneas) — `:150 search` ← `/api/torrents` · `:210 step` · `:328 linkOf` ← `/api/link` · `:371 probe` ← `/api/tracks` · `:440 searchSubs` ← `/api/subs` · `:549 loadQuota` ← `/api/premium*`. Otros: `Tour`, `Sheet`, `LangPicker`, `SeasonChart`, `AdminCode`, `Icon`.

## Trampas
- `TYPICAL` (`torrent-rank.ts:22`) y `level` (`:43`) deben seguir al desktop: `ui/src/options-rank.js:51 TYPICAL_MBPS`, `ui/src/catalog-options.js:851 QUALITY`, `crates/core/src/subtitles.rs`.
- Orden por bitrate (`mbpsOf`), no resolución; sin `size` al final (`byQuality :32`).
- Si cambia el formato de una respuesta, subir su versión en `saved.ts:11 V`.
- Textos siempre `t('texto en español')` + traducción en `i18n/en.ts`.
- Una sola regla de audio latino en `audio.ts`; no duplicar en componentes.
- No importa de `server/` salvo `import type` (`types.ts`).

## Tests
`torrent-rank`, `audio`, `cinema`, `i18n/i18n` `.test.ts` junto al código.
