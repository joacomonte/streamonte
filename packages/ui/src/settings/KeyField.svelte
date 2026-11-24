<script lang="ts">
	// Fila de una key con su campo: faltando, el campo a la vista; guardada, "Cambiar"; recién guardada, la confirmación 1,8 s.
	// Enter o el botón guardan esa key sola. Estado y guardado: keys-form.svelte.ts (la app inyecta el adaptador).
	import { t } from '../i18n/runtime.ts';
	import KeyRow from './KeyRow.svelte';
	import type { KeysForm } from './keys-form.svelte.ts';

	interface Props {
		form: KeysForm;
		service: string;
		name: string;
		hint: string;
		placeholder: string;
		/** Texto largo en el tooltip del ⓘ (desktop). */
		tip?: string;
		/** Con `href` "Conseguir" es un link; con `onget`, un botón. */
		href?: string;
		onget?: () => void;
		/** Botón Guardar en acento (principal). */
		primary?: boolean;
	}
	let { form, service, name, hint, placeholder, tip, href, onget, primary = false }: Props = $props();
	const has = $derived(form.has(service));
	const editing = $derived(form.isEditing(service));
	const edit = $derived(!has || editing);
	const busy = $derived(form.busy === service);
	const err = $derived(form.error?.service === service ? form.error.text : '');
</script>

<KeyRow {service} {name} {hint} {tip} {has} {editing} editField={edit} {href} {onget} changeId="key-{service}-change" getId="key-{service}-page" panelId="panel-{service}" onchange={() => form.toggle(service)}>
	{#if form.saved?.service === service}
		<p id="key-{service}-done" class="st-block key-done" role="status">
			<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="m7.5 12.5 3 3 6-6.5"/></svg>{form.saved.text}
		</p>
	{:else if edit}
		<div id="panel-{service}" class="st-block">
			<div class="st-inline">
				<input id="key-{service}" class="st-input" type="password" autocomplete="off" placeholder={t(placeholder)} aria-label="{name} API key" bind:value={form.typed[service]}
					onkeydown={(e) => { if (e.key === 'Enter') form.save(service, name); }}>
				{#if has && form.canRemove}<button id="key-{service}-del" type="button" class="st-link danger" disabled={busy} onclick={() => form.remove(service)}>{t('Borrar')}</button>{/if}
				<button id="key-{service}-save" class="st-btn" class:go={primary} type="button" disabled={busy || !form.typed[service]?.trim()} onclick={() => form.save(service, name)}>
					{#if busy}<span class="spin light"></span>{/if}{t('Guardar')}
				</button>
			</div>
			{#if err}<p class="st-msg bad" role="alert">{err}</p>{/if}
		</div>
	{/if}
</KeyRow>

<style>
	.key-done { flex-direction: row; align-items: center; gap: 10px; margin: 0; color: var(--text); font-size: 13px; font-weight: 600; animation: key-pop 0.35s var(--out); }
	.key-done svg { flex: none; color: var(--green); }
	.key-done :global(svg circle) { stroke-dasharray: 64; stroke-dashoffset: 64; animation: key-draw 0.45s var(--out) forwards; }
	.key-done :global(svg path) { stroke-dasharray: 16; stroke-dashoffset: 16; animation: key-draw 0.3s var(--out) 0.35s forwards; }
	@keyframes key-draw { to { stroke-dashoffset: 0; } }
	@keyframes key-pop { from { opacity: 0; transform: scale(0.98); } }
	@media (prefers-reduced-motion: reduce) { .key-done, .key-done :global(svg *) { animation: none; stroke-dashoffset: 0; } }
</style>
