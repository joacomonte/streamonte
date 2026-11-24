# web/src/lib — librería del cliente (navegador + SSR)
Tipos, ranking puro, caché de navegador, i18n y componentes Svelte 5. Lo que toca TMDB/TorBox/DB está en `/Users/monti/Documents/Dev/streamonte/web/src/lib/server/CLAUDE.md`.

## Mapa
- `types.ts` — `Torrent` · `Sub` · `Ident` · `Title` · `SeasonScore` · `ApiError`.
- `webApi.ts` — `createWebApi` · `webApi` (único `Api` de la web, con caché de catálogo/ejemplos de subgéneros; se fija en `routes/+layout.svelte`) → `web-adapt.ts` (`catalogItem` `titleDetails` `option` `readLines` `optionsUpdates` `premiumResults`) · ← `packages/ui/src/api.ts` (`Api`).
- Ranking, audio, formatos, `onlyCinema` ← `/Users/monti/Documents/Dev/streamonte/packages/ui/src/` (`rank.ts` `sub-match.ts` `audio.ts` `format.ts`); `Torrents.svelte` los importa por `$ui`.
- `saved.ts` — caché localStorage con TTL: `V` · `get` · `put` · `json` · `recall` · `remember` · `wipe`.
- `catalog.svelte.ts` `webCatalog` (store a nivel módulo sobre `webApi`) → `$ui/catalog/catalog.svelte.ts`, `webApi.ts`, `saved.ts` · ← `routes/+page.svelte`, `routes/t/[kind]/[id]/+page.svelte` (`pickPerson`), `langs.ts` (`relang`).
- `i18n.svelte.ts` — `i18n` · `t` · `loc` · `contentKey` · `setLang` · `setTitles`. `i18n/translate.ts` — re-exporta `translate` `locale` de `packages/ui/src/i18n/translate.ts` · `pickLang(s)`; diccionario ← `packages/ui/src/i18n/en.ts`.
- `nick.ts saveNick` · `track.ts track` (sendBeacon → `/api/track`) · `langs.ts langOptions` (→ `catalog.svelte.ts:webCatalog().relang`; ← `+layout.svelte`, `ajustes/+page.svelte`). Icon/Sheet/LangPicker/Tour/tours viven en `packages/ui/src/components/` (import `$ui/components/…`).
- `Torrents.svelte` (~1000 líneas) — datos por `getApi()`: `ref` · `$effect` → `$ui/options/options-load.ts loadOptions` (`options.load` ← `/api/torrents`, caché 1 h `saved.ts` clave `options:<video>`) · `step` · `linkOf` (`options.link` ← `/api/link`) · `probe` (`options.tracks` ← `/api/tracks`) · `rowOf` → `<OptionsList>` (`$ui/options/`, la misma lista que el desktop) · `<SubsPicker>` (`$ui/subs/`; `copySub` `copyPremium`). Otros: `Tour` (ayuda de subs, `castSteps`), `CastVideo`, `Sheet`, `LangPicker`, `AdminCode`, `Icon`. Hoja `#copied-sheet` (tras "En la tele"): dibujo + `#watch-tutorial` → paso 2 "Bajá Web Video Caster" (`#get-app-ios`/`#get-app-android`, `#get-app-skip`) → `CastVideo`.
- `CastVideo.svelte` — tutorial de Web Video Caster tipo historia (6 pantallas dibujadas en HTML/CSS, 2,5 s c/u = 15 s, `SCENE_MS`; tocar izq/der navega; cartel final con link a la tienda vía `$ui/components/tours.ts casterFor`) · ← `Torrents.svelte` (`#watch-tutorial`, `#toast-tutorial`).

## Trampas
- `TYPICAL_MBPS` y `level` siguen al desktop: `packages/ui/src/rank.ts`, `packages/ui/src/sub-match.ts`, `crates/core/src/subtitles.rs`.
- Si cambia el formato de una respuesta, subir su versión en `saved.ts V`.
- Textos siempre `t('texto en español')` + traducción en `packages/ui/src/i18n/en.ts`.
- Una sola regla de audio latino: `packages/ui/src/latino.ts`.
- No importa de `server/` salvo `import type` (`types.ts`).

## Tests
`i18n/i18n.test.ts`, `web-adapt.test.ts` junto al código; ranking/audio/format: `packages/ui/src/*.test.ts`.
