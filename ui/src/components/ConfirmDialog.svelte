<!-- Diálogo de confirmación único (cola en `confirm-queue.ts`): texto o barra de progreso, y los botones del pedido. -->
<script lang="ts">
  import { onMount } from 'svelte';
  import Sheet from '$ui/components/Sheet.svelte';
  import { t } from '../i18n.js';
  import { answerConfirm, currentConfirm, subscribeConfirm, type ConfirmRequest } from '../confirm-queue.ts';

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
    {#if typeof req?.body === 'string'}{req.body}{:else if req}
      <span class="close-dl">
        <span class="close-dl-head"><b>{req.body.name}</b><span>{t('{pct} % bajado', { pct: req.body.pct })}</span></span>
        <span class="close-dl-bar" role="progressbar" aria-valuenow={req.body.pct} aria-valuemin={0} aria-valuemax={100}><i style="width:{req.body.pct}%"></i></span>
      </span>
    {/if}
  </p>
  <div id="dlg-confirm-actions" class="dialog-actions">
    {#each req?.buttons ?? [] as b (b.label)}
      <!-- svelte-ignore a11y_autofocus -->
      <button id={b.id} class:primary={b.primary} class:danger={b.danger} autofocus={b.primary} onclick={() => choose(b.value)}>{b.label}</button>
    {/each}
  </div>
</Sheet>
