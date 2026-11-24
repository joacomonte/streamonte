#!/bin/sh
# Tests de node (sin Chrome ni Rust) de lo tocado: lo sin commitear (incluidos archivos nuevos) y los commits sin pushear
# (mismo criterio que `changed` de check.sh). Nunca corre cargo.
#   packages/ui/**          → todos los tests de packages/ui (src/**/*.test.ts y test/*.test.ts)
#   otro .ts/.js/.svelte    → los *.test.* de su misma carpeta (ui/src, web/src…)
#   otra cosa en ui/ web/ packages/ (config, json, css) → no se sabe qué afecta: todos los tests de node
#   crates/, src-tauri/, docs/, scripts/, tests/…        → nada
# Sin nada que correr sale en silencio. Uso: sh scripts/test-touched.sh   (ALL=1 fuerza todo)
set -e
cd "$(dirname "$0")/.."
export PATH="$HOME/.nvm/versions/node/v24.21.0/bin:/opt/homebrew/bin:$PATH"

touched=$({
  git status --porcelain | cut -c4- | sed 's/.* -> //'
  git log --format= --name-only HEAD --not --remotes=origin
} | sort -u)

all_tests() {
  ls packages/ui/src/*/*.test.ts packages/ui/src/*.test.ts packages/ui/test/*.test.ts ui/src/*.test.* web/src/lib/*.test.* web/src/lib/*/*.test.* 2>/dev/null || true
  find web/src -name '*.test.*' 2>/dev/null
}

files=""
if [ "$ALL" = 1 ]; then
  files=$(all_tests)
else
  for f in $touched; do
    case "$f" in
      packages/ui/*) files="$files
$(ls packages/ui/src/*/*.test.ts packages/ui/src/*.test.ts packages/ui/test/*.test.ts 2>/dev/null)" ;;
      ui/*|web/*|packages/*)
        case "$f" in
          *.ts|*.js|*.svelte)
            dir=$(dirname "$f")
            files="$files
$(ls "$dir"/*.test.ts "$dir"/*.test.js 2>/dev/null || true)" ;;
          *) files=$(all_tests); break ;;
        esac ;;
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
