# flow/ — piezas de los pasos "buscar → elegir → mejor"
Tarjetas y animaciones compartidas de los pasos de elegir un video.

## Para X → andá a Y
- Contrato de props (`TileSpec`, `FlowChip`, `FlowChoiceProps`) → `types.ts`.
- Tarjeta de un paso → `FlowChoice.svelte`, `FlowChoices.svelte`, `FlowTile.svelte`; migas → `FlowCrumbs.svelte`; animación de búsqueda → `FlowSearching.svelte`, `FlowRadar.svelte`.
- Chips LAT (seguras / a revisar / tarda más) → `lat-chips.ts`. Entrada escalonada → `step-in.ts`.

## Relación
Solo dibuja: la máquina de pasos NO está acá. Desktop: `ui/src/catalog-flow.ts` + `ui/src/FlowScreen.svelte`; web: `web/src/lib/Torrents.svelte` (unificarlas es N3-flow).

## Trampas
- Un cambio visual acá afecta las dos apps.
- Los chips y su texto salen de `latino.ts`/`audio.ts`; no decidir "es latino" en el componente.

## Cómo se prueba
Sin tests propios; `scripts/shot.mjs` y contratos (`desktop-opciones`, `web-opciones`).
