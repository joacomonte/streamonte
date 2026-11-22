<script lang="ts">
	// Lista de opciones de torrents (web y desktop): una fila por opción con clave = hash, así un cambio de datos rehace solo
	// lo que cambió y no la lista entera.
	import OptionRow from './OptionRow.svelte';
	import type { OptionRowView } from './row.ts';

	let { rows, id }: { rows: OptionRowView[]; id?: string } = $props();
</script>

<ul {id} class="cat-options">
	{#each rows as row (row.hash)}
		<OptionRow {row} />
	{/each}
</ul>
