<!-- Toast único (cola en `toast-queue.ts`): `popover="manual"` lo sube a la capa de arriba, también sobre las hojas. Montar una sola instancia por app. -->
<script lang="ts">
	import { onMount } from 'svelte';
	import { currentToast, dismissToast, subscribeToast, type ToastRequest } from './toast-queue.ts';

	let req = $state<ToastRequest | null>(currentToast());
	let el = $state<HTMLElement>();

	onMount(() => subscribeToast(() => (req = currentToast())));

	// Un toast nuevo reinicia el popover (y su animación) y la cuenta para irse solo.
	$effect(() => {
		if (!el) return;
		if (el.matches(':popover-open')) el.hidePopover();
		if (!req) return;
		el.showPopover();
		const id = setTimeout(dismissToast, req.ms);
		return () => clearTimeout(id);
	});
</script>

<div id={req?.id ?? 'toast'} class="toast" popover="manual" bind:this={el} role="status">
	{#if req}
		{#if req.check}
			{#key req.n}
				<svg class="toast-mark" viewBox="0 0 56 56" aria-hidden="true">
					<circle cx="28" cy="28" r="26" />
					<path d="M17 29l7.5 7.5L40 21" />
				</svg>
			{/key}
		{/if}
		<span class="toast-text">
			<strong>{req.text}</strong>
			{#if req.sub}<span>{req.sub}</span>{/if}
		</span>
		{#if req.action}
			{@const action = req.action}
			<button id={action.id ?? 'toast-action'} type="button" class="toast-btn" onclick={() => { dismissToast(); action.onclick(); }}>{action.label}</button>
		{/if}
	{/if}
</div>

<style>
	.toast {
		inset: auto 12px calc(16px + var(--safe-bottom)) 12px;
		margin: 0 auto;
		max-width: 420px;
		width: auto;
		display: none;
		align-items: center;
		gap: 12px;
		padding: 10px 10px 10px 12px;
		border: 1px solid var(--border);
		border-radius: var(--r-lg);
		background: color-mix(in srgb, var(--surface) 92%, transparent);
		backdrop-filter: blur(14px);
		-webkit-backdrop-filter: blur(14px);
		color: var(--text);
		box-shadow: 0 10px 30px var(--shadow-lg);
	}
	.toast:popover-open { display: flex; animation: toast-in 0.32s var(--out); }
	@keyframes toast-in { from { transform: translateY(24px); opacity: 0; } }
	.toast-mark { flex: none; width: 34px; height: 34px; fill: none; stroke-linecap: round; stroke-linejoin: round; }
	.toast-mark circle { fill: color-mix(in srgb, var(--green) 16%, transparent); stroke: var(--green); stroke-width: 3; transform-origin: center; animation: ring 0.45s var(--out) both; }
	.toast-mark path { stroke: var(--green); stroke-width: 5; stroke-dasharray: 36; stroke-dashoffset: 36; animation: draw 0.35s 0.2s var(--out) forwards; }
	@keyframes ring { from { transform: scale(0.6); opacity: 0; } }
	@keyframes draw { to { stroke-dashoffset: 0; } }
	@media (prefers-reduced-motion: reduce) { .toast-mark path { stroke-dashoffset: 0; } }
	.toast-text { flex: 1; min-width: 0; display: flex; flex-direction: column; font-size: 13px; color: var(--muted); }
	.toast-text strong { font-size: 14.5px; color: var(--text); }
	.toast-btn { flex: none; min-height: 36px; padding: 0 12px; border: 0; border-radius: var(--r-pill); background: var(--surface-3); color: var(--text); font-size: 13px; font-weight: 650; position: relative; }
	.toast-btn::after { content: ''; position: absolute; inset: -4px 0; }
</style>
