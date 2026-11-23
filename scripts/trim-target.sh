#!/bin/sh
# Poda de /target (2026-11-17): borra lo que ninguna compilación usó en las últimas 24 h, para que
# no se acumule (llegó a 143 GB) sin perder lo que sí se reusa: cada build lee sus .rlib/.rmeta y
# huellas y eso les refresca la fecha de acceso (macOS la actualiza). Lo podado, si se vuelve a
# necesitar, se recompila solo esa pieza. Lo corren el hook de .claude/settings.json tras cada
# comando con cargo, check.sh y ci-local.sh; a mano: sh scripts/trim-target.sh
# 2026-11-23: igual llegó a 66 GB en un día de mucho trabajo (todo usado en < 24 h): además hay un tope de tamaño
# (TOPE_GB) que borra primero lo usado hace más tiempo, y una vez por semana `pnpm store prune`.
TOPE_GB=${TOPE_GB:-20}
cd "$(dirname "$0")/.." || exit 0

# Store de pnpm: los paquetes que ningún proyecto usa (llegó a 12 GB). Una vez por semana.
stamp="$HOME/Library/Caches/streamonte/pnpm-prune"
if [ -z "$(find "$stamp" -mtime -7 2>/dev/null)" ]; then
  mkdir -p "$(dirname "$stamp")" && touch "$stamp"
  PATH="$HOME/.nvm/versions/node/v24.21.0/bin:/opt/homebrew/bin:$PATH" corepack pnpm -s store prune >/dev/null 2>&1
fi

[ -d target ] || exit 0
# Con un build en curso no: podría borrar algo que ya decidió reusar y todavía no leyó.
pgrep -qx cargo || pgrep -qx rustc && exit 0
# Incremental: carpetas enteras (borrar archivos sueltos de una sesión la deja inconsistente).
for d in target/*/incremental/*/; do
  [ -d "$d" ] || continue
  [ -z "$(find "$d" -type f \( -atime -1 -o -mtime -1 \) -print -quit)" ] && rm -rf "$d"
done
# El resto: archivos sin leer ni escribir en 24 h, y las carpetas que quedan vacías.
# El mpv incluido (copia de src-tauri/mpv) no se lee al compilar: no se poda.
find target -type f -not -path '*/incremental/*' -not -path '*/mpv/*' -atime +0 -mtime +0 -delete 2>/dev/null

# Tope de tamaño: si sigue arriba, se borra de lo usado hace más tiempo a lo más reciente hasta quedar debajo.
# Cada carpeta de incremental cuenta como una pieza (su último uso = el archivo más reciente adentro).
kb=$(du -sk target | cut -f1)
if [ "$kb" -gt $((TOPE_GB * 1024 * 1024)) ]; then
  find target -type f -not -path '*/mpv/*' -exec stat -f '%a %z %N' {} + 2>/dev/null |
    awk '
      { t = $1; s = $2; p = substr($0, length($1) + length($2) + 3)
        if (match(p, /\/incremental\/[^\/]+\//)) p = substr(p, 1, RSTART + RLENGTH - 2)
        if (!(p in uso) || t > uso[p]) uso[p] = t; peso[p] += s }
      END { for (p in uso) print uso[p], peso[p], p }' |
    sort -n |
    awk -v sobra=$((kb * 1024 - TOPE_GB * 1024 * 1024 * 1024)) '
      { if (borrado >= sobra) exit; borrado += $2; print substr($0, length($1) + length($2) + 3) }' |
    while IFS= read -r p; do rm -rf "$p"; done
fi
find target -mindepth 1 -type d -empty -delete 2>/dev/null
exit 0
