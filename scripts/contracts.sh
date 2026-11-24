#!/bin/sh
# Contratos de pantalla (tests/contracts/*.json): levanta web (vite dev) y desktop (vite + mock) en puertos libres,
# corre cada contrato con `shot.mjs --contract` y apaga los servidores. Exit 1 si falla algo que no es `regressed`.
#   sh scripts/contracts.sh [--all] [--changed] [nombre...]    # --all: los `regressed` también fallan; nombre = web-home, desktop-ajustes…
#   --changed: solo los contratos de la app tocada (misma regla que `visual.mjs --changed`: ui/ → desktop, web/ → web, packages/ → las dos)
#   LIVE=1 sh scripts/contracts.sh                 # suma los contratos `"live": true` (TorBox real: lentos)
#   UI_URL=http://… WEB_URL=http://…               # usar servers ya levantados (lo hace verify-ui.sh); la web debe tener HTTP_FIXTURES
#   JOBS=n                                         # contratos en paralelo (2 por defecto)
# Solo levanta el server de las apps que tienen contratos elegidos.
# La web responde TMDB/addons/OS.org desde tests/fixtures/web-http (graba lo que falte; borrar la carpeta para refrescar).
# Sin fixture grabada necesita web/.env.local y web/.data/keys.json; TorBox (LIVE) siempre es real.
cd "$(dirname "$0")/.."
export PATH="$HOME/.nvm/versions/node/v24.21.0/bin:/opt/homebrew/bin:$PATH"
ALL=""; CHANGED=""; NAMES=""
for a in "$@"; do
  case "$a" in --all) ALL="--all" ;; --changed) CHANGED=1 ;; *) NAMES="$NAMES $a" ;; esac
done

APPS=""
if [ -n "$CHANGED" ]; then
  APPS=$(node scripts/visual.mjs --changed-apps) || exit 1
  [ -z "$APPS" ] && { echo "contratos: sin cambios de UI, nada que correr"; exit 0; }
fi
tmp=$(mktemp -d)
# Un solo node lee app y live de todos los JSON y escribe "ruta app" por contrato elegido (nombre, --changed, live).
NAMES="$NAMES" APPS="$APPS" LIVE_ON="$LIVE" node -e '
const fs = require("fs");
const names = process.env.NAMES.split(" ").filter(Boolean), apps = process.env.APPS.split(" ").filter(Boolean);
for (const f of fs.readdirSync("tests/contracts").filter((f) => f.endsWith(".json")).sort()) {
  const n = f.slice(0, -5), c = JSON.parse(fs.readFileSync("tests/contracts/" + f, "utf8"));
  if (names.length && !names.includes(n)) continue;
  if (apps.length && !apps.includes(c.app === "web" ? "web" : "ui")) continue;
  if (c.live && !process.env.LIVE_ON && !names.length) continue;
  console.log("tests/contracts/" + f + " " + c.app);
}' >"$tmp/chosen"
[ -s "$tmp/chosen" ] || { echo "contratos: ninguno elegido"; rm -rf "$tmp"; exit 0; }

port() { node -e 'const s=require("net").createServer().listen(0,()=>{console.log(s.address().port);s.close()})'; }
pids=""
stop() { for p in $pids; do kill "$p" 2>/dev/null; done; rm -rf "$tmp"; }
trap stop EXIT INT TERM
waitfor() { i=0; until curl -s -o /dev/null "$1" || [ $i -ge 120 ]; do sleep 0.5; i=$((i + 1)); done; }
BASE_WEB="$WEB_URL"; BASE_UI="$UI_URL"
if grep -q ' web$' "$tmp/chosen" && [ -z "$BASE_WEB" ]; then
  PW=$(port); BASE_WEB="http://localhost:$PW"
  (cd web && HTTP_FIXTURES="$PWD/../tests/fixtures/web-http" exec node node_modules/vite/bin/vite.js dev --port "$PW" --strictPort >"$tmp/web.log" 2>&1) & pids="$pids $!"
  waitfor "$BASE_WEB/"
fi
if grep -q -v ' web$' "$tmp/chosen" && [ -z "$BASE_UI" ]; then
  PD=$(port); BASE_UI="http://127.0.0.1:$PD"
  (cd ui && exec node node_modules/vite/bin/vite.js --port "$PD" --strictPort >"$tmp/ui.log" 2>&1) & pids="$pids $!"
  waitfor "$BASE_UI/"
fi

run() {
  f=$1; n=$(basename "$f" .json)
  [ "$2" = web ] && base="$BASE_WEB" || base="$BASE_UI"
  node scripts/shot.mjs --contract "$f" --base "$base" $ALL >"$tmp/$n.out" 2>"$tmp/$n.err"; echo $? >"$tmp/$n.rc"
}
# De a ${JOBS:-2}: un Chrome por contrato y los 18 juntos saturan la Mac (carga ~190) y los goto vencen al azar.
jobs=""; n=0
while read -r f app; do
  run "$f" "$app" & jobs="$jobs $!"; n=$((n + 1))
  [ $((n % ${JOBS:-2})) = 0 ] && { wait $jobs; jobs=""; }
done <"$tmp/chosen"
[ -n "$jobs" ] && wait $jobs # solo los contratos (con un número par de contratos queda vacío): un `wait` pelado esperaría también a los servidores

# Salida compacta: una línea por contrato OK; el JSON y stderr completos solo de los que fallan o recuperan algo.
rc=0; total=0
for f in "$tmp"/*.rc; do
  n=$(basename "$f" .rc); total=$((total + 1))
  if [ "$(cat "$f")" = 0 ]; then
    node -e '
      const l = require("fs").readFileSync(process.argv[1], "utf8").trim().split("\n").pop();
      try { const r = JSON.parse(l); if (!r.fixed) { console.log("ok   " + r.contract + " (" + r.passed + (r.regressed.length ? ", " + r.regressed.length + " regressed" : "") + ")"); process.exit(0); } } catch {}
      console.log(l);' "$tmp/$n.out"
  else
    rc=1; echo "FALLA $n"; cat "$tmp/$n.out"
  fi
  [ -s "$tmp/$n.err" ] && cat "$tmp/$n.err"
done
[ $rc = 0 ] && echo "contratos ok ($total)" || echo "contratos: FALLAN (ver arriba)"
exit $rc
