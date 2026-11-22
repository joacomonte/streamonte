import type { RequestHandler } from './$types';
import { track } from '#lib/server/track.ts';

/** El navegador avisa una acción: `{a: acción, d?: dato, dev?: id, z?: zona horaria}` (llega por sendBeacon, como texto).
 * `dev` lo manda play.html, que corre en el navegador de Web Video Caster: así cuenta para el dispositivo que copió el link. */
export const POST: RequestHandler = async (event) => {
	try {
		const { a, d, dev, z } = JSON.parse(await event.request.text());
		const id = typeof dev === 'string' && /^[0-9a-f-]{36}$/.test(dev) ? dev : undefined;
		// Zona IANA (America/Argentina/Buenos_Aires): lo demás se descarta.
		const zona = typeof z === 'string' && /^[A-Za-z_]+(\/[A-Za-z0-9_+-]+){0,2}$/.test(z) && z.length <= 64 ? z : undefined;
		if (typeof a === 'string' && a) await track(event, a, typeof d === 'string' ? d : undefined, id, zona);
	} catch {
		/* aviso roto: se ignora */
	}
	return new Response(null, { status: 204 });
};
