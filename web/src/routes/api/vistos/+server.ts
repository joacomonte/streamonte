import { Fail, route } from '#lib/server/http.ts';
import { dismiss, list, mark, parseSeen, setTmdb, type Seen } from '#lib/server/vistos.ts';
import { tmdbOf } from '#lib/server/tmdb.ts';
import { cleanNick } from '#lib/nick.ts';

// "Vistos recientemente" del apodo de la cookie `nick` (la web la pone en la bienvenida; el desktop la manda con el código).
// GET: la fila. POST `{ action: 'mark' | 'restore', item }` o `{ action: 'visto' | 'olvidar', kind, imdb }`.
// Los que marcó el desktop vienen sin `tmdb`: se resuelve desde el IMDb id (y se guarda); si TMDB no lo conoce, no salen.
export const GET = route(async ({ cookies }) => {
	const apodo = cleanNick(cookies.get('nick')).nick ?? null;
	const seen = await list(apodo);
	const found = await Promise.all(seen.map(async (s): Promise<Seen | null> => {
		if (s.tmdb) return s;
		const tmdb = await tmdbOf(s.imdb, s.kind).catch(() => null);
		if (!tmdb) return null;
		void setTmdb(apodo, s.kind, s.imdb, tmdb).catch(() => {});
		return { ...s, tmdb };
	}));
	return found.filter((s): s is Seen => s !== null);
});

export const POST = route(async ({ request, cookies }) => {
	const apodo = cleanNick(cookies.get('nick')).nick ?? null;
	const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
	const action = body?.action;
	if (action === 'mark' || action === 'restore') await mark(apodo, parseSeen(body?.item), action === 'restore');
	else if (action === 'visto' || action === 'olvidar') await dismiss(apodo, body?.kind === 'tv' ? 'tv' : 'movie', String(body?.imdb ?? ''), action);
	else throw new Fail(400, 'Acción inválida.');
	return { ok: true };
});
