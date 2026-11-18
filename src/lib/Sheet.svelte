<script>
	// Hoja inferior en mobile, diálogo centrado en pantallas grandes. `<dialog>` nativo: foco, Esc y fondo gratis.
	import Icon from './Icon.svelte';

	/** @type {{id: string, title: string, open: boolean, onclose: () => void, children: import('svelte').Snippet}} */
	let { id, title, open, onclose, children } = $props();
	/** @type {HTMLDialogElement | undefined} */
	let dlg = $state();

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
		<button id="{id}-close" class="icon-btn" type="button" aria-label="Cerrar" onclick={() => dlg?.close()}>
			<Icon name="close" />
		</button>
	</header>
	<div class="body">{@render children()}</div>
</dialog>

<style>
	.sheet {
		width: 100%;
		max-width: 560px;
		max-height: 85dvh;
		margin: auto auto 0;
		padding: 0;
		border: 0;
		border-radius: 16px 16px 0 0;
		background: var(--surface);
		color: var(--text);
		box-shadow: 0 -8px 40px var(--shadow-lg);
		display: flex;
		flex-direction: column;
		padding-bottom: var(--safe-bottom);
	}
	.sheet:not([open]) { display: none; }
	.sheet[open] { animation: up 0.28s var(--out); }
	.sheet::backdrop { background: rgb(0 0 0 / 0.45); }
	@keyframes up { from { transform: translateY(40%); opacity: 0; } }
	@media (min-width: 720px) {
		.sheet { margin: auto; border-radius: 16px; }
		.sheet[open] { animation-name: pop; }
		@keyframes pop { from { transform: scale(0.96); opacity: 0; } }
	}
	header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 10px 8px 6px 18px;
		border-bottom: 1px solid var(--border);
	}
	h2 { margin: 0; font-size: 16px; }
	.body { overflow: auto; padding: 12px 16px 16px; }
</style>
