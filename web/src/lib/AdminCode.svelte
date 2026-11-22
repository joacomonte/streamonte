<script lang="ts">
	// Código del panel (/admin): 3 casillas; al completar la tercera lo prueba y, si está bien, entra solo.
	import { goto } from '$app/navigation';
	import { deserialize } from '$app/forms';

	interface Props {
		id?: string;
		/** Minutos de bloqueo que ya informó el servidor (demasiados intentos). */
		wait?: number;
	}
	let { id = 'admin-code', wait = 0 }: Props = $props();

	let code = $state('');
	let wrong = $state(false);
	let blocked = $state((() => wait)());
	let busy = $state(false);

	async function onCode() {
		code = code.replace(/\D/g, '').slice(0, 3);
		wrong = false;
		if (code.length < 3) return;
		busy = true;
		const fd = new FormData();
		fd.set('pass', code);
		// La acción de /admin pone la cookie y responde `redirect` si el código es el correcto.
		const r = await fetch('/admin?/login', { method: 'POST', body: fd, headers: { 'x-sveltekit-action': 'true' } }).then(async (x) => deserialize(await x.text())).catch(() => null);
		busy = false;
		if (r?.type === 'redirect') {
			try {
				localStorage.setItem('sw.admin', '1');
			} catch {
				/* sin almacenamiento: la próxima vez pide el código de nuevo */
			}
			goto('/admin', { invalidateAll: true });
		} else {
			blocked = r?.type === 'failure' ? Number(r.data?.wait) || 0 : 0;
			wrong = true;
			code = '';
		}
	}
</script>

<div class="code" class:wrong>
	<div class="otp">
		{#each [0, 1, 2] as i (i)}
			<span class="box" class:on={!busy && i === Math.min(code.length, 2)}>{code[i] ?? ''}</span>
		{/each}
		<!-- svelte-ignore a11y_autofocus -->
		<input {id} type="text" inputmode="numeric" pattern="[0-9]*" maxlength="3" autocomplete="one-time-code" aria-label="Código del panel" autofocus disabled={busy || !!blocked} bind:value={code} oninput={onCode} />
	</div>
	<p class="err" role="alert">{blocked ? `Demasiados intentos. Probá de nuevo en ${blocked} min.` : wrong ? 'Código incorrecto' : ''}</p>
</div>

<style>
	.code { display: flex; flex-direction: column; align-items: center; gap: 6px; }
	.otp { position: relative; display: flex; gap: 10px; }
	.box { width: 52px; height: 62px; display: grid; place-items: center; font-size: 30px; font-weight: 700; color: var(--text); border: 2px solid var(--border-strong); border-radius: var(--r-card); background: var(--surface); }
	.box.on { border-color: var(--accent); box-shadow: 0 0 0 4px color-mix(in srgb, var(--accent) 25%, transparent); }
	/* Invisible encima de las casillas: anda con tocar, pegar y autocompletar. */
	.otp input { position: absolute; inset: 0; width: 100%; height: 100%; opacity: 0; font-size: 16px; border: 0; padding: 0; caret-color: transparent; }
	.err { color: #e5484d; margin: 0; min-height: 1.3em; font-size: 13.5px; }
	.wrong .otp { animation: shake 0.35s; }
	@keyframes shake { 25% { transform: translateX(-6px); } 75% { transform: translateX(6px); } }
	@media (prefers-reduced-motion: reduce) { .wrong .otp { animation: none; } }
</style>
