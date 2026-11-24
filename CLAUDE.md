# Streamonte (monorepo)
Busca películas/series, mide torrents (velocidad, audio, subs) y los reproduce. Desktop (Tauri + Rust) y web (SvelteKit, Vercel) con la misma lógica. Cada carpeta tiene su CLAUDE.md corto.

## ¿Dónde voy?
| Tarea | Ir a |
|---|---|
| Comando/endpoint nuevo, campo en la ficha | `docs/recetas/comando-nuevo.md` |
| Regla "es latino" | `crates/core/src/audio.rs` + `packages/ui/src/latino.ts` + `packages/golden/spanish_variant.json` |
| Otra regla Rust↔TS | `packages/golden/CLAUDE.md` |
| Pantalla compartida, badges de opciones | `packages/ui/src/<área>/` (`options/` + `css/options.css`) |
| Ajustes, limpieza | `ui/src/components/` (Settings, Downloads) · web: `web/src/routes/ajustes/` |
| Lo propio del desktop | `ui/CLAUDE.md` |
| Endpoint web | `web/src/routes/api/` + `web/src/lib/server/` |
| Motor, análisis, reproducción, subs, catálogo | `crates/core/src/<x>/` |
| Comando Tauri / evento | `src-tauri/` · `crates/core/src/events.rs` |
| Verificar, CI, planes | `scripts/` · `tests/` · `.github/` · `docs/` |

## Reglas que cruzan apps
- Todo cambio va en desktop Y web, salvo orden contraria. Compartido en `packages/ui/`.
- Misma regla en Rust y TS → cambiar una obliga a la otra y su golden.
- 1440p = "2K", 14 Mbps típicos: `packages/ui/src/rank.ts` `TYPICAL_MBPS`.
- Worktrees en `.claude/worktrees/`; buscar con `rg --files`, no `find`. Node 24 (nvm) primero en el PATH. Sin deps nuevas sin preguntar.
- Cambio chico (~3 archivos por app, sin golden/comando/contrato) → directo, `check.sh` + `shot.mjs`. Una sesión por feature; exploración larga a un subagente.

## Verificación: 3 carriles
1. `sh scripts/check.sh` ~5 s (0,3 s sin cambios).
2. `sh scripts/check.sh full` ~30 s (+ tests, una vez al cerrar); UI: `sh scripts/verify-ui.sh --changed` ~28 s.
3. Antes de pushear: `contracts.sh` ~80-130 s, `visual.mjs` ~20-45 s, `ci-local.sh` ~1,5 min.
- Nada pesado en paralelo (`scripts/lib/heavy-lock.sh`). Detalle, release y deploy: `scripts/CLAUDE.md`.
- Dev desktop: `cd ui && pnpm dev` + `cargo run -p streamonte`.
