# components/ — piezas compartidas (sin `$app` ni Tauri)
## Para X → andá a Y
- Íconos → `icons.ts` (`ICONS`) + `Icon.svelte`. Diálogo/hoja → `Sheet.svelte` (`<dialog>`; props `footer` `titleId` `closeId` `maxWidth` `closable`).
- Selector de idioma de Ajustes → `LangPicker.svelte` (+ `LangFlag`, `LangSwitch`, `lang-data.ts`).
- Bienvenida / tours → `Tour.svelte`, `TourLang.svelte`, `tour-state.ts`, `tours.ts` (`welcomeSteps`, `castSteps`, `casterFor`).
- Confirmar → `confirmDialog()` (`confirm-queue.ts`) + una `ConfirmDialog.svelte` por app (snippet `rich` para cuerpos que no son texto). Toast → `toast()` (`toast-queue.ts`) + una `Toast.svelte` por app. Aviso de versión → `UpdateBar.svelte`. Esc / toque afuera → `use:dismiss` (`dismiss.ts`).
- Letras que entran desenfocadas en inputs → `type-fx.ts`. Pantalla "Actualizando" → `Updating.svelte`.

## Relación
Lo usan `web/` y `ui/` (los diálogos del desktop se montan sobre `Sheet`).

## Trampas
- `Sheet` es `<dialog>`: ids de cierre/título por props, los contratos los usan.
- `type-fx` no toca contraseñas ni `data-typefx="off"`.

## Cómo se prueba
`icons.test.ts`, `tour-state.test.ts`.
