# scripts — verificación, capturas, release
Todo se corre desde la raíz del repo (o del worktree).

## Para X → script
- Chequeo rápido (fmt, clippy, tipos/lint del carril tocado): `sh scripts/check.sh`. Con tests: `check.sh full`. Fuerza: `RUST=1`, `ALL=1`, `FORCE=1`.
- UI sin mirar a ojo: `node scripts/shot.mjs <url> [--sel] [--click] [--only mobile|desktop]` (PNG + ids + errores de consola).
- Contratos + visual con un solo vite: `sh scripts/verify-ui.sh --changed`. Por separado: `contracts.sh`, `node scripts/visual.mjs [--update] [--changed]`.
- Lo mismo que el CI de GitHub: `sh scripts/ci-local.sh` (lee los `run:` de `ci.yml`).
- Foto de `/api/*` de la web antes/después de reestructurar: `node scripts/api-snapshot.mjs take|diff`.
- Benchmark de la lista de opciones: `node scripts/bench-options.mjs` (base: `bench/options-baseline.json`).
- Probar la app instalada sin release: `sh scripts/dogfood.sh`.
- Worktree listo en ~10 s: `sh scripts/wt-setup.sh`. Mpv empaquetado: `fetch-mpv.sh`. Podar `target/`: `trim-target.sh`.
- Release: `sh scripts/release.sh [patch|minor] [--dry-run]`, solo desde `main` y con orden del usuario.
- Tests de lo tocado en node (~1,4 s): `sh scripts/test-touched.sh`.

## Deploy web con preview
`vercel deploy` sin `--prod` desde la raíz (Root Directory=`web`) → URL de preview → probar en el celu → `vercel promote <url>` (instantáneo, no recompila). Antes confirmar que las variables existen en el scope Preview. `--prod` directo solo para hotfix; el "push" de la web incluye deploy.

## Trampas
- Pesados (`full`, contracts, visual, ci-local) toman `scripts/lib/heavy-lock.sh`: uno a la vez.
- `check.sh` salta si el contenido ya pasó (stamp); no ve ignorados como `.env.local`.
- Visual: baselines de macOS; no corre en CI.
- Tests de browser/visual: `tests/CLAUDE.md`.
