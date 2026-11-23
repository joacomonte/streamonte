<script lang="ts">
	// Bandera circular en SVG (los emoji de bandera no se ven en Windows). El tamaño lo pone el contenedor.
	import type { LangCode } from './tour-state.ts';

	let { lang }: { lang: LangCode } = $props();
</script>

<svg viewBox="10 0 44 44" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
	{#if lang === 'es'}
		<rect width="64" height="44" fill="#74acdf" />
		<rect y="14.67" width="64" height="14.67" fill="#fff" />
		<g fill="#f6b40e" stroke="#85340a" stroke-width="0.4">
			{#each [0, 45, 90, 135, 180, 225, 270, 315] as a (a)}
				<path d="M32 15.6 L33 19.4 L31 19.4 Z" transform="rotate({a} 32 22)" />
			{/each}
			<circle cx="32" cy="22" r="3.2" />
		</g>
	{:else}
		<rect width="64" height="44" fill="#fff" />
		{#each [0, 2, 4, 6, 8, 10, 12] as s (s)}
			<rect y={s * (44 / 13)} width="64" height={44 / 13} fill="#b22234" />
		{/each}
		<rect width="27" height={(44 / 13) * 7} fill="#3c3b6e" />
		<g fill="#fff">
			{#each [0, 1, 2, 3, 4] as r (r)}
				{#each [0, 1, 2, 3, 4, 5] as c (c)}
					<circle cx={3 + c * 4.2 + (r % 2) * 2.1} cy={3 + r * 4.4} r="0.85" />
				{/each}
			{/each}
		</g>
	{/if}
</svg>

<style>
	svg { display: block; width: 100%; height: 100%; }
</style>
