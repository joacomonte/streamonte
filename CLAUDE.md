# Streamonte (monorepo)
Busca películas/series, mide torrents (velocidad, audio, subs) y los reproduce. Desktop (Tauri + Rust) y web (SvelteKit, Vercel) con la misma lógica. Cada carpeta tiene su CLAUDE.md corto.

## ¿Dónde voy?
| Tarea | Ir a |
|---|---|
| Comando/endpoint nuevo, campo en la ficha | `docs/recetas/comando-nuevo.md` |
| Llevar algo de la web al desktop | `docs/recetas/portar-web-a-desktop.md` |
| Regla "es latino" | `crates/core/src/audio.rs` + `packages/ui/src/latino.ts` + `packages/golden/spanish_variant.json` |
| Otra regla Rust↔TS | `packages/golden/CLAUDE.md` |
| Pantalla compartida, badges de opciones | `packages/ui/src/<área>/` (`options/` + `css/options.css`) |
| Apodo, bienvenida, saludo | `packages/ui/src/animals/` · `ui/src/Welcome.svelte` · `web/src/routes/api/nick/` |
| Ajustes, limpieza | `ui/src/components/` (Settings, Downloads) · `packages/ui/src/settings/` · web: `web/src/routes/ajustes/` |
| Lo propio del desktop | `ui/CLAUDE.md` |
| Endpoint web | `web/src/routes/api/` + `web/src/lib/server/` |
| Motor, análisis, reproducción, subs, catálogo | `crates/core/src/<x>/` |
| Comando Tauri / evento | `src-tauri/` · `crates/core/src/events.rs` |
| Diseño/estilo visual (tokens, recetas, do/don't) | `docs/estilo/` |
| Verificar, CI, planes | `scripts/` · `tests/` · `.github/` · `docs/` |

## Reglas que cruzan apps
- Todo cambio va en desktop Y web, salvo orden contraria. Compartido en `packages/ui/`. Misma regla en Rust y TS → cambiar una obliga a la otra y su golden.
- 1440p = "2K", 14 Mbps típicos: `packages/ui/src/rank.ts` `TYPICAL_MBPS`.
- Branches en el checkout principal, no worktrees (solo si se piden: `scripts/wt-setup.sh`). `rg --files`, no `find`. Node 24 (nvm) primero en el PATH. Sin deps nuevas sin preguntar.
- Cambio chico (~3 archivos por app, sin golden/comando/contrato) → directo, sin subagente: `check.sh` + `shot.mjs`. Una sesión por feature; exploración larga a un subagente. Agentes que editan: de a uno, en su branch (excepción: `/contract-first`).

## Hechos duros
- Repo y releases de GitHub públicos: ningún secreto en el binario ni en el repo. Las keys del servidor salen solo vía `/api/desktop/*` al llavero.
- La UI del desktop no hace red (CSP `connect-src` ipc): toda llamada a la web pasa por `crates/core/src/web.rs`. Cambiar status o cuerpo de `/api/nick` o del candado rompe el desktop.
- Vercel (web) no ve `ui/` salvo `package.json`: lo que comparten las dos apps va en `packages/ui/src`.
- Sin `APODO_SECRET`, `/api/nick` da 503 (demás env vars: `web/CLAUDE.md`).
- Release: árbol limpio (incluye untracked), desde main; el updater solo sube de versión (`release.sh --revert` = patch nuevo).
- Golden: renombrar o mover un JSON rompe `include_str!` (Rust) y `readFileSync` (web).

## Verificación: lo mínimo (defaults del usuario)
1. Siempre: `sh scripts/check.sh` + contratos rápidos de lo tocado: `node scripts/scenes.mjs --contracts --changed`.
2. Escenas completas (`scenes.mjs` sin filtro): solo si el usuario las pide; se puede preguntar, por default no.
3. Prueba de flujo (escena suelta `--file --snap`, Playwright): solo con OK del usuario.
4. `ci-local.sh`: solo si un deploy/CI ya falló una vez, para no reintentar a ciegas.
- Varios cambios seguidos → un solo check + contratos y un solo deploy al final. Push de la web = `vercel deploy --prod` desde la raíz (en background).
- Desktop solo en releases pedidos. Sin cambios en Rust → nada de cargo. Nada pesado en paralelo (`scripts/lib/heavy-lock.sh`). Release y deploy: `scripts/CLAUDE.md`. Dev: `cd ui && pnpm dev` + `cargo run -p streamonte`.
- Capturas: estado del mock por URL (`?nonick`, `?tour`, `?live`, `?scenario=<n>`) + `node scripts/shot.mjs <url>`; pantalla nueva → su estado por URL en `ui/src/mock-tauri.ts`. Preferir estado por URL antes que clics.

## Contract-first
contrato: packages/ui/src/api.ts (Api) · packages/ui/src/types.ts · ui/src/types.ts (serde). Stubs: todo!() / throw new Error('not implemented')
mock: ui/src/mock-tauri.ts (estado por URL: ?nonick, ?tour, ?live, ?scenario=<n>) · packages/ui/test/fake-api.ts
registros (solo el chat principal): src-tauri/src/lib.rs (invoke_handler) · crates/core/src/lib.rs · crates/core/src/app/mod.rs · packages/ui/src/i18n/en.ts
verify-wp: sh scripts/check.sh && sh scripts/test-touched.sh · pantalla → node scripts/scenes.mjs <escena> --contracts
verify-final: RUST=1 sh scripts/check.sh full && node scripts/scenes.mjs --contracts --changed
pesado: check.sh full, verify-ui.sh y ci-local.sh (heavy-lock, uno a la vez). release.sh y dogfood.sh no corren con agentes activos.
Hasta 3 agentes en el mismo branch, con owns disjuntos.
