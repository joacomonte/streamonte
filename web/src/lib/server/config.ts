// Dónde guarda cosas el servidor y sus keys. Todo se lee en cada llamada (no al cargar el módulo), así los tests
// fijan `process.env` antes de llamar.
import { keys } from './keys.ts';

/** Carpeta de datos: `.data` local, `/tmp/.data` en Vercel (efímera: cada cold start re-baja lo cacheado). */
export const dataDir = (): string => (process.env.VERCEL ? '/tmp/.data' : '.data');

/** Una key (`tmdb`, `torbox`, `opensubtitles`…): la variable de entorno si existe, si no `keys.json`. */
export const key = async (name: string): Promise<string | undefined> => (await keys())[name];
