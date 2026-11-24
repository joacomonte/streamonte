# Streamonte (monorepo)

Busca películas/series, mide torrents (velocidad real, audio, subs) y los reproduce. Dos apps con la misma lógica de dominio:
desktop (Tauri + Rust) y web (SvelteKit, Vercel). Cada carpeta tiene su CLAUDE.md con mapa, flujos y refs: leer ese primero.

## Mapa
- `crates/core/` — núcleo Rust (streamonte-core): catálogo, análisis, motor torrent, reproducción, subs → `crates/core/CLAUDE.md`
  - `src/catalog/` · `src/analyzer/` · `src/engine/` (+ `engine/rqbit/`) · `src/playback/` · `src/subtitles/` — cada uno con CLAUDE.md
- `src-tauri/` — shell Tauri: comandos `invoke` → core, evento único `core://event` → `src-tauri/CLAUDE.md`
- `ui/` — UI desktop (JS `@ts-check`, migrando a Svelte 5 + TS con Vite, Node 24 + pnpm 10) → `ui/CLAUDE.md`
- `web/` — web SvelteKit + TS (server en `src/lib/server/`, rutas en `src/routes/`) → `web/CLAUDE.md`
- `packages/ui/` — CSS (`css/`) y TS compartido (`src/`: tipos, `Api`, rank, format, i18n) → `packages/ui/CLAUDE.md`; `packages/golden/` — vectores de test web↔Rust → `packages/CLAUDE.md`
- `scripts/check.sh` — chequeos · `docs/` — protocolo del motor, mockups, planes (`docs/plans/`, gitignorado)

## Flujo general
Usuario → UI (`ui/src/api.js` invoke) → `src-tauri/src/commands.rs` → `crates/core` (`AppCore`) → TMDB/Cinemeta/Torrentio/trackers/rqbit/mpv → eventos `core://event` → UI.
Web: página → `web/src/routes/**/+page.server.ts` o `api/**/+server.ts` → `web/src/lib/server/*` → TMDB/indexers/TorBox.

## Reglas que cruzan apps
- Todo cambio que pida el usuario va en desktop Y web, salvo que diga lo contrario (pedido 2026-11-23): UI compartida en `packages/ui/`, y lo propio de cada app en `ui/` y `web/`.
- La misma regla vive en Rust y en TS (tráiler, plataformas AR, reparto, release tags, excluidos, idioma de subs, estado de serie): cambiar una obliga a cambiar la otra y `packages/golden/*.json` (casos `diverge` = desvío conocido, salteado en web).
- 1440p = "2K", 14 Mbps típicos: `packages/ui/src/rank.ts:20 TYPICAL_MBPS` (única regla; web y desktop la importan).

## Cómo trabajar acá (iteración rápida, 2026-11-24)
- **Cambio chico → directo, sin proponer approach ni preguntar.** Es chico si se cumple todo esto:
  - toca hasta ~3 archivos por app;
  - no toca una regla compartida Rust↔TS (golden) ni crea un comando Tauri o endpoint;
  - no borra datos ni cambia un contrato.

  Se hace en desktop y web, se verifica (`check.sh` + `shot.mjs` solo de la pantalla tocada) y se reporta corto. Si al empezar resulta más grande, avisar y pasar al flujo normal (approach + OK).
- **Contexto chico:** una sesión por feature. La exploración amplia y las verificaciones de salida larga van a un subagente (Haiku o Sonnet) que devuelve solo la conclusión. Las lecturas y comandos independientes, juntos en una sola respuesta.
- **Modelo:** lo mecánico (CSS, textos, un campo, mover código) puede ir a un subagente Sonnet; Opus para diseño y bugs difíciles.
- **Esperas:** release, CI y deploy en background con aviso al terminar. Nada de `sleep` ni polling.
- **Plan de mejoras:** `docs/plans/iteracion-y-reestructura.md`.

## Relación
- `packages/ui/src/` ← `web/` (alias `$ui`, `web/vite.config.ts`) · ← `ui/` (alias `$ui`, `ui/vite.config.ts`).
- `Api` (`packages/ui/src/api.ts:11`): impls `web/src/lib/webApi.ts:17` (fetch `/api/*`) y `ui/src/tauriApi.ts:20` (invoke + `core://event`); adaptadores puros `web/src/lib/web-adapt.ts`, `ui/src/tauri-adapt.ts`.
- Ranking, formatos, i18n (`packages/ui/src/i18n/en.ts`) y tipos de vista viven solo en `packages/ui/src/`.

## Chequeos
- `sh scripts/check.sh` (~5 s: fmt, clippy de core, lint/tipos de ui y web) · `sh scripts/check.sh full` (+ nextest y `node --test`; ~32 s en caliente; una vez al cerrar el cambio, serializado con otros `full` por `scripts/lib/heavy-lock.sh`). Corre solo el carril de lo tocado (sin commitear o sin pushear): `ui/` → ui · `web/` → web · `packages/ui/` → ui+web · `crates/`, `src-tauri/`, `Cargo.*`, `packages/golden` → Rust (src-tauri solo si cambió); `tests/`, `scripts/`, `docs/` → nada. `RUST=1` fuerza Rust, `ALL=1` todo. Si ya pasó con el mismo contenido sale en ~0,3 s (stamp); `FORCE=1` lo ignora. El CI de GitHub corre en branches y PRs, no en tags (el tag lo construye `release.yml`).
- Release: `sh scripts/release.sh [patch|minor] [--dry-run]` (solo desde `main` al día con origin; sube versión, tag, push y sigue el CI). Solo con orden del usuario.
- CI local = el de GitHub (`ci.yml`) con los mismos comandos: `sh scripts/ci-local.sh` (~1,5 min), a mano: sin hook pre-push desde 2026-11-24 (valida el CI de GitHub). No cubre Windows. Lee los `run:` de `ci.yml` (`scripts/lib/ci-steps.mjs`): no hay que sincronizarlo a mano.
- Disco: `scripts/trim-target.sh` poda el `target/` compartido (incremental/examples sin uso 24 h; deps solo por tope `TOPE_GB`=30) y una vez por semana `pnpm store prune`; lo corren check.sh y ci-local.sh, a lo sumo cada 6 h. `.cargo/config.toml` (sin trackear) fija target único y `jobs = 4`.
- Node 24 (nvm) primero en PATH: la web usa type stripping nativo; el node de Homebrew es viejo.
- Desktop dev: `cd ui && pnpm dev` + `cargo run -p streamonte` (sin Vite la ventana queda en blanco). Es lo más rápido para iterar: core real + recarga en caliente de la UI.
- Probar la app instalada sin release (mpv empaquetado, keychain real, la app en /Applications): `sh scripts/dogfood.sh` (perfil `dogfood` sin LTO, incremental; reemplaza y abre /Applications/Streamonte.app; `--no-install` solo compila). Los releases (tag) son para los usuarios: no se usan para probar.
- TorBox del desktop: siempre directo con la key de cada usuario (el modo "TorBox de Streamonte" por la web se sacó el 2026-11-23). Smoke contra la API real antes de un release: `cargo nextest run -p streamonte-core --run-ignored all torbox_smoke` (necesita la key guardada).
- Verificar UI sin mirar a ojo: `node scripts/shot.mjs <url> [--sel CSS] [--click SEL] [--only mobile|desktop] [--out DIR]` → 2 PNG (celu/escritorio, `mobile.png` y `desktop.png`, oscuros, sin animaciones) + 1 línea JSON por captura con posición de cada `id`, errores de consola e `imgFailed` (imágenes visibles que no cargaron; antes de capturar espera sus cargas, tope 8 s); exit 1 si la página falla.
- Benchmark de la lista de opciones (desktop vs web, N filas + updates en vivo): `node scripts/bench-options.mjs [--n 25,100,300] [--runs 3] [--profile] [--dev] [--out FILE]`; línea base en `bench/options-baseline.json` (compararla antes/después de tocar el render).
- Contratos de pantalla (`tests/contracts/*.json`: ids/textos que cada pantalla web y desktop debe tener; `regressed` = faltan y se restauran después): `sh scripts/contracts.sh [--all] [nombre…]` (~70 s, 4 a la vez, levanta web+desktop mock; la web responde TMDB/addons desde `tests/fixtures/web-http` vía `HTTP_FIXTURES`, sin red; `LIVE=1` suma los de TorBox; fuera de `check.sh full`) — correrlo tras unificar código.
- Regresión visual (14 capturas vs `tests/visual/baseline/`, sin red): `node scripts/visual.mjs [--update] [--changed]` (~35 s; `--changed` = solo la app tocada) → `tests/visual/README.md`.
- Desktop sin Tauri (en el navegador): `cd ui && pnpm dev` → http://127.0.0.1:1420 responde con `ui/mock/*.json` (`ui/src/mock-tauri.ts`); regrabar: `cargo run -p streamonte-core --example record_fixtures`. Sin eventos en vivo (análisis, velocidad, reproducción).
- Worktree nuevo listo en ~10 s: `sh scripts/wt-setup.sh` (pnpm desde el store + `web/.env.local` y `web/.data` clonados).
- Deploy web: `vercel deploy --prod --yes` desde ESTA raíz (Root Directory=web, `.vercelignore` sube solo `web/` y `packages/`).
