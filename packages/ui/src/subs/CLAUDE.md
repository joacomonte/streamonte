# subs/ — selector de subtítulos (web ↔ desktop)
## Para X → andá a Y
- Pantalla del selector → `SubsPicker.svelte` (props `ref` `option` `file` `match` `lead` `actions` `onUse`); fila → `SubRow.svelte` (badge LAT/EN).
- Los que trae el video (recomendado en tarjeta + resto gris, tipo completo/sordos/forzados) → `NativeSubs.svelte` + `native-view.ts`; orden → `native-rank.ts` (golden con Rust).
- Flujo (buscar, bajar, premium) → `subs-flow.ts`. Ranking, fuente, calce, "no calza" → `subs-logic.ts`; nivel/grupo de match → `../sub-match.ts`.

## Relación
Usa `getApi().subs` y `.premium`. Lo usan `Torrents.svelte` (web) y `ui/src/SubsStep.svelte`.

## Trampas
- `sub_lang` (golden) = idioma por nombre, igual en Rust y web.
- Bajar un subtítulo premium gasta cuota y buscar no: premium solo con toque del usuario.

## Cómo se prueba
`subs.test.ts`, `subs.flow.test.ts`; contratos `desktop-subs-step`, `desktop-subs-nofit`, `web-subs-sheet`.
