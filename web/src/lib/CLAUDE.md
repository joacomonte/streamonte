# web/src/lib — librería del cliente (navegador + SSR)
Tipos, ranking puro, caché de navegador, i18n y componentes Svelte 5. Lo que toca TMDB/TorBox/DB está en `/Users/monti/Documents/Dev/streamonte/web/src/lib/server/CLAUDE.md`.

## Mapa
- `types.ts` — `:4 Torrent` · `:21 Sub` · `:35 Ident` · `:50 Title` · `:55 SeasonScore` · `:58 ApiError`.
- `webApi.ts` — `:17 createWebApi` · `:93 webApi` (único `Api` de la web, con caché de catálogo/géneros; se fija en `routes/+layout.svelte:19`) → `web-adapt.ts` (`:13 catalogItem` `:29 titleDetails` `:71 option` `:130 readLines` `:147 optionsUpdates` `:113 premiumResults`) · ← `packages/ui/src/api.ts` (`Api`).
- Ranking, audio, formatos, `onlyCinema` ← `/Users/monti/Documents/Dev/streamonte/packages/ui/src/` (`rank.ts` `sub-match.ts` `audio.ts` `format.ts`); `Torrents.svelte` los importa por `$ui`.
- `saved.ts` — caché localStorage con TTL: `:11 V` · `:21 get` · `:32 put` · `:56 json` · `:70 recall` · `:77 remember` · `:87 wipe`.
- `catalog.svelte.ts` `:17 webCatalog` (store a nivel módulo sobre `webApi`) → `$ui/catalog/catalog.svelte.ts`, `webApi.ts`, `saved.ts` · ← `routes/+page.svelte`, `routes/t/[kind]/[id]/+page.svelte` (`pickPerson`), `langs.ts` (`relang`).
- `i18n.svelte.ts` — `:17 i18n` · `:20 t` · `:22 loc` · `:24 contentKey` · `:31 setLang` · `:39 setTitles`. `i18n/translate.ts` — re-exporta `translate` `locale` de `packages/ui/src/i18n/translate.ts` · `pickLang(s)`; diccionario ← `packages/ui/src/i18n/en.ts`.
- `nick.ts:19 saveNick` · `track.ts:2 track` (sendBeacon → `/api/track`) · `langs.ts:6 langOptions` (→ `catalog.svelte.ts:webCatalog().relang`; ← `+layout.svelte`, `ajustes/+page.svelte`). Icon/Sheet/LangPicker/Tour/tours viven en `packages/ui/src/components/` (import `$ui/components/…`).
- `Torrents.svelte` (1133 líneas) — datos por `getApi()`: `:52 ref` · `$effect` → `$ui/options/options-load.ts loadOptions` (`options.load` ← `/api/torrents`, caché 1 h `saved.ts` clave `options:<video>`) · `:193 step` · `:302 linkOf` (`options.link` ← `/api/link`) · `:331 probe` (`options.tracks` ← `/api/tracks`) · `:346 rowOf` → `<OptionsList> :727` (`$ui/options/`, la misma lista que el desktop) · `<SubsPicker> :766` (`$ui/subs/`; `copySub:481` `copyPremium:503`). Otros: `Tour` (ayuda de subs, `castSteps`), `CastVideo`, `Sheet`, `LangPicker`, `AdminCode`, `Icon`. Hoja `#copied-sheet` (tras "En la tele"): solo dibujo + `#watch-tutorial` → `CastVideo`. Casteo nativo: `#where-cast` (solo si el navegador tiene `video.remote`/AirPlay; `askWhere` abre la hoja también con `.m3u8`) → `castNative` (`remote.prompt()` o `webkitShowPlaybackTargetPicker` sobre el `<video hidden>`) → al conectar `#cast-sheet` "Reproduciendo en la tele" + `#cast-stop`; si falla, mensaje y queda `#where-wvc`.
- `CastVideo.svelte` — tutorial de Web Video Caster tipo historia (6 pantallas dibujadas en HTML/CSS, 2,5 s c/u = 15 s, `SCENE_MS`; tocar izq/der navega; cartel final con link a la tienda vía `$ui/components/tours.ts casterFor`) · ← `Torrents.svelte` (`#watch-tutorial`, `#toast-tutorial`).

## Trampas
- `TYPICAL_MBPS` y `level` siguen al desktop: `packages/ui/src/rank.ts:20`, `packages/ui/src/sub-match.ts:16`, `crates/core/src/subtitles.rs`.
- Si cambia el formato de una respuesta, subir su versión en `saved.ts:11 V`.
- Textos siempre `t('texto en español')` + traducción en `packages/ui/src/i18n/en.ts`.
- Una sola regla de audio latino: `packages/ui/src/audio.ts`.
- No importa de `server/` salvo `import type` (`types.ts`).

## Tests
`i18n/i18n.test.ts`, `web-adapt.test.ts` junto al código; ranking/audio/format: `packages/ui/src/*.test.ts`.
