import { pickLangs } from '#lib/i18n/translate.js';
import { langStore, tx } from '#lib/server/lang.js';

// Candado rústico: si hay APP_PASSWORD (en Vercel), pide un código de 3 dígitos y lo guarda en una cookie.
// shortcut: código fijo en env, en cookie legible y sin rate limit; si se expone más, pasar a login real.

const GATE = `<!doctype html><html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Streamonte</title>
<style>
	:root { color-scheme: light dark; --bg: #f6f7f9; --fg: #111; --card: #fff; --line: #d0d4da; }
	@media (prefers-color-scheme: dark) { :root { --bg: #0d1014; --fg: #eee; --card: #171b21; --line: #2c323b; } }
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
	<p id="gate-error" role="alert"></p>
</main>
<script>
	const input = document.getElementById('gate-code');
	// Si ya había cookie y seguimos acá, el código guardado era incorrecto.
	if (/(^|; )code=/.test(document.cookie)) document.getElementById('gate-error').textContent = 'Código incorrecto';
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

/** @type {import('@sveltejs/kit/hooks').Handle} */
export const handle = async ({ event, resolve }) => {
	// Idiomas del pedido (cookies o el del navegador): la app y los errores en `ui`; lo de TMDB en `titles`/`info`.
	const langs = pickLangs((n) => event.cookies.get(n), event.request.headers.get('accept-language'));
	const lang = langs.ui;
	event.locals.langs = langs;
	return langStore.run(langs, async () => {
		const pass = process.env.APP_PASSWORD;
		if (!pass || event.cookies.get('code') === pass) return resolve(event, { transformPageChunk: ({ html }) => html.replace('<html lang="es">', `<html lang="${lang}">`) });
		if (event.url.pathname.startsWith('/api/')) return new Response(tx('Falta el código.'), { status: 401 });
		const gate = GATE.replace('<html lang="es">', `<html lang="${lang}">`)
			.replace('Introducí el código', tx('Introducí el código'))
			.replace('Código de 3 dígitos', tx('Código de 3 dígitos'))
			.replace("'Código incorrecto'", JSON.stringify(tx('Código incorrecto')));
		return new Response(gate, { status: 401, headers: { 'content-type': 'text/html; charset=utf-8' } });
	});
};
