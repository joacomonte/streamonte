#!/bin/sh
# Verificación de UI en una pasada: contratos de pantalla + regresión visual, con un solo vite por app.
#   sh scripts/verify-ui.sh [--changed|--all]    # --changed (por defecto con cambios) = solo la app tocada; --all = las dos
# Toma el lock de tareas pesadas (scripts/lib/heavy-lock.sh), levanta desktop-mock y web (con HTTP_FIXTURES, TMDB_KEY y
# APP_PASSWORD vacíos) una sola vez, corre `contracts.sh` y después `visual.mjs` contra esos mismos servers.
# La web de visual (fixtures de tests/visual/fixtures/web, interceptadas en el navegador) y la de contratos
# (HTTP_FIXTURES en el server) comparten server: investigado 2026-11-24, las 6 capturas web dan 0,000 % de diferencia.
# No graba ni regraba nada: para eso `node scripts/visual.mjs --update --only <x>` (baselines) o `--record` (fixtures).
cd "$(dirname "$0")/.."
export PATH="$HOME/.nvm/versions/node/v24.21.0/bin:/opt/homebrew/bin:$PATH"
MODE="--changed"
[ "$1" = "--all" ] && MODE="--all"
[ "$1" = "--changed" ] && MODE="--changed"

APPS="ui web"
if [ "$MODE" = "--changed" ]; then
  APPS=$(node scripts/visual.mjs --changed-apps) || exit 1
  [ -z "$APPS" ] && { echo "verify-ui: sin cambios de UI, nada que verificar"; exit 0; }
fi

. scripts/lib/heavy-lock.sh
tmp=$(mktemp -d)
pids=""
stop() { for p in $pids; do kill "$p" 2>/dev/null; done; rm -rf "$tmp"; heavy_unlock; }
trap stop EXIT INT TERM
heavy_lock "verify-ui $MODE"

port() { node -e 'const s=require("net").createServer().listen(0,()=>{console.log(s.address().port);s.close()})'; }
waitfor() { i=0; until curl -s -o /dev/null "$1" || [ $i -ge 120 ]; do sleep 0.5; i=$((i + 1)); done; }
UI_URL=""; WEB_URL=""
case " $APPS " in *" ui "*)
  p=$(port); UI_URL="http://127.0.0.1:$p"
  (cd ui && exec node node_modules/vite/bin/vite.js --port "$p" --strictPort >"$tmp/ui.log" 2>&1) & pids="$pids $!"
  waitfor "$UI_URL/" ;;
esac
case " $APPS " in *" web "*)
  p=$(port); WEB_URL="http://127.0.0.1:$p"
  (cd web && TMDB_KEY="" APP_PASSWORD="" HTTP_FIXTURES="$PWD/../tests/fixtures/web-http" exec node node_modules/vite/bin/vite.js dev --port "$p" --strictPort --host 127.0.0.1 >"$tmp/web.log" 2>&1) & pids="$pids $!"
  waitfor "$WEB_URL/" ;;
esac

rc=0
CARGS=""; [ "$MODE" = "--changed" ] && CARGS="--changed" # (el `--all` de contracts.sh es otra cosa: los `regressed` también fallan)
UI_URL="$UI_URL" WEB_URL="$WEB_URL" sh scripts/contracts.sh $CARGS || rc=1
# `--only` no admite listas: sin cambios de una app, el filtro de visual es el mismo `--changed`.
VISUAL_ARGS=""
[ -n "$UI_URL" ] && VISUAL_ARGS="$VISUAL_ARGS --ui-url $UI_URL"
[ -n "$WEB_URL" ] && VISUAL_ARGS="$VISUAL_ARGS --web-url $WEB_URL"
[ "$MODE" = "--changed" ] && VISUAL_ARGS="$VISUAL_ARGS --changed"
node scripts/visual.mjs $VISUAL_ARGS || rc=1
[ $rc = 0 ] && echo "verify-ui ok" || echo "verify-ui: FALLA (ver arriba)"
exit $rc
