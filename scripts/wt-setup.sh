#!/bin/sh
# Deja un worktree listo para trabajar en segundos: dependencias de web y ui desde el store de pnpm (sin red si ya
# están bajadas) y las keys locales de la web copiadas del checkout principal (sin imprimirlas).
#   sh scripts/wt-setup.sh        # desde la raíz del worktree
set -e
cd "$(dirname "$0")/.."
export PATH="$HOME/.nvm/versions/node/v24.21.0/bin:/opt/homebrew/bin:$PATH" COREPACK_ENABLE_DOWNLOAD_PROMPT=0
main=$(git worktree list --porcelain | sed -n '1s/^worktree //p')
for d in web ui; do (cd "$d" && corepack pnpm install --frozen-lockfile --prefer-offline --config.confirmModulesPurge=false --reporter=silent) & done
wait
if [ "$main" != "$(pwd)" ]; then
  [ -f "$main/web/.env.local" ] && cp "$main/web/.env.local" web/.env.local
  # .data: keys + cachés (índice IMDb ~60 MB, fichas TMDB); clon APFS, instantáneo y sin bajar nada.
  [ -d "$main/web/.data" ] && rm -rf web/.data && cp -cR "$main/web/.data" web/.data
fi
echo "worktree listo"
