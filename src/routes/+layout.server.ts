import type { LayoutServerLoad } from './$types';
import { cleanNick } from '#lib/nick.ts';

/** Los idiomas que eligió hooks.server.js, para el primer render, y el apodo (sin apodo, la app lo pide). */
export const load: LayoutServerLoad = ({ locals, cookies }) => ({ langs: locals.langs, nick: cleanNick(cookies.get('nick')).nick ?? null });
