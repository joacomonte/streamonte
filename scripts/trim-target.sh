#!/bin/sh
# Poda de /target (2026-11-17; reglas nuevas 2026-11-24). Lo corren check.sh y ci-local.sh (ya no hay hook de Claude);
# a mano: sh scripts/trim-target.sh
#  - incremental/ y examples/: lo que ninguna compilación usó en 24 h (las carpetas de incremental, enteras: borrar
#    archivos sueltos de una sesión la deja inconsistente).
#  - deps/, build/ y .fingerprint/ (lo caro de recompilar): solo por tope de tamaño (TOPE_GB), de lo usado hace más
#    tiempo a lo más reciente. Cada build lee sus .rlib/.rmeta y eso les refresca la fecha de acceso (macOS la
#    actualiza); si el atime está apagado se usa la fecha de modificación y se avisa.
#  - Una vez por semana `pnpm store prune`.
# Corre a lo sumo una vez cada 6 h (stamp en <git-common-dir>/trim.stamp).
TOPE_GB=${TOPE_GB:-30}
cd "$(dirname "$0")/.." || exit 0
stamp="$(git rev-parse --git-common-dir)/trim.stamp"
[ -n "$(find "$stamp" -mmin -360 2>/dev/null)" ] && exit 0

# Store de pnpm: los paquetes que ningún proyecto usa (llegó a 12 GB). Una vez por semana.
pnpm_stamp="$HOME/Library/Caches/streamonte/pnpm-prune"
if [ -z "$(find "$pnpm_stamp" -mtime -7 2>/dev/null)" ]; then
  mkdir -p "$(dirname "$pnpm_stamp")" && touch "$pnpm_stamp"
  PATH="$HOME/.nvm/versions/node/v24.21.0/bin:/opt/homebrew/bin:$PATH" corepack pnpm -s store prune >/dev/null 2>&1
fi

target="$(cd "$(git rev-parse --git-common-dir)/.." && pwd)/target"
[ -d "$target" ] || exit 0
cd "$target/.." || exit 0
# Con un build en curso no: podría borrar algo que ya decidió reusar y todavía no leyó.
pgrep -qx cargo || pgrep -qx rustc && exit 0
touch "$stamp"

# ¿El atime se actualiza al leer? Se lee un rlib y se compara.
campo=%a
probe=$(find target -name '*.rlib' -path '*/deps/*' -print -quit 2>/dev/null)
if [ -n "$probe" ]; then
  antes=$(stat -f %a "$probe")
  cat "$probe" >/dev/null
  [ "$(stat -f %a "$probe")" = "$antes" ] && campo=%m && echo "trim-target: atime apagado, el tope usa la fecha de modificación" >&2
fi

# Incremental: carpetas enteras sin uso en 24 h.
for d in target/*/incremental/*/ target/*/*/incremental/*/; do
  [ -d "$d" ] || continue
  [ -z "$(find "$d" -type f \( -atime -1 -o -mtime -1 \) -print -quit)" ] && rm -rf "$d"
done
# Examples: archivos sin leer ni escribir en 24 h.
find target -type f -path '*/examples/*' -atime +0 -mtime +0 -delete 2>/dev/null

# Tope de tamaño (deps, build y .fingerprint; el mpv incluido y lo reciente de incremental no se tocan por acá).
# Cada pieza = un archivo; se borran de la de uso más viejo a la más nueva hasta quedar debajo.
kb=$(du -sk target | cut -f1)
if [ "$kb" -gt $((TOPE_GB * 1024 * 1024)) ]; then
  find target -type f \( -path '*/deps/*' -o -path '*/build/*' -o -path '*/.fingerprint/*' \) -not -path '*/mpv/*' \
    -exec stat -f "$campo %z %N" {} + 2>/dev/null |
    sort -n |
    awk -v sobra=$((kb * 1024 - TOPE_GB * 1024 * 1024 * 1024)) '
      { if (borrado >= sobra) exit; borrado += $2; print substr($0, length($1) + length($2) + 3) }' |
    while IFS= read -r p; do rm -f "$p"; done
fi
find target -mindepth 1 -type d -empty -delete 2>/dev/null
exit 0
