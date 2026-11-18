import { keys, setKeys } from '#lib/server/keys.js';
import { route } from '#lib/server/http.js';

/** Solo si están cargadas; el valor nunca sale del servidor. */
const status = async () => {
	const k = await keys();
	return { tmdb: Boolean(k.tmdb), torbox: Boolean(k.torbox), opensubtitles: Boolean(k.opensubtitles) };
};
export const GET = route(status);
export const POST = route(async ({ request }) => {
	const { tmdb, torbox, opensubtitles } = await request.json();
	await setKeys({ tmdb, torbox, opensubtitles });
	return status();
});
