<script lang="ts">
	// Hoja inferior en mobile, diálogo centrado en pantallas grandes. `<dialog>` nativo: foco, Esc y fondo gratis.
	import Icon from './Icon.svelte';
	import { t } from './i18n.svelte.ts';

	import type { Snippet } from 'svelte';

	interface Props {
		id: string;
		title: string;
		open: boolean;
		onclose: () => void;
		children: Snippet;
	}
	let { id, title, open, onclose, children }: Props = $props();
	let dlg = $state<HTMLDialogElement>();

	$effect(() => {
		if (open && !dlg?.open) dlg?.showModal();
		else if (!open && dlg?.open) dlg.close();
	});
</script>

<dialog
	{id}
	bind:this={dlg}
	class="sheet"
	aria-labelledby="{id}-title"
	onclose={onclose}
	onclick={(e) => e.target === dlg && dlg?.close()}
>
	<header>
		<h2 id="{id}-title">{title}</h2>
		<button id="{id}-close" class="btn-icon" type="button" aria-label={t('Cerrar')} onclick={() => dlg?.close()}>
			<Icon name="close" />
		</button>
	</header>
	<div class="body">{@render children()}</div>
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
	/* Al llegar al tope o al fondo de la hoja, el gesto no pasa a la página. */
	.body { overflow: auto; overscroll-behavior: contain; padding: 12px 16px 16px; }
</style>
