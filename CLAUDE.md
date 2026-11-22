# Streamonte (monorepo)

Busca películas/series, mide torrents (velocidad real, audio, subs) y los reproduce. Dos apps con la misma lógica de dominio:
desktop (Tauri + Rust) y web (SvelteKit, Vercel). Cada carpeta tiene su CLAUDE.md con mapa, flujos y refs: leer ese primero.

## Mapa
- `crates/core/` — núcleo Rust (streamonte-core): catálogo, análisis, motor torrent, reproducción, subs → `crates/core/CLAUDE.md`
  - `src/catalog/` · `src/analyzer/` · `src/engine/` (+ `engine/rqbit/`) · `src/playback/` · `src/subtitles/` — cada uno con CLAUDE.md
- `src-tauri/` — shell Tauri: comandos `invoke` → core, evento único `core://event` → `src-tauri/CLAUDE.md`
- `ui/` — UI desktop (JS `@ts-check`, migrando a Svelte 5 + TS con Vite vía Deno) → `ui/CLAUDE.md`
- `web/` — web SvelteKit + TS (server en `src/lib/server/`, rutas en `src/routes/`) → `web/CLAUDE.md`
- `packages/ui/css/` — CSS compartido (tokens, clases `.btn/.chip/.pill/.surface/.skel…`); `packages/golden/` — vectores de test web↔Rust → `packages/CLAUDE.md`
- `scripts/check.sh` — chequeos · `docs/` — protocolo del motor, mockups, planes (`docs/plans/`, gitignorado)

## Flujo general
Usuario → UI (`ui/src/api.js` invoke) → `src-tauri/src/commands.rs` → `crates/core` (`AppCore`) → TMDB/Cinemeta/Torrentio/trackers/rqbit/mpv → eventos `core://event` → UI.
Web: página → `web/src/routes/**/+page.server.ts` o `api/**/+server.ts` → `web/src/lib/server/*` → TMDB/indexers/TorBox.

## Reglas que cruzan apps
- La misma regla vive en Rust y en TS (tráiler, plataformas AR, reparto, release tags, excluidos, idioma de subs, estado de serie): cambiar una obliga a cambiar la otra y `packages/golden/*.json` (casos `diverge` = desvío conocido, salteado en web).
- 1440p = "2K", 14 Mbps típicos: `web/src/lib/torrent-rank.ts` ↔ `ui/src/options-rank.js:51`.

## Chequeos
- `sh scripts/check.sh` (~3 s: fmt, clippy, lint/tipos UI) · `sh scripts/check.sh full` (~6 s: + nextest, deno test, web check+test).
- Node 24 (nvm) primero en PATH: la web usa type stripping nativo; el node de Homebrew es viejo.
- Desktop dev: `cd ui && deno run -A npm:vite` + `cargo run -p streamonte` (sin Vite la ventana queda en blanco).
- Deploy web: `vercel deploy --prod --yes` desde ESTA raíz (Root Directory=web, `.vercelignore` sube solo `web/` y `packages/`).
