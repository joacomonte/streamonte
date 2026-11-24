<!-- Diálogos del desktop: confirmación, log de reproducción y Ajustes. Lo monta `main.ts` antes de `app.js`. -->
<script lang="ts">
  import ConfirmDialog from '$ui/components/ConfirmDialog.svelte';
  import { t } from '../i18n.ts';
  import LogDialog from './LogDialog.svelte';
  import Settings from './Settings.svelte';
</script>

<Settings />
<LogDialog />
{#snippet progress(body: object)}
  {@const dl = body as { name: string; pct: number }}
  <span class="close-dl">
    <span class="close-dl-head"><b>{dl.name}</b><span>{t('{pct} % bajado', { pct: dl.pct })}</span></span>
    <span class="close-dl-bar" role="progressbar" aria-valuenow={dl.pct} aria-valuemin={0} aria-valuemax={100}><i style="width:{dl.pct}%"></i></span>
  </span>
{/snippet}
<ConfirmDialog rich={progress} />
