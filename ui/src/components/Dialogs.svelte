<!-- Diálogos del desktop: confirmación, log de reproducción y Ajustes. Lo monta `main.ts` antes de `app.js`. -->
<script lang="ts">
  import ConfirmDialog from './ConfirmDialog.svelte';
  import LogDialog from './LogDialog.svelte';
  import Settings from './Settings.svelte';
</script>

<Settings />
<LogDialog />
<ConfirmDialog />
