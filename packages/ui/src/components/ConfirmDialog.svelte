<!-- Diálogo de confirmación único (cola en `confirm-queue.ts`): texto, o lo que dibuje `rich` si el cuerpo es un objeto, y los botones del pedido. Montar una sola instancia por app. -->
<script lang="ts">
	import { onMount, type Snippet } from 'svelte';
	import Sheet from './Sheet.svelte';
	import { answerConfirm, currentConfirm, subscribeConfirm, type ConfirmRequest } from './confirm-queue.ts';

	/** Dibuja los cuerpos que no son texto (el desktop: barra de progreso de la reproducción que sigue bajando). */
	let { rich }: { rich?: Snippet<[object]> } = $props();
	let req = $state<ConfirmRequest | null>(currentConfirm());

	onMount(() => subscribeConfirm(() => (req = currentConfirm())));

	function choose(value: unknown): void {
		if (!req) return;
		req.closing = true;
		answerConfirm(value);
	}
	// Esc (o cerrar sin elegir) = null.
	function onclose(): void {
		if (req && !req.closing) answerConfirm(null);
	}
</script>

<Sheet id="dlg-confirm" title={req?.title ?? ''} open={req !== null} {onclose} closable={false} maxWidth="460px">
	<p id="dlg-confirm-text">
		{#if typeof req?.body === 'string'}{req.body}{:else if req && rich}{@render rich(req.body)}{/if}
	</p>
	<div id="dlg-confirm-actions" class="dialog-actions">
		{#each req?.buttons ?? [] as b (b.label)}
			<!-- svelte-ignore a11y_autofocus -->
			<button id={b.id} class="btn" class:btn-primary={b.primary} class:primary={b.primary} class:danger={b.danger} autofocus={b.primary} onclick={() => choose(b.value)}>{b.label}</button>
		{/each}
	</div>
</Sheet>
