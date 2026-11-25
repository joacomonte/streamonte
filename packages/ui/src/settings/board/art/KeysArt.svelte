<script lang="ts">
	// Llavero: una llave por servicio; las guardadas brillan en verde.
	let { on }: { on: boolean[] } = $props();
</script>

<svg class="art art-keys" viewBox="0 0 170 150" aria-hidden="true">
	<g class="ring-g">
		<path class="st" d="M85 0 V8" />
		{#each on as lit, i (i)}
			<g class:on={lit} transform="rotate({-55 + i * (110 / Math.max(1, on.length - 1))} 85 26)">
				<path class="st" d="M85 44 V50" />
				<circle class="k-fill" cx="85" cy="60" r="10" />
				<path class="k-fill" d="M82.5 69.5 h5 v40 l-2.5 3.5 l-2.5 -3.5 Z M87.5 94 h5 v4 h-5 Z M87.5 102 h3.5 v4 h-3.5 Z" />
				<circle class="k-hole" cx="85" cy="60" r="3.3" />
			</g>
		{/each}
		<circle class="ring" cx="85" cy="26" r="18" />
	</g>
</svg>
