#!/bin/sh
# El CI de GitHub (.github/workflows/ci.yml) corrido acá (2026-11-23): para no enterarse en la nube, que tarda.
# Los comandos salen de los `run:` de ci.yml (scripts/lib/ci-steps.mjs), así que cambiar ci.yml basta. A mano (sin hook
# pre-push desde 2026-11-24: valida el CI de GitHub). No cubre Windows (solo se ve en el CI) ni las pruebas de red.
# Cada job corre en paralelo con los demás; sus pasos, en orden, salvo el job de cargo (fmt/clippy/test van a la vez).
#   sh scripts/ci-local.sh
set -e
cd "$(dirname "$0")/.."
export PATH="$HOME/.nvm/versions/node/v24.21.0/bin:/opt/homebrew/bin:$PATH" # node 24 como el CI
# target/ único para todos los worktrees y 4 jobs por cargo, como check.sh (2026-11-23).
export CARGO_TARGET_DIR="${CARGO_TARGET_DIR:-$(cd "$(git rev-parse --git-common-dir)/.." && pwd)/target}"
export CARGO_BUILD_JOBS="${CARGO_BUILD_JOBS:-4}"
. scripts/lib/heavy-lock.sh

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"; heavy_unlock' EXIT
heavy_lock "ci-local.sh"
tab=$(printf '\t')
node scripts/lib/ci-steps.mjs | grep -v "${tab}corepack enable\$" >"$tmp/steps"

# Un paso: `pnpm x` → `corepack pnpm -s x`; clippy en su carpeta (la de check.sh) para no esperar el lock de la de tests.
step() {
  case $3 in pnpm\ *) set -- "$1" "$2" "corepack pnpm -s ${3#pnpm }" ;; esac
  case $3 in "cargo clippy"*) export CARGO_TARGET_DIR="$CARGO_TARGET_DIR/clippy" ;; esac
  (cd "$2" && eval "$3")
}
for job in $(cut -f1 "$tmp/steps" | sort -u); do
  grep "^$job$tab" "$tmp/steps" >"$tmp/$job.steps"
  if ! grep -qv "^$job$tab[^$tab]*${tab}cargo " "$tmp/$job.steps"; then
    # Todo cargo: los pasos a la vez, cada uno con su log.
    n=0
    while IFS="$tab" read -r j dir cmd; do
      n=$((n + 1)); ( step "$j" "$dir" "$cmd" >"$tmp/$job-$n.log" 2>&1 || touch "$tmp/$job-$n.fail" ) &
    done <"$tmp/$job.steps"
  else
    ( while IFS="$tab" read -r j dir cmd; do step "$j" "$dir" "$cmd" || exit 1; done <"$tmp/$job.steps" >"$tmp/$job.log" 2>&1 || touch "$tmp/$job.fail" ) &
  fi
done
wait

failed=0
for f in "$tmp"/*.fail; do
  [ -e "$f" ] || continue
  failed=1
  echo "── $(basename "$f" .fail) falló"
  [ -f "${f%.fail}.log" ] && tail -40 "${f%.fail}.log"
done
# Poda de target/ (a lo sumo una vez cada 6 h) en segundo plano: no demora el push.
(nohup sh scripts/trim-target.sh >/dev/null 2>&1 &)
[ $failed = 0 ] && echo "ci local ok" || exit 1
