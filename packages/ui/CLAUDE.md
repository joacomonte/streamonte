# packages/ui — código compartido web ↔ desktop (TS estricto, sin `any`)
Base `/Users/monti/Documents/Dev/streamonte/packages/ui/` · alias `$ui` → `src/` (web: `/Users/monti/Documents/Dev/streamonte/web/vite.config.ts`, desktop: `/Users/monti/Documents/Dev/streamonte/ui/vite.config.ts`) · sin node_modules (usa los de `ui/`) · `npm run check` · `npm test`.
Imports internos relativos con `.ts`. Los `.ts` que prueba `node --test` se importan por ruta relativa, no `$ui`.

## `src/` (→ usa · ← usado por)
- `types.ts` `:4 Kind` `:11 CatalogItem` `:65 TitleDetails` `:99 TorrentOption` `:134 OptionsUpdate` `:150 SubtitleOption` `:172 Capabilities` `:184 ApiEvent` · ← todo.
- `api.ts` `:11 Api` → `types.ts` · ← `webApi.ts` (web), `tauriApi.ts` (desktop), `context.ts`.
- `context.ts` `:7 setApi` `:9 getApi` → `api.ts`, `svelte` · ← raíz de cada app (T2).
- `format.ts` `:5 humanBytes` `:12 mbps` `:19 mb` `:25 clock` `:34 ago` `:47 onlyCinema` → `i18n/runtime.ts` · ← desktop (`ui/src/*.js`), web (`routes/+page.svelte`, `routes/t/[kind]/[id]/+page.svelte`).
- `season.ts` `:14 seasonTone` `:17 seasonTrend` `:29 barHeight` `:38 seasonOutlook` → `types.ts` · ← `title/title-state.ts`, `ui/src/catalog-side.js`.
- `title/TitleView.svelte` (ficha única) → `context.ts` (`getApi().title.*`), `SeasonChart.svelte`, `title-state.ts`, `components/Icon.svelte` · ← `web/src/routes/t/[kind]/[id]/+page.svelte`, `ui/src/SidePanel.svelte`. Props: `details?` `season` `episode` `onSeason` `onEpisode` `onPerson` `onOpenTitle` `options` (snippet torrents) `between` `teaser` `ids`.
- `title/SeasonChart.svelte` → `title-state.ts:43 chartModel` · ← `TitleView.svelte`.
- `title/title-state.ts` `:12 pickPeople` `:19 providerView` `:26 seasonTiles` `:34 outlookOf` `:43 chartModel` `:59 episodeRows` `:62 showCineNote` `:83 WEB_IDS` `:88 DESKTOP_IDS` → `season.ts`, `format.ts` · test `title/title-state.test.ts` (fixtures `ui/mock/`).
- `rank.ts` `:17 QUALITY_STARS` `:20 TYPICAL_MBPS` `:25 mbpsOf` `:29 neededBps` `:37 optionMbps` `:44 byQuality` `:60 hintOf` `:71 latOf` `:84 tierOf` `:113 rankOptions` → `types.ts` · ← `web/src/lib/Torrents.svelte`, `ui/src/catalog-options.ts`, `ui/src/tauri-adapt.ts`.
- `options/` — lista de opciones de torrents (web ↔ desktop; CSS `packages/ui/css/options.css`):
  - `OptionsList.svelte` (`rows` por hash) → `OptionRow.svelte` (`row`) → `since.ts` `:6 since`, `components/Icon.svelte` · ← `web/src/lib/Torrents.svelte`, `ui/src/StreamsPanel.svelte`, `ui/src/FlowScreen.svelte`.
  - `row.ts` `:58 OptionRowView` (`Mid`/`Action` desktop-only = `capabilities.speedTests`) `:83 RES_ORDER` `:101 qualityOf` `:117 TipBook` `:174 langTags` `:196 sizeText` → `audio.ts`, `rank.ts` · ← `ui/src/catalog-options.ts`, `Torrents.svelte`.
  - `options-load.ts` `:20 applyUpdate` `:32 loadOptions` → `getApi().options.load` · ← `Torrents.svelte`.
  - `health.ts` (salud estimada, puro) `:131 rawPrediction` `:154 learnBias` `:201 predict` `:210 shownLevel` `:219 fidelity` `:268 calibration` `:305 healthOf` · ← `ui/src/health-store.ts`, `ui/src/catalog-options.ts`; tipos re-exportados en `ui/src/types.d.ts`.
  - tests `options/options.test.ts` (fixture `ui/mock/events__catalog_streams__*`), `options/health.test.ts`.
- `sub-match.ts` `:9 sourceOf` `:13 groupOf` `:16 level` `:28 rank` · ← `web/src/lib/Torrents.svelte`.
- `audio.ts` `:13 audioOf` `:23 latStatus` `:30 LAT_BADGE` → `types.ts` · ← `web/src/lib/Torrents.svelte`.
- `magnet-hash.ts` `:4 magnetHash` · ← `ui/src/catalog-magnet.js`.
- `context.ts` `:16 apiContext` (mount desde JS) · ← `ui/src/mount-shared.ts`.
- `subs/` — `SubsPicker.svelte` (`ref` `option` `file` `match` `lead` `actions` `onUse`) → `subs-flow.ts` `:25 SubsFlow` · `subs-logic.ts` `:11 rankSubs` `srcOf` `timingOf` `noFitText` `keyOf` · `SubRow.svelte` → `components/Icon.svelte`, `getApi().subs/.premium` · ← `web/src/lib/Torrents.svelte`, `ui/src/SubsStep.svelte` · test `subs/subs.test.ts`.
- `magnet/` — `MagnetView.svelte` (`hash` `name` `titleHref`|`onTitle` `ready`) → `magnet-flow.ts` `:9 MagnetFlow` · `magnet-logic.ts` `:15 magnetTitle` `getApi().magnet` · ← `web/src/routes/m/[hash]/+page.svelte`, `ui/src/catalog-magnet.js` (vía `mount-shared.ts`) · test `magnet/magnet.test.ts`.
- `i18n/en.ts` (diccionario único es→en) · ← `i18n/translate.ts`.
- `i18n/translate.ts` `:8 translate` `:14 locale` → `en.ts` · ← `web/src/lib/i18n/translate.ts`, `ui/src/i18n.js`.
- `i18n/runtime.ts` `:9 setTranslator` `:10 t` → `translate.ts` · ← `format.ts`; fijado por `web/src/lib/i18n.svelte.ts`, `ui/src/i18n.js`.
- `components/` (compartidos web ↔ desktop; sin `$app`/Tauri):
  - `icons.ts` `:3 ICONS` `IconName` · ← `Icon.svelte`, `ui/src/dom.js:icon`.
  - `Icon.svelte` · `Sheet.svelte` (`<dialog>`) · `LangPicker.svelte` (`onpick`; `flags`) → `icons.ts`, `i18n/runtime.ts`.
  - `Tour.svelte` (`index` bindable, `onnick`, `langs`, snippet `extra`) → `tour-state.ts` (`guardStep` `resumeIndex` `Step` `LangOptions`), `LangPicker.svelte` · ← `web/src/routes/+layout.svelte`, `web/src/lib/Torrents.svelte`, `ui/src/Welcome.svelte`.
  - `tours.ts` `welcomeSteps` `castSteps` `device` `seen` `markSeen` → `tour-state.ts` · ← web.
- `catalog/` (catálogo compartido):
  - `filters.ts` `:46 toBrowse` `:62 parseSaved` (`KINDS` `SORTS` `LANGS` `VOTES` `BACK` `backLabel` `changedCount`) → `types.ts` · ← `store.ts`, `Since.svelte`, `Catalog.svelte`.
  - `store.ts` `:53 initialState` `:69 createCatalog` (estado + acciones, sin Svelte) → `api.ts`, `filters.ts` · ← `catalog.svelte.ts`, `ui/src/catalog-store.test.ts`.
  - `catalog.svelte.ts` `:8 createCatalogStore` (`$state` + `store.ts`) · ← `web/src/lib/catalog.svelte.ts`, `ui/src/catalog-mount.ts`.
  - `Catalog.svelte` (props `store` `onopen` `href` `header` `top` `onmagnet` `onlog` `pinned` `cardMin`) → `Search` `Segmented` `Since` `Grid` `FiltersSheet` · ← `web/src/routes/+page.svelte`, `ui/src/catalog-mount.ts`.
  - `CardInfo.svelte` (hover de la tarjeta: géneros, duración, categoría, premios, barras de temporada; lo monta `Grid.svelte` tras 250 ms con mouse) → `card-info.ts` `:25 ratingTier` `:32 cardMeta` `:38 cardSeasons` (test `card-info.test.ts`, fixtures `ui/mock/`), `getApi().title.details/seasonRatings(imdb, quick)`; `Grid.svelte` reintenta el póster roto con `getApi().catalog.poster` (web: null).
  - `Search.svelte` · `Segmented.svelte` · `Since.svelte` · `Grid.svelte` · `FiltersSheet.svelte` → `components/Icon.svelte`, `components/Sheet.svelte`.
- `globals.d.ts` tipos mínimos `node:test`, `node:assert/strict`, `node:fs` (sin @types/node).
- Tests junto al código: `*.test.ts`; `i18n/i18n.test.ts` escanea `web/src`, `ui/src`, `packages/ui/src` y `ui/index.html`.
