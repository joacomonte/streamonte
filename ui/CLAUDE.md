# ui — UI del escritorio (webview de Tauri)
JS vanilla `// @ts-check` + JSDoc, migrando a Svelte 5 + TS por "islas". Habla con el core SOLO vía `api.js` → comandos Tauri (ver `/Users/monti/Documents/Dev/streamonte/src-tauri/CLAUDE.md`).

## Mapa
- `/Users/monti/Documents/Dev/streamonte/ui/index.html`: shell estático (`#catalog`, `#dlg-settings`); carga `/src/main.ts` (:9). `src/main.ts` importa `app.js` + `catalog.js` y monta `Island.svelte` (vacía) en `#svelte-root`.
- `vite.config.ts`: puerto 1420 `strictPort` (= `devUrl` de tauri.conf.json), `outDir dist`. `deno.json`: `checkJs`, `strict`, tipos `src/globals.d.ts`. `TYPING.md`: convenciones.
- `styles.css` (704): tokens `:root`, topbar, diálogos/Ajustes · `catalog.css` (1143): grilla, panel lateral `.catalog.side-open` (:5), filas de opción. Secciones por comentario `/* … */`.
- En `/Users/monti/Documents/Dev/streamonte/ui/src/`:
- `api.js:28` `api` (espejo 1:1 de commands.rs) · `:23` `invoke` (dispara `streamonte:torbox-code`) · `:230` `onCoreEvent`. `types.js`: solo `@typedef` (serde del core + `CoreEvent`).
- `state.js:10` `state` · `:35` `entryOfHash` · `:49` `titleOf`.
- `app.js`: `init:106` `onShortcut:23` `onEvent:34` (despacho de `CoreEvent`) · `onCoreEvent(onEvent):138`.
- `catalog.js` (1025): `search:85` `renderResults:345` `loadMore:489` `renderBrowse:899` `render:923` · listener de eventos :996-1005.
- `catalog-state.js`: `showError:11` `safeGet:15` `state:39` `view:57` (sin imports del catálogo).
- `catalog-side.js`: panel derecho `openSide:42` `closeSide:79` `goSeason:91` `renderSide:140`.
- `catalog-options.js` (1312): `loadStreams:171` `onStreams:198` `sortOptions:245` `loadTorbox:317` `groupPanel:519` · bajar de fondo `api.playBackground:812` · ▶ `api.playTorbox:1286`/`api.play:1287`.
- `options-rank.js` (puro, con test): `latOf:25` `qualityRank:82` `healthOf:102` `rankOptions:142`.
- `catalog-flow.js`: `newFlow:30` `flowFilter:88` `cancelFlowWork:184` `flowStep:250`.
- `catalog-tests.js`: `toggleBest:87` `runCensus:186` `runQuick:261` `runDeep:395` `onSwarmEvent:431`.
- `catalog-subs.js`: `subsProgress:44` `readSubsNow:137` `subsStep:253` `openSubs:265`.
- `catalog-magnet.js:27` `openMagnet` · `magnet-hash.js:9` `magnetHash` (puro).
- `audio-picker.js`: `closeWizard:53` `openWizard:125` `originalAudio:165` `play:223`.
- `dialogs.js`: `confirmDialog:15` `cleanTemp:69` `openSettings:211` `saveKey:319` `onConfirmClose:353`.
- `top-menus.js`: `refreshCopied:63` `playCopied:73` `toggleDownloads:168`.
- `activity.js:329` `activity` · `activity-feed.js`: `renderActivity:13` `logEvent:37`.
- `speed.js`: `onSpeedEvent:208` `initSpeed:215` · `health-calib.js` (con test): `learnBias:131` `predict:184` `trackPlayback:274` `incomingStatus:376`.
- `welcome.js`: `isTouring:17` `openWelcome:64` · `lang-picker.js`: `langPicker:15` `langToggle:34` (cambiar idioma recarga) · `updater.js:8` (plugin updater).
- `dom.js`: `el:35` `icon:98` `setStatus:106` `showError:114` · `format.js`: `humanBytes:8` `mbps:16` `ago:41` `playbackText:51` · `season.js` (puro) · `tooltip.js` (se instala solo) · `i18n.js`: `t:18` `translateStatic:37` · `i18n-en.js` · `test-stub.js` (stub de webview, no es test).

## Flujo
- Búsqueda: `catalog.js:85` `search` → `api.js:116` `catalogSearch` → `commands.rs:435` → `AppCore::catalog_search` (`crates/core/src/app.rs:1375`) → `state.results` → `render`.
- Torrents: `catalog-options.js:171` `loadStreams` → `api.js:158` `catalogStreams` → `commands.rs:460` → `app.rs:1539` → evento `catalog-streams` → `catalog.js:998` → `onStreams`; swarm/census → `catalog-swarm-*` → `onSwarmEvent`.
- Reproducir: `audio-picker.js:223` `play` → `api.play` → evento `playback-updated` → `app.js:69` → `state.playbacks`; `app.js` avisa con CustomEvent `playback-changed` y `catalog.js:980` lo escucha.
- Cierre: evento `confirm-close` → `app.js:66` → `dialogs.js:353` `onConfirmClose` → `api` `on_close`.

## Trampas
- `src/mock-tauri.ts`: sin `__TAURI__` (Vite en el navegador) instala un invoke que responde con `ui/mock/<cmd>__<args>.json` (slug igual a `crates/core/examples/record_fixtures.rs`); comando sin fixture → `console.warn('[mock] sin fixture')`. Por eso `main.ts` importa `app.js`/`catalog.js` dinámicamente, después del mock.
- Comando nuevo: `api.js` + typedef en `types.js` (+ commands.rs y lib.rs). `api.xxxYyy` ↔ `xxx_yyy`. Campos serde en snake_case, enums kebab-case.
- Único canal `core://event`; listeners: `app.js:138` y `catalog.js:996`. `window.__TAURI__` solo en `api.js:18` y `updater.js:8`; la CSP no permite red desde la UI.
- `catalog-state.js` no importa otros módulos del catálogo (ciclos). `activity.js` usa `document.querySelector` a propósito (ciclo con `dom.js`).
- Lógica pura (sin DOM) en `options-rank.js`/`season.js`/`magnet-hash.js` para testearla.
- i18n: la clave es el texto en español en `t('…')`/`tr()`; texto nuevo → agregar a `i18n-en.js` (`i18n-keys.test.js` falla si falta o cambian placeholders; neutros en `NEUTRAL:11`).
- Puerto 1420 fijo: si está ocupado Vite falla.
- Tests que importan i18n/format/api: `import './test-stub.js'` PRIMERO.

## Tests
`deno test --no-check --allow-read --config ui/deno.json ui/src`; chequeo rápido `sh scripts/check.sh` (full suma tests); Svelte/TS: `cd /Users/monti/Documents/Dev/streamonte/ui && npm run check`. Dev: `deno run -A npm:vite` + `cargo run -p streamonte`.
