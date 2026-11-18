// Candado rústico: si hay APP_PASSWORD (en Vercel), pide un código de 3 dígitos y lo guarda en una cookie.
// shortcut: código fijo en env, en cookie legible y sin rate limit; si se expone más, pasar a login real.

const GATE = `<!doctype html><html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Streamonte</title>
<style>
	:root { color-scheme: light dark; --bg: #f6f7f9; --fg: #111; --card: #fff; --line: #d0d4da; }
	@media (prefers-color-scheme: dark) { :root { --bg: #0d1014; --fg: #eee; --card: #171b21; --line: #2c323b; } }
	body { margin: 0; min-height: 100dvh; display: grid; place-items: center; background: var(--bg); color: var(--fg); font: 18px system-ui, sans-serif; }
	#gate-dialog { background: var(--card); border: 1px solid var(--line); border-radius: 20px; padding: 40px 32px; width: min(90vw, 360px); text-align: center; box-sizing: border-box; }
	h1 { margin: 0 0 24px; font-size: 26px; }
	/* Un solo input invisible encima de 3 casillas: anda con pegar y autocompletar. */
	#gate-otp { position: relative; display: flex; gap: 14px; justify-content: center; }
	.gate-box { width: 72px; height: 88px; display: grid; place-items: center; font-size: 44px; font-weight: 600; border: 2px solid var(--line); border-radius: 16px; }
	.gate-box.on { border-color: #4f8cff; box-shadow: 0 0 0 4px color-mix(in srgb, #4f8cff 25%, transparent); }
	#gate-code { position: absolute; inset: 0; width: 100%; opacity: 0; font-size: 16px; border: 0; caret-color: transparent; }
	#gate-error { color: #e5484d; min-height: 1.4em; margin: 14px 0 0; }
</style></head><body>
<main id="gate-dialog" role="dialog" aria-labelledby="gate-title">
	<h1 id="gate-title">Ingresar código</h1>
	<div id="gate-otp">
		<div class="gate-box"></div><div class="gate-box"></div><div class="gate-box"></div>
		<input id="gate-code" type="text" inputmode="numeric" pattern="[0-9]*" maxlength="3" autocomplete="one-time-code" autofocus aria-label="Código de 3 dígitos">
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
	input.focus();
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
	const pass = process.env.APP_PASSWORD;
	if (!pass || event.cookies.get('code') === pass) return resolve(event);
	if (event.url.pathname.startsWith('/api/')) return new Response('Falta el código.', { status: 401 });
	return new Response(GATE, { status: 401, headers: { 'content-type': 'text/html; charset=utf-8' } });
};
