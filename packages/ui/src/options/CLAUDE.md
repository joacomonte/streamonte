# options/ — lista de opciones de torrents (web ↔ desktop)
Fila y lista de opciones; CSS en `packages/ui/css/options.css`.

## Para X → andá a Y
- Badges de idioma (LAT, LAT?, Gallego, subs) → `row.ts` `langTags` (lógica y texto) → dibuja `OptionRow.svelte` (el texto "LAT" también está fijo ahí). Textos/tips del estado: `../audio.ts` `LAT_BADGE`. Color: `../../css/options.css` (`.cat-lang`, `.ok`, `.no`).
- Resolución, tamaño, qué muestra cada fila → `row.ts`. Fila/lista → `OptionRow.svelte`, `OptionsList.svelte`.
- Carga y updates en vivo → `options-load.ts` (`getApi().options.load`). Salud estimada → `health.ts` (puro).
- "hace X" → `since.ts`.

## Relación
Usa `rank.ts`, `audio.ts`, `latino.ts`. Lo usan la web (`Torrents.svelte`) y el desktop (`StreamsPanel`, `FlowScreen`).

## Trampas
- `Mid`/`Action` de la fila son solo desktop (`capabilities.speedTests`).
- Es la misma lista en las dos apps: un cambio acá cambia las dos.

## Cómo se prueba
`options.test.ts` (fixture `ui/mock/events__catalog_streams__*`), `health.test.ts`, `*.flow.test.ts`.
