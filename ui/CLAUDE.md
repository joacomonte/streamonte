# ui — UI del escritorio (webview de Tauri)
JS vanilla `// @ts-check` + JSDoc, migrando a Svelte 5 + TS por "islas". Habla con el core SOLO vía `api.js` → comandos Tauri (ver `/Users/monti/Documents/Dev/streamonte/src-tauri/CLAUDE.md`).

## Mapa
- `/Users/monti/Documents/Dev/streamonte/ui/index.html`: shell estático (`#catalog`; Ajustes/log/confirmación son Svelte, `components/Settings.svelte`…); carga `/src/main.ts` (:9). `src/main.ts` importa `app.js` + `catalog.js` (+ `catalog-mount.ts`) y monta `Island.svelte` (vacía) en `#svelte-root`.
- `vite.config.ts`: alias `$ui` → `/Users/monti/Documents/Dev/streamonte/packages/ui/src`, `fs.allow ..`; puerto 1420 `strictPort` (= `devUrl` de tauri.conf.json), `outDir dist`. `tsconfig.js.json`: paths `$ui`, `checkJs`, `strict`, tipos `src/globals.d.ts` (tsc de los `src/*.js`); `.oxlintrc.json`: oxlint (browser, no-undef). `TYPING.md`: convenciones.
- `styles.css` (704): tokens `:root`, topbar, diálogos/Ajustes · `catalog.css` (~800): tokens que faltan al catálogo compartido, panel lateral `.catalog.side-open` (:5), filas de opción. Secciones por comentario `/* … */`.
- En `/Users/monti/Documents/Dev/streamonte/ui/src/`:
- `tauriApi.ts:20 createTauriApi` · `:142 createDesktopApi` (único: lo crea `main.ts:30`) → `api.js`, `tauri-adapt.ts` (`kindOf:11` `titleDetails:47` `optionsUpdate:126` `apiEvent:185`) · ← `packages/ui/src/api.ts` (`Api`). `types.d.ts`: tipos serde (antes `types.js`).
- `api.js:47` `api` (espejo 1:1 de commands.rs) · `:23` `invoke` (dispara `streamonte:torbox-code`) · `:32 once` (`catalogMeta`/`catalogDetails`: una invocación por título; `forgetTitles` ← `catalog.js`) · `onCoreEvent`. `types.d.ts` (serde del core + `CoreEvent`).
- `live.ts` (puro, con test): `Live:6` `reduce:26` `loaded:46` `titleOf:64` · `live.svelte.ts`: `live:13` (`$state.raw`) `activityLog:35` `activity:55` `startLive:59` (única suscripción de app.js) → `live.ts`, `activity-feed.ts` · ← `state.js` (fachada `state`/`titleOf` para audio-picker, dialog-flows, catalog-options, speed), `components/{CopiedMagnet,Downloads,Activity}.svelte` (← `main.ts`).
- `app.js`: `onShortcut:21` `onEvent:33` (lo no migrado; recibe `prev`) · `startLive(onEvent):83`.
- `catalog.js`: lo que queda del catálogo en JS — `pickPerson:34` `pasteMagnet` `askTmdbKey` `setPastedHost:126` `refreshPasted:128` `openSources` · listener de eventos del núcleo en `init`. Grilla/filtros/buscador = `packages/ui/src/catalog/` montado por `catalog-mount.ts:17 mountCatalog(api)` (→ `catalog-side.js:openSide`; ← `main.ts:32`). `catalog-store.test.ts` (fixtures `mock/`).
- `catalog-state.js`: `showError` `safeGet` `state` (`side` con gancho `hooks.side` → `catalog-mount.ts`) `view` (sin imports del catálogo).
- `catalog-side.js`: dueño de `state.side` — `openSide:42` `closeSide:76` `goSeason:88` `renderSide:107` (→ `side-panel.svelte.ts`) · `Object.assign(actions):119` · ← `catalog-mount.ts`, `catalog-magnet.js`, `catalog-options.ts`.
- `side-panel.svelte.ts` `panel` `actions` (puente JS↔Svelte) · `SidePanel.svelte` (cerrar, migas, `#cat-streams`) → `$ui/title/TitleView.svelte` · montado en `#cat-side` por `main.ts` con el mismo `Api`.
- `catalog-options.ts`: `loadStreams:122` `onStreams:150` `sortOptions:180` `loadTorbox:237` `groupPanel:406` `startBg:625` `rowView:669` `playButtons:759` `renderStreamsOnly:822` (arma la vista + FLIP) `streamsView:933` `playOption:1025` → `options-logic.ts`, `streams-panel.svelte.ts`, fila `$ui/options/row.ts` · ← `catalog.js`, `catalog-side.js`, `app.js`.
- `streams-panel.svelte.ts` `showStreams:17` (monta `StreamsPanel.svelte` en `#cat-streams`) `openCtxMenu:35` (`CtxMenu.svelte`) · modelo de vista `streams-view.ts` · `StreamsPanel.svelte` → `GroupPanel.svelte`, `FlowScreen.svelte`, `Crumbs.svelte`, `MoreRow.svelte`, `$ui/options/OptionsList.svelte` · ← `catalog-options.ts`.
- `catalog-flow.ts`: `newFlow:36` `flowFilter:82` `cancelFlowWork:174` `crumbs:218` `flowStep:236` (→ `FlowView`) `moreRow:409` · ← `catalog-options.ts`, `catalog-tests.ts`.
- `catalog-tests.ts` (estado de pruebas en módulo): `startAnalysis:75` `toggleBest:94` `runCensus:182` `runQuick:234` `runDeep:369` `onSwarmEvent:407` · `options-logic.ts` (puro, test `options-logic.test.ts` con `mock/`): `quickGroupOf` `seedsOf` `fileBytesOf` `playbackFor` `pinActive` `topFinalists`.
- `catalog-subs.js`: `subsProgress:34` `readTracks:64` `readSubsNow:119` `subsStep:198` `openSubs:211` → `mount-shared.ts`, `SubsStep.svelte` (→ `packages/ui/src/subs/SubsPicker.svelte`).
- `catalog-magnet.js:18` `openMagnet` → `mount-shared.ts` `mountMagnet` (→ `packages/ui/src/magnet/MagnetView.svelte`) · `magnetHash` ← `packages/ui/src/magnet-hash.ts`.
- `mount-shared.ts` `mountSubsStep` `mountMagnet` `provideApi:11` (lo llama `main.ts:31`) → `packages/ui/src/context.ts` `apiContext` · ← `catalog-subs.js`, `catalog-magnet.js`.
- `audio-picker.js`: `closeWizard:53` `openWizard:125` `originalAudio:165` `play:223`.
- `dialogs.js` (fachada) → `dialog-flows.ts` (`askAfterClose` `openLog` `cleanTemp` `clearDataCache` `stopAllAndClean` `onConfirmClose`), `confirm-queue.ts` (`confirmDialog` + cola), `ui-host.ts` (`host`: `openSettings` `openLog` `showSpeedPanel`) · ← `app.js` `top-menus.js` `catalog*.js`.
- `components/`: `Dialogs.svelte` (monta `Settings` `LogDialog` `ConfirmDialog`; `main.ts` lo monta ANTES de `app.js`) · `Settings.svelte` → `settings-model.ts` (con test) → `desktopApi.ts` (`DesktopApi`/`desktop`: comandos solo desktop, no están en `Api`).
- `top-menus.js`: `togglePop` `popFor` `closePop` (popover de speed.js; ← `components/Downloads.svelte` lo cierra).
- `activity.js` (re-export de `activity` para dom.js/audio-picker.js) · `activity-feed.ts` (puro, con test): `mergeLine:33` `busyText:50` `eventLines:70`.
- `speed.js`: `onSpeedEvent` `initSpeed` → `speed-instance.ts` → `speed-store.ts` + `speed-model.ts` (con test) · `components/SpeedButton.svelte` `SpeedPanel.svelte` `Gauge.svelte` · `health-store.ts` (localStorage + red; cuentas en `$ui/options/health.ts`): `setLinkMbps` `healthCalibration` `trackPlayback` `speedOf` `notePrediction` `incomingStatus`.
- `Welcome.svelte` (Tour compartido, pasos del desktop) · `welcome-state.js`: `isTouring` `setTouring` `STORE` (← `catalog.js`) · `SettingsLang.svelte` (LangPicker compartido en `#set-lang-picker`) · `lang-picker.js`: `langToggle` (cambiar idioma recarga) · `updater.js:8` (plugin updater).
- `dom.js`: `el:35` `icon` (paths ← `packages/ui/src/components/icons.ts`) `setStatus:106` `showError:114` · `format.js`: `playbackText:8` (resto ← `packages/ui/src/format.ts`) · `season` ← `packages/ui/src/season.ts` · `tooltip.js` (se instala solo) · `i18n.js`: `t` `translateStatic` (diccionario ← `packages/ui/src/i18n/en.ts`) · `test-stub.js` (stub de webview, no es test).

## Flujo
- Búsqueda: `catalog.js:85` `search` → `api.js:116` `catalogSearch` → `commands.rs:435` → `AppCore::catalog_search` (`crates/core/src/app.rs:1375`) → `state.results` → `render`.
- Torrents: `catalog-options.ts:122` `loadStreams` → `api.js:158` `catalogStreams` → `commands.rs:460` → `app.rs:1539` → evento `catalog-streams` → `catalog.js:998` → `onStreams`; swarm/census → `catalog-swarm-*` → `onSwarmEvent`.
- Reproducir: `audio-picker.js:223` `play` → `api.play` → evento `playback-updated` → `live.svelte.ts:59` → `live.v.playbacks` → `app.js:33`; `app.js` avisa con CustomEvent `playback-changed` y `catalog.js:980` lo escucha.
- Cierre: evento `confirm-close` → `app.js:66` → `dialog-flows.ts` `onConfirmClose` → `api` `on_close`.

## Trampas
- `src/mock-tauri.ts`: sin `__TAURI__` (Vite en el navegador) instala un invoke que responde con `ui/mock/<cmd>__<args>.json` (slug igual a `crates/core/examples/record_fixtures.rs`); con id de título (`tt…`) responde SOLO la fixture de ese id (sin fixture → default/null + `console.warn('[mock] sin fixture')`, nunca la de otro título); sin id (página, búsqueda) cae a la primera `<cmd>__*`. `catalog_streams` reproduce `ui/mock/events__catalog_streams__<slug>.json` por `core://event` (secuencia progresiva de ≤6 eventos, uno cada 500 ms; grabada SIN la caché de 1 h: `record_fixtures` usa carpetas temporales con la config real; solo streams; swarm/censo/velocidad/playback sin mock; `?live` emite una fila + una descarga de fondo). Por eso `main.ts` importa `app.js`/`catalog.js` dinámicamente, después del mock.
- Comando nuevo: `api.js` + tipo en `types.d.ts` (+ commands.rs y lib.rs). `api.xxxYyy` ↔ `xxx_yyy`. Campos serde en snake_case, enums kebab-case.
- Único canal `core://event`; listeners: `live.svelte.ts:59` y `catalog.js:996`. `window.__TAURI__` solo en `api.js:18` y `updater.js:8`; la CSP no permite red desde la UI.
- `catalog-state.js` no importa otros módulos del catálogo (ciclos).
- Lógica pura (sin DOM) en `packages/ui/src/`; los JS que prueba `node --test` importan `packages/ui` por ruta relativa, el resto por `$ui`.
- i18n: texto nuevo → `packages/ui/src/i18n/en.ts` (`packages/ui/src/i18n/i18n.test.ts` falla si falta; neutros en `NEUTRAL`).
- Puerto 1420 fijo: si está ocupado Vite falla.
- Tests que importan i18n/format/api: `import './test-stub.js'` PRIMERO.

## Tests
`cd /Users/monti/Documents/Dev/streamonte/ui && npm test` (`node --test`); `npm run lint` (oxlint); `npm run check` (svelte-check + tsc de los JS); `sh scripts/check.sh` (full suma tests). Dev: `npm run dev` + `cargo run -p streamonte`.
