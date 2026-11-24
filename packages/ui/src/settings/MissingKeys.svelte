<script lang="ts">
	// Banner "Faltan keys": lista las keys sin guardar según `status` (el del adaptador). Con `href` es un link; con `onopen`, un botón.
	// Sin `status` (cargando) o sin nada que falte, no se muestra.
	import { t } from '../i18n/runtime.ts';

	interface Props {
		status: Partial<Record<string, boolean>> | null;
		/** Keys que cuentan, en orden. Por defecto las dos que frenan la app. */
		services?: { service: string; label: string }[];
		href?: string;
		onopen?: () => void;
	}
	let { status, services = [{ service: 'tmdb', label: 'TMDB (catálogo)' }, { service: 'torbox', label: 'TorBox (torrents)' }], href, onopen }: Props = $props();
	const missing = $derived(status ? services.filter((s) => !status[s.service]) : []);
</script>

{#snippet body()}
	<strong>{t('Faltan keys')}</strong>
	<span>{missing.map((m) => t(m.label)).join(t(' y '))}{t(': cargalas en Ajustes.')}</span>
{/snippet}

{#if missing.length}
	{#if href}
		<a id="keys-cta" class="cta" {href}>{@render body()}</a>
	{:else}
		<button id="keys-cta" class="cta" type="button" onclick={onopen}>{@render body()}</button>
	{/if}
{/if}

<style>
	.cta { display: flex; flex-direction: column; gap: 2px; padding: 12px 14px; margin-bottom: 12px; border-radius: var(--r-card); background: color-mix(in srgb, var(--accent) 14%, var(--surface)); border: 1px solid color-mix(in srgb, var(--accent) var(--tint-3), transparent); text-decoration: none; font-size: 14px; color: var(--text); text-align: left; }
	button.cta { width: 100%; cursor: pointer; }
</style>
