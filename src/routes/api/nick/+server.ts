import { Fail, route } from '#lib/server/http.ts';
import { sql } from '#lib/server/track.ts';
import { cleanNick } from '#lib/nick.ts';

/** Guarda el apodo `{nick}` en la cookie `nick` y se lo pone a lo que este dispositivo hizo antes sin apodo. */
export const POST = route(async ({ request, cookies, url }) => {
	const c = cleanNick((await request.json()).nick);
	if (!c.nick) throw new Fail(400, c.error ?? 'Escribí tu apodo');
	cookies.set('nick', c.nick, { path: '/', maxAge: 60 * 60 * 24 * 365 * 5, httpOnly: false, sameSite: 'lax', secure: url.protocol === 'https:' });
	const dev = cookies.get('dev');
	const q = sql();
	if (q && dev) await q`UPDATE eventos SET apodo = ${c.nick} WHERE dispositivo = ${dev} AND apodo IS NULL`;
	return { nick: c.nick };
});
