<script lang="ts">
	// Pantalla completa "Actualizando" (web y desktop): aparece al tocar Actualizar, así hay respuesta inmediata mientras
	// la web recarga o el desktop baja, instala y reinicia. `progress` (0–1) llena la barra; sin él, la barra recorre sola.
	import { t } from '../i18n/runtime.ts';
	import logo from '../assets/logo-mark.svg';

	interface Props {
		detail: string;
		progress?: number | null;
	}
	let { detail, progress = null }: Props = $props();
	const pct = $derived(progress === null ? null : Math.round(Math.min(1, Math.max(0, progress)) * 100));
</script>

<div id="updating" class="wrap" role="alertdialog" aria-modal="true" aria-labelledby="updating-title" aria-describedby="updating-detail" aria-busy="true">
	<div class="mark" aria-hidden="true">
		<span class="ring"></span>
		<img src={logo} alt="" width="64" height="72" />
	</div>
	<h2 id="updating-title">{t('Actualizando Streamonte')}</h2>
	<p id="updating-detail">{detail}</p>
	<div id="updating-bar" class="bar" class:run={pct === null} role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow={pct ?? undefined}>
		<i style:width={pct === null ? null : `${pct}%`}></i>
	</div>
</div>

<style>
	.wrap {
		position: fixed;
		inset: 0;
		z-index: 1000;
		display: grid;
		place-content: center;
		justify-items: center;
		gap: 10px;
		padding: 24px;
		background: color-mix(in srgb, var(--bg) 86%, transparent);
		backdrop-filter: blur(18px) saturate(1.2);
		-webkit-backdrop-filter: blur(18px) saturate(1.2);
		color: var(--text);
		text-align: center;
		animation: in 0.2s var(--out);
	}
	.mark { position: relative; display: grid; place-items: center; width: 120px; height: 120px; margin-bottom: 8px; }
	.mark img { position: relative; width: 64px; height: auto; filter: drop-shadow(0 10px 24px rgb(194 87 122 / 0.35)); animation: float 2.4s ease-in-out infinite; }
	/* Aro de luz que gira detrás del logo con los colores del atardecer. */
	.ring {
		position: absolute;
		inset: 0;
		border-radius: 50%;
		background: conic-gradient(from 0deg, transparent 0deg, #c2577a 90deg, #f59a62 160deg, #ffd59a 200deg, transparent 260deg);
		mask: radial-gradient(closest-side, transparent calc(100% - 3px), #000 calc(100% - 2px));
		-webkit-mask: radial-gradient(closest-side, transparent calc(100% - 3px), #000 calc(100% - 2px));
		animation: spin 1.4s linear infinite;
	}
	.ring::after { content: ''; position: absolute; inset: 18px; border-radius: 50%; background: radial-gradient(closest-side, rgb(245 154 98 / 0.22), transparent); animation: glow 2.4s ease-in-out infinite; }
	h2 { margin: 0; font-size: 19px; font-weight: 750; letter-spacing: -0.01em; animation: rise 0.45s 0.05s var(--out) both; }
	p { margin: 0; min-height: 1.4em; font-size: 14px; color: var(--muted); animation: rise 0.45s 0.1s var(--out) both; }
	.bar { position: relative; width: min(220px, 60vw); height: 4px; margin-top: 10px; overflow: hidden; border-radius: 4px; background: color-mix(in srgb, var(--muted) 22%, transparent); }
	.bar i { position: absolute; inset: 0 auto 0 0; border-radius: inherit; background: linear-gradient(90deg, #c2577a, #f59a62); transition: width 0.3s var(--out); }
	.bar.run i { width: 40%; animation: run 1.2s ease-in-out infinite; }

	@keyframes in { from { opacity: 0; } }
	@keyframes rise { from { opacity: 0; transform: translateY(6px); } }
	@keyframes spin { to { rotate: 360deg; } }
	@keyframes float { 50% { transform: translateY(-5px); } }
	@keyframes glow { 50% { opacity: 0.4; scale: 0.9; } }
	@keyframes run { from { translate: -100%; } to { translate: 250%; } }
	@media (prefers-reduced-motion: reduce) {
		.ring, .ring::after, .mark img, h2, p { animation: none; }
		.bar.run i { animation-duration: 2.4s; }
	}
</style>
