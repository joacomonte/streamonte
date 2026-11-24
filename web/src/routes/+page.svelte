<script lang="ts">
	import { goto, invalidateAll } from '$app/navigation';
	import { page } from '$app/state';
	import { onMount, getContext } from 'svelte';
	import logo from '$ui/assets/logo-mark.svg';
	import Catalog from '$ui/catalog/Catalog.svelte';
	import Icon from '$ui/components/Icon.svelte';
	import MissingKeys from '$ui/settings/MissingKeys.svelte';
	import LangToggle from '$ui/components/LangToggle.svelte';
	import type { EpisodeRef, RecentItem } from '$ui/catalog/recent.ts';
	import type { CatalogItem } from '$ui/types.ts';
	import { webCatalog } from '#lib/catalog.svelte.ts';
	import { i18n, setLang, t } from '#lib/i18n.svelte.ts';
	import { track } from '#lib/track.ts';
	import { magnetHash } from '$ui/magnet-hash.ts';

	const store = webCatalog();
	let keys = $state<{ tmdb: boolean; torbox: boolean } | null>(null);
	/** La bienvenida está tapando la portada (la pone el layout). */
	const touring = getContext<() => boolean>('touring');
	$effect(() => void (store.st.covered = touring()));
	onMount(() => void fetch('/api/keys').then((r) => r.json()).then((k) => (keys = k)));

	/** ES / EN de la app (los títulos tienen su propio idioma, en Ajustes): sinopsis y géneros siguen a la app. */
	function switchLang(l: 'es' | 'en') {
		if (l === i18n.lang) return;
		setLang(l);
		store.relang();
		invalidateAll();
	}
	const href = (it: CatalogItem) => `/t/${it.kind}/${it.id}`;
	/** "Vistos recientemente": el capítulo (o la ficha) que eligió. */
	const resume = (it: RecentItem, ep: EpisodeRef | null) => goto(ep ? `/t/tv/${it.id}/${ep.season}/${ep.episode}` : `/t/${it.kind}/${it.id}`);
	/** "Pegar magnet": un magnet pegado en el buscador va a su pantalla en vez de buscarse como texto. */
	function openMagnet(magnet: string) {
		const hash = magnetHash(magnet);
		if (!hash) return;
		const dn = new URLSearchParams(magnet.split('?')[1] ?? '').get('dn') ?? '';
		goto(`/m/${hash}${dn ? `?${new URLSearchParams({ dn })}` : ''}`);
	}
</script>

<Catalog {store} {href} onopen={(it) => goto(href(it))} onmagnet={openMagnet} onlog={track} onsettings={() => goto('/ajustes')} onresume={resume} fade {header} {top} />

{#snippet header()}
	<div class="row">
		<div class="brand-row">
			<h1 class="brand"><img src={logo} alt="Streamonte" width="24" height="27" /></h1>
			{#if page.data.nick}
				<p class="hello"><span class="hi">{t('Hola')}</span><b>{page.data.nick}</b><span>!</span><span class="wave" aria-hidden="true">👋</span></p>
			{/if}
		</div>
		<div class="top-actions">
			<LangToggle id="lang" value={i18n.lang} label={t('Idioma')} onpick={switchLang} touch />
			<a id="go-settings" class="btn-icon" href="/ajustes" aria-label={t('Ajustes')}><Icon name="gear" /></a>
		</div>
	</div>
{/snippet}

{#snippet top()}
	<MissingKeys status={keys} href="/ajustes" />
{/snippet}

<style>
	.row { display: flex; align-items: center; justify-content: space-between; gap: 6px; margin-right: -10px; }
	.top-actions { display: flex; align-items: center; gap: 4px; }
	.brand { margin: 0; flex: none; line-height: 0; align-self: center; }
	.brand img { display: block; width: 24px; height: 27px; }
	/* En el celu más chica: entra "Streamonte  Hola Joaco! 👋" junto a los botones. */
	@media (max-width: 480px) { .brand img { width: 22px; height: 25px; } }
	/* Marca y saludo en la misma línea; el saludo se recorta con … si el apodo no entra (375 px). */
	.brand-row { display: flex; align-items: center; gap: 8px; min-width: 0; flex: 1; }
	/* Solo el apodo se recorta (con …): "Hola", el signo y la mano quedan siempre. */
	.hello { display: flex; align-items: baseline; min-width: 0; margin: 0; font-size: 14.5px; color: var(--muted); white-space: nowrap; animation: hello-in 0.6s var(--out) 0.25s both; }
	.hello > * { flex: none; }
	.hi { margin-right: 0.3em; }
	.hello b { flex: 0 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; color: var(--text); font-weight: 650; }
	/* La mano saluda una vez, desde la muñeca. */
	.wave { display: inline-block; margin-left: 0.3em; transform-origin: 70% 80%; animation: wave 1.4s ease-in-out 0.8s both; }
	@keyframes hello-in { from { opacity: 0; transform: translateX(-8px); } }
	@keyframes wave { 15% { transform: rotate(14deg); } 30% { transform: rotate(-8deg); } 45% { transform: rotate(12deg); } 60% { transform: rotate(-4deg); } 75% { transform: rotate(8deg); } 100% { transform: rotate(0); } }
	@media (prefers-reduced-motion: reduce) { .hello, .wave { animation: none; } }
</style>
