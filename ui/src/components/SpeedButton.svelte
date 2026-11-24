<!-- Contenido del botón #btn-speed de la barra: medidor y velocidad. `host` es el botón (su clase y aria-busy siguen al estado). -->
<script lang="ts">
  import { onMount } from 'svelte';
  import { t } from '../i18n.ts';
  import { fmtMbps } from '../speed-model.ts';
  import { speedStore } from '../speed-instance.ts';
  import Gauge from './Gauge.svelte';

  let { host }: { host: HTMLElement } = $props();
  let view = $state(speedStore.snapshot().view);
  onMount(() => speedStore.subscribe(() => (view = speedStore.snapshot().view)));

  $effect(() => {
    host.classList.toggle('measuring', view.kind === 'measuring');
    host.classList.toggle('failed', view.kind === 'failed');
    host.setAttribute('aria-busy', String(view.kind === 'measuring'));
    host.title = t('Tu conexión: velocidad de internet y cómo se estima si un torrent va a andar bien');
  });
</script>

<Gauge v={view.mbps ?? 0} />
<span class="speed-val">
  {#if view.kind === 'measuring' || view.kind === 'done'}{fmtMbps(view.mbps)} <small>Mbps</small>{:else if view.kind === 'failed'}{t('Sin medir')}{:else}{t('Medir')}{/if}
</span>
