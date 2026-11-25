<script lang="ts">
	// Hoja inferior en mobile, diálogo centrado en pantallas grandes. `<dialog>` nativo: foco, Esc y fondo gratis.
	import Icon from './Icon.svelte';
	import { t } from '../i18n/runtime.ts';

	import type { Snippet } from 'svelte';

	interface Props {
		id: string;
		title: string;
		open: boolean;
		onclose: () => void;
		children: Snippet;
		/** Pie fijo debajo del cuerpo que scrollea (el desktop lo usa en Ajustes). */
		footer?: Snippet;
		/** Ids de los que dependen tests y atajos; por defecto `{id}-title` y `{id}-close`. */
		titleId?: string;
		closeId?: string;
		/** Ancho máximo en pantallas anchas (CSS); por defecto el de `.sheet`. */
		maxWidth?: string;
		/** false: sin ✕ ni cierre al tocar el fondo (confirmaciones); Esc sigue cerrando. */
		closable?: boolean;
		/** Clase extra del `<dialog>` (Ajustes del desktop: `frost`, vidrio de css/board.css). */
		class?: string;
	}
	let { id, title, open, onclose, children, footer, titleId = `${id}-title`, closeId = `${id}-close`, maxWidth, closable = true, class: cls = '' }: Props = $props();
	let dlg = $state<HTMLDialogElement>();

	$effect(() => {
		if (open && !dlg?.open) dlg?.showModal();
		else if (!open && dlg?.open) dlg.close();
	});
</script>

<dialog
	{id}
	bind:this={dlg}
	class="sheet {cls}"
	aria-labelledby={titleId}
	style:max-width={maxWidth}
	onclose={onclose}
	onclick={(e) => closable && e.target === dlg && dlg?.close()}
>
	<header>
		<h2 id={titleId}>{title}</h2>
		{#if closable}
			<button id={closeId} class="x" type="button" aria-label={t('Cerrar')} onclick={() => dlg?.close()}>
				<Icon name="close" />
			</button>
		{/if}
	</header>
	<div class="body">{@render children()}</div>
	{@render footer?.()}
</dialog>

<style>
	.sheet[open] .body > :global(*) { animation: rise 0.5s var(--out) backwards; }
	.sheet[open] .body > :global(:nth-child(2)) { animation-delay: 0.06s; }
	.sheet[open] .body > :global(:nth-child(3)) { animation-delay: 0.12s; }
	.sheet[open] .body > :global(:nth-child(4)) { animation-delay: 0.18s; }
	.sheet[open] .body > :global(:nth-child(n + 5)) { animation-delay: 0.24s; }
	@keyframes rise { from { opacity: 0; transform: translateY(18px); } }
	header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 10px 8px 6px 18px;
		border-bottom: 1px solid var(--border);
	}
	h2 { margin: 0; font-size: 16px; }
	.x { display: inline-grid; place-items: center; width: 44px; height: 44px; padding: 0; border: 0; border-radius: var(--r-pill); background: none; color: var(--muted); }
	.x:active { background: var(--surface-2); }
	/* Al llegar al tope o al fondo de la hoja, el gesto no pasa a la página. */
	.body { overflow: auto; overscroll-behavior: contain; padding: 12px 16px 16px; }
</style>
