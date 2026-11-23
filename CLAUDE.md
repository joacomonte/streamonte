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

## Relación
- `packages/ui/src/` ← `web/` (alias `$ui`, `web/vite.config.ts`) · ← `ui/` (alias `$ui`, `ui/vite.config.ts`).
- `Api` (`packages/ui/src/api.ts:11`): impls `web/src/lib/webApi.ts:17` (fetch `/api/*`) y `ui/src/tauriApi.ts:20` (invoke + `core://event`); adaptadores puros `web/src/lib/web-adapt.ts`, `ui/src/tauri-adapt.ts`.
- Ranking, formatos, i18n (`packages/ui/src/i18n/en.ts`) y tipos de vista viven solo en `packages/ui/src/`.

## Chequeos
- `sh scripts/check.sh` (~3 s: fmt, clippy, oxlint + tsc de la UI, tsc de packages/ui) · `sh scripts/check.sh full` (~6 s: + nextest, `pnpm test` de la UI, web check+test).
- CI local = el de GitHub (`ci.yml`) con los mismos comandos: `sh scripts/ci-local.sh` (~1,5 min). Lo corre el hook `pre-push` (`.githooks/`, activo con `git config core.hooksPath .githooks`; un push de solo tags no lo repite; urgencia: `--no-verify`). No cubre Windows. Si cambia `ci.yml`, cambiar el script.
- Disco: `scripts/trim-target.sh` poda `target/` (sin uso 24 h y tope `TOPE_GB`=20, de lo más viejo a lo más nuevo) y una vez por semana `pnpm store prune`; lo corren check.sh, ci-local.sh y el hook de Claude tras cada `cargo`.
- Node 24 (nvm) primero en PATH: la web usa type stripping nativo; el node de Homebrew es viejo.
- Desktop dev: `cd ui && pnpm dev` + `cargo run -p streamonte` (sin Vite la ventana queda en blanco).
- TorBox del desktop: siempre directo con la key de cada usuario (el modo "TorBox de Streamonte" por la web se sacó el 2026-11-23). Smoke contra la API real antes de un release: `cargo nextest run -p streamonte-core --run-ignored all torbox_smoke` (necesita la key guardada).
- Verificar UI sin mirar a ojo: `node scripts/shot.mjs <url> [--sel CSS] [--click SEL] [--only mobile|desktop] [--theme light|dark] [--out DIR]` → 4 PNG (celu/escritorio × claro/oscuro, sin animaciones) + 1 línea JSON por captura con posición de cada `id`, errores de consola e `imgFailed` (imágenes visibles que no cargaron; antes de capturar espera sus cargas, tope 8 s); exit 1 si la página falla.
- Benchmark de la lista de opciones (desktop vs web, N filas + updates en vivo): `node scripts/bench-options.mjs [--n 25,100,300] [--runs 3] [--profile] [--dev] [--out FILE]`; línea base en `bench/options-baseline.json` (compararla antes/después de tocar el render).
- Contratos de pantalla (`tests/contracts/*.json`: ids/textos que cada pantalla web y desktop debe tener; `regressed` = faltan y se restauran después): `sh scripts/contracts.sh [--all] [nombre…]` (~70 s, 4 a la vez, levanta web+desktop mock; la web responde TMDB/addons desde `tests/fixtures/web-http` vía `HTTP_FIXTURES`, sin red; `LIVE=1` suma los de TorBox; fuera de `check.sh full`) — correrlo tras unificar código.
- Regresión visual (14 capturas vs `tests/visual/baseline/`, sin red): `node scripts/visual.mjs [--update] [--changed]` (~35 s; `--changed` = solo la app tocada) → `tests/visual/README.md`.
- Desktop sin Tauri (en el navegador): `cd ui && pnpm dev` → http://127.0.0.1:1420 responde con `ui/mock/*.json` (`ui/src/mock-tauri.ts`); regrabar: `cargo run -p streamonte-core --example record_fixtures`. Sin eventos en vivo (análisis, velocidad, reproducción).
- Worktree nuevo listo en ~10 s: `sh scripts/wt-setup.sh` (pnpm desde el store + `web/.env.local` y `web/.data` clonados).
- Deploy web: `vercel deploy --prod --yes` desde ESTA raíz (Root Directory=web, `.vercelignore` sube solo `web/` y `packages/`).
