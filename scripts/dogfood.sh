#!/bin/sh
# Probar la app instalada sin release: build local (perfil `dogfood` de Cargo.toml, sin LTO e incremental)
# que reemplaza /Applications/Streamonte.app y la abre. Mismos datos y keychain que la app de los usuarios.
# Uso: sh scripts/dogfood.sh [--no-install]
# La primera vez compila todas las deps (varios minutos); después, solo lo tocado.
# Solo macOS. Para Windows sigue haciendo falta el release (o un build en CI).
set -eu
cd "$(dirname "$0")/.."
export PATH="$HOME/.nvm/versions/node/v24.21.0/bin:/opt/homebrew/bin:$PATH" # node 24 primero (igual que check.sh)
export CARGO_TARGET_DIR="${CARGO_TARGET_DIR:-$(cd "$(git rev-parse --git-common-dir)/.." && pwd)/target}"
start=$(date +%s)

echo "› UI (vite build)"
(cd ui && node_modules/.bin/vite build --logLevel error)

echo "› App (perfil dogfood)"
# createUpdaterArtifacts=false: sin la clave de firma del updater, que solo existe en CI.
ui/node_modules/.bin/tauri build --bundles app \
  --config '{"bundle":{"createUpdaterArtifacts":false}}' \
  -- --profile dogfood

app="$CARGO_TARGET_DIR/dogfood/bundle/macos/Streamonte.app"
[ -d "$app" ] || { echo "no encontré $app" >&2; exit 1; }

dest="$app"
if [ "${1-}" != "--no-install" ]; then
  if pgrep -x streamonte >/dev/null; then
    osascript -e 'quit app "Streamonte"' || true
    while pgrep -x streamonte >/dev/null; do sleep 0.2; done
  fi
  rsync -a --delete "$app/" /Applications/Streamonte.app/
  open /Applications/Streamonte.app
  dest=/Applications/Streamonte.app
fi
echo "✓ dogfood en $(( $(date +%s) - start )) s → $dest"
