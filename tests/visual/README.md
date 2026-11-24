# Regresión visual
`node scripts/visual.mjs` captura 7 pantallas en oscuro (7 PNG `*-dark.png`, solo viewport) y las compara con `baseline/`; `--update` las regraba. Falla si más del 0,1 % de los píxeles cambia (`--threshold`, `--tol` = diferencia por canal que se ignora, 16). Los diffs (rojo = cambió) quedan en `$TMPDIR/streamonte-visual` (o `--out`). `--only TEXTO` filtra pantallas. Tarda ~35 s (levanta Vite de `ui` y `web` solo).

- Desktop (`app-*`, 1280×800): `ui` con `mock-tauri` (`ui/mock/*.json`). Web (`web-*`, 375×812): `/api/*` sale de `fixtures/web/` (sin keys ni red); regrabar: levantar `web` con `TMDB_KEY` y correr `node scripts/visual.mjs --record --only web --web-url http://127.0.0.1:PUERTO`.
- Imágenes remotas (pósters, caras) → un gris fijo; fuentes/scripts externos se abortan. Animaciones, caret y transiciones apagados.
- Fixtures web sin `from`/`to` en la clave (son fechas relativas a hoy). `/api/torrents` no se graba (stream, necesita TorBox): la ficha web muestra "Buscando torrents…".
- Claves de fixtures: se ignoran `from`, `to` y `l` (idioma; si la web agrega otro parámetro que no cambia la respuesta, sumarlo en `apiFile`). `/packages/*` (logo) se sirve desde disco: el dev server lo devuelve como HTML. La ficha de la app espera el texto final de los streams, no un sleep fijo.
- Plataforma: las baselines son de macOS (fuentes del sistema). No corre en CI: correrlo a mano antes de pushear un cambio visible y commitear las baselines regrabadas. Junto con los contratos: `sh scripts/verify-ui.sh [--changed|--all]` (un solo vite por app).
- Límite: 0,1 % no ve un cambio muy chico (p. ej. un color en un botón diminuto); bajar `--threshold` si hace falta.
- Regrabar una pantalla: `node scripts/visual.mjs --update --only <x>`.
