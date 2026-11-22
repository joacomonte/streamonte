# Migración a TS: convenciones

- Los imports de módulos migrados se escriben con extensión `.ts` (`import { x } from './x.ts'`, `'#lib/server/x.ts'`).
  Es la única forma que funciona igual en `node --test` (type stripping nativo, no remapea `.js`→`.ts`), svelte-check (kit activa `allowImportingTsExtensions`) y Vite.
- Al renombrar un `.js` a `.ts`, actualizar TODOS los imports que lo nombran (incluidas rutas en JSDoc `import('...')`, app.d.ts, .svelte).
- Tests: `*.test.ts`; `npm test` corre `src/**/*.test.{js,ts}`.
- Solo sintaxis borrable por type stripping: nada de `enum`, `namespace`, parameter properties (`constructor(private x)`), ni `import x = require`. Los `import type`/`export type` van explícitos para tipos.
