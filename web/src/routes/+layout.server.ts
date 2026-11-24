import type { LayoutServerLoad } from './$types';
import { verifiedNick } from '#lib/server/apodo-session.ts';

/** Los idiomas que eligió hooks.server.js, para el primer render, y el apodo verificado (sin él, la app pide apodo y
 * código de animales). */
export const load: LayoutServerLoad = async ({ locals, cookies }) => ({ langs: locals.langs, nick: await verifiedNick((n) => cookies.get(n)) });
