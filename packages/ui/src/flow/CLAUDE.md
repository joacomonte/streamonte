# flow/ — pasos "buscar → elegir → mejor" (máquina + piezas)
Máquina de pasos compartida de elegir un video y las tarjetas/animaciones que la dibujan.

## Para X → andá a Y
- Máquina de pasos (conexión, ¿latino?, búsqueda del buen match con Seguir buscando / Detener, España, migas; modo torrent con calidad solo desktop) → `flow-model.ts` (`createFlow`; test `flow-model.test.ts`). Cada app le da candidatas (`FlowCand`), su estado, `read` y `row`: web `web/src/lib/Torrents.svelte`, desktop `ui/src/catalog-flow.ts`.
- Contrato de props y de la vista (`TileSpec`, `FlowChip`, `FlowChoiceProps`, `FlowView`, `ChoiceView`, `FlowButton`) → `types.ts`.
- Tarjeta de un paso → `FlowChoice.svelte`, `FlowChoices.svelte`, `FlowTile.svelte`; migas → `FlowCrumbs.svelte`; animación de búsqueda → `FlowSearching.svelte`, `FlowRadar.svelte`.
- Chips LAT (seguras / a revisar / tarda más) → `lat-chips.ts`. Entrada escalonada → `step-in.ts`.

- Tabla de conexión y `fitsNet` → `net.ts` (sus textos se traducen al mostrarlos: `net.test.ts` mira que estén en `en.ts`). Reglas de match (`isMatch`, `needsReading`, `latPotential`, `latFirst`) → `match-rules.ts` (test: `match-rules.test.ts`). Fila "Seguir buscando" / Detener → `MoreRow.svelte` (`look` 'row' web, 'cat' desktop).

## Relación
Por TorBox la búsqueda de torrents corre de fondo mientras se elige (`FlowDeps.list`; el radar espera la lista entera). Queda en cada app: la pantalla "buscando torrents" (solo desktop por torrent), cómo lee pistas, la lista de "Ver todas" y el dibujo (web: tarjetas y `.row-btn` en `Torrents.svelte`; desktop: `ui/src/FlowScreen.svelte`). Ids por app en `FlowIds`.

## Trampas
- Un cambio visual o de la máquina acá afecta las dos apps.
- En la web el estado es un proxy de `$state`: lo que se compara por identidad (`Scan`) se relee del estado después de asignarlo.

## Cómo se prueba
`flow-model.test.ts`, `match-rules.test.ts`, `net.test.ts`; `scripts/shot.mjs` y contratos (`desktop-opciones`, `web-opciones`, `web-pasos`; las web son `live`).
