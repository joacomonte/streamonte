#!/bin/sh
# El CI de GitHub (.github/workflows/ci.yml) corrido acá, con los mismos comandos (2026-11-23): para no enterarse
# en la nube, que tarda. Lo corre el hook `pre-push` (.githooks/pre-push). No cubre Windows (solo se ve en el CI)
# ni las pruebas de red. Si cambia ci.yml, cambiar esto también.
#   sh scripts/ci-local.sh
set -e
cd "$(dirname "$0")/.."
export PATH="$HOME/.nvm/versions/node/v24.21.0/bin:/opt/homebrew/bin:$PATH" # node 24 como el CI

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
run() { name=$1; shift; ( "$@" >"$tmp/$name.log" 2>&1 || touch "$tmp/$name.fail" ) & }

# Dependencias exactas del lockfile, como el CI (sin red si ya están en el store).
for d in web ui; do (cd "$d" && corepack pnpm -s install --frozen-lockfile >/dev/null) || touch "$tmp/install-$d.fail"; done

# job core: fmt, clippy y `cargo test` (no nextest: el CI corre los tests en hilos del mismo proceso).
# clippy en su carpeta (la de check.sh) para no esperar el lock de la de tests.
run fmt cargo fmt --all --check
run clippy env CARGO_TARGET_DIR=target/clippy cargo clippy -p streamonte-core --all-targets -q -- -D warnings
run core-test cargo test -q -p streamonte-core
# job web
run web sh -c 'cd web && corepack pnpm -s check && corepack pnpm -s test'
# job ui
run ui sh -c 'cd ui && corepack pnpm -s lint && corepack pnpm -s check && corepack pnpm -s test && corepack pnpm -s build'
# job shared-ui
run shared-ui sh -c 'cd packages/ui && corepack pnpm -s check && corepack pnpm -s test'
wait

failed=0
for f in "$tmp"/*.fail; do
  [ -e "$f" ] || continue
  name=$(basename "$f" .fail)
  failed=1
  echo "── $name falló"
  [ -f "$tmp/$name.log" ] && tail -40 "$tmp/$name.log"
done
# Poda de target/ (tope de tamaño) en segundo plano: no demora el push.
(nohup sh scripts/trim-target.sh >/dev/null 2>&1 &)
[ $failed = 0 ] && echo "ci local ok" || exit 1
