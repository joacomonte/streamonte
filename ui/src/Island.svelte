<!-- Isla Svelte mínima (etapa 0): invisible; prueba que Svelte compila y monta junto al DOM viejo. -->
<script lang="ts">
  let ready = $state(true);
</script>

<span id="svelte-island" hidden data-ready={ready}></span>
