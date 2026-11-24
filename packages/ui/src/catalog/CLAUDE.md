# catalog/ — grilla, filtros y buscador compartidos
Pantalla de inicio de las dos apps: estado en `store.ts` (sin Svelte) + `catalog.svelte.ts` (`$state`), vista en `Catalog.svelte`.

## Para X → andá a Y
- Filtros (tipo, orden, años, votos, idioma) → `filters.ts`, `Segmented`/`Since`/`Votes.svelte`; piso de votos → `votes.ts`.
- Estado y acciones (buscar, paginar) → `store.ts`. Tarjeta del póster → `Grid.svelte`; hover → `CardInfo.svelte` + `card-info.ts`.
- Géneros y subgéneros → `GenrePicker.svelte`, `subgenres.ts`, `genre-art.ts`. "Vistos" → `RecentRow.svelte`, `recent.ts`.

## Relación
Usa `api.ts` (`catalog.*`, `title.*`). Lo montan `web/src/routes/+page.svelte` (con `web/src/lib/catalog.svelte.ts`) y `ui/src/catalog-mount.ts`. Con género, `BrowseFilters.interests` va a IMDb (web `server/interests.ts`, desktop `catalog/interests.rs`).

## Trampas
- Fade a oscuro en baldosas con imagen (`packages/CLAUDE.md`).
- `Grid` pide ficha y premios al ver la tarjeta (~0,4 s, de a 3); el hover la monta tras 250 ms.

## Cómo se prueba
`card-info.test.ts` (fixtures `ui/mock/`); `ui/src/catalog-store.test.ts` prueba `store.ts`.
