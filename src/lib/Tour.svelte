<script>
	// Tutorial por pasos: hoja inferior en mobile, diálogo centrado en pantallas grandes (como Sheet). `<dialog>`
	// nativo: foco, Esc y fondo. Flechas del teclado y botones para moverse; Saltar o Esc lo cierran.
	import Icon from './Icon.svelte';
	import { t } from './i18n.svelte.js';
	import LangPicker from './LangPicker.svelte';

	/** @type {{id: string, label: string, open: boolean, steps: import('./tours.js').Step[], onclose: () => void}} */
	let { id, label, open, steps, onclose } = $props();
	/** @type {HTMLDialogElement | undefined} */
	let dlg = $state();
	let i = $state(0);
	let dir = $state(1);
	const step = $derived(steps[i]);
	const last = $derived(i === steps.length - 1);

	$effect(() => {
		if (open && !dlg?.open) {
			i = 0;
			dlg?.showModal();
		} else if (!open && dlg?.open) dlg.close();
	});

	/** @param {number} to */
	function go(to) {
		if (to < 0 || to >= steps.length) return;
		dir = to > i ? 1 : -1;
		i = to;
	}

	const still = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
	/** Entra desde el lado hacia donde se avanza, saliendo de un desenfoque. @param {Element} _ @param {{dir: number}} p */
	const enter = (_, { dir }) => ({
		duration: still() ? 0 : 420,
		css: (/** @type {number} */ t) => {
			const e = 1 - Math.pow(1 - t, 4);
			return `transform: translateX(${(1 - e) * dir * 28}px); opacity: ${e}; filter: blur(${(1 - e) * 6}px);`;
		}
	});
</script>

<dialog
	{id}
	bind:this={dlg}
	class="tour"
	aria-label={label}
	onclose={onclose}
	onclick={(e) => e.target === dlg && dlg?.close()}
	onkeydown={(e) => {
		if (e.key === 'ArrowRight') go(i + 1);
		else if (e.key === 'ArrowLeft') go(i - 1);
	}}
>
	<header>
		<div class="progress" role="progressbar" aria-label={t('Paso {n} de {d}', { n: i + 1, d: steps.length })} aria-valuemin="1" aria-valuemax={steps.length} aria-valuenow={i + 1}>
			{#each steps as s, n (s.title)}
				<button id="{id}-dot-{n}" type="button" class="seg" class:done={n <= i} aria-label={t('Ir al paso {n}', { n: n + 1 })} onclick={() => go(n)}><span></span></button>
			{/each}
		</div>
		{#if !last}
			<button id="{id}-skip" type="button" class="skip" onclick={() => dlg?.close()}>{t('Saltar')}</button>
		{/if}
	</header>

	{#snippet body(/** @type {import('./tours.js').Step} */ st, /** @type {boolean} */ live)}
		<div class="disc" aria-hidden="true">
			{#if live}<span class="ring"></span>{/if}
			<Icon name={st.icon} size={34} />
		</div>
		<h2 id={live ? `${id}-title` : undefined}>{st.title}</h2>
		<p>{st.body}</p>
		{#if st.picker}
			<div class="picker">{#if live}<LangPicker id="{id}-lang" />{:else}<div class="picker-size"></div>{/if}</div>
		{/if}
		{#if st.links?.length}
			<ul class="stores">
				{#each st.links as l (l.href)}
					<li>
						<a id={live ? `${id}-store-${i}-${l.href.replace(/\W+/g, '-').slice(-28)}` : undefined} href={l.href} target="_blank" rel="noopener noreferrer" tabindex={live ? undefined : -1}>
							<span class="store-text"><strong>{l.label}</strong><small>{l.store}</small></span>
							<Icon name="download" size={18} />
						</a>
					</li>
				{/each}
			</ul>
		{/if}
	{/snippet}
	<!-- Todos los pasos invisibles en la misma celda: la hoja toma la altura del más alto y no salta al avanzar. -->
	<div class="stages">
		{#each steps as st (st.title)}
			<div class="stage sizer" aria-hidden="true" inert>{@render body(st, false)}</div>
		{/each}
		{#key i}
			<div class="stage" in:enter={{ dir }}>{@render body(step, true)}</div>
		{/key}
	</div>

	<footer>
		{#if i > 0}
			<button id="{id}-back" type="button" class="btn ghost" onclick={() => go(i - 1)}>{t('Atrás')}</button>
		{/if}
		<button id="{id}-next" type="button" class="btn primary" onclick={() => (last ? dlg?.close() : go(i + 1))}>
			{last ? t('Listo') : t('Siguiente')}
			{#if !last}<Icon name="next" size={18} />{/if}
		</button>
	</footer>
</dialog>

<style>
	.tour {
		width: 100%;
		max-width: 440px;
		max-height: 92dvh;
		margin: auto auto 0;
		padding: 0 0 var(--safe-bottom);
		border: 0;
		border-radius: 24px 24px 0 0;
		background: var(--surface);
		color: var(--text);
		box-shadow: 0 -12px 48px var(--shadow-lg);
		display: flex;
		flex-direction: column;
		overflow: hidden;
	}
	.tour:not([open]) { display: none; }
	.tour[open] { animation: rise 0.5s var(--out); }
	.tour::backdrop { background: rgb(0 0 0 / 0.5); backdrop-filter: blur(3px); }
	.tour[open]::backdrop { animation: fade 0.4s var(--out); }
	@keyframes rise { from { transform: translateY(48%); } }
	@keyframes fade { from { opacity: 0; } }
	@media (min-width: 720px) {
		.tour { margin: auto; border-radius: 24px; }
		.tour[open] { animation-name: pop; }
		@keyframes pop { from { transform: translateY(16px) scale(0.97); opacity: 0; } }
	}

	header { display: flex; align-items: center; gap: 12px; padding: 14px 20px 0; min-height: 52px; }
	.progress { flex: 1; display: flex; gap: 6px; }
	.seg { flex: 1; height: 28px; padding: 0; border: 0; background: none; display: grid; align-items: center; cursor: pointer; }
	.seg span { display: block; height: 4px; border-radius: 99px; background: var(--surface-3); overflow: hidden; position: relative; }
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
	.skip { min-height: 40px; margin-right: -10px; padding: 0 10px; border: 0; border-radius: 999px; background: none; color: var(--muted); font-size: 14px; font-weight: 600; }
	.skip:active { background: var(--surface-2); }

	.stages { display: grid; }
	.stage { grid-area: 1 / 1; padding: 20px 24px 8px; display: flex; flex-direction: column; }
	.sizer { visibility: hidden; }
	.sizer .disc { animation: none; }
	.disc {
		position: relative;
		width: 76px;
		height: 76px;
		margin-bottom: 22px;
		display: grid;
		place-items: center;
		border-radius: 24px;
		background: color-mix(in srgb, var(--accent) 16%, var(--surface));
		color: var(--accent-fg);
		animation: disc 0.6s var(--out) both;
	}
	.disc :global(svg) { position: relative; }
	.ring { position: absolute; inset: 0; border-radius: inherit; border: 2px solid color-mix(in srgb, var(--accent) 45%, transparent); animation: ring 1.1s var(--out) 0.15s both; }
	@keyframes disc { from { transform: scale(0.7) rotate(-8deg); } }
	@keyframes ring { from { transform: scale(1); opacity: 1; } to { transform: scale(1.55); opacity: 0; } }
	h2 { margin: 0 0 8px; font-size: 24px; line-height: 1.2; letter-spacing: -0.02em; text-wrap: balance; }
	p { margin: 0; font-size: 16px; line-height: 1.5; color: var(--muted); text-wrap: pretty; }

	.picker { margin-top: 20px; }
	/* Alto del selector en el paso invisible que fija la altura de la hoja (3 filas). */
	.picker-size { height: 240px; }
	.stores { list-style: none; margin: 20px 0 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
	.stores a {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		min-height: 56px;
		padding: 8px 16px;
		border: 1px solid var(--border-strong);
		border-radius: 14px;
		color: var(--text);
		text-decoration: none;
		transition: background 0.2s, transform 0.15s;
	}
	.stores a:active { transform: scale(0.98); background: var(--surface-2); }
	.stores a :global(svg) { color: var(--accent-fg); flex: none; }
	.store-text { display: flex; flex-direction: column; min-width: 0; }
	.store-text strong { font-size: 15px; font-weight: 650; }
	.store-text small { font-size: 13px; color: var(--muted); }

	footer { display: flex; gap: 10px; padding: 12px 20px 20px; }
	footer .btn { flex: 1; display: inline-flex; align-items: center; justify-content: center; gap: 4px; height: 50px; font-size: 16px; }
	.ghost { background: none; }

	@media (hover: hover) {
		.stores a:hover { background: var(--surface-2); }
		.skip:hover { color: var(--text); }
	}
	@media (prefers-reduced-motion: reduce) {
		.tour[open], .tour[open]::backdrop, .disc, .ring { animation: none; }
		.ring { display: none; }
		.seg span::after { transition: none; }
	}
</style>
