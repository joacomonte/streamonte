import { track } from '#lib/server/track.js';

/** El navegador avisa una acción: `{a: acción, d?: dato}` (llega por sendBeacon, como texto). */
export async function POST(event) {
	try {
		const { a, d } = JSON.parse(await event.request.text());
		if (typeof a === 'string' && a) await track(event, a, typeof d === 'string' ? d : undefined);
	} catch {
		/* aviso roto: se ignora */
	}
	return new Response(null, { status: 204 });
}
