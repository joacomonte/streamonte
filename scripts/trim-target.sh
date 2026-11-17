#!/bin/sh
# Poda de /target (2026-11-17): borra lo que ninguna compilación usó en las últimas 24 h, para que
# no se acumule (llegó a 143 GB) sin perder lo que sí se reusa: cada build lee sus .rlib/.rmeta y
# huellas y eso les refresca la fecha de acceso (macOS la actualiza). Lo podado, si se vuelve a
# necesitar, se recompila solo esa pieza. Lo corre el hook de .claude/settings.json tras cada
# comando con cargo; a mano: sh scripts/trim-target.sh
cd "$(dirname "$0")/.." || exit 0
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
find target -mindepth 1 -type d -empty -delete 2>/dev/null
exit 0
