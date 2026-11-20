import { track } from '#lib/server/track.js';

/** El navegador avisa una acción: `{a: acción, d?: dato, dev?: id}` (llega por sendBeacon, como texto). `dev` lo manda
 * play.html, que corre en el navegador de Web Video Caster: así cuenta para el dispositivo que copió el link. */
export async function POST(event) {
	try {
		const { a, d, dev } = JSON.parse(await event.request.text());
		const id = typeof dev === 'string' && /^[0-9a-f-]{36}$/.test(dev) ? dev : undefined;
		if (typeof a === 'string' && a) await track(event, a, typeof d === 'string' ? d : undefined, id);
	} catch {
		/* aviso roto: se ignora */
	}
	return new Response(null, { status: 204 });
}
