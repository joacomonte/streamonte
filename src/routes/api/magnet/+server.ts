import { download, identify, status } from '#lib/server/magnet.ts';
import { route } from '#lib/server/http.ts';

/** Estado del torrent pegado en TorBox (y, con `who=1`, qué película o serie es, por su nombre). */
export const GET = route(async ({ url }) => {
	const hash = url.searchParams.get('hash')?.toLowerCase() ?? '';
	const st = await status(hash);
	const name = st.name || url.searchParams.get('dn') || '';
	return { ...st, ident: url.searchParams.get('who') === '1' && name ? await identify(name) : undefined };
});

/** "Bajarlo en TorBox". Body: {hash, dn}. */
export const POST = route(async ({ request }) => {
	const { hash = '', dn = '' } = await request.json().catch(() => ({}));
	return download(String(hash).toLowerCase(), String(dn));
});
