import { download } from '#lib/server/subs.ts';
import { route, srtResponse } from '#lib/server/http.ts';

/** El .srt suelto (sin zip), como descarga. `name`: nombre del archivo sin extensión. */
export const GET = route(async ({ params, url }) => {
	const text = await download(params.id);
	return srtResponse(text, url.searchParams.get('name') || `subtitulo-${params.id}`, url.searchParams.get('ext') === 'ass' ? 'ass' : 'srt');
});
