<!-- Detalle (log en vivo) de una reproducción. El cuerpo lo va completando `app.js` línea a línea (evento `playback-log`). -->
<script lang="ts">
  import { onMount } from 'svelte';
  import Sheet from '$ui/components/Sheet.svelte';
  import { t } from '../i18n.ts';
  import { host } from '../ui-host.ts';

  let pre = $state<HTMLPreElement>();
  let open = $state(false);
  let title = $state(t('Detalle'));

  onMount(() => {
    host.openLog = (name, lines) => {
      title = name;
      open = true;
      // El <pre> existe aunque la hoja esté cerrada; se completa antes de abrir.
      if (pre) pre.textContent = lines.join('\n');
    };
  });
</script>

<Sheet id="dlg-log" {title} {open} onclose={() => (open = false)} maxWidth="min(860px, 92vw)">
  <pre id="dlg-log-body" bind:this={pre}></pre>
</Sheet>

<style>
  pre { margin: 0; max-height: 50vh; overflow: auto; font-size: 12px; background: var(--bg); padding: 8px; border-radius: var(--radius); }
</style>
