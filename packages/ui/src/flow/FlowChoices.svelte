<script lang="ts">
	// Contenedor de tarjetas de un paso: en columna, o `even` = todas del mismo alto.
	import type { Snippet } from 'svelte';

	let { even = false, children }: { even?: boolean; children: Snippet } = $props();
</script>

<div class="choices" class:even>{@render children()}</div>

<style>
	.choices { display: flex; flex-direction: column; gap: 8px; }
	.choices.even { display: grid; grid-auto-rows: 1fr; }
</style>
