<!-- Detalle (log en vivo) de una reproducción. El cuerpo lo va completando `app.js` línea a línea (evento `playback-log`). -->
<script lang="ts">
  import { onMount } from 'svelte';
  import { t } from '../i18n.js';
  import { host } from '../ui-host.ts';

  let dlg: HTMLDialogElement;
  let pre: HTMLPreElement;
  let title = $state(t('Detalle'));

  onMount(() => {
    host.openLog = (name, lines) => {
      title = name;
      pre.textContent = lines.join('\n');
      dlg.showModal();
    };
  });
</script>

<dialog id="dlg-log" class="dialog wide" bind:this={dlg}>
  <h3 id="dlg-log-title">{title}</h3>
  <pre id="dlg-log-body" bind:this={pre}></pre>
  <div class="dialog-actions"><button id="dlg-log-close" onclick={() => dlg.close()}>{t('Cerrar')}</button></div>
</dialog>
