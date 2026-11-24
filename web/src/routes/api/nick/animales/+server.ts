import { json } from '@sveltejs/kit';
import { Fail, route } from '#lib/server/http.ts';
import { ownAnimals } from '#lib/server/apodo-session.ts';

// Los 2 animales del apodo, solo para su dueño con sesión verificada (cookie `apodo` firmada). Sin sesión: 401.
// `{ nick, animals: [id, id] | null }`: null si el código es anterior al cifrado (se completa al volver a entrar).
// Nunca se cachea.
export const GET = route(async ({ cookies }) => {
	const own = await ownAnimals((n) => cookies.get(n));
	if (!own) throw new Fail(401, 'Entrá con tu apodo');
	return json(own, { headers: { 'cache-control': 'no-store' } });
});
