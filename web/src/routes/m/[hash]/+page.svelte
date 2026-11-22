<script lang="ts">
	// "Pegar magnet": envoltorio web de `MagnetView`; cuando TorBox lo tiene, sus videos van a <Torrents>.
	import Icon from '$ui/components/Icon.svelte';
	import Torrents from '#lib/Torrents.svelte';
	import { t as tr } from '#lib/i18n.svelte.ts';
	import { torrentOf } from '#lib/web-adapt.ts';
	import { page } from '$app/state';
	import MagnetView from '$ui/magnet/MagnetView.svelte';

	const hash = $derived(page.params.hash?.toLowerCase() ?? '');
	const dn = $derived(page.url.searchParams.get('dn') ?? '');
	let title = $state('');
	// La raíz de la web todavía no fija el Api.
</script>

<svelte:head><title>{title || tr('Torrent pegado')} · Streamonte</title></svelte:head>

<main class="mag">
	<a class="back" href="/" aria-label={tr('Volver')}><Icon name="back" size={20} /></a>
	{#key hash}
		<MagnetView {hash} name={dn} bind:title titleHref={(i) => `/t/${i.kind}/${i.id}`}>
			{#snippet ready(st, ident, shown)}
				<Torrents imdb={ident?.imdb ?? ''} s={ident?.season ?? null} e={ident?.episode ?? null} name={shown} orig={ident?.origLang ?? null} runtime={ident?.runtime ?? null} given={st.options.map(torrentOf)} />
			{/snippet}
		</MagnetView>
	{/key}
</main>

<style>
	.mag { max-width: 720px; margin: 0 auto; padding: 12px 16px 48px; }
	.back { display: inline-grid; place-items: center; width: 44px; height: 44px; margin-left: -8px; color: var(--text); }
</style>
