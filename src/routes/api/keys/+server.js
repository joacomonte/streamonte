import { keys, setKeys } from '#lib/server/keys.js';
import { route } from '#lib/server/http.js';

/** Solo si están cargadas; el valor nunca sale del servidor. */
const status = async () => {
	const k = await keys();
	return {
		tmdb: Boolean(k.tmdb),
		torbox: Boolean(k.torbox),
		opensubtitles: Boolean(k.opensubtitles),
		opensubtitles_user: Boolean(k.opensubtitles_user),
		opensubtitles_pass: Boolean(k.opensubtitles_pass)
	};
};
export const GET = route(status);
export const POST = route(async ({ request }) => {
	const { tmdb, torbox, opensubtitles, opensubtitles_user, opensubtitles_pass } = await request.json();
	await setKeys({ tmdb, torbox, opensubtitles, opensubtitles_user, opensubtitles_pass });
	return status();
});
