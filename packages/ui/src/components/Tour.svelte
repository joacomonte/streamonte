<script lang="ts">
	// Tutorial por pasos a pantalla completa (respeta las zonas seguras). `<dialog>` nativo: foco y Esc. Flechas del
	// teclado y botones para moverse; Saltar o Esc lo cierran (se aleja y se apaga). Solo se anima transform y opacity.
	import type { Snippet } from 'svelte';
	import { t } from '../i18n/runtime.ts';
	import Icon from './Icon.svelte';
	import LangPicker from './LangPicker.svelte';
	import { guardStep, type LangOptions, type Step, type StoreLink } from './tour-state.ts';

	interface Props {
		id: string;
		label: string;
		open: boolean;
		steps: Step[];
		/** Paso actual (la app lo puede leer o mover); al abrir vuelve a `start`. */
		index?: number;
		start?: number;
		/** El apodo ya guardado; mientras no haya, el paso del apodo no deja pasar ni salir. */
		nick?: string | null;
		/** Valida y guarda el apodo (solo si algún paso lo pide). */
		onnick?: (raw: string) => Promise<{ nick?: string; error?: string }>;
		/** Idiomas del paso `picker`. */
		langs?: LangOptions;
		/** Contenido propio de la app para el paso con `extra`. */
		extra?: Snippet<[string]>;
		onclose: () => void;
		/** Arranca la salida (lo de atrás ya puede entrar mientras el tutorial se apaga). */
		onleave?: () => void;
	}
	let { id, label, open, steps, index = $bindable(0), start = 0, nick = null, onnick, langs, extra, onclose, onleave }: Props = $props();
	let dlg = $state<HTMLDialogElement>();
	let leaving = $state(false);
	let dir = $state(1);
	const step = $derived(steps[index]);
	const last = $derived(index === steps.length - 1);
	// Apodo: lo tipeado, el error en línea y si ya quedó guardado (en esta bienvenida o antes).
	let nickValue = $state((() => nick ?? '')());
	let nickError = $state('');
	let nickSaving = $state(false);
	let nickOk = $state((() => !!nick)());
	const nickAt = $derived(steps.findIndex((s) => s.nick));
	/** Paso más allá del apodo sin tenerlo: se queda en el del apodo. */
	const guard = (to: number) => guardStep(to, nickAt, nickOk);
	/** Íconos de tienda que no cargaron (por URL del ícono): se cambian por un mosaico propio. */
	let broken = $state<Record<string, boolean>>({});

	$effect(() => {
		if (open && !dlg?.open) {
			index = start;
			leaving = false;
			dlg?.showModal();
		} else if (!open && dlg?.open) dlg.close();
	});

	function go(to: number) {
		if (to < 0 || to >= steps.length) return;
		to = guard(to);
		if (to === index) return;
		dir = to > index ? 1 : -1;
		index = to;
	}

	/** Sale con su animación y recién después cierra el `<dialog>` (Saltar, Listo y Esc). */
	function exit() {
		if (leaving || !dlg?.open) return;
		// Sin apodo no se sale (Saltar y Esc llevan al paso del apodo).
		if (guard(steps.length) !== steps.length) return go(nickAt);
		leaving = true;
		onleave?.();
		if (still()) dlg.close();
		else setTimeout(() => dlg?.close(), 380);
	}

	const still = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
	/** Entra desde el lado hacia donde se avanza. */
	const enter = (_: Element, { dir }: { dir: number }) => ({
		duration: still() ? 0 : 460,
		css: (t: number) => {
			const e = 1 - Math.pow(1 - t, 4);
			return `transform: translateX(${(1 - e) * dir * 48}px); opacity: ${e};`;
		}
	});
	/** Sale hacia el lado contrario, rápido. */
	const leave = (_: Element, { dir }: { dir: number }) => ({
		duration: still() ? 0 : 200,
		css: (t: number) => `transform: translateX(${(1 - t) * -dir * 32}px); opacity: ${t};`
	});
	/** Valida y guarda el apodo; si está bien, sigue (o cierra, si era el último paso). */
	async function submitNick() {
		if (nickSaving) return;
		nickSaving = true;
		const r = (await onnick?.(nickValue)) ?? { error: '' };
		nickSaving = false;
		if (!r.nick) {
			nickError = t(r.error ?? '');
			return;
		}
		nickValue = r.nick;
		nickOk = true;
		nickError = '';
		if (last) exit();
		else go(index + 1);
	}
	/** Siguiente/Listo: en el paso del apodo, primero lo guarda. */
	function next() {
		if (step.nick) submitNick();
		else if (last) exit();
		else go(index + 1);
	}
	const initials = (name: string) => name.split(' ').map((w) => w[0]).join('').slice(0, 2);
</script>

<dialog {id} bind:this={dlg} class="tour" class:leaving aria-label={label} onclose={() => {
	// Sin apodo no se cierra: Chrome cierra con Esc aunque se cancele el evento si no hubo un toque antes.
	if (open && guard(steps.length) !== steps.length) {
		dlg?.showModal();
		go(nickAt);
	} else onclose();
}} oncancel={(e) => {
	e.preventDefault();
	exit();
}} onkeydown={(e) => {
	// Las flechas dentro del campo del apodo mueven el cursor, no el tutorial.
	if (e.target instanceof HTMLInputElement) return;
	if (e.key === 'ArrowRight') go(index + 1);
	else if (e.key === 'ArrowLeft') go(index - 1);
}}>
	{#snippet app(l: StoreLink)}
		<span class="app-icon">
			{#if broken[l.icon]}
				<svg viewBox="0 0 64 64" width="64" height="64" aria-hidden="true">
					<rect width="64" height="64" rx="15" fill="var(--accent)" />
					<text x="32" y="40" text-anchor="middle" font-size="22" font-weight="700" fill="var(--accent-text)">{initials(l.label)}</text>
				</svg>
			{:else}
				<img src={l.icon} alt="" width="64" height="64" loading="lazy" decoding="async" referrerpolicy="no-referrer" onerror={() => (broken[l.icon] = true)} />
			{/if}
		</span>
		<span class="app-text"><strong>{l.label}</strong><small>{l.store}</small></span>
	{/snippet}
	<div class="frame">
		<header>
			<div class="progress" role="progressbar" aria-label={t('Paso {n} de {d}', { n: index + 1, d: steps.length })} aria-valuemin="1" aria-valuemax={steps.length} aria-valuenow={index + 1}>
				{#each steps as s, n (s.title)}
					<button id="{id}-dot-{n}" type="button" class="seg" class:done={n <= index} aria-label={t('Ir al paso {n}', { n: n + 1 })} onclick={() => go(n)}><span></span></button>
				{/each}
			</div>
			{#if !last && !(step.nick && !nickOk)}
				<button id="{id}-skip" type="button" class="skip" onclick={exit}>{t('Saltar')}</button>
			{/if}
		</header>

		<div class="stages">
			{#key index}
				<div class="stage" in:enter={{ dir }} out:leave={{ dir }}>
					<div class="art" aria-hidden="true">
						<span class="ring"></span>
						<span class="ring late"></span>
						<span class="disc"><Icon name={step.icon} size={56} /></span>
					</div>
					<h2 id="{id}-title">{step.title}</h2>
					<p>{step.body}</p>
					{#if step.nick}
						<form id="{id}-nick-form" class="nick" novalidate onsubmit={(e) => {
							e.preventDefault();
							submitNick();
						}}>
							<input id="{id}-nick" type="text" maxlength="20" autocomplete="nickname" autocapitalize="words" spellcheck="false" enterkeyhint="done" placeholder="Joaco" aria-label={t('Tu apodo')} aria-invalid={!!nickError} aria-describedby="{id}-nick-error" bind:value={nickValue} oninput={() => (nickError = '')} />
							<p id="{id}-nick-error" class="nick-error" role="alert">{nickError}</p>
						</form>
					{/if}
					{#if step.picker}
						{#if langs}<div class="picker"><LangPicker id="{id}-lang" only={step.picker} {...langs} /></div>{/if}
					{/if}
					{#if step.extra && extra}<div class="extra">{@render extra(step.extra)}</div>{/if}
					{#if step.links?.length}
						<ul class="stores">
							{#each step.links as l (l.href ?? l.label)}
								<li>
									{#if l.href}
										<a id="{id}-store-{index}-{l.href.replace(/\W+/g, '-').slice(-28)}" class="app" href={l.href} target="_blank" rel="noopener noreferrer">
											{@render app(l)}
											<span class="get"><Icon name="download" size={18} />{t('Bajar')}</span>
										</a>
									{:else}
										<div class="app">{@render app(l)}</div>
									{/if}
								</li>
							{/each}
						</ul>
					{/if}
				</div>
			{/key}
		</div>

		<footer>
			{#if index > 0}
				<button id="{id}-back" type="button" class="ghost" onclick={() => go(index - 1)}>{t('Atrás')}</button>
			{/if}
			<button id="{id}-next" type="button" class="primary" disabled={step.nick && nickSaving} onclick={next}>
				{last ? t('Listo') : t('Siguiente')}
				{#if !last}<Icon name="next" size={20} />{/if}
			</button>
		</footer>
	</div>
</dialog>

<style>
	.tour {
		position: fixed;
		inset: 0;
		width: 100%;
		height: 100dvh;
		max-width: none;
		max-height: none;
		margin: 0;
		padding: var(--safe-top) env(safe-area-inset-right) var(--safe-bottom) env(safe-area-inset-left);
		border: 0;
		background: radial-gradient(130% 55% at 50% 0%, color-mix(in srgb, var(--accent) 16%, var(--bg)), var(--bg) 70%) var(--bg);
		color: var(--text);
		overflow: hidden;
	}
	.tour:not([open]) { display: none; }
	.tour[open] { animation: fade 0.35s var(--out); }
	.tour::backdrop { background: var(--bg); }
	@keyframes fade { from { opacity: 0; } }
	/* Salida: se agranda apenas y se apaga, con el fondo, y deja ver lo que hay detrás. */
	.tour.leaving { animation: away 0.38s var(--ease) forwards; pointer-events: none; }
	.tour.leaving::backdrop { animation: away-bg 0.38s var(--ease) forwards; }
	@keyframes away { to { opacity: 0; transform: scale(1.06); } }
	@keyframes away-bg { to { opacity: 0; } }

	.frame { height: 100%; max-width: 480px; margin: 0 auto; display: flex; flex-direction: column; }

	header { display: flex; align-items: center; gap: 12px; padding: 12px 20px 0; min-height: 56px; flex: none; }
	.progress { flex: 1; display: flex; gap: 6px; }
	.seg { flex: 1; height: 32px; padding: 0; border: 0; background: none; display: grid; align-items: center; cursor: pointer; }
	.seg span { display: block; height: 5px; border-radius: var(--r-pill); background: var(--surface-3); overflow: hidden; position: relative; }
	.seg span::after {
		content: '';
		position: absolute;
		inset: 0;
		border-radius: inherit;
		background: var(--accent);
		transform: scaleX(0);
		transform-origin: left;
		transition: transform 0.5s var(--out);
	}
	.seg.done span::after { transform: scaleX(1); }
	.skip { min-height: 44px; margin-right: -10px; padding: 0 12px; border: 0; border-radius: var(--r-pill); background: none; color: var(--muted); font-size: 15px; font-weight: 600; }
	.skip:active { background: var(--surface-2); }

	/* Pasos apilados en la misma celda: el que sale y el que entra se cruzan. */
	.stages { flex: 1; min-height: 0; display: grid; }
	.stage { grid-area: 1 / 1; min-height: 0; overflow-y: auto; padding: 16px 24px; display: flex; flex-direction: column; }
	/* Centrado vertical que no corta arriba si el contenido no entra (scrollea). */
	.stage > :first-child { margin-top: auto; }
	.stage > :last-child { margin-bottom: auto; }
	/* Entrada escalonada: dibujo, título, texto y lo que siga. */
	.stage > * { animation: up 0.6s var(--out) both; }
	.stage > :nth-child(2) { animation-delay: 70ms; }
	.stage > :nth-child(3) { animation-delay: 130ms; }
	.stage > :nth-child(4) { animation-delay: 190ms; }
	@keyframes up { from { transform: translateY(18px); opacity: 0; } }

	.art { position: relative; width: 132px; height: 132px; margin-bottom: 32px; display: grid; place-items: center; }
	.art > * { grid-area: 1 / 1; }
	.disc {
		width: 112px;
		height: 112px;
		display: grid;
		place-items: center;
		border-radius: 34px;
		background: color-mix(in srgb, var(--accent) 20%, var(--surface));
		color: var(--accent-fg);
		box-shadow: 0 16px 40px -12px color-mix(in srgb, var(--accent) var(--tint-4), transparent);
		animation: pop 0.7s var(--out) both, float 4.5s ease-in-out 0.7s infinite;
	}
	.ring { width: 112px; height: 112px; border-radius: 34px; border: 2px solid color-mix(in srgb, var(--accent) 50%, transparent); animation: ring 2.6s var(--out) 0.2s infinite both; }
	.ring.late { animation-delay: 1.5s; }
	@keyframes pop { from { transform: scale(0.6) rotate(-10deg); } }
	@keyframes float { 50% { transform: translateY(-8px) rotate(2deg); } }
	@keyframes ring { from { transform: scale(1); opacity: 0.9; } to { transform: scale(1.7); opacity: 0; } }

	h2 { margin: 0 0 12px; font-size: 30px; line-height: 1.15; letter-spacing: -0.025em; text-wrap: balance; }
	p { margin: 0; font-size: 17px; line-height: 1.5; color: var(--muted); text-wrap: pretty; }

	.picker { margin-top: 28px; }
	.nick { margin-top: 28px; display: flex; flex-direction: column; align-items: stretch; }
	.nick input {
		height: 64px;
		padding: 0 16px;
		border: 2px solid var(--border-strong);
		border-radius: var(--r-lg);
		background: var(--surface);
		color: var(--text);
		font-size: 26px;
		font-weight: 650;
		text-align: center;
		letter-spacing: -0.01em;
		outline: none;
		transition: border-color 0.2s var(--ease), box-shadow 0.2s var(--ease);
	}
	.nick input::placeholder { color: var(--muted); opacity: 0.5; font-weight: 500; }
	.nick input:focus { border-color: var(--accent); box-shadow: 0 0 0 4px color-mix(in srgb, var(--accent) 25%, transparent); }
	.nick input[aria-invalid='true'] { border-color: var(--red); }
	.nick-error { min-height: 1.5em; margin-top: 8px; font-size: 14.5px; color: var(--red); text-align: center; }
	.stores { list-style: none; margin: 28px 0 0; padding: 0; display: flex; flex-direction: column; gap: 12px; }
	.stores li { animation: up 0.6s var(--out) both; }
	.stores li:nth-child(2) { animation-delay: 90ms; }
	.stores li:nth-child(3) { animation-delay: 180ms; }
	.app {
		display: flex;
		align-items: center;
		gap: 14px;
		min-height: 88px;
		padding: 12px 12px 12px 12px;
		border: 1px solid var(--border-strong);
		border-radius: 22px;
		background: var(--surface);
		color: var(--text);
		text-decoration: none;
		transition: transform 0.15s;
	}
	a.app:active { transform: scale(0.98); }
	.app-icon { flex: none; width: 64px; height: 64px; border-radius: 15px; overflow: hidden; background: var(--surface-3); box-shadow: 0 0 0 1px rgb(255 255 255 / 0.06); }
	.app-icon img, .app-icon svg { display: block; width: 100%; height: 100%; }
	.app-text { flex: 1; display: flex; flex-direction: column; min-width: 0; }
	.app-text strong { font-size: 17px; font-weight: 650; line-height: 1.25; }
	.app-text small { font-size: 13.5px; color: var(--muted); }
	.get {
		flex: none;
		display: inline-flex;
		align-items: center;
		gap: 6px;
		height: 44px;
		padding: 0 16px;
		border-radius: var(--r-pill);
		background: var(--accent);
		color: var(--accent-text);
		font-size: 15px;
		font-weight: 650;
	}

	footer { flex: none; display: flex; gap: 10px; padding: 12px 20px 16px; }
	footer button { flex: 1; display: inline-flex; align-items: center; justify-content: center; gap: 4px; height: 56px; border: 1px solid var(--border-strong); border-radius: var(--r-lg); background: none; color: var(--text); font-size: 17px; font-weight: 650; transition: transform 0.15s; }
	footer button:active { transform: scale(0.97); }
	footer button:disabled { opacity: 0.55; cursor: default; }
	footer .primary { border-color: var(--accent); background: var(--accent); color: var(--accent-text); }
	.extra { margin-top: 26px; }

	@media (hover: hover) {
		a.app:hover { background: var(--surface-2); }
		.skip:hover { color: var(--text); }
	}
	@media (prefers-reduced-motion: reduce) {
		.tour[open], .tour.leaving, .tour.leaving::backdrop, .stage > *, .stores li, .disc, .ring { animation: none; }
		.ring { display: none; }
		.seg span::after { transition: none; }
	}
</style>
