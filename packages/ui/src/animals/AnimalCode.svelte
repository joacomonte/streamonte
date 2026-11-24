<script lang="ts">
	// Código de 2 animales del apodo (diseño: docs/mockups/animales/variantes.html, con 2 en vez de 3, en cualquier orden).
	// "nuevo": aviso → elegir → "Acordate de estos 2" (recién ahí se guarda). "login": la grilla con las 12 de la ayuda
	// primero (el orden lo da el servidor) y un error deja esperar 15 s (cuenta regresiva; la espera la controla el
	// servidor). `<dialog>` modal: queda encima de la bienvenida. La app manda el código con `submit`.
	import { onDestroy } from 'svelte';
	import { t } from '../i18n/runtime.ts';
	import Icon from '../components/Icon.svelte';
	import { ANIMALS, CODE_LEN, type Animal, type CodeResult } from './animals.ts';

	interface Props {
		nick: string;
		mode: 'nuevo' | 'login';
		/** Ids en el orden de la grilla. */
		order: string[];
		/** Segundos de espera que ya corren (otro intento errado hace poco). */
		wait?: number;
		submit: (code: string[]) => Promise<CodeResult>;
		/** Creado o acertado. */
		ondone: () => void;
		/** Volver a escribir otro apodo (flecha o Esc). */
		onback: () => void;
	}
	let { nick, mode, order, wait = 0, submit, ondone, onback }: Props = $props();

	const byId = (id: string | undefined): Animal | undefined => ANIMALS.find((a) => a.id === id);
	const cards = $derived(order.map(byId).filter((a): a is Animal => !!a));
	let dlg = $state<HTMLDialogElement>();
	let phase = $state<'warn' | 'pick' | 'done'>((() => (mode === 'nuevo' ? 'warn' : 'pick'))());
	let picks = $state<string[]>([]);
	let status = $state<'' | 'ok' | 'err'>('');
	let msg = $state('');
	let busy = $state(false);
	let waitLeft = $state((() => wait)());
	/** El dock (elegidas + botón) aparece recién al scrollear hasta el final. */
	let away = $state(true);
	/** En el login, con error o espera el dock se ve siempre (el mensaje y la cuenta regresiva viven ahí). */
	const hideDock = $derived(away && status === '' && !waitLeft && !msg);
	const full = $derived(picks.length === CODE_LEN);
	const timers: ReturnType<typeof setTimeout>[] = [];
	const later = (fn: () => void, ms: number) => timers.push(setTimeout(fn, ms));
	const still = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

	$effect(() => {
		if (dlg && !dlg.open) dlg.showModal();
	});
	// Cuenta regresiva de la espera.
	$effect(() => {
		if (waitLeft <= 0) return;
		const id = setInterval(() => (waitLeft = Math.max(0, waitLeft - 1)), 1000);
		return () => clearInterval(id);
	});
	onDestroy(() => timers.forEach(clearTimeout));

	function checkAway() {
		if (!dlg) return;
		// Al final = ya se ve la línea de las fotos (el dock sticky ocupa lugar debajo de ella).
		const credit = dlg.querySelector('#animal-credit');
		away = !!credit && credit.getBoundingClientRect().top >= dlg.getBoundingClientRect().bottom;
	}
	$effect(() => {
		void phase;
		requestAnimationFrame(checkAway);
	});

	function toggle(id: string) {
		if (status === 'ok' || busy) return;
		status = '';
		msg = '';
		const at = picks.indexOf(id);
		if (at >= 0) picks = picks.filter((p) => p !== id);
		else if (picks.length < CODE_LEN) picks = [...picks, id];
	}

	function pickAgain() {
		phase = 'pick';
		picks = [];
		msg = '';
		dlg?.scrollTo({ top: 0 });
	}

	async function send() {
		busy = true;
		const r = await submit([...picks]);
		busy = false;
		if (r.ok) {
			status = 'ok';
			later(ondone, still() ? 0 : 700);
			return;
		}
		msg = r.error;
		waitLeft = r.wait ?? 0;
		if (mode === 'nuevo') return;
		status = 'err';
		later(() => {
			picks = [];
			status = '';
		}, 900);
	}

	function done() {
		if (!full || busy) return;
		if (mode === 'nuevo') {
			phase = 'done';
			dlg?.scrollTo({ top: 0 });
		} else if (!waitLeft) void send();
	}

	// Aviso previo: cada 1,2 s una carta cambia de animal, como una ruleta (sin movimiento reducido, quietas).
	const SHUFFLE = ['nemo', 'komodo'];
	let shuffle = $state([...SHUFFLE]);
	let flip = $state(-1);
	$effect(() => {
		if (phase !== 'warn' || still()) return;
		const id = setInterval(() => {
			const at = Math.floor(Math.random() * shuffle.length);
			flip = -1;
			requestAnimationFrame(() => (flip = at));
			later(() => (shuffle[at] = ANIMALS[Math.floor(Math.random() * ANIMALS.length)].id), 180);
		}, 1200);
		return () => clearInterval(id);
	});

	const label = $derived(
		mode === 'nuevo'
			? full ? t('Listo') : `${picks.length} / ${CODE_LEN}`
			: status === 'ok' ? t('¡Adentro!') : waitLeft ? t('Esperá {n} s', { n: waitLeft }) : full ? t('Entrar') : `${picks.length} / ${CODE_LEN}`
	);
</script>

{#snippet trio(ids: string[], cls: string)}
	<div class="trio {cls}">
		{#each ids as id, i (i)}
			{@const a = byId(id)}
			<div class="t-card" class:flip={cls === 'shuffle' && flip === i} style="--i:{i}">
				{#if a}<img src={a.img} alt="" style:object-position={a.pos} /><b>{t(a.name)}</b>{:else}<span class="q">?</span>{/if}
			</div>
		{/each}
	</div>
{/snippet}

<dialog id="animal-code" bind:this={dlg} class="code" aria-label={t('Código de animales')} onscroll={checkAway} oncancel={(e) => {
	e.preventDefault();
	onback();
}}>
	<div class="phone">
		<button id="animal-back" type="button" class="back" aria-label={t('Cambiar apodo')} onclick={onback}><Icon name="back" /></button>
		{#if phase === 'warn'}
			<section class="warn">
				{@render trio(shuffle, 'shuffle')}
				<h1 class="big">{t('Elegí 2')}</h1>
				<p class="pill">🔒 {t('Son tu llave · no te los olvides')}</p>
				<p class="sub">{t('Con tu apodo y estos 2 entrás desde cualquier celu o compu')}</p>
				<button id="animal-warn-ok" class="cta" type="button" onclick={pickAgain}>{t('Elegir')}</button>
			</section>
		{:else if phase === 'done'}
			<section class="warn">
				{@render trio(picks, 'big')}
				<h1 class="big remember">🧠 {t('Acordate de estos 2')}</h1>
				<p class="sub">{t('Los vas a necesitar para entrar')}</p>
				<p class="pill">📸 {t('Sacale una captura')}</p>
				<button id="animal-done-ok" class="cta" class:ok={status === 'ok'} type="button" disabled={busy || status === 'ok'} onclick={send}>{t('Listo')}</button>
				<button id="animal-redo" class="ghost" type="button" disabled={busy || status === 'ok'} onclick={pickAgain}>{t('Elegir otros')}</button>
				<p id="animal-done-msg" class="msg err" role="alert">{msg}</p>
			</section>
		{:else}
			{#if mode === 'nuevo'}
				<h1>{t('Elegí 2')}</h1>
			{:else}
				<h1>{t('Hola, {nick}', { nick })} 👋</h1>
				<p class="lead">{t('Tus 2 animales')}</p>
			{/if}
			<div id="animal-grid" class="grid" class:full>
				{#each cards as a, i (a.id)}
					{@const at = picks.indexOf(a.id)}
					<button id="animal-{a.id}" type="button" class="card" class:sel={at >= 0} style="--i:{i}" aria-pressed={at >= 0} aria-label={t(a.name)} onclick={() => toggle(a.id)}>
						<img src={a.img} alt="" loading="lazy" style:object-position={a.pos} />
						<span class="badge">{at >= 0 ? '✓' : ''}</span>
						<span class="fact"><span class="tag">💡 {t('¿Sabías?')}</span><span class="bubble">{#each a.facts as f, j (j)}<span class="ft" style="--j:{j}">{t(f)}</span>{/each}</span></span>
						<b>{t(a.name)}</b>
					</button>
				{/each}
			</div>
			<p id="animal-credit" class="credit">{t('Fotos: Wikimedia Commons')}</p>
		{/if}
	</div>
	{#if phase === 'pick'}
		<div class="dock" class:away={hideDock}>
			<div class="dock-in {status}" class:shake={status === 'err'}>
				<div class="row">
					{#each Array.from({ length: CODE_LEN }, (_, i) => i) as i (i)}
						{@const a = byId(picks[i])}
						<button id="animal-slot-{i}" type="button" class="slot" class:full={!!a} disabled={!a} aria-label={a ? t('Sacar {a}', { a: t(a.name) }) : undefined} onclick={() => a && toggle(a.id)}>
							{#if a}<img src={a.img} alt="" /><span class="nm">{t(a.name)}</span>{:else}<span class="ph"></span>{/if}
						</button>
					{/each}
				</div>
				<button id="animal-done" class="cta" type="button" disabled={!full || busy || (mode === 'login' && (!!waitLeft || status !== ''))} onclick={done}>{label}</button>
				<p id="animal-msg" class="msg" class:err={!!msg} role="alert">{msg}</p>
			</div>
		</div>
	{/if}
</dialog>

<style>
	.code { --out: cubic-bezier(0.16, 1, 0.3, 1); --spring: cubic-bezier(0.34, 1.56, 0.64, 1); position: fixed; inset: 0; width: auto; height: auto; max-width: none; max-height: none; margin: 0; padding: env(safe-area-inset-top) 10px 0; border: 0; background: var(--bg); color: var(--text); overflow-x: hidden; overflow-y: auto; font-size: 15px; line-height: 1.4; }
	.code, .code * { box-sizing: border-box; }
	.code::backdrop { background: var(--bg); }
	.code:not([open]) { display: none; }
	.phone { position: relative; width: 100%; max-width: 460px; margin: 0 auto; padding-top: 14px; }
	.back { display: grid; place-items: center; width: 40px; height: 40px; margin: -6px 0 2px -8px; padding: 0; border: 0; border-radius: 50%; background: none; color: var(--muted); cursor: pointer; }
	.back:hover, .back:focus-visible { color: var(--text); background: color-mix(in srgb, var(--text) 8%, transparent); outline: none; }
	h1 { margin: 4px 0 2px; font-size: 22px; letter-spacing: -0.02em; line-height: 1.15; text-wrap: balance; }
	.lead { margin: 0 0 10px; color: var(--muted); font-size: 13px; }

	.grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; }
	.card { position: relative; aspect-ratio: 4 / 5; border: 0; padding: 0; border-radius: 12px; overflow: hidden; background: var(--surface-2); color: #fff; text-align: left; cursor: pointer; box-shadow: inset 0 0 0 1px rgb(255 255 255 / 0.09); transition: transform 0.3s var(--out), box-shadow 0.3s, filter 0.3s; animation: deal 0.6s var(--out) both; animation-delay: calc(var(--i) * 25ms); }
	@keyframes deal { from { opacity: 0; transform: translateY(12px) scale(0.96); } }
	.card img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; transition: transform 0.6s var(--out); }
	.card::after { content: ''; position: absolute; inset: 0; background: linear-gradient(to top, rgb(0 0 0 / 0.9) 0%, rgb(0 0 0 / 0.3) 45%, transparent 70%); }
	.card b { position: absolute; left: 8px; right: 6px; bottom: 7px; z-index: 1; font-size: 12px; line-height: 1.12; }
	.card .badge { position: absolute; top: 5px; right: 5px; z-index: 2; width: 20px; height: 20px; border-radius: 50%; display: grid; place-items: center; font-size: 11px; font-weight: 800; background: var(--amber); color: #1a1200; transform: scale(0); transition: transform 0.35s var(--spring); }
	.card.sel { box-shadow: inset 0 0 0 2px var(--amber), 0 8px 22px rgb(245 185 66 / 0.18); transform: translateY(-2px); }
	.card.sel img { transform: scale(1.08); }
	.card.sel .badge { transform: scale(1); }
	.grid.full .card:not(.sel) { filter: saturate(0.4) brightness(0.55); }
	@media (hover: hover) { .card:hover img { transform: scale(1.06); } }

	/* Datos curiosos: sticker "¿Sabías?" + burbuja; los 3 rotan solos con CSS (2,6 s cada uno). */
	.card .fact { position: absolute; left: 7px; right: 7px; top: 12%; z-index: 2; display: grid; justify-items: start; gap: 4px; pointer-events: none; opacity: 0; transform: translateY(8px) scale(0.85) rotate(-4deg); transition: opacity 0.25s, transform 0.5s var(--spring); }
	.card.sel .fact { opacity: 1; transform: rotate(-3deg); transition-delay: 0.1s; }
	.card .tag { padding: 3px 7px; border-radius: 999px; background: var(--amber); color: #1a1200; font-size: 9.5px; font-weight: 900; letter-spacing: 0.02em; box-shadow: 0 3px 10px rgb(0 0 0 / 0.35); }
	.card .bubble { position: relative; display: grid; width: 100%; padding: 7px 8px; border-radius: 12px 12px 12px 4px; background: rgb(255 255 255 / 0.16); backdrop-filter: blur(12px) saturate(1.6); -webkit-backdrop-filter: blur(12px) saturate(1.6); color: #fff; font-size: 11px; font-weight: 750; line-height: 1.22; text-shadow: 0 1px 3px rgb(0 0 0 / 0.5); box-shadow: inset 0 0 0 1px rgb(255 255 255 / 0.3), 0 8px 20px rgb(0 0 0 / 0.35); }
	.card .bubble::after { content: ''; position: absolute; left: 10px; bottom: -6px; border: 6px solid transparent; border-top-color: rgb(255 255 255 / 0.3); border-bottom: 0; }
	.card .ft { grid-area: 1 / 1; opacity: 0; animation: fact 7.8s infinite; animation-delay: calc(var(--j) * 2.6s); }
	.card:not(.sel) .ft { animation: none; }
	@keyframes fact { 0% { opacity: 0; transform: translateY(5px); } 4%, 30% { opacity: 1; transform: none; } 34%, 100% { opacity: 0; transform: translateY(-5px); } }
	.card.sel::after { background: linear-gradient(to top, rgb(0 0 0 / 0.85) 0%, rgb(0 0 0 / 0.2) 45%, rgb(0 0 0 / 0.15) 100%); }

	/* Las 2 elegidas + el botón, pegados abajo del diálogo (sticky: dependen solo del diálogo, no del layout de la página de
	   atrás); ocultos hasta scrollear del todo (suben desde abajo al llegar), salvo con error o espera. */
	.dock { position: sticky; bottom: 0; z-index: 5; margin: 16px -10px 0; display: flex; justify-content: center; padding: 12px 10px calc(12px + env(safe-area-inset-bottom)); background: linear-gradient(to top, var(--bg) 70%, rgb(13 16 20 / 0)); transition: transform 0.45s var(--out), opacity 0.3s; }
	.dock.away { transform: translateY(110%); opacity: 0; pointer-events: none; }
	.dock-in { width: 100%; max-width: 460px; display: grid; gap: 10px; padding: 10px; border-radius: 26px; background: rgb(255 255 255 / 0.05); backdrop-filter: blur(16px) saturate(1.4); -webkit-backdrop-filter: blur(16px) saturate(1.4); box-shadow: 0 -8px 30px rgb(0 0 0 / 0.4); }
	.dock-in.shake { animation: shake 0.42s; }
	@keyframes shake { 20%, 60% { transform: translateX(-7px); } 40%, 80% { transform: translateX(7px); } }
	.row { display: flex; align-items: center; gap: 8px; }
	.slot { position: relative; flex: 1; font: inherit; cursor: pointer; min-width: 0; height: 52px; border-radius: 999px; border: 0; background: rgb(255 255 255 / 0.06); box-shadow: inset 0 0 0 1px rgb(255 255 255 / 0.14); display: flex; align-items: center; gap: 8px; padding: 4px; overflow: hidden; color: var(--muted); font-size: 12px; font-weight: 700; }
	.slot:disabled { cursor: default; }
	.slot .ph { width: 100%; text-align: center; }
	.slot img { width: 42px; height: 42px; flex: none; border-radius: 50%; object-fit: cover; animation: pop 0.45s var(--out); }
	.slot .nm { min-width: 0; overflow: hidden; color: var(--text); font-size: 11.5px; line-height: 1.15; display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical; text-align: left; }
	.slot.full { background: rgb(245 185 66 / 0.12); box-shadow: inset 0 0 0 1.5px var(--amber); }
	.dock-in.ok .slot.full { box-shadow: inset 0 0 0 1.5px var(--green); }
	@keyframes pop { from { transform: scale(0.4); opacity: 0; } }
	.cta { width: 100%; height: 48px; border: 0; border-radius: 999px; background: #fff; color: #0b0d11; box-shadow: 0 6px 20px rgb(255 255 255 / 0.12); font: inherit; font-size: 15px; font-weight: 750; cursor: pointer; transition: opacity 0.2s, background 0.3s; }
	.cta:disabled { background: rgb(255 255 255 / 0.08); color: rgb(255 255 255 / 0.45); box-shadow: inset 0 0 0 1px rgb(255 255 255 / 0.12); cursor: default; }
	.cta:not(:disabled):active { scale: 0.96; }
	.dock-in.ok .cta, .cta.ok, .cta.ok:disabled { background: var(--green); color: #052e12; }
	.msg { margin: -2px 0 0; text-align: center; font-size: 12px; color: var(--muted); min-height: 16px; }
	.msg.err { color: var(--red); }
	.credit { margin: 8px 0 0; font-size: 11px; color: rgb(139 148 163 / 0.6); text-align: center; }

	/* Aviso previo y recordatorio (apodo nuevo). */
	.warn { display: grid; gap: 12px; padding: 18px 4px 40px; animation: rise 0.5s var(--out); }
	@keyframes rise { from { opacity: 0; transform: translateY(10px); } }
	.trio { display: flex; justify-content: center; gap: 10px; }
	.t-card { position: relative; width: 38%; aspect-ratio: 4 / 5; border-radius: 16px; overflow: hidden; background: var(--surface-2); border: 1.5px dashed rgb(255 255 255 / 0.18); display: grid; place-items: center; animation: deal 0.6s var(--out) both; animation-delay: calc(var(--i) * 90ms); }
	.t-card:first-child { transform: rotate(-6deg) translateY(6px); }
	.t-card:last-child { transform: rotate(6deg) translateY(6px); }
	.t-card img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
	.t-card::after { content: ''; position: absolute; inset: 0; background: linear-gradient(to top, rgb(0 0 0 / 0.85), transparent 55%); }
	.t-card b { position: absolute; left: 8px; right: 6px; bottom: 7px; z-index: 1; font-size: 12px; line-height: 1.15; }
	.t-card:has(img) { border: 1.5px solid var(--amber); }
	.t-card .q { font-size: 34px; font-weight: 800; color: rgb(255 255 255 / 0.25); animation: pulse 1.6s ease-in-out infinite; }
	@keyframes pulse { 50% { opacity: 0.35; transform: scale(0.92); } }
	.trio.shuffle .t-card { border-style: solid; border-color: rgb(255 255 255 / 0.12); }
	.t-card.flip { animation: flip 0.36s ease-in-out; }
	@keyframes flip { 50% { transform: rotateY(90deg) scale(0.96); } }
	.ghost { height: 42px; border: 0; background: none; color: var(--muted); font: inherit; font-size: 14px; font-weight: 650; cursor: pointer; }
	h1.big { margin: 10px 0 0; text-align: center; font-size: 40px; letter-spacing: -0.03em; }
	.pill { justify-self: center; margin: 0; padding: 8px 14px; border-radius: 999px; background: rgb(245 185 66 / 0.12); border: 1px solid rgb(245 185 66 / 0.35); color: var(--amber); font-size: 14px; font-weight: 700; }
	.warn .cta { margin-top: 6px; }
	.sub { margin: -4px 0 0; text-align: center; font-size: 13px; color: var(--muted); opacity: 0.8; }
	/* Recordatorio: las 2 elegidas en grande, lado a lado, entran con rebote. */
	.trio.big { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
	.trio.big .t-card { width: auto; aspect-ratio: 4 / 5; transform: none; border-radius: 18px; animation: deal-big 0.7s var(--spring) both; animation-delay: calc(var(--i) * 140ms); }
	.trio.big .t-card b { left: 10px; bottom: 9px; font-size: 16px; }
	@keyframes deal-big { from { opacity: 0; transform: translateY(28px) scale(0.75) rotate(-5deg); } }
	h1.remember { margin-top: 8px; font-size: 28px; }

	@media (prefers-reduced-motion: reduce) {
		.code, .code * { animation: none !important; transition: none !important; }
		/* Sin la rotación, queda el primer dato a la vista. */
		.card.sel .ft:first-child { opacity: 1; }
	}
</style>
