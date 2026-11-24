#!/bin/sh
# Tests de node (sin Chrome ni Rust) de lo tocado: lo sin commitear (incluidos archivos nuevos) y los commits sin pushear
# (mismo criterio que `changed` de check.sh). Nunca corre cargo.
#   packages/ui/** o packages/golden/* → todos los tests de node (packages/ui, ui y web)
#   web/*                   → todos los de web (los tests viven en carpetas padre: no se mapea por carpeta)
#   ui/*                    → todos los de ui
#   crates/, src-tauri/, docs/, scripts/, tests/…        → nada
# Sin nada que correr sale en silencio. Uso: sh scripts/test-touched.sh   (ALL=1 fuerza todo; TOUCHED="a b" simula la lista de tocados)
set -e
cd "$(dirname "$0")/.."
export PATH="$HOME/.nvm/versions/node/v24.21.0/bin:/opt/homebrew/bin:$PATH"

if [ -n "$TOUCHED" ]; then
  touched=$TOUCHED
else
  touched=$({
    git status --porcelain | cut -c4- | sed 's/.* -> //'
    git log --format= --name-only HEAD --not --remotes=origin
  } | sort -u)
fi

all_tests() {
  ls packages/ui/src/*/*.test.ts packages/ui/src/*.test.ts packages/ui/test/*.test.ts 2>/dev/null || true
  web_tests
  ui_tests
}
web_tests() { find web/src -name '*.test.*' -not -path '*/node_modules/*' 2>/dev/null || true; }
ui_tests() { find ui/src -name '*.test.*' -not -path '*/node_modules/*' 2>/dev/null || true; }

files=""
if [ "$ALL" = 1 ]; then
  files=$(all_tests)
else
  for f in $touched; do
    case "$f" in
      packages/ui/*|packages/golden/*) files=$(all_tests); break ;; # check.sh manda packages/ui a ui + web
      web/*) files="$files
$(web_tests)" ;;
      ui/*) files="$files
$(ui_tests)" ;;
    esac
  done
fi

files=$(echo "$files" | grep . | sort -u || true)
[ -z "$files" ] && exit 0
out=$(mktemp)
# shellcheck disable=SC2086
if node --test $files >"$out" 2>&1; then rc=0; else rc=$?; fi
[ "$rc" != 0 ] && grep -E '^not ok|✖|^ℹ fail' "$out" | head -20
rm -f "$out"
exit $rc
