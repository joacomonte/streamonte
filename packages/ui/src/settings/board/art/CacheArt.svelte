<script lang="ts">
	// Datos: un cilindro que se llena según `fill` (0–1).
	let { fill }: { fill: number } = $props();
	const y = $derived(Math.round((96 - 80 * Math.min(1, Math.max(0, fill))) * 10) / 10);
</script>

<svg class="art art-data" viewBox="0 0 80 100" aria-hidden="true">
	<g clip-path="url(#bd-can)">
		<g class="lq" style:transform="translateY({y}px)">
			<rect x="0" y="0" width="80" height="110" fill="url(#bd-liquid)" />
			<path class="surf" d="M-16 1 q 8 -4 16 0 t 16 0 t 16 0 t 16 0 t 16 0 t 16 0 V8 H-16 Z" fill="#c4dcff" opacity="0.55" />
		</g>
	</g>
	<path class="st" d="M14 22 C14 12 66 12 66 22 V88 C66 98 14 98 14 88 Z" />
	<path class="st" d="M14 22 C14 32 66 32 66 22 M14 44 C14 54 66 54 66 44 M14 66 C14 76 66 76 66 66" opacity="0.5" />
</svg>
