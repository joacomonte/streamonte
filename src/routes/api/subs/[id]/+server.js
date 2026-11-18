import { download } from '#lib/server/subs.js';
import { route } from '#lib/server/http.js';

/** El .srt suelto (sin zip), como descarga. `name`: nombre del archivo sin extensión. */
export const GET = route(async ({ params, url }) => {
	const text = await download(params.id);
	const name = (url.searchParams.get('name') || `subtitulo-${params.id}`).replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-').slice(0, 150);
	const ext = url.searchParams.get('ext') === 'ass' ? 'ass' : 'srt';
	// Con BOM: algunas teles y reproductores lo necesitan para leer los acentos.
	return new Response(`﻿${text}`, {
		headers: {
			'content-type': 'application/x-subrip; charset=utf-8',
			'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(`${name}.es.${ext}`)}`
		}
	});
});
