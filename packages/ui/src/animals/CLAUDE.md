# animals/ — apodo y código de 2 animales (web ↔ desktop)
Datos de los 20 animales y pantalla del código. La usan la bienvenida, Ajustes y el saludo de las dos apps.

## Para X → andá a Y
- Ids, orden, constantes y `CodeResult` → `animals.ts`. Pantalla del código → `AnimalCode.svelte` (la montan `NickCode.svelte` y `web/src/lib/ApodoCode.svelte`).
- Validar apodo → `nick.ts`. Flujo desktop sobre `Api.nick` → `nick-flow.svelte.ts` (estado: `ui/src/nick-state.svelte.ts`).
- Saludo con miniaturas → `NickHello.svelte`. Cartas en Ajustes → `MyAnimals.svelte`. Servidor → `web/src/lib/server/apodos.ts`.

## Trampas
- No reordenar ni quitar animales: el servidor guarda posiciones en `ANIMAL_IDS` (hash). Reordenarlos rompe los códigos guardados.
- `animals.ts` y `nick.ts` no usan `$ui` ni `t()`: el servidor los importa por ruta relativa (`node --test`).

## Cómo se prueba
`web/src/lib/server/apodos.test.ts`; escenas `tests/scenes/web-apodo-*.json`. Desktop: mock `?nonick` (no hay escena).
