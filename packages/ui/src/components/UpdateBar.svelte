<!-- Aviso de versión nueva (web y desktop): barra fija abajo con un botón de acción. Los textos los pone cada app. -->
<script lang="ts">
	import Icon from './Icon.svelte';
	import { t } from '../i18n/runtime.ts';

	interface Props {
		text: string;
		/** Notas de la versión (desktop). */
		notes?: string;
		actionLabel: string;
		busy?: boolean;
		onaction: () => void;
		/** Con esto aparece el ✕. */
		ondismiss?: () => void;
		/** Dónde queda anclada (CSS `bottom`); la barra de estado del desktop pide más. */
		bottom?: string;
	}
	let { text, notes, actionLabel, busy = false, onaction, ondismiss, bottom = 'calc(12px + var(--safe-bottom))' }: Props = $props();
</script>

<div id="update-bar" class="update" role="status" style:bottom>
	<span class="text">{text}</span>
	{#if notes}<span id="update-notes" class="notes">{notes}</span>{/if}
	<button id="update-now" type="button" class="update-btn" disabled={busy} onclick={onaction}><Icon name="download" size={16} />{actionLabel}</button>
	{#if ondismiss}
		<button id="update-dismiss" type="button" class="update-x" disabled={busy} aria-label={t('Cerrar aviso')} onclick={ondismiss}><Icon name="close" size={16} /></button>
	{/if}
</div>

<style>
	.update {
		position: fixed;
		left: 12px;
		right: 12px;
		z-index: 60;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		max-width: 520px;
		margin: 0 auto;
		padding: 8px 8px 8px 16px;
		border-radius: var(--r-card);
		background: var(--raised);
		box-shadow: 0 8px 28px var(--shadow-lg);
		font-size: 14.5px;
		font-weight: 600;
		animation: update-in 0.4s var(--out);
	}
	.text { flex: 1; min-width: 0; }
	.notes { max-width: 320px; font-size: 13px; font-weight: 400; color: var(--muted); white-space: pre-line; }
	.update-btn { display: inline-flex; align-items: center; gap: 6px; min-height: 40px; padding: 0 14px; border: 0; border-radius: var(--r-md); background: var(--accent); color: var(--accent-text); font-size: 14px; font-weight: 700; }
	.update-btn:active { transform: scale(0.97); }
	.update-btn:disabled { opacity: 0.6; }
	.update-x { display: inline-grid; place-items: center; width: 40px; height: 40px; padding: 0; border: 0; border-radius: var(--r-pill); background: none; color: var(--muted); }
	@keyframes update-in { from { transform: translateY(24px); opacity: 0; } }
	@media (prefers-reduced-motion: reduce) { .update { animation: none; } }
</style>
