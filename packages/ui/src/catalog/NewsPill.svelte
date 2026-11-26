<script lang="ts">
	// Pastilla "Novedades · N" al lado del buscador (diseño: docs/mockups/novedades/dialog-a.html): reabre el diálogo.
	// N = los no vistos desde la última vez; sin número si no hay.
	import { t } from '../i18n/runtime.ts';

	interface Props {
		count: number;
		onopen: () => void;
	}
	let { count, onopen }: Props = $props();
</script>

<button id="news-pill" type="button" class="np" aria-label={count ? t('Novedades: {n} sin ver', { n: count }) : t('Novedades')} onclick={onopen}>
	{#if count}<span class="pulse" aria-hidden="true"></span>{/if}
	<span>{t('Novedades')}</span>
	{#if count}<span class="n" aria-hidden="true">{count}</span>{/if}
</button>

<style>
	.np { flex: none; display: inline-flex; align-items: center; gap: 8px; height: 48px; margin-top: 6px; padding: 0 16px 0 14px; border: 0; border-radius: var(--r-pill); background: var(--surface-2); box-shadow: inset 0 0 0 1px var(--border-strong); color: var(--text); font: inherit; font-size: 13.5px; font-weight: 700; white-space: nowrap; cursor: pointer; transition: background 0.15s, transform 0.15s var(--out); }
	@media (hover: hover) { .np:hover { background: var(--surface-3); } }
	.np:active { transform: scale(0.97); }
	.np:focus-visible { outline: 2px solid var(--accent-fg); outline-offset: 2px; }
	.pulse { width: 8px; height: 8px; border-radius: 50%; background: var(--accent-fg); animation: pulse 2.4s var(--ease) infinite; }
	.n { min-width: 22px; padding: 2px 7px; border-radius: var(--r-pill); background: var(--accent); color: #fff; font-size: 12px; text-align: center; font-variant-numeric: tabular-nums; }
	@media (max-width: 479px) { .np { padding: 0 12px; } }
	@keyframes pulse { 0% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--accent-fg) 55%, transparent); } 70%, 100% { box-shadow: 0 0 0 6px transparent; } }
	@media (prefers-reduced-motion: reduce) { .pulse { animation: none; } }
</style>
