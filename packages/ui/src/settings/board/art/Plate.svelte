<script lang="ts">
	// "The Odyssey" / "La Odisea" según el idioma de los títulos; al cambiar, el cartel da media vuelta.
	import { untrack } from 'svelte';
	let { titles }: { titles: string } = $props();
	let shown = $state(untrack(() => titles));
	let flip = $state(false);
	$effect(() => {
		if (titles === shown) return;
		flip = false;
		requestAnimationFrame(() => (flip = true));
		const id = setTimeout(() => (shown = titles), matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 190);
		return () => clearTimeout(id);
	});
</script>

<span class="plate" class:flip><span class="plate-in"><span class="plate-t">{shown === 'es' ? 'La Odisea' : 'The Odyssey'}</span></span></span>
