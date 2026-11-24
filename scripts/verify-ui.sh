#!/bin/sh
# Verificación de UI en una pasada: contratos de pantalla + regresión visual (`scripts/scenes.mjs`).
#   sh scripts/verify-ui.sh [--changed|--all]    # --changed (por defecto con cambios) = solo la app tocada; --all = las dos
# Toma el lock de tareas pesadas (scripts/lib/heavy-lock.sh) y corre el runner de escenas, que levanta un vite por app
# (web con HTTP_FIXTURES y APP_PASSWORD vacío; TMDB_KEY de .env.local: sin key la home no muestra el catálogo).
# No graba nada: para eso `node scripts/visual.mjs --update --only <x>` (baselines) o `--record` (fixtures).
cd "$(dirname "$0")/.."
export PATH="$HOME/.nvm/versions/node/v24.21.0/bin:/opt/homebrew/bin:$PATH"
MODE="--changed"
[ "$1" = "--all" ] && MODE="--all"
[ "$1" = "--changed" ] && MODE="--changed"

ARGS=""
if [ "$MODE" = "--changed" ]; then
  APPS=$(node scripts/scenes.mjs --changed-apps) || exit 1
  [ -z "$APPS" ] && { echo "verify-ui: sin cambios de UI, nada que verificar"; exit 0; }
  ARGS="--changed"
fi

. scripts/lib/heavy-lock.sh
trap 'heavy_unlock' EXIT INT TERM
heavy_lock "verify-ui $MODE"

rc=0
node scripts/scenes.mjs $ARGS || rc=1
[ $rc = 0 ] && echo "verify-ui ok" || echo "verify-ui: FALLA (ver arriba)"
exit $rc
