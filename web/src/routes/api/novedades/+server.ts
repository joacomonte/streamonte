import { Fail, route } from '#lib/server/http.ts';
import { verifiedNick } from '#lib/server/apodo-session.ts';
import { listNews, markSeen, refreshNews } from '#lib/server/novedades.ts';

// "Novedades" (packages/ui/src/catalog/news.ts). Sin apodo verificado: sin capítulos y `seenAt` null.
// GET: lo guardado (NewsListWire). POST `{ action: 'refresh' }`: recalcula y contesta al terminar (Vercel corta el trabajo
// que sigue después de responder); el cliente no lo espera: es el pedido aparte "en segundo plano".
export const GET = route(async ({ cookies }) => {
	const apodo = await verifiedNick((n) => cookies.get(n));
	return listNews(apodo || null);
});

export const POST = route(async ({ request, cookies }) => {
	const apodo = await verifiedNick((n) => cookies.get(n));
	const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
	if (body?.action === 'refresh') await refreshNews(apodo || null);
	else if (body?.action === 'seen') await markSeen(apodo || null);
	else throw new Fail(400, 'Acción inválida.');
	return { ok: true };
});
