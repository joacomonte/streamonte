<script lang="ts">
  // Saludo de la barra de arriba ("Hola Joaco! 👋" + los 2 animales), junto a la marca: el mismo de la web (`NickHello`).
  // Tocar las miniaturas abre Ajustes, donde están las cartas.
  import NickHello from '$ui/animals/NickHello.svelte';
  import { openSettings } from './dialog-flows.ts';
  import { nickState } from './nick-state.svelte.ts';
</script>

<div id="top-hello" class="slot">
  {#if nickState.nick}<NickHello nick={nickState.nick} animals={nickState.animals ?? []} onpick={() => void openSettings()} />{/if}
</div>

<style>
  .slot { flex: 1; min-width: 0; margin-left: 12px; }
</style>
