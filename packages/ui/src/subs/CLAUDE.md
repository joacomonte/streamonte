# subs/ — selector de subtítulos (web ↔ desktop)
## Para X → andá a Y
- Pantalla del selector → `SubsPicker.svelte` (props `ref` `option` `file` `match` `lead` `actions` `onUse`); fila → `SubRow.svelte` (badge LAT/EN).
- Flujo (buscar, bajar, premium) → `subs-flow.ts`. Ranking, fuente, calce, "no calza" → `subs-logic.ts`; nivel/grupo de match → `../sub-match.ts`.

## Relación
Usa `getApi().subs` y `.premium`. Lo usan `web/src/lib/Torrents.svelte` y `ui/src/SubsStep.svelte` (vía `ui/src/mount-shared.ts`).

## Trampas
- "Es latino" lo decide `../latino.ts` (golden `spanish_variant`); `sub_lang` = idioma por nombre en Rust y web.
- Premium solo con toque del usuario (gasta cuota); buscar es gratis.

## Cómo se prueba
`subs.test.ts`, `subs.flow.test.ts`; contratos `desktop-subs-step`, `desktop-subs-nofit`, `web-subs-sheet`.
