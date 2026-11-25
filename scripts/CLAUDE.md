# scripts — verificación, capturas, release
Todo se corre desde la raíz del repo.

## Para X → script
- Chequeo rápido (fmt, clippy, tipos/lint del carril tocado): `sh scripts/check.sh`. Con tests: `check.sh full`. Fuerza: `RUST=1`, `ALL=1`, `FORCE=1`.
- UI sin mirar a ojo: `node scripts/shot.mjs <url> [--sel] [--click] [--only mobile|desktop]` (PNG + ids + errores de consola). Flujo con escribir/tocar/esperar: escena suelta `node scripts/scenes.mjs --file x.json --snap` (mismo formato que `tests/scenes`).
- Contratos + visual con un solo vite: `sh scripts/verify-ui.sh --changed`. Todo sale de un runner, `node scripts/scenes.mjs [nombre] [--contracts|--shots] [--changed] [--update]`; `contracts.sh` y `visual.mjs` son alias.
- Lo mismo que el CI de GitHub: `sh scripts/ci-local.sh` (lee los `run:` de `ci.yml`).
- Foto de `/api/*` de la web antes/después de reestructurar: `node scripts/api-snapshot.mjs take <dir>` / `diff <a> <b>`.
- Benchmark de la lista de opciones: `node scripts/bench-options.mjs` (base: `bench/options-baseline.json`).
- Probar la app instalada sin release: `sh scripts/dogfood.sh`.
- Worktree (solo si el usuario lo pide) listo en ~10 s: `sh scripts/wt-setup.sh`. Mpv empaquetado: `fetch-mpv.sh`. Podar `target/`: `trim-target.sh`.
- Release: `sh scripts/release.sh [patch|minor|major] [--dry-run]`, solo desde `main` y con orden del usuario. `--revert` deshace el último y publica el patch siguiente.
- Tests de lo tocado en node (~1,4 s): `sh scripts/test-touched.sh`.

## Deploy web
"Push" de la web = `vercel deploy --prod` desde la raíz del monorepo (Root Directory=`web`). Preview (`vercel deploy` sin `--prod` → `vercel promote <url>`) solo si el usuario lo pide; antes confirmar las variables en el scope Preview.

## Trampas
- Toman `scripts/lib/heavy-lock.sh` (uno a la vez): `check.sh full`, `verify-ui.sh` y `ci-local.sh`; scenes/contracts/visual no.
- Ayudas de `lib/`: `web-apodo.mjs` (sesión de apodo de prueba para escenas), `ci-steps.mjs` (lista los `run:` de `ci.yml`).
- `check.sh` salta si el contenido ya pasó (stamp); no ve ignorados como `.env.local`.
- Visual: baselines de macOS; no corre en CI.
- `.cargo/config.toml` (sin trackear, en la raíz) fija `jobs = 4` y `rustc-wrapper = "sccache"`. `target/` es por worktree: uno compartido servía un core de otro worktree.
- Escenas: `--jobs 4` por defecto; la espera del código de animales es 1 s (`APODO_WAIT_SECONDS`).
- Los releases son para los usuarios, no para probar: usar `dogfood.sh`.
- Tests de browser/visual: `tests/CLAUDE.md`. `shot.mjs` ya no corre contratos (eso es `scenes.mjs`).
