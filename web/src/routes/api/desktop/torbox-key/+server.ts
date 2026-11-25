import { json } from '@sveltejs/kit';
import { Fail, route } from '#lib/server/http.ts';
import { verifiedNick } from '#lib/server/apodo-session.ts';
import { keys } from '#lib/server/keys.ts';
import { track } from '#lib/server/track.ts';

// La key de TorBox del servidor para el desktop (que no puede llevarla en el binario: el repo es público). Pasa por el
// candado de código (hooks.server.ts) y además exige la sesión de apodo verificada (cookie firmada `apodo`).
// `{ key }`; sin sesión: 401 (JSON, para que el desktop no lo tome por código errado); sin key en el servidor: 404.
// Nunca se cachea ni se loguea la key (el aviso de uso lleva solo el nombre del evento).
export const GET = route(async (event) => {
	const nick = await verifiedNick((n) => event.cookies.get(n));
	if (!nick) throw new Fail(401, 'Entrá con tu apodo');
	const { torbox } = await keys();
	if (!torbox) throw new Fail(404, 'El servidor no tiene key de TorBox');
	await track(event, 'torbox key desktop');
	return json({ key: torbox }, { headers: { 'cache-control': 'no-store' } });
});
