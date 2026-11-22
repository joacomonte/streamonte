#!/bin/sh
# Chequeos del proyecto (2026-11-17; en paralelo desde 2026-11-22). Rápido (por defecto): formato, clippy
# (lib, binarios y tests; sin ejemplos), tipos y lint del JS de la UI. `full`: además los tests del núcleo
# (nextest), los de la UI (deno test) y clippy de los ejemplos.
#   sh scripts/check.sh        # rápido
#   sh scripts/check.sh full   # + tests
# Para chequeo continuo mientras se edita: `bacon` (clippy) o `bacon nextest`.
set -e
cd "$(dirname "$0")/.."
export PATH="/opt/homebrew/bin:$PATH" # deno, cargo-nextest (Homebrew de Apple Silicon)
# clippy con su propia carpeta: si comparte la de nextest, cargo los serializa con su lock.
CLIPPY_TARGET="target/clippy"
[ "$1" = "full" ] && CLIPPY_TARGETS="--all-targets" || CLIPPY_TARGETS="--lib --bins --tests"

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
# Cada chequeo en segundo plano escribe su salida aparte; al final se muestra solo la de los que fallaron.
run() { name=$1; shift; ( "$@" >"$tmp/$name.log" 2>&1 || touch "$tmp/$name.fail" ) & }

run fmt cargo fmt --all --check
run clippy env CARGO_TARGET_DIR="$CLIPPY_TARGET" cargo clippy --workspace $CLIPPY_TARGETS -q -- -D warnings
# no-window*: la UI usa `window` a propósito (es un webview, no Deno). `no-undef` no conoce los globales del
# navegador: lint-undef.py ignora solo esos (2026-11-17: un `const` borrado de más no lo marcaba nadie).
run js sh -c 'deno lint -q --rules-exclude=no-window,no-window-prefix ui/src &&
  deno lint --json --rules-include=no-undef ui/src | python3 scripts/lint-undef.py &&
  deno check -q --config ui/deno.json ui/src/*.js'
if [ "$1" = "full" ]; then
  run uitest deno test -q --no-check --allow-read --config ui/deno.json ui/src
  # --lib --tests: sin compilar los ejemplos (los compila clippy de arriba).
  cargo nextest run -p streamonte-core --lib --tests --no-fail-fast --status-level fail --final-status-level fail || touch "$tmp/nextest.fail"
fi
wait

failed=0
for f in "$tmp"/*.fail; do
  [ -e "$f" ] || continue
  name=$(basename "$f" .fail)
  failed=1
  echo "── $name falló"
  [ -s "$tmp/$name.log" ] && cat "$tmp/$name.log"
done
[ "$failed" = 0 ] || exit 1
echo "check ok${1:+ ($1)}"
