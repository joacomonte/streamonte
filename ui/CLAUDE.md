# ui — UI del escritorio (webview de Tauri)
~8.8k líneas JS vanilla con `// @ts-check` + JSDoc (sin framework), migrando a Svelte 5 + TS por "islas". Habla con el core SOLO vía `api.js` → comandos Tauri (ver `/Users/monti/Documents/Dev/streamonte/src-tauri/CLAUDE.md`).

## Mapa — build / migración
- `/Users/monti/Documents/Dev/streamonte/ui/index.html`: shell estático (topbar, `#catalog`, diálogos `#dlg-settings` etc.); carga `/src/main.ts` (:9) y los 2 CSS. Textos fijos los traduce `translateStatic`.
- `/Users/monti/Documents/Dev/streamonte/ui/src/main.ts:2`: importa `app.js` + `catalog.js` (efectos de módulo) y `mount(Island)` en `#svelte-root` (:10). `src/Island.svelte`: isla vacía (etapa 0).
- `/Users/monti/Documents/Dev/streamonte/ui/vite.config.ts`: plugin svelte (runes), puerto 1420 `strictPort` host 127.0.0.1 (= `devUrl` de tauri.conf.json), `outDir dist`, target safari15. `package.json`: svelte/vite/svelte-check (`npm run check`).
- `/Users/monti/Documents/Dev/streamonte/ui/deno.json`: lib dom+deno.ns, `checkJs`, `strict`, `types: src/globals.d.ts` (tipa `window.__TAURI__`). `TYPING.md`: convenciones de tipado.

## Mapa — src/ (una línea por archivo)
- `api.js:28` `api` (77 `invoke`, espejo 1:1 de commands.rs; `invoke` wrapper :20 dispara `streamonte:torbox-code`) · `:230` `onCoreEvent` (escucha `core://event`).
- `types.js`: solo `@typedef` (formas serde del core + `CoreEvent`); append-only.
- `state.js:10` `state` global (biblioteca, playbacks, análisis) · `:35` `entryOfHash` · `:49` `titleOf`.
- `app.js`: arranque `init:106`, atajos `onShortcut:23`, despacho de eventos `onEvent:34` (status, speed-test, analyzer-*, library-*, confirm-close, playback-*), `onCoreEvent(onEvent):138`.
- `catalog.js` (1025): Buscar/Explorar/filtros. `search:85` `render:923` `renderResults:345` `renderBrowse:899` `loadMore:489`; listener de eventos de catálogo :996-1005.
- `catalog-state.js`: `state:39` (side, results, update…) `view:57` `showError:11` `safeGet/safeSet` (localStorage); sin imports del catálogo (evita ciclos).
- `catalog-side.js`: panel derecho — ficha, temporadas, similares, migas: `openSide:42` `closeSide:79` `renderSide:140` `goSeason:91`.
- `catalog-options.js` (1312): opciones de un video — `loadStreams:171` `onStreams:198` `groupPanel:519` `loadTorbox:317` `sortOptions:245`, ▶ reproducir/bajar de fondo (~:812, :1286).
- `options-rank.js`: lógica pura de ranking `rankOptions:142` `healthOf:102` `qualityRank:82` `latOf:25` (con test).
- `catalog-flow.js`: pasos al elegir video (torrent/TorBox → ¿latino? → resolución → lista): `newFlow:30` `flowStep:250` `flowFilter:88` `cancelFlowWork:184`.
- `catalog-tests.js`: pruebas de conexión por torrent (rápida/profunda/"mejor"): `runQuick:261` `runDeep:395` `runCensus:186` `toggleBest:87` `onSwarmEvent:431`.
- `catalog-subs.js`: paso Subtítulos: `subsStep:253` `openSubs:265` `subsProgress:44` `readSubsNow:137`.
- `catalog-magnet.js:27` `openMagnet` (pegar magnet + TorBox) · `magnet-hash.js:9` `magnetHash` (btih, puro).
- `audio-picker.js`: panel Reproducir (player/audio/subs): `openWizard:125` `play:223` `closeWizard:53` `originalAudio:165`.
- `dialogs.js`: confirmación, log, limpieza, Ajustes (keys, red, ecualizador, TorBox compartido), cierre: `openSettings:211` `saveKey:319` `onConfirmClose:353` `confirmDialog:15` `cleanTemp:69`.
- `top-menus.js`: botón magnet copiado + menú Descargas: `refreshCopied:63` `playCopied:73` `toggleDownloads:168` `refreshDownloads:236`.
- `activity.js:329` `activity` (burbuja/panel de actividad) · `activity-feed.js`: `logEvent:37` `renderActivity:13` (evento→línea de log).
- `speed.js`: "Tu conexión" `initSpeed:215` `onSpeedEvent:208` · `health-calib.js`: calibración de salud estimada `predict:184` `learnBias:131` `trackPlayback:274` `incomingStatus:376` (con test).
- `welcome.js`: tour inicial `openWelcome:64` `isTouring:17` · `lang-picker.js`: `langPicker:15` `langToggle:34` (cambiar idioma recarga la ventana) · `updater.js`: aviso de versión (plugin updater, usa `window.__TAURI__`).
- `dom.js`: `el:35` `icon:98` `setStatus:106` `showError:114`; `$`/`$input`/`$button` · `format.js`: `humanBytes:8` `mbps:16` `ago:41` `playbackText:51` · `season.js`: puntaje por temporada puro · `tooltip.js`: tooltips propios (se instala solo) · `i18n.js`/`i18n-en.js` (ver i18n).
- `test-stub.js`: stub de webview para tests (no es un test).

## CSS
- `/Users/monti/Documents/Dev/streamonte/ui/styles.css` (704): tokens `:root` claro/oscuro, topbar, filas, diálogos/Ajustes (:146), etiquetas de idioma (:151), actividad (:380), idiomas (:618), bienvenida (:645).
- `/Users/monti/Documents/Dev/streamonte/ui/catalog.css` (1144): grilla + panel lateral `.catalog.side-open`, filas de opción (:546), Explorar (:872), ficha (:1047), badges de idioma (:1055), pegar magnet (:1073). Usa variables de styles.css.

## Flujo
- Búsqueda: input → `catalog.js:85` `search` → `api.js:116` `catalogSearch` → `invoke('catalog_search')` → `src-tauri/src/commands.rs:435` → `AppCore::catalog_search` (crates/core/src/app.rs:1375) → `state.results` → `render`.
- Torrents: elegir video → `catalog-options.js:171` `loadStreams` → `api.catalogStreams` (api.js:158) → `commands.rs:460` → `app.rs:1539` → evento `catalog-streams` (app.rs:1543) → `catalog.js:998` → `onStreams` → `renderStreamsOnly`; luego swarm/census (`catalog-tests.js`) → eventos `catalog-swarm-*` → `onSwarmEvent`.
- Reproducir: ▶ → `audio-picker.js:223` `play` (o `catalog-options.js:1286`) → `api.play`/`playTorbox` → `play`/`play_torbox` → evento `playback-updated` → `app.js:69` → `state.playbacks` → filas.
- Cierre: evento `confirm-close` → `app.js:66` → `dialogs.js:353` `onConfirmClose` → `api` `on_close`.

## Conexiones
- Nombre `api.xxxYyy` ↔ comando `xxx_yyy` (camelCase↔snake_case; ej. `catalogSwarm`↔`catalog_swarm`). Lista completa con líneas: `/Users/monti/Documents/Dev/streamonte/src-tauri/CLAUDE.md`.
- Eventos: único `core://event` (`api.js:230`); `app.js:138` (global) y `catalog.js:996` (catálogo) son los 2 listeners; `catalog.js:982` también oye `playback-*` como CustomEvent.
- `window.__TAURI__` solo en `api.js:18` y `updater.js:8`. CSP no permite red desde la UI.

## i18n
- App en es/en. Clave = texto en español literal en `t('…')`/`tr()` (i18n.js:18) y en index.html (`translateStatic:37`); `i18n-en.js` mapea es→en (`{x}` = placeholders). Sin entrada → se muestra en español.
- Texto nuevo: agregar la clave a `i18n-en.js`; `i18n-keys.test.js` falla si falta, o si cambian los placeholders (neutros en `NEUTRAL`:11).

## Reglas / trampas
- Comando nuevo: `api.js` + typedef en `types.js` (y commands.rs + lib.rs en src-tauri). Campos en snake_case (serde), enums kebab-case.
- `catalog-state.js` no importa otros módulos del catálogo (ciclos). `dom.js`↔`activity.js`: `activity` usa `document.querySelector` a propósito.
- Lógica pura (sin DOM) va en `options-rank.js`/`season.js`/`magnet-hash.js` para poder testearla.
- Puerto 1420 fijo: si está ocupado Vite falla (`strictPort`).
- Tests que importan i18n/format/api: `import './test-stub.js'` PRIMERO.

## Correr / chequear
- Dev: `cd /Users/monti/Documents/Dev/streamonte/ui && deno run -A npm:vite` + `cd /Users/monti/Documents/Dev/streamonte && cargo run -p streamonte` (con `cargo tauri dev` el beforeDevCommand levanta Vite).
- Chequeos: `cd /Users/monti/Documents/Dev/streamonte && sh scripts/check.sh` (rápido: deno lint + `scripts/lint-undef.py` + `deno check --config ui/deno.json ui/src/*.js`); `sh scripts/check.sh full` suma tests.
- Tests: `deno test --no-check --allow-read --config ui/deno.json ui/src` (format, health-calib, magnet-hash, options-rank, season, i18n-keys). Svelte/TS: `cd /Users/monti/Documents/Dev/streamonte/ui && npm run check`.
