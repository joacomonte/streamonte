#!/bin/sh
# Chequeos del proyecto (2026-11-17). Rápido (por defecto, ~3-4 s tras un cambio): formato, clippy de
# todo el workspace (cubre `cargo check` y los ejemplos) y lint del JS. `full`: además los tests del
# núcleo con nextest (en paralelo; sin ejemplos ni doc-tests, que no hay).
#   sh scripts/check.sh        # rápido
#   sh scripts/check.sh full   # + tests
# Para chequeo continuo mientras se edita: `bacon` (clippy) o `bacon nextest`.
set -e
cd "$(dirname "$0")/.."
export PATH="/opt/homebrew/bin:$PATH" # deno, cargo-nextest (Homebrew de Apple Silicon)

cargo fmt --all --check
cargo clippy --workspace --all-targets -q -- -D warnings
# no-window*: la UI usa `window` a propósito (es un webview, no Deno).
deno lint -q --rules-exclude=no-window,no-window-prefix ui/src
if [ "$1" = "full" ]; then
  cargo nextest run -p streamonte-core --no-fail-fast --status-level fail
fi
echo "check ok${1:+ ($1)}"
