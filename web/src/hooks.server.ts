import type { Handle } from '@sveltejs/kit/hooks';
import { pickLangs, type Lang, type Langs } from '#lib/i18n/translate.ts';
import { LANG_PARAM, langStore, tx } from '#lib/server/lang.ts';
import { attempt } from '#lib/server/intentos.ts';

// Candado rústico: si hay APP_PASSWORD (en Vercel), pide un código de 3 dígitos y lo guarda en una cookie.
// Cambiar APP_PASSWORD (y redeployar) deja afuera todas las cookies viejas: se compara contra el valor actual.
// 5 códigos errados seguidos bloquean la IP 15 min (lib/server/intentos.js).
// shortcut: código fijo en env, en cookie legible; si se expone más, pasar a login real.

/** Pide a Chrome (Android) el modelo del equipo y la versión del sistema en los pedidos siguientes (los lee track()). */
const HINTS = 'Sec-CH-UA-Model, Sec-CH-UA-Platform-Version';
/** IPs que ya entraron con el código correcto en esta instancia (vencimiento en ms): así el pedido de todos los
 * días no consulta la base. Una IP bloqueada no entra acá, y una que entró y falla después se saca. */
const okIps = new Map<string, number>();

const GATE = `<!doctype html><html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Streamonte</title>
<style>
	:root { color-scheme: dark; --bg: #0d1014; --fg: #eee; --card: #171b21; --line: #2c323b; }
	/* Arriba y a distancia fija (no centrado ni en dvh): el teclado abre debajo sin tapar ni mover las casillas. */
	body { margin: 0; min-height: 100dvh; display: flex; flex-direction: column; align-items: center; padding: calc(env(safe-area-inset-top) + 40px) 16px 0; box-sizing: border-box; background: var(--bg); color: var(--fg); font: 18px system-ui, sans-serif; -webkit-tap-highlight-color: transparent; }
	#gate-dialog { background: var(--card); border: 1px solid var(--line); border-radius: 20px; padding: 32px 24px 24px; width: min(100%, 360px); text-align: center; box-sizing: border-box; }
	h1 { margin: 0 0 24px; font-size: 26px; }
	/* Un solo input invisible encima de 3 casillas: anda con pegar y autocompletar. */
	#gate-otp { position: relative; display: flex; gap: 14px; justify-content: center; }
	.gate-box { width: 72px; height: 88px; display: grid; place-items: center; font-size: 44px; font-weight: 600; border: 2px solid var(--line); border-radius: 16px; }
	.gate-box.on { border-color: #4f8cff; box-shadow: 0 0 0 4px color-mix(in srgb, #4f8cff 25%, transparent); }
	#gate-code { position: absolute; inset: 0; width: 100%; height: 100%; opacity: 0; font-size: 16px; border: 0; padding: 0; caret-color: transparent; }
	#gate-error { color: #e5484d; min-height: 1.4em; margin: 14px 0 0; }
</style></head><body>
<main id="gate-dialog" role="dialog" aria-labelledby="gate-title">
	<h1 id="gate-title">Introducí el código</h1>
	<div id="gate-otp">
		<div class="gate-box"></div><div class="gate-box"></div><div class="gate-box"></div>
		<input id="gate-code" type="text" inputmode="numeric" pattern="[0-9]*" maxlength="3" autocomplete="one-time-code" aria-label="Código de 3 dígitos">
	</div>
	<p id="gate-error" role="alert">GATE_ERROR</p>
</main>
<script>
	const input = document.getElementById('gate-code');
	const boxes = document.querySelectorAll('.gate-box');
	const paint = () => boxes.forEach((b, i) => {
		b.textContent = input.value[i] ?? '';
		b.classList.toggle('on', document.activeElement === input && i === Math.min(input.value.length, 2));
	});
	input.addEventListener('focus', paint);
	input.addEventListener('blur', paint);
	// El celu solo abre el teclado con un toque (el foco automático lo marca pero no lo abre): sin foco al cargar,
	// y cualquier toque en la página enfoca el campo. En la compu sí arranca enfocado.
	document.addEventListener('pointerdown', (e) => { if (e.target !== input) { e.preventDefault(); input.focus({ preventScroll: true }); } });
	if (!matchMedia('(pointer: coarse)').matches) input.focus({ preventScroll: true });
	paint();
	input.addEventListener('input', () => {
		input.value = input.value.replace(/\\D/g, '').slice(0, 3);
		paint();
		if (input.value.length < 3) return;
		document.cookie = 'code=' + input.value + '; path=/; max-age=31536000; samesite=lax' + (location.protocol === 'https:' ? '; secure' : '');
		location.reload();
	});
</script></body></html>`;

export const handle: Handle = async ({ event, resolve }) => {
	// Id del dispositivo para el panel de uso (/admin): se pone en la primera página, antes de cualquier aviso. Legible
	// desde JS para pasarlo en el link de la tele (play.html corre en otro navegador, sin esta cookie).
	// Se vuelve a poner siempre: así también pasa a legible la que quedó httpOnly de la primera versión.
	if (!event.url.pathname.startsWith('/api/')) event.cookies.set('dev', event.cookies.get('dev') ?? crypto.randomUUID(), { path: '/', maxAge: 60 * 60 * 24 * 365 * 5, httpOnly: false, sameSite: 'lax', secure: event.url.protocol === 'https:' });
	// Idiomas del pedido (cookies o el del navegador): la app y los errores en `ui`; los títulos de TMDB en `titles`.
	// En los GET cacheables el idioma viene en la URL (`l`, ver lib/server/lang.ts) y manda sobre la cookie.
	const inUrl = event.url.searchParams.get('l')?.match(LANG_PARAM);
	const langs: Langs = inUrl ? { titles: inUrl[1] as Lang, ui: inUrl[2] as Lang } : pickLangs((n) => event.cookies.get(n), event.request.headers.get('accept-language'));
	const lang = langs.ui;
	event.locals.langs = langs;
	return langStore.run(langs, async () => {
		const pass = process.env.APP_PASSWORD;
		const app = async () => {
			const res = await resolve(event, { transformPageChunk: ({ html }) => html.replace('<html lang="es">', `<html lang="${lang}">`) });
			if (res.headers.get('content-type')?.startsWith('text/html')) res.headers.set('Accept-CH', HINTS);
			return res;
		};
		if (!pass) return app();
		const code = event.cookies.get('code');
		let wait: number | undefined;
		if (code) {
			const ip = event.getClientAddress();
			if (code === pass && (okIps.get(ip) ?? 0) > Date.now()) return app();
			const r = await attempt(`app:${ip}`, code, pass);
			if (r.ok) {
				okIps.set(ip, Date.now() + 10 * 60_000);
				return app();
			}
			okIps.delete(ip);
			wait = r.wait;
		}
		// El aviso de uso pasa sin código: lo manda también play.html desde el navegador de Web Video Caster.
		if (event.url.pathname === '/api/track') return resolve(event);
		// Bloqueada: 429 y no 401 (el desktop toma 401 como código incorrecto y borra el que tiene guardado).
		if (event.url.pathname.startsWith('/api/')) return wait ? new Response(tx('Demasiados intentos. Probá en 15 minutos.'), { status: 429 }) : new Response(tx('Falta el código.'), { status: 401 });
		const error = wait ? tx('Demasiados intentos. Probá de nuevo en {n} min.', { n: wait }) : code ? tx('Código incorrecto') : '';
		let gate = GATE.replace('<html lang="es">', `<html lang="${lang}">`)
			.replace('Introducí el código', tx('Introducí el código'))
			.replace('Código de 3 dígitos', tx('Código de 3 dígitos'))
			.replace('GATE_ERROR', error);
		if (wait) gate = gate.replace('<input id="gate-code"', '<input id="gate-code" disabled');
		const headers = new Headers({ 'content-type': 'text/html; charset=utf-8', 'accept-ch': HINTS });
		// Código errado (o bloqueado): se borra la cookie, así recargar no lo manda (ni lo cuenta) de nuevo. A mano: las
		// cookies de `event.cookies` no llegan a una Response armada acá.
		if (code) headers.append('set-cookie', 'code=; Path=/; Max-Age=0; SameSite=Lax');
		return new Response(gate, { status: 401, headers });
	});
};
