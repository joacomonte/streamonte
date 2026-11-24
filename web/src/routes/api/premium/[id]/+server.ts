// Premium: bajar UNO (gasta 1). Solo por POST, con el toque del usuario; el GET sirve lo ya bajado sin gastar.
import { premiumDownload, premiumFile } from '#lib/server/subs.ts';
import { Fail, route, srtResponse } from '#lib/server/http.ts';

export const POST = route(({ params }) => premiumDownload(params.id));

/** El .srt ya bajado (con BOM: algunas teles lo necesitan para los acentos). Nunca baja: sin bajar, 404. */
export const GET = route(async ({ params, url }) => {
	const text = await premiumFile(params.id);
	if (text == null) throw new Fail(404, 'Ese subtítulo de Premium no está bajado.');
	return srtResponse(text, url.searchParams.get('name') || `subtitulo-${params.id}`, 'srt');
});
