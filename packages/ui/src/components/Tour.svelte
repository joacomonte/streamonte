<script lang="ts">
	// Tutorial por pasos a pantalla completa (respeta las zonas seguras). `<dialog>` nativo: foco y Esc. Flechas del
	// teclado y botones para moverse; Saltar o Esc lo cierran (se aleja y se apaga). Solo se anima transform y opacity.
	import type { Snippet } from 'svelte';
	import { t } from '../i18n/runtime.ts';
	import Icon from './Icon.svelte';
	import logo from '../assets/logo-mark.svg';
	import TourLang from './TourLang.svelte';
	import { guardStep, type LangOptions, type Step, type StoreLink, type LangCode } from './tour-state.ts';

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
		onnick?: (raw: string) => Promise<{ nick?: string; error?: string; /** Falta (o es incorrecto) el código de la web: se vuelve a pedir. */ needCode?: boolean }>;
		/** Solo desktop: el paso del apodo pide antes el código de 3 dígitos de la web. `oncode` lo guarda y devuelve el error, si hay. */
		needCode?: boolean;
		oncode?: (code: string) => Promise<string | null>;
		/** Idiomas del paso `picker`. */
		langs?: LangOptions;
		/** Contenido propio de la app para el paso con `extra`. */
		extra?: Snippet<[string]>;
		onclose: () => void;
		/** Arranca la salida (lo de atrás ya puede entrar mientras el tutorial se apaga). */
		onleave?: () => void;
		/** Confeti al terminar con Listo en el último paso. */
		confetti?: boolean;
	}
	let { id, label, open, steps, index = $bindable(0), start = 0, nick = null, onnick, needCode = false, oncode, langs, extra, onclose, onleave, confetti = false }: Props = $props();
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
	// Código de la web (desktop): mientras `codeNeed`, el paso muestra su campo en vez del apodo.
	let codeNeed = $state((() => needCode)());
	let codeValue = $state('');
	let codeError = $state('');
	let codeSaving = $state(false);
	const codeFull = $derived(/^\d{3}$/.test(codeValue));
	/** Pone el foco en el campo que aparece al cambiar de código a apodo (y al revés). */
	const focusNow = (el: HTMLElement) => el.focus();
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
	/** Entra desde el lado hacia donde se avanza (curva tipo cubic-bezier(.16,1,.3,1)). */
	const enter = (_: Element, { dir }: { dir: number }) => ({
		duration: still() ? 0 : 500,
		css: (t: number) => {
			const e = t === 1 ? 1 : 1 - Math.pow(2, -10 * t);
			return `transform: translateX(${(1 - e) * dir * 56}px); opacity: ${Math.min(1, t * 2.5)};`;
		}
	});
	/** Sale hacia el lado contrario, rápido. */
	const leave = (_: Element, { dir }: { dir: number }) => ({
		duration: still() ? 0 : 200,
		css: (t: number) => `transform: translateX(${(1 - t) * -dir * 32}px); opacity: ${t};`
	});
	/** Valida y guarda el apodo; si está bien, sigue (o cierra, si era el último paso). */
	async function submitCode() {
		if (codeSaving || !codeFull) return;
		codeSaving = true;
		const err = (await oncode?.(codeValue)) ?? null;
		codeSaving = false;
		if (err) {
			codeError = t(err);
			return;
		}
		codeNeed = false;
		codeError = '';
		codeValue = '';
	}
	async function submitNick() {
		if (codeNeed) return submitCode();
		if (nickSaving) return;
		nickSaving = true;
		const r = (await onnick?.(nickValue)) ?? { error: '' };
		nickSaving = false;
		if (!r.nick) {
			if (r.needCode) {
				codeNeed = true;
				codeValue = '';
				codeError = t(r.error ?? '');
				return;
			}
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
	// Idioma de la app: elegir ya es la respuesta y pasa al siguiente tras ver la elección (~0,35 s). Títulos: se queda
	// para probar los dos en el póster y se sigue con "Siguiente".
	function pickLang(kind: 'app' | 'titles', v: LangCode) {
		langs?.onpick(kind, v);
		if (kind === 'titles') return;
		const at = index;
		setTimeout(() => index === at && go(index + 1), 350);
	}

	function next() {
		if (step.nick) submitNick();
		else if (last) {
			if (confetti) burst();
			exit();
		} else go(index + 1);
	}
	/** 40 papelitos que saltan desde abajo y caen (~1 s). Van en el body: el tutorial se apaga mientras tanto. */
	function burst() {
		if (still()) return;
		const css = getComputedStyle(document.documentElement);
		const colors = ['--accent', '--green', '--red', '--yellow', '--amber'].map((c) => css.getPropertyValue(c).trim() || '#2563eb');
		for (let n = 0; n < 40; n++) {
			const p = document.createElement('i');
			const w = 6 + Math.random() * 6;
			p.style.cssText = `position:fixed;left:50%;bottom:18%;width:${w}px;height:${w * 1.6}px;border-radius:2px;background:${colors[n % colors.length]};pointer-events:none;z-index:2147483647;`;
			document.body.append(p);
			const x = (Math.random() - 0.5) * innerWidth * 0.9;
			const y = -(innerHeight * (0.35 + Math.random() * 0.4));
			const r = (Math.random() - 0.5) * 900;
			p.animate(
				[
					{ transform: 'translate(0, 0) rotate(0)', opacity: 1 },
					{ transform: `translate(${x * 0.8}px, ${y}px) rotate(${r / 2}deg)`, opacity: 1, offset: 0.45 },
					{ transform: `translate(${x}px, ${y * 0.55}px) rotate(${r}deg)`, opacity: 0 }
				],
				{ duration: 900 + Math.random() * 300, easing: 'cubic-bezier(.2,.7,.4,1)' }
			).finished.finally(() => p.remove());
		}
	}
	/** El apodo achica la letra si es largo, para entrar en una línea (el input no hace salto de línea). */
	const nickSize = $derived(Math.min(40, Math.floor(560 / Math.max(1, nickValue.length))));
	const nickTyped = $derived(nickValue.trim() !== '');
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
	{#if step.nick}
		<!-- Fondo del paso del apodo: columnas diagonales de tarjetas de vidrio que suben y bajan, con un velo. -->
		<div class="glass" aria-hidden="true">
			<div class="cols">
				{#each [0, 1, 2, 3, 4] as c (c)}
					<div class="col">
						{#each { length: 12 } as _, n (n)}<span></span>{/each}
					</div>
				{/each}
			</div>
		</div>
	{/if}
	<div class="frame">
		<header>
			<button id="{id}-back" type="button" class="back" class:gone={index === 0} tabindex={index === 0 ? -1 : 0} aria-hidden={index === 0} aria-label={t('Atrás')} onclick={() => go(index - 1)}><Icon name="back" size={22} /></button>
			<div class="progress" role="progressbar" aria-label={t('Paso {n} de {d}', { n: index + 1, d: steps.length })} aria-valuemin="1" aria-valuemax={steps.length} aria-valuenow={index + 1}>
				{#each steps as s, n (s.title)}
					<button id="{id}-dot-{n}" type="button" class="dot" class:done={n < index} class:on={n === index} aria-label={t('Ir al paso {n}', { n: n + 1 })} onclick={() => go(n)}><span></span></button>
				{/each}
			</div>
			{#if !last && !(step.nick && !nickOk)}
				<button id="{id}-skip" type="button" class="skip" onclick={exit}>{t('Saltar')}</button>
			{/if}
		</header>

		<div class="stages">
			{#key index}
				<div class="stage" class:nickstage={step.nick} in:enter={{ dir }} out:leave={{ dir }}>
					{#if !(step.picker && langs) && !step.nick}
						<div class="art" aria-hidden="true">
							<span class="ring"></span>
							<span class="ring late"></span>
							{#if step.logo}<img class="logo" src={logo} alt="" width="96" height="108" />{:else}<span class="disc"><Icon name={step.icon} size={56} /></span>{/if}
						</div>
					{/if}
					{#if step.nick}
						<!-- "Hola," y el apodo se escribe debajo, con la misma letra: el input real va encima del espejo
						     (texto y caret transparentes) y el espejo dibuja cada letra que entra y un caret propio. -->
						<form id="{id}-nick-form" class="nick" novalidate onsubmit={(e) => {
							e.preventDefault();
							if (codeNeed ? codeFull : nickTyped) submitNick();
						}}>
							{#if codeNeed}
								<label class="hello" for="nick-web-code">{t('Código de la web')}</label>
								<div class="typed" style="--fs: 40px">
									<span class="field">
									<span class="mirror" aria-hidden="true">{#each [...codeValue] as ch, n (n)}<span class="ch">{ch}</span>{/each}<span class="caret"></span>{#if !codeValue}<span class="ph">000</span>{/if}</span>
									<input id="nick-web-code" use:focusNow data-typefx="off" type="text" inputmode="numeric" maxlength="3" autocomplete="off" spellcheck="false" enterkeyhint="go" aria-invalid={!!codeError} aria-describedby="nick-web-code-error" bind:value={codeValue} oninput={() => ((codeError = ''), (codeValue = codeValue.replace(/\D/g, '')))} />
									</span>
									<button id="nick-web-code-go" type="submit" class="go" class:show={codeFull} disabled={codeSaving} tabindex={codeFull ? 0 : -1} aria-hidden={!codeFull} aria-label={t('Seguir')}>
										<svg class="arr" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12h15M13 6l6 6-6 6" /></svg>
									</button>
								</div>
								<p id="nick-web-code-error" class="hint" class:err={!!codeError} class:gone={codeFull && !codeError} role="alert">{codeError || `${t('Los 3 números de acceso de la web')} · ${t('obligatorio')}`}</p>
							{:else}
							<label class="hello" for="{id}-nick">{t('Hola')},</label>
							<div class="typed" style="--fs: {nickSize}px">
								<span class="field">
								<span class="mirror" aria-hidden="true">{#each [...nickValue] as ch, n (n)}<span class="ch">{ch}</span>{/each}<span class="caret"></span>{#if !nickValue}<span class="ph">{t('tu apodo')}</span>{/if}</span>
								<!-- svelte-ignore a11y_autofocus (el paso es escribir el apodo; el <dialog> abre con foco en él) -->
								<input id="{id}-nick" data-typefx="off" type="text" maxlength="20" autocomplete="nickname" autocapitalize="words" spellcheck="false" enterkeyhint="go" aria-invalid={!!nickError} aria-describedby="{id}-nick-error" bind:value={nickValue} oninput={() => ((nickError = ''), (nickValue = nickValue.charAt(0).toUpperCase() + nickValue.slice(1)))} use:focusNow autofocus />
								</span>
								<button id="{id}-nick-go" type="submit" class="go" class:show={nickTyped} disabled={nickSaving} tabindex={nickTyped ? 0 : -1} aria-hidden={!nickTyped} aria-label={t('Seguir')}>
									<svg class="arr" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12h15M13 6l6 6-6 6" /></svg>
								</button>
							</div>
							<p id="{id}-nick-error" class="hint" class:err={!!nickError} class:gone={nickTyped && !nickError} role="alert">{nickError || `${step.title} · ${t('obligatorio')}`}</p>
							{/if}
						</form>
					{:else}
						<h2 id="{id}-title" class:center={step.picker && langs}>{step.title}</h2>
						{#if step.body}<p>{step.body}</p>{/if}
					{/if}
					{#if step.picker}
						{#if langs}<div class="picker"><TourLang id="{id}-lang" only={step.picker} {...langs} onpick={pickLang} /></div>{/if}
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

		<footer class:hidden={step.nick || (step.picker === 'app' && !!langs && !last)}>
			{#if !(step.picker === 'app' && langs) || last}
				<button id="{id}-next" type="button" class="primary" disabled={step.nick && nickSaving} onclick={next}>
					{last ? t('Listo') : t('Siguiente')}
					{#if !last}<Icon name="next" size={20} />{/if}
				</button>
			{/if}
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

	.frame { position: relative; height: 100%; max-width: 480px; margin: 0 auto; display: flex; flex-direction: column; }

	header { display: flex; align-items: center; gap: 12px; padding: 12px 20px 0; min-height: 56px; flex: none; }
	.back { display: grid; place-items: center; width: 40px; height: 40px; margin-left: -10px; padding: 0; border: 0; border-radius: 50%; background: none; color: var(--muted); transition: opacity 0.25s var(--ease), color 0.2s var(--ease), background 0.2s var(--ease); }
	.back:hover, .back:focus-visible { color: var(--text); background: color-mix(in srgb, var(--text) 8%, transparent); outline: none; }
	.back.gone { opacity: 0; pointer-events: none; }
	/* Puntos: el del paso actual se estira; los ya vistos quedan del color de acento. */
	.progress { flex: 1; display: flex; align-items: center; }
	.dot { height: 32px; padding: 0 4px; border: 0; background: none; display: grid; align-items: center; cursor: pointer; }
	.dot span { display: block; width: 8px; height: 8px; border-radius: var(--r-pill); background: var(--border-strong); transition: width 0.45s cubic-bezier(0.34, 1.56, 0.64, 1), background 0.3s var(--ease); }
	.dot.done span { background: color-mix(in srgb, var(--accent) 55%, var(--border-strong)); }
	.dot.on span { width: 26px; background: var(--accent); }
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
	.logo { position: relative; display: block; width: 96px; height: 108px; filter: drop-shadow(0 18px 36px rgb(194 87 122 / 0.35)); animation: float 4s ease-in-out infinite; }
	@keyframes float { 50% { transform: translateY(-6px); } }
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
	h2.center { font-size: 40px; font-weight: 600; letter-spacing: -0.035em; line-height: 1.08; }

	/* Paso del apodo: abajo a la izquierda, sobre el fondo de vidrio. */
	.glass { position: absolute; inset: 0; overflow: hidden; pointer-events: none; animation: fade 0.5s var(--out); }
	.glass::after { content: ''; position: absolute; inset: 0; background: linear-gradient(to bottom, var(--bg) 8%, color-mix(in srgb, var(--bg) 92%, transparent) 42%, color-mix(in srgb, var(--bg) 45%, transparent) 72%, color-mix(in srgb, var(--bg) 10%, transparent)); }
	.cols { position: absolute; inset: -120px -80px; display: flex; gap: 12px; transform: rotate(-14deg); }
	.col { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 12px; animation: col-up 34s linear infinite; }
	.col:nth-child(even) { animation-name: col-down; animation-duration: 40s; }
	.col:nth-child(3) { animation-duration: 30s; }
	.col span { flex: none; aspect-ratio: 2 / 3; border-radius: 12px; background: color-mix(in srgb, var(--text) 4%, transparent); border: 1px solid color-mix(in srgb, var(--text) 8%, transparent); }
	@keyframes col-up { from { transform: translateY(0); } to { transform: translateY(-50%); } }
	@keyframes col-down { from { transform: translateY(-50%); } to { transform: translateY(0); } }
	/* Apodo arriba (a ~12% del alto): el teclado del celu abre abajo sin tapar ni mover nada. */
	.stage.nickstage > :first-child { margin-top: 12vh; }
	.stage.nickstage > :last-child { margin-bottom: auto; }
	.nick { --k: 1; display: flex; flex-direction: column; align-items: flex-start; }
	/* Desktop / pantallas anchas: todo el bloque del apodo más grande (--k multiplica letra, espejo y ayuda). */
	@media (min-width: 900px) {
		.nick { --k: 1.6; }
		.frame:has(.nickstage) { max-width: 760px; }
	}
	.hello, .typed { font-size: calc(40px * var(--k)); font-weight: 600; letter-spacing: -0.035em; line-height: 1.08; }
	.hello { color: var(--muted); }
	.typed { position: relative; width: 100%; min-height: 1.08em; color: var(--text); }
	.typed .mirror, .typed input { font-size: calc(var(--fs) * var(--k)); }
	.mirror { display: flex; align-items: center; white-space: pre; min-height: calc(43px * var(--k)); }
	.ch { display: inline-block; animation: letter 0.35s cubic-bezier(0.16, 1, 0.3, 1); }
	@keyframes letter { from { filter: blur(6px); transform: translateY(6px); opacity: 0; } }
	.caret { flex: none; width: 3px; height: 0.95em; margin: 0 2px; border-radius: 2px; background: var(--accent-fg); animation: blink 1s steps(1) infinite; }
	@keyframes blink { 50% { opacity: 0; } }
	/* font-size: el desktop tiene un `.ph` global de 12.5px (ui/styles.css) que achicaba el placeholder. */
	.ph { font-size: inherit; color: var(--border-strong); }
	.typed input {
		position: absolute;
		inset: 0;
		width: 100%;
		padding: 0;
		border: 0;
		background: none;
		color: transparent;
		caret-color: transparent;
		font-family: inherit;
		font-weight: inherit;
		letter-spacing: inherit;
		outline: none;
	}
	.hint { min-height: 1.5em; margin-top: calc(14px * var(--k)); font-size: calc(14.5px * (1 + var(--k)) / 2); color: var(--dim); transition: opacity 0.3s var(--ease); }
	.hint.gone { opacity: 0; }
	.hint.err { color: var(--red); }
	/* Seguir: flecha pegada al apodo (lo sigue mientras se escribe); entra deslizando, empuja suave mientras espera. */
	.typed { display: flex; align-items: center; gap: 0.12em; }
	.field { position: relative; display: inline-block; padding-right: 0.12em; min-width: 1em; }
	.go {
		flex: none;
		display: grid;
		place-items: center;
		width: 1.2em;
		height: 1.2em;
		padding: 0;
		border: 0;
		background: none;
		color: var(--accent-fg);
		font-size: var(--fs);
		opacity: 0;
		transform: translateX(-12px);
		pointer-events: none;
		transition: opacity 0.3s var(--ease), transform 0.5s cubic-bezier(0.34, 1.56, 0.64, 1), color 0.2s var(--ease);
	}
	.arr { width: 0.75em; height: 0.75em; overflow: visible; fill: none; stroke: currentColor; stroke-width: 2.4; stroke-linecap: round; stroke-linejoin: round; transition: transform 0.3s var(--out); }
	.go.show { opacity: 1; transform: none; pointer-events: auto; }
	.go.show .arr { animation: nudge 2s var(--ease) 0.6s infinite; }
	@keyframes nudge { 0%, 60%, 100% { transform: none; } 30% { transform: translateX(5px); } }
	.go.show:hover, .go.show:focus-visible { color: var(--text); outline: none; }
	.go.show:hover .arr, .go.show:focus-visible .arr { animation: none; transform: translateX(6px); }
	.go.show:active .arr { transform: translateX(10px); }
	.go:disabled { opacity: 0.5; }
	footer.hidden { display: none; }
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
		.tour[open], .tour.leaving, .tour.leaving::backdrop, .stage > *, .stores li, .disc, .ring, .glass, .logo, .col, .ch, .caret { animation: none; }
		.go, .hint { transition: none; }
		.go.show .arr { animation: none; }
		.ring { display: none; }
		.dot span { transition: none; }
	}
</style>
