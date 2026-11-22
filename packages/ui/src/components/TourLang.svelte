<script lang="ts">
	// Idiomas en la bienvenida, con dibujo en vez de texto: banderas que ondean (app) y un póster cuyo título se da
	// vuelta al cambiar (títulos). Banderas en SVG: los emoji de bandera no se ven en Windows.
	import { t } from '../i18n/runtime.ts';
	import type { LangCode, LangOptions } from './tour-state.ts';

	interface Props extends LangOptions {
		id: string;
		only: 'app' | 'titles';
	}
	let { id, only, app, titles, onpick }: Props = $props();

	const LANGS = [['es', 'Español'], ['en', 'English']] as const;
	const POSTER: Record<LangCode, string> = { es: 'LA ODISEA', en: 'THE ODYSSEY' };
	const still = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

	// El título del póster va a 90° con el texto viejo y vuelve con el nuevo.
	let shown = $state((() => titles)());
	let flipping = $state(false);
	$effect(() => {
		const next = titles;
		if (next === shown || flipping) return;
		if (still()) shown = next;
		else {
			flipping = true;
			setTimeout(() => {
				shown = next;
				flipping = false;
			}, 200);
		}
	});
</script>

{#snippet flag(v: LangCode)}
	<svg viewBox="0 0 64 44" width="64" height="44" aria-hidden="true">
		{#if v === 'es'}
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
{/snippet}

{#if only === 'app'}
	<div class="cards" role="radiogroup" aria-label={t('Idioma de la app')}>
		{#each LANGS as [v, name] (v)}
			<button id="{id}-app-{v}" type="button" role="radio" class="card" aria-checked={app === v} onclick={() => onpick('app', v)}>
				<span class="flag">{@render flag(v)}</span>
				<span class="name">{name}</span>
			</button>
		{/each}
	</div>
{:else}
	<div class="poster" aria-hidden="true">
		<svg class="scene" viewBox="0 0 200 300" preserveAspectRatio="xMidYMid slice">
			<defs>
				<linearGradient id="{id}-sky" x1="0" y1="0" x2="0" y2="1">
					<stop offset="0" stop-color="#1e2a5a" />
					<stop offset="0.55" stop-color="#d9607a" />
					<stop offset="1" stop-color="#f7b267" />
				</linearGradient>
			</defs>
			<rect width="200" height="300" fill="url(#{id}-sky)" />
			<circle class="sun" cx="100" cy="196" r="40" fill="#ffd36e" />
			<path d="M0 220 Q50 180 100 214 T200 204 V300 H0 Z" fill="#7b3f6e" />
			<path d="M0 248 Q60 214 120 244 T200 236 V300 H0 Z" fill="#4a2752" />
			<path d="M0 272 Q70 252 140 270 T200 266 V300 H0 Z" fill="#2a1736" />
		</svg>
		<span class="ttl" class:flipping>{POSTER[shown]}</span>
	</div>
	<div class="seg" role="radiogroup" aria-label={t('Títulos')} class:en={titles === 'en'}>
		<span class="knob"></span>
		{#each LANGS as [v, name] (v)}
			<button id="{id}-titles-{v}" type="button" role="radio" aria-checked={titles === v} onclick={() => onpick('titles', v)}>{name}</button>
		{/each}
	</div>
{/if}

<style>
	/* Idioma de la app: dos tarjetas; la elegida sube con resorte y su bandera ondea más rápido. */
	.cards { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
	.card {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 14px;
		padding: 26px 8px 20px;
		border: 2px solid var(--border-strong);
		border-radius: 22px;
		background: var(--surface);
		color: var(--text);
		font-size: 17px;
		font-weight: 700;
		transition: transform 0.45s cubic-bezier(0.34, 1.56, 0.64, 1), border-color 0.25s var(--ease), background 0.25s var(--ease), box-shadow 0.25s var(--ease);
	}
	.card[aria-checked='true'] {
		transform: translateY(-6px);
		border-color: var(--accent);
		background: color-mix(in srgb, var(--accent) 12%, var(--surface));
		box-shadow: 0 14px 30px -14px color-mix(in srgb, var(--accent) var(--tint-4), transparent);
	}
	.card:active { transform: scale(0.97); }
	.flag {
		display: block;
		width: 64px;
		height: 44px;
		border-radius: 5px;
		overflow: hidden;
		box-shadow: 0 0 0 1px rgb(0 0 0 / 0.08), 0 6px 14px -6px rgb(0 0 0 / 0.35);
		transform-origin: left center;
		animation: wave 3.2s ease-in-out infinite;
	}
	.flag svg { display: block; }
	.card[aria-checked='true'] .flag { animation-duration: 1.3s; }
	@keyframes wave {
		25% { transform: skewY(2deg) scaleX(0.97); }
		75% { transform: skewY(-1.5deg) scaleX(1.01); }
	}

	/* Idioma de los títulos: un póster dibujado y su título. */
	.poster {
		position: relative;
		width: min(200px, 52vw);
		aspect-ratio: 2 / 3;
		margin: 0 auto;
		border-radius: 14px;
		overflow: hidden;
		perspective: 500px;
		box-shadow: 0 22px 44px -18px rgb(0 0 0 / 0.55), 0 0 0 1px rgb(255 255 255 / 0.06);
	}
	.scene { display: block; width: 100%; height: 100%; }
	.sun { animation: rise 6s ease-in-out infinite; }
	@keyframes rise { 50% { transform: translateY(-6px); } }
	.ttl {
		position: absolute;
		left: 8px;
		right: 8px;
		top: 18%;
		color: #fff;
		font-family: var(--display);
		font-size: 25px;
		font-weight: 800;
		letter-spacing: 0.14em;
		line-height: 1.1;
		text-align: center;
		text-shadow: 0 2px 12px rgb(0 0 0 / 0.45);
		/* Vuelve con resorte; se va rápido (la transición la manda el estado de destino). */
		transition: transform 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);
	}
	.ttl.flipping { transform: rotateX(90deg); transition: transform 0.2s ease-in; }

	.seg {
		position: relative;
		display: grid;
		grid-template-columns: 1fr 1fr;
		width: min(320px, 100%);
		margin: 24px auto 0;
		padding: 4px;
		border-radius: var(--r-pill);
		background: var(--surface-3);
	}
	.knob {
		position: absolute;
		top: 4px;
		bottom: 4px;
		left: 4px;
		width: calc(50% - 4px);
		border-radius: var(--r-pill);
		background: var(--accent);
		box-shadow: 0 4px 12px -4px color-mix(in srgb, var(--accent) var(--tint-4), transparent);
		transition: transform 0.45s cubic-bezier(0.34, 1.56, 0.64, 1);
	}
	.seg.en .knob { transform: translateX(100%); }
	.seg button {
		position: relative;
		height: 48px;
		border: 0;
		border-radius: var(--r-pill);
		background: none;
		color: var(--muted);
		font-size: 16px;
		font-weight: 700;
		transition: color 0.25s var(--ease);
	}
	.seg button[aria-checked='true'] { color: var(--accent-text); }

	@media (prefers-reduced-motion: reduce) {
		.card, .ttl, .ttl.flipping, .knob, .seg button { transition: none; }
		.flag, .sun { animation: none; }
	}
</style>
