<script lang="ts">
	// Fila de géneros del catálogo (2026-11-23; reemplaza la hoja de filtros avanzados): chips de texto bajos con el dibujo
	// chiquito del género adentro (variante A, minimal), en una fila que se desliza. Elegir uno tiñe apenas su fondo de su
	// color y el dibujo "actúa" su género (el rayo tiembla, el fantasma flota, el corazón late); con el mouse actúa al pasar.
	// "Todos" saca la selección. Dibujos, colores y movimientos: `genre-art.ts`.
	import { t } from '../i18n/runtime.ts';
	import { ALL_ART, genreArt, type GenreArt } from './genre-art.ts';
	import type { CatalogStore } from './store.ts';

	interface Props {
		store: CatalogStore;
		ontoggle: (id: string) => void;
		onclear: () => void;
	}
	let { store, ontoggle, onclear }: Props = $props();
	const st = $derived(store.st);
	const genres = $derived(st.genreList[st.f.kind] ?? []);
	const none = $derived(st.f.genres.length === 0);
</script>

{#snippet art(a: GenreArt)}
	<span class="art" style:--act="act-{a.motion}" aria-hidden="true">
		<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">{@html a.svg}</svg>
	</span>
{/snippet}

<div id="genres" class="row" role="group" aria-label={t('Géneros')}>
	<button id="genre-all" type="button" class="tile" class:on={none} aria-pressed={none} style:--h={ALL_ART.hue} onclick={() => !none && onclear()}>
		{@render art(ALL_ART)}{t('Todos')}
	</button>
	{#each genres as g (g.id)}
		{@const on = st.f.genres.includes(g.id)}
		{@const a = genreArt(g.id)}
		<button id="genre-{g.id}" type="button" class="tile" class:on aria-pressed={on} style:--h={a.hue} onclick={() => ontoggle(g.id)}>
			{@render art(a)}{g.name}
		</button>
	{:else}
		{#each [62, 74, 88, 80, 70] as w, i (i)}<span class="tile ghost" style:width="{w}px" aria-hidden="true"></span>{/each}
	{/each}
</div>

<style>
	/* De borde a borde en celu (la cabecera tiene 16 px a cada lado); los bordes se desvanecen para que se note que sigue. */
	.row {
		display: flex;
		gap: 6px;
		margin: 6px -16px 0;
		padding: 2px 16px 4px;
		overflow-x: auto;
		overscroll-behavior-x: contain;
		scroll-snap-type: x proximity;
		scroll-padding-inline: 16px;
		scrollbar-width: none;
		mask-image: linear-gradient(to right, transparent, #000 12px, #000 calc(100% - 28px), transparent);
	}
	.row::-webkit-scrollbar { display: none; }
	/* Color del género: el mismo tono, más claro en oscuro y más profundo en claro. */
	.tile {
		--g: oklch(0.74 0.14 var(--h));
		flex: none;
		display: inline-flex;
		align-items: center;
		gap: 6px;
		height: 34px;
		padding: 0 12px;
		border: 0;
		border-radius: var(--r-pill);
		background: var(--surface-2);
		color: var(--muted);
		font-size: 13.5px;
		font-weight: 600;
		white-space: nowrap;
		scroll-snap-align: start;
		-webkit-tap-highlight-color: transparent;
		transition: background 0.25s var(--out), color 0.25s var(--out), scale 0.2s var(--out);
	}
	@media (prefers-color-scheme: light) { .tile { --g: oklch(0.52 0.15 var(--h)); } }
	.tile:focus-visible { outline: 2px solid var(--accent-fg); outline-offset: 1px; }
	.tile:active { scale: 0.95; }
	.art { display: inline-flex; color: color-mix(in srgb, var(--g) 70%, var(--muted)); transition: color 0.25s var(--out); }
	.art svg { transform-origin: 50% 55%; }
	.tile.on { background: color-mix(in srgb, var(--g) 18%, var(--surface-2)); color: var(--text); }
	.tile.on .art { color: var(--g); }
	/* El momento: al quedar elegido (o al pasar el mouse) el dibujo actúa su género una vez. */
	.tile.on .art svg { animation: var(--act) 0.75s var(--out); }
	@media (hover: hover) {
		.tile:hover { color: var(--text); }
		.tile:hover .art { color: var(--g); }
		.tile:hover .art svg { animation: var(--act) 0.75s var(--out); }
	}
	.ghost { padding: 0; }

	@keyframes act-shake { 15% { transform: translateX(-2px) rotate(-8deg); } 30% { transform: translateX(2px) rotate(7deg); } 45% { transform: translateX(-1.5px) rotate(-5deg); } 60% { transform: translateX(1px) rotate(3deg); } }
	@keyframes act-spin { from { transform: rotate(-200deg) scale(0.7); } }
	@keyframes act-bounce { 30% { transform: translateY(-6px) scale(0.94, 1.08); } 55% { transform: translateY(0) scale(1.1, 0.9); } 75% { transform: translateY(-2px); } }
	@keyframes act-wobble { 25% { transform: rotate(-14deg); } 50% { transform: rotate(10deg); } 75% { transform: rotate(-5deg); } }
	@keyframes act-sweep { 30% { transform: translate(-3px, -2px) rotate(-8deg); } 65% { transform: translate(3px, 1px) rotate(6deg); } }
	@keyframes act-beat { 18% { transform: scale(1.25); } 36% { transform: scale(0.94); } 54% { transform: scale(1.14); } 72% { transform: scale(1); } }
	@keyframes act-float { 40% { transform: translateY(-6px) rotate(-6deg); opacity: 0.55; } 70% { transform: translateY(-2px) rotate(3deg); } }
	@keyframes act-lift { 40% { transform: translateY(-16px); opacity: 0; } 41% { transform: translateY(14px); opacity: 0; } }
	@keyframes act-flicker { 15% { opacity: 0.25; } 25% { opacity: 1; } 40% { opacity: 0.4; } 55% { opacity: 1; } }
	@keyframes act-blink { 35% { transform: scaleY(0.08); } 55% { transform: scaleY(1); } }
	@keyframes act-wave { 30% { transform: skewY(-10deg) translateX(1px); } 60% { transform: skewY(7deg); } }
	@keyframes act-flip { from { transform: rotate(-180deg); } }
	@keyframes act-twinkle { 35% { transform: rotate(28deg) scale(1.25); } 65% { transform: rotate(-8deg) scale(0.95); } }
</style>
