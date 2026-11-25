# title/ — la ficha de película/serie (una sola para las dos apps)
## Para X → andá a Y
- Layout de la ficha, sinopsis, gente, dónde verla → `TitleView.svelte` (props: `details` `season` `episode` `options` snippet…).
- Lógica pura (gente, proveedores, temporadas, `TITLE_IDS`) → `title-state.ts`. Gráfico de temporadas → `SeasonChart.svelte`.
- Anti spoiler de capítulos → `spoiler.ts`. Fondo teñido del póster → `tint.ts`.
- Premios → `awards.ts` (`awardsView`, `cardAwards`, claves de categoría), `AwardsBadge.svelte`.
- Campo nuevo en la ficha → `docs/recetas/comando-nuevo.md` (sección B); el tipo es `TitleDetails` en `../types.ts`.

## Relación
Usa `getApi().title.*`. Lo montan la ruta `t/[kind]/[id]` de la web y `ui/src/SidePanel.svelte`.

## Trampas
- Los ids de la ficha son los mismos en las dos apps (`TITLE_IDS`): cambiarlos rompe `tests/scenes/*ficha*.json` y `*temporada*`.
- `AwardsBadge`: copa = mejor película/serie, medalla = otra categoría, escarapela gris = solo nominaciones.

## Cómo se prueba
`title-state.test.ts`, `awards.test.ts` (fixtures `ui/mock/`).
