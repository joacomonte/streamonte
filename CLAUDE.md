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
- Branches en el checkout principal, no worktrees (un worktree recompila Rust); buscar con `rg --files`, no `find`. Node 24 (nvm) primero en el PATH. Sin deps nuevas sin preguntar.
- Cambio chico (~3 archivos por app, sin golden/comando/contrato) → directo, `check.sh` + `shot.mjs`. Una sesión por feature; exploración larga a un subagente.

## Verificación: lo mínimo (defaults del usuario)
1. Siempre: `sh scripts/check.sh` + contratos rápidos de lo tocado: `node scripts/scenes.mjs --contracts --changed`.
2. Escenas completas (`scenes.mjs` sin filtro): solo si el usuario las pide; se puede preguntar, por default no.
3. Prueba de flujo (escena suelta `--file --snap`, Playwright): solo con OK del usuario.
4. `ci-local.sh`: solo si un deploy/CI ya falló una vez, para no reintentar a ciegas.
- Cambio chico → directo, sin subagente. Agentes que editan: de a uno, en su branch.
- Varios cambios seguidos → un solo check + contratos y un solo deploy al final; `vercel --prod` en background.
- Desktop solo en releases pedidos. Sin cambios en Rust → nada de cargo.
- Rust: branches en el checkout principal (misma compilación); sccache. Nada pesado en paralelo (`scripts/lib/heavy-lock.sh`). Release y deploy: `scripts/CLAUDE.md`.
- Dev desktop: `cd ui && pnpm dev` + `cargo run -p streamonte`.
