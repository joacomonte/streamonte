<script lang="ts">
	// Fila de una key o cuenta: nombre + pista, chip Guardada/Falta y "Cambiar" (si ya está) o "Conseguir" (si falta).
	// El campo para pegarla va en `children`: cada app lo guarda a su manera (desktop: almacén seguro; web: servidor).
	import type { Snippet } from 'svelte';
	import Icon from '../components/Icon.svelte';
	import { t } from '../i18n/runtime.ts';

	interface Props {
		service: string;
		name: string;
		hint: string;
		/** Texto largo en el tooltip del ⓘ (solo desktop). */
		tip?: string;
		has: boolean;
		/** El campo de reemplazo está abierto (muestra "Cancelar"). */
		editing?: boolean;
		okText?: string;
		/** Con `href` "Conseguir" es un link; con `onget`, un botón; sin ninguno no se muestra. */
		href?: string;
		onget?: () => void;
		onchange: () => void;
		changeId?: string;
		getId?: string;
		panelId?: string;
		/** Hay un campo `key-<servicio>` en pantalla (para enlazar el label). */
		editField?: boolean;
		children?: Snippet;
	}
	let {
		service, name, hint, tip, has, editing = false, okText, href, onget, onchange,
		changeId = `change-${service}`, getId = `get-${service}`, panelId, editField = false, children
	}: Props = $props();
</script>

<li class="key-row" data-service={service}>
	<div class="st-row">
		<span class="st-lbl">
			<span class="st-name"><label for={editField ? `key-${service}` : undefined}>{name}</label>{#if tip}<button id="key-{service}-tip" type="button" class="tip-i" aria-label={tip} title={tip} onclick={(e) => e.preventDefault()}><Icon name="info" size={14} /></button>{/if}</span>
			<span class="st-sub">{hint}</span>
		</span>
		<span id="key-{service}-state" class="st-chip" class:ok={has}>{#if has}<Icon name="check" size={12} />{/if}{has ? (okText ?? t('Guardada')) : t('Falta')}</span>
		{#if has}
			<button id={changeId} type="button" class="st-link" aria-expanded={editing} aria-controls={panelId} onclick={onchange}>{editing ? t('Cancelar') : t('Cambiar')}</button>
		{:else if href}
			<a id={getId} class="st-link" {href} target="_blank" rel="noreferrer">{t('Conseguir')}<Icon name="external" size={13} /></a>
		{:else if onget}
			<button id={getId} type="button" class="st-link" onclick={onget}>{t('Conseguir')}<Icon name="external" size={13} /></button>
		{/if}
	</div>
	{@render children?.()}
</li>
