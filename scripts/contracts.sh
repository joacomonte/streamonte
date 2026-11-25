#!/bin/sh
# Alias de `node scripts/scenes.mjs --contracts`: contratos de pantalla (tests/scenes/*.json con `must`).
#   sh scripts/contracts.sh [--all] [--changed] [nombre...]   # --all: los `regressed` también fallan; LIVE=1 suma los `"live": true`
#   UI_URL=… WEB_URL=… usa servers ya levantados; JOBS=n contratos en paralelo (4). Formato de escena y detalle: scripts/scenes.mjs.
cd "$(dirname "$0")/.."
export PATH="$HOME/.nvm/versions/node/v24.21.0/bin:/opt/homebrew/bin:$PATH"
exec node scripts/scenes.mjs --contracts "$@"
