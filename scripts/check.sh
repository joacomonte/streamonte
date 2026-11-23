#!/bin/sh
# Chequeos del proyecto (2026-11-17; en paralelo desde 2026-11-22). Rápido (por defecto): formato, clippy
# (lib, binarios y tests; sin ejemplos), tipos y lint del JS de la UI. `full`: además los tests del núcleo
# (nextest), los de la UI y de packages/ui (node --test), tipos y tests de la web y clippy de los ejemplos.
#   sh scripts/check.sh        # rápido
#   sh scripts/check.sh full   # + tests
# Para chequeo continuo mientras se edita: `bacon` (clippy) o `bacon nextest`.
set -e
cd "$(dirname "$0")/.."
export PATH="$HOME/.nvm/versions/node/v24.21.0/bin:/opt/homebrew/bin:$PATH" # node 24 primero (la web usa su type stripping; el de Homebrew es viejo); cargo-nextest
# clippy con su propia carpeta: si comparte la de nextest, cargo los serializa con su lock.
CLIPPY_TARGET="target/clippy"
[ "$1" = "full" ] && CLIPPY_TARGETS="--all-targets" || CLIPPY_TARGETS="--lib --bins --tests"

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
# Cada chequeo en segundo plano escribe su salida aparte; al final se muestra solo la de los que fallaron.
run() { name=$1; shift; ( "$@" >"$tmp/$name.log" 2>&1 || touch "$tmp/$name.fail" ) & }

run fmt cargo fmt --all --check
run clippy env CARGO_TARGET_DIR="$CLIPPY_TARGET" cargo clippy --workspace $CLIPPY_TARGETS -q -- -D warnings
# oxlint (ui/.oxlintrc.json: globales del navegador, no-undef) y tsc con checkJs estricto (svelte-check + ui/tsconfig.js.json).
run js sh -c 'cd ui && corepack pnpm -s lint >/dev/null && corepack pnpm -s check >/dev/null'
# packages/ui (código compartido web + desktop): tsc estricto con el typescript de ui/node_modules.
run uipkg sh -c 'cd packages/ui && corepack pnpm -s check'
if [ "$1" = "full" ]; then
  run uipkgtest sh -c 'cd packages/ui && corepack pnpm -s test'
  run uitest sh -c 'cd ui && corepack pnpm -s test'
  # Web (monorepo, 2026-11-22): tipos y tests, en paralelo con el resto.
  run web sh -c 'cd web && corepack pnpm -s check >/dev/null && corepack pnpm -s test'
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
# Poda de target/ (24 h y tope de tamaño) en segundo plano.
(nohup sh scripts/trim-target.sh >/dev/null 2>&1 &)
[ "$failed" = 0 ] || exit 1
echo "check ok${1:+ ($1)}"
