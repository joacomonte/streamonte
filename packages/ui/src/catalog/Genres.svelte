<script lang="ts">
	// Fila de géneros del catálogo (2026-11-23; reemplaza la hoja de filtros avanzados): un dibujo por género dentro de un
	// círculo, con nombre abajo, en una fila que se desliza. Elegir uno lo tiñe de su color y el dibujo "actúa" su género
	// (el rayo tiembla, el fantasma flota, el corazón late); con el mouse actúa al pasar. "Todos" saca la selección.
	// Dibujos, colores y movimientos: `genre-art.ts`.
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
		<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">{@html a.svg}</svg>
	</span>
{/snippet}

<div id="genres" class="row" role="group" aria-label={t('Géneros')}>
	<button id="genre-all" type="button" class="tile" class:on={none} aria-pressed={none} style:--h={ALL_ART.hue} onclick={() => !none && onclear()}>
		{@render art(ALL_ART)}<span class="name">{t('Todos')}</span>
	</button>
	{#each genres as g (g.id)}
		{@const on = st.f.genres.includes(g.id)}
		{@const a = genreArt(g.id)}
		<button id="genre-{g.id}" type="button" class="tile" class:on aria-pressed={on} style:--h={a.hue} onclick={() => ontoggle(g.id)}>
			{@render art(a)}<span class="name">{g.name}</span>
		</button>
	{:else}
		{#each Array(7) as _, i (i)}<span class="tile ghost" aria-hidden="true"><span class="art skel"></span><span class="name skel"></span></span>{/each}
	{/each}
</div>

<style>
	/* De borde a borde en celu (la cabecera tiene 16 px a cada lado); los bordes se desvanecen para que se note que sigue. */
	.row {
		display: flex;
		gap: 2px;
		margin: 6px -16px 0;
		padding: 4px 16px 6px;
		overflow-x: auto;
		overscroll-behavior-x: contain;
		scroll-snap-type: x proximity;
		scroll-padding-inline: 16px;
		scrollbar-width: none;
		mask-image: linear-gradient(to right, transparent, #000 14px, #000 calc(100% - 32px), transparent);
	}
	.row::-webkit-scrollbar { display: none; }
	/* Color del género: el mismo tono, más claro en oscuro y más profundo en claro. */
	.tile {
		--g: oklch(0.74 0.14 var(--h));
		flex: none;
		width: 72px;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 6px;
		padding: 2px 0;
		border: 0;
		border-radius: var(--r-md);
		background: none;
		color: var(--muted);
		scroll-snap-align: start;
		-webkit-tap-highlight-color: transparent;
	}
	@media (prefers-color-scheme: light) { .tile { --g: oklch(0.52 0.15 var(--h)); } }
	.tile:focus-visible { outline: 2px solid var(--accent-fg); outline-offset: 1px; }
	.art {
		display: grid;
		place-items: center;
		width: 48px;
		height: 48px;
		border-radius: 50%;
		background: var(--surface-2);
		color: color-mix(in srgb, var(--g) 55%, var(--muted));
		transition: background 0.3s var(--out), color 0.3s var(--out), box-shadow 0.3s var(--out), transform 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);
	}
	.art svg { transform-origin: 50% 55%; }
	.tile:active .art { transform: scale(0.92); }
	.tile.on .art {
		background: color-mix(in srgb, var(--g) 20%, var(--surface-2));
		color: var(--g);
		box-shadow: inset 0 0 0 1.5px var(--g), 0 6px 14px -6px color-mix(in srgb, var(--g) 70%, transparent);
		transform: translateY(-2px);
	}
	/* El momento: al quedar elegido (o al pasar el mouse) el dibujo actúa su género una vez. */
	.tile.on .art svg { animation: var(--act) 0.75s var(--out); }
	@media (hover: hover) {
		.tile:hover .art { color: var(--g); }
		.tile:hover .art svg { animation: var(--act) 0.75s var(--out); }
	}
	.name {
		display: -webkit-box;
		-webkit-box-orient: vertical;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		overflow: hidden;
		max-width: 68px;
		min-height: 2.4em;
		font-size: 11.5px;
		font-weight: 600;
		line-height: 1.2;
		text-align: center;
		text-wrap: balance;
		transition: color 0.25s var(--out);
	}
	.tile.on .name { color: var(--text); }
	.ghost .art, .ghost .name { background: var(--surface-2); }
	.ghost .name { width: 44px; min-height: 0; height: 10px; border-radius: 5px; }

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
