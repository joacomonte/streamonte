<script lang="ts">
	// Sección de Ajustes: título chico + contenido. `level` es 2 en la página de la web y 3 en el diálogo del desktop. Estilos: css/settings.css.
	import type { Snippet } from 'svelte';
	interface Props {
		id: string;
		/** Id del título (lo referencia `aria-labelledby`). */
		headId: string;
		title: string;
		level?: 2 | 3;
		children: Snippet;
	}
	let { id, headId, title, level = 2, children }: Props = $props();
</script>

<section class="st-sec" {id} aria-labelledby={headId}>
	<svelte:element this={`h${level}`} class="st-h" id={headId}>{title}</svelte:element>
	{@render children()}
</section>
