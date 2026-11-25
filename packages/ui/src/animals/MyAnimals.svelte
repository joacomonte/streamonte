<script lang="ts">
	// "Tu clave: estos 2": las cartas de los 2 animales del apodo en Ajustes (web y desktop).
	import { t } from '../i18n/runtime.ts';
	import type { Animal } from './animals.ts';

	let { animals }: { animals: Animal[] } = $props();
</script>

<section id="my-animals" class="mine" aria-label={t('Tu clave: estos 2')}>
	<p class="mine-lead">🔑 {t('Tu clave: estos 2')}</p>
	<div class="mine-cards">
		{#each animals as a, i (a.id)}
			<div id="my-animal-{i + 1}" class="mine-card" style="--i:{i}">
				<img src={a.img} alt="" style:object-position={a.pos} />
				<span class="mine-n">{i + 1}</span>
				<b>{t(a.name)}</b>
			</div>
		{/each}
	</div>
</section>

<style>
	.mine { margin: 4px 14px 16px; }
	.mine-lead { margin: 0 0 10px; font-size: 13px; color: var(--muted); text-align: center; }
	.mine-cards { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; max-width: 320px; margin: 0 auto; perspective: 700px; }
	.mine-card { position: relative; aspect-ratio: 4 / 5; border-radius: 18px; overflow: hidden; background: var(--surface-2); box-shadow: 0 10px 22px -10px rgb(0 0 0 / 0.8); animation: deal 0.7s var(--out) both; animation-delay: calc(var(--i) * 160ms + 150ms); }
	.mine-card:nth-child(1) { --tilt: -3deg; }
	.mine-card:nth-child(2) { --tilt: 3deg; }
	.mine-card img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
	.mine-card::after { content: ''; position: absolute; inset: 0; background: linear-gradient(to top, rgb(0 0 0 / 0.85), transparent 55%); }
	.mine-card b { position: absolute; left: 10px; right: 8px; bottom: 9px; z-index: 1; font-size: 15px; line-height: 1.15; color: #fff; }
	.mine-n { position: absolute; top: 8px; left: 8px; z-index: 1; width: 24px; height: 24px; border-radius: 50%; display: grid; place-items: center; font-size: 13px; font-weight: 800; background: var(--accent); color: var(--accent-text); }
	@keyframes deal { from { opacity: 0; transform: translateY(26px) rotateY(80deg) rotate(var(--tilt, 0deg)) scale(0.8); } 70% { transform: translateY(-4px) rotateY(0) scale(1.02); } }
	@media (prefers-reduced-motion: reduce) { .mine-card { animation: none; } }
</style>
