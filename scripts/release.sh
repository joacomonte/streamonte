#!/bin/sh
# Release de la app (2026-11-24): sube la versión, commitea "vX.Y.Z", crea el tag, pushea y sigue el CI.
# SOLO lo corre el usuario (commitea y pushea). Los releases son para los usuarios, no para probar (para eso: dogfood.sh).
#   sh scripts/release.sh [patch|minor] [--dry-run]     # patch por defecto
#   sh scripts/release.sh --revert [--dry-run]          # deshace el último release y publica el patch siguiente
# --dry-run imprime los pasos (líneas "+ …") sin escribir nada.
# --revert usa `git revert <tag anterior>..<último tag>`: sirve con commits lineales; con merges --no-ff el revert es manual.
# Sin --dry-run exige estar en main y con origin/main como ancestro de HEAD.
# El updater solo avanza de versión: por eso --revert no "baja" el número, revierte el contenido y sube un patch.
set -e
cd "$(dirname "$0")/.."

bump=patch; revert=""; dry=""
for a in "$@"; do
  case $a in
    patch | minor) bump=$a ;;
    --revert) revert=1 ;;
    --dry-run) dry=1 ;;
    *) echo "uso: sh scripts/release.sh [patch|minor] [--revert] [--dry-run]" >&2; exit 2 ;;
  esac
done
# Ejecuta (o, con --dry-run, solo muestra) un comando.
do_() { echo "+ $*"; [ -n "$dry" ] || "$@"; }

if [ -z "$dry" ]; then
  [ "$(git branch --show-current)" = main ] || { echo "el release se hace desde main (estás en '$(git branch --show-current)')" >&2; exit 1; }
  git fetch origin main
  git merge-base --is-ancestor origin/main HEAD || { echo "origin/main tiene commits que HEAD no: actualizar main antes del release" >&2; exit 1; }
fi
[ -n "$dry" ] || [ -z "$(git status --porcelain)" ] || { echo "el árbol tiene cambios sin commitear: commitearlos antes del release" >&2; exit 1; }

cur=$(sed -n 's/^version = "\(.*\)"/\1/p' Cargo.toml | head -1)
last=$(git describe --tags --abbrev=0 --match 'v[0-9]*' 2>/dev/null || true)
echo "versión actual en Cargo.toml: $cur · último tag: ${last:-ninguno}"

if [ -n "$revert" ]; then
  [ -n "$last" ] || { echo "no hay tag que revertir" >&2; exit 1; }
  prev=$(git describe --tags --abbrev=0 --match 'v[0-9]*' "$last^" 2>/dev/null || true)
  [ -n "$prev" ] || { echo "no hay un tag anterior a $last: revertir a mano" >&2; exit 1; }
  # Revierte lo que entró entre el release anterior y el último (sin commitear todavía); la versión se maneja abajo.
  do_ git revert --no-commit "$prev..$last" || { git revert --abort 2>/dev/null; echo "el revert tuvo conflictos: abortado, resolverlo a mano" >&2; exit 1; }
  do_ git checkout HEAD -- Cargo.toml Cargo.lock src-tauri/tauri.conf.json
  bump=patch
  base=${last#v}
else
  base=$cur
fi

IFS=. read -r major minor patch <<EOF
$base
EOF
if [ "$bump" = minor ]; then new="$major.$((minor + 1)).0"; else new="$major.$minor.$((patch + 1))"; fi
echo "nueva versión: $new"

# Cargo.toml: la primera línea `version = "…"` (la de [workspace.package]); tauri.conf.json: su "version", si la tiene.
echo "+ Cargo.toml: version = \"$new\""
[ -n "$dry" ] || { awk -v v="$new" '!hecho && /^version = "/ { print "version = \"" v "\""; hecho = 1; next } { print }' Cargo.toml >Cargo.toml.tmp && mv Cargo.toml.tmp Cargo.toml; }
if grep -q '^ *"version":' src-tauri/tauri.conf.json; then
  echo "+ src-tauri/tauri.conf.json: \"version\": \"$new\""
  [ -n "$dry" ] || { sed "s/^\( *\"version\": *\)\"[^\"]*\"/\1\"$new\"/" src-tauri/tauri.conf.json >src-tauri/tauri.conf.json.tmp && mv src-tauri/tauri.conf.json.tmp src-tauri/tauri.conf.json; }
fi
do_ cargo update -w --offline
do_ git add -A
do_ git commit -m "v$new"
do_ git tag "v$new"
do_ git push origin HEAD
do_ git push origin "v$new"

# Sigue el workflow del tag (puede tardar unos segundos en aparecer).
if [ -n "$dry" ]; then
  echo "+ gh run watch (release de v$new) --exit-status"
else
  id=""
  for _ in 1 2 3 4 5 6 7 8 9 10 11 12; do
    id=$(gh run list --workflow release --branch "v$new" --limit 1 --json databaseId --jq '.[0].databaseId // empty' 2>/dev/null || true)
    [ -n "$id" ] && break
    sleep 5
  done
  [ -n "$id" ] || { echo "no encontré el run del release; mirarlo con: gh run list --workflow release" >&2; exit 1; }
  gh run watch "$id" --exit-status
fi
