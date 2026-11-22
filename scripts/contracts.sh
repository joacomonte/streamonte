#!/bin/sh
# Contratos de pantalla (tests/contracts/*.json): levanta web (vite dev) y desktop (vite + mock) en puertos libres,
# corre cada contrato con `shot.mjs --contract` y apaga los servidores. Exit 1 si falla algo que no es `regressed`.
#   sh scripts/contracts.sh [--all] [nombre...]    # --all: los `regressed` también fallan; nombre = web-home, desktop-ajustes…
#   LIVE=1 sh scripts/contracts.sh                 # suma los contratos `"live": true` (TorBox real: lentos)
# La web necesita web/.env.local y web/.data/keys.json (TMDB real); sin ellos web-* fallan.
cd "$(dirname "$0")/.."
export PATH="$HOME/.nvm/versions/node/v24.21.0/bin:/opt/homebrew/bin:$PATH"
ALL=""; NAMES=""
for a in "$@"; do [ "$a" = "--all" ] && ALL="--all" || NAMES="$NAMES $a"; done

port() { node -e 'const s=require("net").createServer().listen(0,()=>{console.log(s.address().port);s.close()})'; }
PW=$(port); PD=$(port)
tmp=$(mktemp -d)
pids=""
stop() { for p in $pids; do kill "$p" 2>/dev/null; done; rm -rf "$tmp"; }
trap stop EXIT INT TERM
(cd web && exec npx vite dev --port "$PW" --strictPort >"$tmp/web.log" 2>&1) & pids="$pids $!"
(cd ui && exec node node_modules/vite/bin/vite.js --port "$PD" --strictPort >"$tmp/ui.log" 2>&1) & pids="$pids $!"
for p in $PW $PD; do
  i=0; until curl -s -o /dev/null "http://127.0.0.1:$p/" || [ $i -ge 60 ]; do sleep 0.5; i=$((i + 1)); done
done

run() {
  f=$1; n=$(basename "$f" .json)
  [ -n "$NAMES" ] && case " $NAMES " in *" $n "*) ;; *) return ;; esac
  app=$(node -p "JSON.parse(require('fs').readFileSync('$f','utf8')).app")
  live=$(node -p "!!JSON.parse(require('fs').readFileSync('$f','utf8')).live")
  [ "$live" = true ] && [ -z "$LIVE" ] && [ -z "$NAMES" ] && return
  [ "$app" = web ] && base="http://localhost:$PW" || base="http://127.0.0.1:$PD"
  node scripts/shot.mjs --contract "$f" --base "$base" $ALL >"$tmp/$n.out" 2>"$tmp/$n.err"; echo $? >"$tmp/$n.rc"
}
jobs=""
for f in tests/contracts/*.json; do run "$f" & jobs="$jobs $!"; done
wait $jobs # solo los contratos: un `wait` pelado esperaría también a los servidores

rc=0
for f in "$tmp"/*.rc; do
  [ -e "$f" ] || continue
  n=$(basename "$f" .rc)
  cat "$tmp/$n.out"
  [ -s "$tmp/$n.err" ] && cat "$tmp/$n.err"
  [ "$(cat "$f")" = 0 ] || rc=1
done
[ $rc = 0 ] && echo "contratos ok" || echo "contratos: FALLAN (ver arriba)"
exit $rc
