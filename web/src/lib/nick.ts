// El validador del apodo vive en `packages/ui/src/animals/nick.ts` (lo comparten web y desktop); acá solo se reexporta
// por ruta relativa (el servidor y `node --test` no resuelven `$ui`).
export { cleanNick } from '../../../packages/ui/src/animals/nick.ts';
