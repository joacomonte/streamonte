#!/bin/sh
# Baja el mpv oficial que trae la app (2026-11-17) a src-tauri/mpv/, que Tauri incluye como recurso
# (`bundle.resources`). Lo corre el release antes de compilar cada plataforma; en desarrollo es
# opcional (sin él, la app usa el mpv instalado o VLC).
#   sh scripts/fetch-mpv.sh macos-arm | macos-intel | windows
# Versión y checksums fijos: cambiar a otra versión = actualizar los tres sha256.
set -eu
VERSION=v0.42.0
case "${1:-}" in
  macos-arm)   ASSET=mpv-$VERSION-macos-15-arm.zip;   SHA=be1b8d2445e6880860869c080b8710dee189721f1fa4689840db6a2c10d7be69 ;;
  macos-intel) ASSET=mpv-$VERSION-macos-15-intel.zip; SHA=2d2f34350ff844b6014c35f21ca142937275e19c0c673150a8564fcd2f3bfa14 ;;
  windows)     ASSET=mpv-$VERSION-x86_64-pc-windows-msvc.zip; SHA=8dd69cbab079086765fa5d873c09513b2834b85d146c1301718a757e8c0595ef ;;
  *) echo "uso: $0 macos-arm | macos-intel | windows" >&2; exit 2 ;;
esac
cd "$(dirname "$0")/.."
OUT=src-tauri/mpv
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
curl -sSfL -o "$TMP/mpv.zip" "https://github.com/mpv-player/mpv/releases/download/$VERSION/$ASSET"
GOT=$( (sha256sum "$TMP/mpv.zip" 2>/dev/null || shasum -a 256 "$TMP/mpv.zip") | cut -d' ' -f1)
[ "$GOT" = "$SHA" ] || { echo "checksum distinto para $ASSET: $GOT" >&2; exit 1; }
# Python está en todos los runners (unzip no siempre en Windows); allá puede llamarse `python`.
PY=$(command -v python3 || command -v python)
"$PY" -m zipfile -e "$TMP/mpv.zip" "$TMP/x"
# Deja solo lo de esta plataforma (conserva .gitkeep).
find "$OUT" -mindepth 1 ! -name .gitkeep -exec rm -rf {} + 2>/dev/null || true
if [ "$1" = windows ]; then
  cp "$TMP/x/mpv.exe" "$TMP/x/vulkan-1.dll" "$OUT/"
else
  # El zip de macOS trae un tar con mpv.app (conserva los permisos y la firma).
  tar -xzf "$TMP/x/mpv.tar.gz" -C "$OUT"
fi
# Algunos archivos vienen de solo lectura (libMoltenVK): sin escritura, Tauri no puede volver a
# copiar los recursos en cada compilación.
chmod -R u+w "$OUT"
echo "mpv $VERSION ($1) en $OUT"
