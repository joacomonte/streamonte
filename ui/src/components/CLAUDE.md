# ui/src/components — pantallas solo del desktop
Se montan desde `ui/src/boot.ts` (los diálogos, antes de `initApp`).

## Para X → andá a Y
- Ajustes (tablero: Llaves, Perfil, Reproducción, Conexión, Idioma; cada ficha abre un panel con las filas) → `Settings.svelte` (arma con `$ui/settings/` y `$ui/settings/board/`; `openSettings('keys')` abre directo en Llaves); modelo con test → `../settings-model.ts`. Reproducción incluye el ecualizador de mpv.
- Acciones de limpieza (borrar temporales, datos guardados, detener todo) → botones en `Downloads.svelte` que llaman a `../dialog-flows.ts` (NO están en Ajustes).
- Descargas y reproducciones en curso → `Downloads.svelte`; actividad → `Activity.svelte`; log → `LogDialog.svelte`; confirmaciones → `$ui/components/ConfirmDialog.svelte` (montada en `Dialogs.svelte`); magnet copiado → `CopiedMagnet.svelte`.
- Medidor de velocidad → `SpeedButton.svelte`, `SpeedPanel.svelte`, `Gauge.svelte`. Contenedor → `Dialogs.svelte`.

## Relación
Settings, LogDialog y ConfirmDialog usan `$ui/components/Sheet.svelte` y `packages/ui/css/settings.css`. Leen `live`/`activity` de `../live.svelte.ts`. La web tiene su propio Ajustes (`web/src/routes/ajustes/`); lo común sale de `$ui/settings/`.

## Trampas
- Los textos largos de Ajustes van en el tooltip del ⓘ.
- Las filas de Ajustes existen solo con su panel abierto: nada de `getElementById(...).addEventListener` al arrancar (usar delegado o `openSettings(tile)`).
- Guardar la key de TMDB recarga el catálogo (evento `streamonte:tmdb-key`).

## Cómo se prueba
Contratos `desktop-ajustes`, `desktop-descargas`; `settings-model.test.ts`; `scripts/shot.mjs`.
