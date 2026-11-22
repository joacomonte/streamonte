# web/src/lib — librería del cliente (navegador + SSR)
Tipos, ranking puro, caché de navegador, i18n y componentes Svelte 5. Lo que toca TMDB/TorBox/DB está en `/Users/monti/Documents/Dev/streamonte/web/src/lib/server/CLAUDE.md`.

## Mapa
- `types.ts` — `:4 Torrent` · `:21 Sub` · `:35 Ident` · `:50 Title` · `:55 SeasonScore` · `:58 ApiError`.
- `webApi.ts` — `:17 createWebApi` · `:93 webApi` (único `Api` de la web, con caché de catálogo/géneros; se fija en `routes/+layout.svelte:19`) → `web-adapt.ts` (`:13 catalogItem` `:29 titleDetails` `:71 option` `:130 readLines` `:147 optionsUpdates` `:113 premiumResults` `:173 torrentOf`) · ← `packages/ui/src/api.ts` (`Api`).
- Ranking, audio, formatos, `onlyCinema` ← `/Users/monti/Documents/Dev/streamonte/packages/ui/src/` (`rank.ts` `sub-match.ts` `audio.ts` `format.ts`); `Torrents.svelte` los importa por `$ui`.
- `saved.ts` — caché localStorage con TTL: `:11 V` · `:21 get` · `:32 put` · `:56 json` · `:70 recall` · `:77 remember` · `:87 wipe`.
- `catalog.svelte.ts` `:17 webCatalog` (store a nivel módulo sobre `webApi`) → `$ui/catalog/catalog.svelte.ts`, `webApi.ts`, `saved.ts` · ← `routes/+page.svelte`, `routes/t/[kind]/[id]/+page.svelte` (`pickPerson`), `langs.ts` (`relang`).
- `i18n.svelte.ts` — `:17 i18n` · `:20 t` · `:22 loc` · `:24 contentKey` · `:31 setLang` · `:39 setTitles`. `i18n/translate.ts` — re-exporta `translate` `locale` de `packages/ui/src/i18n/translate.ts` · `pickLang(s)`; diccionario ← `packages/ui/src/i18n/en.ts`.
- `nick.ts:19 saveNick` · `track.ts:2 track` (sendBeacon → `/api/track`) · `langs.ts:6 langOptions` (→ `catalog.svelte.ts:webCatalog().relang`; ← `+layout.svelte`, `ajustes/+page.svelte`). Icon/Sheet/LangPicker/Tour/tours viven en `packages/ui/src/components/` (import `$ui/components/…`).
- `Torrents.svelte` (1367 líneas) — `:150 search` ← `/api/torrents` · `:210 step` · `:328 linkOf` ← `/api/link` · `:371 probe` ← `/api/tracks` · `<SubsPicker> :848` (`$ui/subs/`; `copySub:490` `copyPremium:512`) ← `getApi()` . Otros: `Tour`, `Sheet`, `LangPicker`, `AdminCode`, `Icon`. (`SeasonChart` ahora en `$ui/title/`.)

## Trampas
- `TYPICAL_MBPS` y `level` siguen al desktop: `packages/ui/src/rank.ts:20`, `packages/ui/src/sub-match.ts:16`, `crates/core/src/subtitles.rs`.
- Si cambia el formato de una respuesta, subir su versión en `saved.ts:11 V`.
- Textos siempre `t('texto en español')` + traducción en `packages/ui/src/i18n/en.ts`.
- Una sola regla de audio latino: `packages/ui/src/audio.ts`.
- No importa de `server/` salvo `import type` (`types.ts`).

## Tests
`i18n/i18n.test.ts`, `web-adapt.test.ts` junto al código; ranking/audio/format: `packages/ui/src/*.test.ts`.
