#!/bin/sh
# Chequeos del proyecto (2026-11-17; en paralelo desde 2026-11-22). Rápido (por defecto): formato, clippy
# (lib, binarios y tests; sin ejemplos) y tipos/lint del JS, cada uno solo si cambió lo suyo (ver `changed` abajo).
# `full`: además los tests (nextest, node --test) con el mismo mapeo y clippy de los ejemplos; serializado con
# otros `full` por scripts/lib/heavy-lock.sh.
#   sh scripts/check.sh        # rápido
#   sh scripts/check.sh full   # + tests
# Para chequeo continuo mientras se edita: `bacon` (clippy) o `bacon nextest`.
set -e
cd "$(dirname "$0")/.."
export PATH="$HOME/.nvm/versions/node/v24.21.0/bin:/opt/homebrew/bin:$PATH" # node 24 primero (la web usa su type stripping; el de Homebrew es viejo); cargo-nextest
# target/ único para el checkout principal y todos sus worktrees (2026-11-23): las dependencias se compilan una
# vez, y el lock de cargo pone en fila los builds de distintos worktrees en vez de correrlos juntos (exit 137).
SHARED_TARGET="$(cd "$(git rev-parse --git-common-dir)/.." && pwd)/target"
export CARGO_TARGET_DIR="${CARGO_TARGET_DIR:-$SHARED_TARGET}"
# Clippy y nextest corren a la vez: 4 jobs cada uno para no pasar los 8 núcleos.
export CARGO_BUILD_JOBS="${CARGO_BUILD_JOBS:-4}"
# clippy con su propia carpeta: si comparte la de nextest, cargo los serializa con su lock.
CLIPPY_TARGET="$CARGO_TARGET_DIR/clippy"
[ "$1" = "full" ] && CLIPPY_TARGETS="--all-targets" || CLIPPY_TARGETS="--lib --bins --tests"

# Qué correr según lo tocado (2026-11-23; por carril 2026-11-24): cuenta lo sin commitear (incluidos archivos nuevos)
# y los commits que todavía no se pushearon (funciona también sin upstream: worktrees, detached).
#   ruta tocada      → qué corre            (tests/, scripts/ y docs/ no disparan nada)
#   ui/              → ui check
#   web/             → web check
#   packages/ui/     → ui check + web check
#   packages/golden/ → Rust + test golden de la web
# Forzar: RUST=1 (Rust, incluido src-tauri) · ALL=1 (todo) · FORCE=1 (ignora el stamp de "ya pasó").
changed() {
  [ "$ALL" = 1 ] && return 0
  [ -n "$(git status --porcelain -- "$@")" ] && return 0
  [ -n "$(git log --format= --name-only HEAD --not --remotes=origin -- "$@")" ]
}
STAMP_ENV="RUST=$RUST ALL=$ALL"
RUST_PATHS="crates src-tauri Cargo.toml Cargo.lock packages/golden"
TAURI=0
if [ "$RUST" = 1 ] || [ "$ALL" = 1 ]; then
  RUST=1
  TAURI=1
else
  RUST=0
  changed $RUST_PATHS && RUST=1
  changed src-tauri Cargo.toml Cargo.lock && TAURI=1
fi
UI=0; WEB=0; PKG=0; GOLD=0
changed ui && UI=1
changed web && WEB=1
changed packages/ui && PKG=1
changed packages/golden && GOLD=1

# "Ya pasó": mismo HEAD, mismo diff, mismos archivos nuevos, mismos scripts y mismo modo = mismo resultado.
# No ve los ignorados que importan (web/.env.local): FORCE=1 lo saltea.
common=$(git rev-parse --git-common-dir)
key=$({
  git rev-parse HEAD
  git diff --binary HEAD
  git ls-files -o --exclude-standard
  git ls-files -o --exclude-standard -z | xargs -0 cat 2>/dev/null
  cat scripts/check.sh scripts/lib/*
  echo "mode=${1:-fast} $STAMP_ENV"
} | shasum | cut -d' ' -f1)
stamp="$common/check-ok/$key"
if [ -z "$FORCE" ] && [ -e "$stamp" ]; then
  echo "check ok${1:+ ($1)} (ya pasó con este mismo contenido; FORCE=1 lo ignora)"
  exit 0
fi

. scripts/lib/heavy-lock.sh
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"; heavy_unlock' EXIT
[ "$1" = "full" ] && heavy_lock "check.sh full"
# Cada chequeo en segundo plano escribe su salida aparte; al final se muestra solo la de los que fallaron.
run() { name=$1; shift; ( "$@" >"$tmp/$name.log" 2>&1 || touch "$tmp/$name.fail" ) & }

if [ "$RUST" = 1 ]; then
  run fmt cargo fmt --all --check
  # Solo el núcleo (clippy de --workspace compila tauri y duplica tokio/reqwest/librqbit); src-tauri solo si cambió.
  # Los dos comparten carpeta de clippy: van en fila, no a la vez.
  clippy_cmd="cargo clippy -p streamonte-core $CLIPPY_TARGETS -q -- -D warnings"
  [ "$TAURI" = 1 ] && clippy_cmd="$clippy_cmd && cargo clippy -p streamonte $CLIPPY_TARGETS -q -- -D warnings"
  run clippy env CARGO_TARGET_DIR="$CLIPPY_TARGET" sh -c "$clippy_cmd"
fi
# oxlint (ui/.oxlintrc.json: globales del navegador, no-undef) y tipos estrictos (svelte-check + ui/tsconfig.json).
# Directo a node_modules/.bin: `corepack pnpm` suma ~0,3 s por llamada.
if [ "$UI" = 1 ] || [ "$PKG" = 1 ]; then
  run js sh -c 'cd ui && node_modules/.bin/oxlint src >/dev/null && node_modules/.bin/svelte-check --tsconfig ./tsconfig.json >/dev/null'
fi
if [ "$WEB" = 1 ] || [ "$PKG" = 1 ]; then
  run web sh -c 'cd web && node_modules/.bin/svelte-kit sync >/dev/null && node_modules/.bin/svelte-check --tsconfig ./tsconfig.json >/dev/null'
fi
if [ "$1" = "full" ]; then
  # packages/ui: tsc estricto con su propio typescript (workspace). Solo en full y en CI (el carril rápido lo cubre con
  # ui check): agarra globales de solo desktop (ui/src/globals.d.ts, vite/client) usados por error en packages/ui.
  if [ "$PKG" = 1 ] || [ "$UI" = 1 ]; then run uipkg sh -c 'cd packages/ui && node_modules/.bin/tsc -p tsconfig.json'; fi
  if [ "$UI" = 1 ] || [ "$WEB" = 1 ] || [ "$PKG" = 1 ]; then run uipkgtest sh -c 'cd packages/ui && node --test "src/**/*.test.ts"'; fi
  if [ "$UI" = 1 ] || [ "$PKG" = 1 ]; then run uitest sh -c 'cd ui && node --test "src/**/*.test.{js,ts}"'; fi
  if [ "$WEB" = 1 ] || [ "$PKG" = 1 ] || [ "$GOLD" = 1 ]; then run webtest sh -c 'cd web && node --test "src/**/*.test.{js,ts}"'; fi
  # Solo cambió packages/golden/: el lector del desktop (ui) no corre con el resto.
  if [ "$GOLD" = 1 ] && [ "$UI" != 1 ] && [ "$PKG" != 1 ]; then run uigolden sh -c 'cd ui && node --test src/golden-status.test.ts'; fi
  # --lib --tests: sin compilar los ejemplos (los compila clippy de arriba).
  if [ "$RUST" = 1 ]; then cargo nextest run -p streamonte-core --lib --tests --no-fail-fast --status-level fail --final-status-level fail || touch "$tmp/nextest.fail"; fi
elif [ "$GOLD" = 1 ]; then
  run webgolden sh -c 'cd web && node --test src/lib/server/golden.test.ts src/lib/server/golden-rules.test.ts'
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
# Poda de target/ (a lo sumo una vez cada 6 h) en segundo plano.
(nohup sh scripts/trim-target.sh >/dev/null 2>&1 &)
[ "$failed" = 0 ] || exit 1
mkdir -p "$common/check-ok" && touch "$stamp"
find "$common/check-ok" -type f -mtime +7 -delete 2>/dev/null
[ "$RUST" = 1 ] && echo "check ok${1:+ ($1)}" || echo "check ok${1:+ ($1)} (Rust sin cambios: salteado; forzar con RUST=1)"
