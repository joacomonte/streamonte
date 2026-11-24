# magnet/ — "Pegar magnet": ver, identificar y bajar un magnet
## Para X → andá a Y
- Pantalla → `MagnetView.svelte` (props `hash` `name` `titleHref`|`onTitle` `ready`). Flujo → `magnet-flow.ts`. Nombre/título → `magnet-logic.ts`.
- Hash de un magnet → `../magnet-hash.ts`.

## Relación
Usa `getApi().magnet`. Lo montan la ruta `m/[hash]` de la web y `ui/src/catalog-magnet.ts`.

## Trampas
- Las opciones del magnet pegado son `TorrentOption[]` y NO miden velocidad en desktop (Pasted).

## Cómo se prueba
`magnet.test.ts`, `magnet.flow.test.ts`; contrato `web-magnet`.
