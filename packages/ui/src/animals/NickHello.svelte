<script lang="ts">
	// Saludo de la portada ("Hola Joaco! 👋") con las miniaturas de los 2 animales del apodo (web y desktop). `href`: a dónde
	// lleva tocar las miniaturas (Ajustes) o `onpick` en el desktop, que abre Ajustes por callback.
	import { t } from '../i18n/runtime.ts';
	import type { Animal } from './animals.ts';

	interface Props {
		nick: string;
		/** Los 2 animales; vacío mientras no se saben. */
		animals: Animal[];
		href?: string;
		onpick?: () => void;
	}
	let { nick, animals, href, onpick }: Props = $props();
</script>

<p class="hello"><span class="hi">{t('Hola')}</span><b>{nick}</b><span>!</span><span class="wave" aria-hidden="true">👋</span>{#if animals.length === 2}<a id="nick-animals" class="pair" {href} role={href ? undefined : 'button'} tabindex={href ? undefined : 0} aria-label={t('Tu clave: estos 2')} onclick={onpick ? (e) => { e.preventDefault(); onpick(); } : undefined} onkeydown={onpick ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onpick(); } } : undefined}>{#each animals as a, i (a.id)}<img id="nick-animal-{i + 1}" src={a.img} alt="" style:object-position={a.pos} />{/each}</a>{/if}</p>

<style>
	/* Solo el apodo se recorta (con …): "Hola", el signo y la mano quedan siempre. */
	.hello { display: flex; align-items: baseline; min-width: 0; margin: 0; font-size: 14.5px; color: var(--muted); white-space: nowrap; animation: hello-in 0.6s var(--out) 0.25s both; }
	.hello > * { flex: none; }
	/* Las 2 miniaturas del apodo: redondas, chicas y superpuestas; no empujan nada (flex: none, 38 px). */
	.pair { display: flex; align-self: center; margin-left: 0.55em; cursor: pointer; }
	.pair img { width: 22px; height: 22px; border-radius: 50%; object-fit: cover; border: 2px solid var(--surface); background: var(--surface); box-sizing: content-box; }
	.pair img + img { margin-left: -8px; }
	.hi { margin-right: 0.3em; }
	.hello b { flex: 0 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; color: var(--text); font-weight: 650; }
	/* La mano saluda una vez, desde la muñeca. */
	.wave { display: inline-block; margin-left: 0.3em; transform-origin: 70% 80%; animation: wave 1.4s ease-in-out 0.8s both; }
	@keyframes hello-in { from { opacity: 0; transform: translateX(-8px); } }
	@keyframes wave { 15% { transform: rotate(14deg); } 30% { transform: rotate(-8deg); } 45% { transform: rotate(12deg); } 60% { transform: rotate(-4deg); } 75% { transform: rotate(8deg); } 100% { transform: rotate(0); } }
	@media (prefers-reduced-motion: reduce) { .hello, .wave { animation: none; } }
</style>
