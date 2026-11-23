<script lang="ts">
	// Idiomas en la bienvenida, con dibujo en vez de texto: banderas que ondean (app) y un póster cuyo título se da
	// vuelta al cambiar (títulos). Banderas en SVG: los emoji de bandera no se ven en Windows.
	import { t } from '../i18n/runtime.ts';
	import Icon from './Icon.svelte';
	import type { LangCode, LangOptions } from './tour-state.ts';

	interface Props extends LangOptions {
		id: string;
		only: 'app' | 'titles';
	}
	let { id, only, app, titles, onpick }: Props = $props();
	// Las dos tarjetas arrancan iguales: el idioma actual es solo el de por defecto, se marca recién al tocarlo.
	let picked = $state<LangCode | null>(null);

	const LANGS = [['es', 'Español'], ['en', 'English']] as const;
// Ejemplo real: La Odisea (Nolan, 2026), con el título y el póster de TMDB en cada idioma. Sin red queda el dibujo.
	const POSTER: Record<LangCode, string> = { es: 'La Odisea', en: 'The Odyssey' };
	const POSTER_IMG: Record<LangCode, string> = {
		es: 'https://image.tmdb.org/t/p/w342/sRxbUe5FB25Gde0e2FnwwSckpXb.jpg',
		en: 'https://image.tmdb.org/t/p/w342/5rhTDKUhPYvpdQIijFIs5VoWsON.jpg'
	};
	const hide = (e: Event) => ((e.currentTarget as HTMLImageElement).style.display = 'none');
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
	<svg viewBox="10 0 44 44" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
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
			<button id="{id}-app-{v}" type="button" role="radio" class="card" aria-checked={app === v} class:on={picked === v} onclick={() => ((picked = v), onpick('app', v))}>
				<span class="flag">{@render flag(v)}</span>
				<span class="name">{name}</span>
				<span class="go"><Icon name={picked === v ? 'check' : 'next'} size={24} /></span>
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
		{#each ['es', 'en'] as const as v (v)}<img class="real" class:on={shown === v} class:flipping src={POSTER_IMG[v]} alt="" width="342" height="513" referrerpolicy="no-referrer" onerror={hide} />{/each}
	</div>
	<div class="about" aria-live="polite">
		<span class="ttl" class:flipping>{POSTER[shown]}</span>
		<span class="by">{t('Film de')} <b>Christopher Nolan</b> · 2026</span>
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
	.cards { display: grid; gap: 14px; }
	.card {
		display: flex;
		align-items: center;
		gap: 20px;
		min-height: 112px;
		padding: 20px 26px 20px 22px;
		border: 1px solid color-mix(in srgb, var(--text) 10%, transparent);
		border-radius: 28px;
		background: color-mix(in srgb, var(--surface) 80%, transparent);
		backdrop-filter: blur(12px);
		color: var(--text);
		text-align: left;
		transition: transform 0.45s cubic-bezier(0.34, 1.56, 0.64, 1), border-color 0.25s var(--ease), background 0.25s var(--ease), box-shadow 0.3s var(--ease);
	}
	.flag {
		flex: none;
		display: block;
		width: 64px;
		height: 64px;
		border-radius: 50%;
		overflow: hidden;
		box-shadow: 0 0 0 3px color-mix(in srgb, var(--text) 8%, transparent), 0 10px 24px -10px rgb(0 0 0 / 0.6);
		transition: transform 0.45s cubic-bezier(0.34, 1.56, 0.64, 1), box-shadow 0.25s var(--ease);
	}
	.flag svg { display: block; width: 100%; height: 100%; }
	.name { flex: 1; display: grid; gap: 2px; font-size: 26px; font-weight: 700; letter-spacing: -0.02em; line-height: 1.1; }
	.go { color: var(--muted); opacity: 0.5; transition: opacity 0.25s var(--ease), transform 0.35s var(--out), color 0.2s var(--ease); }
	@media (hover: hover) {
		.card:hover { transform: translateY(-3px); border-color: color-mix(in srgb, var(--accent) 60%, transparent); background: color-mix(in srgb, var(--accent) 8%, var(--surface)); box-shadow: 0 18px 40px -20px color-mix(in srgb, var(--accent) 70%, transparent); }
		.card:hover .flag { transform: scale(1.08) rotate(-6deg); }
		.card:hover .go { opacity: 1; transform: translateX(4px); color: var(--text); }
	}
	.card:focus-visible { outline: none; border-color: var(--accent); }
	.card.on { border-color: var(--accent); background: color-mix(in srgb, var(--accent) 14%, var(--surface)); }
	.card.on .flag { box-shadow: 0 0 0 3px var(--accent), 0 10px 24px -10px rgb(0 0 0 / 0.6); }
	.card.on .go { opacity: 1; color: var(--accent-fg); }
	.card:active { transform: scale(0.98); }

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
	/* Póster real encima del dibujo; los dos idiomas cargados, se muestra el elegido y gira al cambiar. */
	.real { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; opacity: 0; transition: transform 0.4s cubic-bezier(0.34, 1.56, 0.64, 1); }
	.real.on { opacity: 1; }
	.real.on.flipping { transform: rotateY(90deg); transition: transform 0.2s ease-in; }
	.about { display: grid; justify-items: center; gap: 4px; margin-top: 14px; text-align: center; }
	.by { font-size: 14px; color: var(--muted); }
	.by b { color: var(--text); font-weight: 650; }
	.ttl {
		display: inline-block;
		color: var(--text);
		font-size: 26px;
		font-weight: 800;
		letter-spacing: -0.015em;
		line-height: 1.15;
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
		.card, .ttl, .ttl.flipping, .real, .knob, .seg button { transition: none; }
		.sun { animation: none; }
	}
</style>
