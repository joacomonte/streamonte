# .github — CI y release
## Para X → andá a Y
- Chequeos de cada push/PR → `workflows/ci.yml` (jobs `core`, `web`, `ui`; solo branches y PRs, no tags).
- Release (tag `v*`: guard, release, build por plataforma, publicar) → `workflows/release.yml`. El tag lo crea `sh scripts/release.sh`, solo con orden del usuario.

## Reglas
- `scripts/ci-local.sh` = `ci.yml`: lee los `run:` de los jobs (`scripts/lib/ci-steps.mjs`). Cambiar un comando en `ci.yml` alcanza; si cambia la forma de los pasos, revisar ese lector.
- El CI no cubre visual ni contratos (macOS, a mano: `scripts/CLAUDE.md`).

## Trampas
- Windows solo se ve en el CI.
- El mpv se baja en el release con `scripts/fetch-mpv.sh` (versión y sha256 fijos).
