import { json } from '@sveltejs/kit';
import { Fail, route } from '#lib/server/http.ts';
import { sql, track } from '#lib/server/track.ts';
import { ask, enter, parseCode, store } from '#lib/server/apodos.ts';
import { canSign, COOKIE, MAX_AGE, sign } from '#lib/server/apodo-session.ts';
import { tx } from '#lib/server/lang.ts';
import { cleanNick } from '#lib/nick.ts';

// Apodo con código de 2 animales (lib/server/apodos.ts). Nunca devuelve el código ni cuáles 2 de las 12 cartas son.
// GET `?nick=`: `{ nick, mode: 'nuevo' | 'login', order: ids, wait: s }` (sin código, el que entra lo crea).
// POST `{ nick, code: [id, id], mode }`: crea o prueba el código; si sale bien pone la cookie firmada `apodo`.
//   Errado: 403 `{ message, wait }`; en espera (15 s después de un error, la controla el servidor): 429 `{ message, wait }`;
//   el apodo cambió de estado entre el GET y el POST (otro creó el código o el admin lo reseteó): 409 `{ message }`.
const nickOf = (raw: unknown) => {
	const c = cleanNick(raw);
	if (!c.nick) throw new Fail(400, c.error ?? 'Escribí tu apodo');
	return c.nick;
};

export const GET = route(async ({ url }) => {
	const nick = nickOf(url.searchParams.get('nick'));
	return { nick, ...(await ask(store(), nick)) };
});

export const POST = route(async (event) => {
	const { request, cookies, url } = event;
	const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
	const nick = nickOf(body?.nick);
	const code = parseCode(body?.code);
	if (!code) throw new Fail(400, 'Elegí 2 animales');
	// Sin secreto no hay sesión: no se crea ni se prueba nada (si no, el código quedaría creado sin poder entrar).
	if (!canSign()) throw new Fail(503, 'No se puede entrar con apodo ahora: falta configurar el servidor.');
	const r = await enter(store(), nick, code, body?.mode === 'nuevo' ? 'nuevo' : 'login');
	if (!r.ok) {
		if (r.reason === 'taken') return json({ message: tx('Ese apodo cambió. Probá de nuevo.') }, { status: 409 });
		if (r.reason === 'wrong') await track(event, 'código mal', nick);
		return json({ message: tx(r.reason === 'wrong' ? 'No son esos' : 'Esperá {n} s', { n: r.wait }), wait: r.wait }, { status: r.reason === 'wrong' ? 403 : 429 });
	}
	cookies.set(COOKIE, sign(nick, r.version), { path: '/', maxAge: MAX_AGE, httpOnly: true, sameSite: 'lax', secure: url.protocol === 'https:' });
	// La cookie vieja sin firma (antes del código) ya no se usa.
	cookies.delete('nick', { path: '/' });
	// Lo que este dispositivo hizo antes sin apodo pasa a ser suyo.
	const dev = cookies.get('dev');
	const q = sql();
	if (q && dev) await q`UPDATE eventos SET apodo = ${nick} WHERE dispositivo = ${dev} AND apodo IS NULL`;
	return { nick, created: r.created };
});
