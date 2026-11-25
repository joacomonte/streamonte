<script lang="ts">
	// Los 2 animales del apodo como cartas en abanico, con las fotos reales (animals.ts). Ficha de Perfil del tablero.
	import { t } from '../../../i18n/runtime.ts';
	import type { Animal } from '../../../animals/animals.ts';
	let { animals }: { animals: Animal[] } = $props();
</script>

<span class="fan" aria-hidden="true">
	{#each animals.slice(0, 2) as a, i (a.id)}
		<span class="fan-card c{i + 1}">
			<img src={a.img} alt="" style:object-position={a.pos} />
			<span class="fan-n">{i + 1}</span>
			<b>{t(a.name)}</b>
		</span>
	{/each}
</span>

<style>
	.fan { flex: 1; min-height: 150px; display: flex; justify-content: center; align-items: center; padding-bottom: 6px; }
	.fan-card { position: relative; flex: none; width: 53%; max-width: 180px; aspect-ratio: 3 / 4.3; border-radius: 20px; overflow: hidden; background: var(--surface-2); box-shadow: 8px 12px 24px -8px rgb(0 0 0 / 0.75), inset 0 1px 0 rgb(255 255 255 / 0.2); transition: transform 0.4s var(--out); }
	.fan-card.c1 { rotate: -6deg; translate: 0 4%; z-index: 1; }
	.fan-card.c2 { rotate: 5deg; margin-left: -11%; translate: 0 -3%; z-index: 2; }
	:global(.board-tile:hover) .c1 { transform: translate(-6%, -2%) rotate(-3deg); }
	:global(.board-tile:hover) .c2 { transform: translate(6%, -3%) rotate(3deg); }
	img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
	.fan-card::after { content: ''; position: absolute; inset: 0; background: linear-gradient(to top, rgb(0 0 0 / 0.85), transparent 55%); }
	.fan-n { position: absolute; top: 9px; left: 9px; z-index: 1; display: grid; place-items: center; width: 22px; height: 22px; border-radius: 50%; background: var(--accent); color: #fff; font-size: 12px; font-weight: 800; box-shadow: 0 2px 6px rgb(0 0 0 / 0.5); }
	/* Nombres largos ("Dragón de Komodo"): más chico y sin cortar palabras, para no pasar de 2 líneas. */
	b { position: absolute; left: 10px; right: 8px; bottom: 9px; z-index: 1; font-size: clamp(11px, 3.4cqi, 13.5px); line-height: 1.15; color: #fff; text-wrap: balance; text-shadow: 0 1px 6px rgb(0 0 0 / 0.8); }
	@container board (max-width: 560px) { .fan-card { width: 40%; } }
	/* En el encabezado del panel (caja de 118 px): cartas chicas que entren enteras. */
	:global(.board-hero-art) .fan { min-height: 0; height: 100%; padding: 0; }
	:global(.board-hero-art) .fan-card { width: auto; height: 92%; border-radius: 12px; }
	:global(.board-hero-art) b, :global(.board-hero-art) .fan-n { display: none; }
</style>
