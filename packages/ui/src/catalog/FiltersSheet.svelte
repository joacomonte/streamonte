<script lang="ts">
	// Hoja de filtros avanzados: géneros, votos mínimos e idioma original.
	import Sheet from '../components/Sheet.svelte';
	import { t } from '../i18n/runtime.ts';
	import { changedCount, LANGS, VOTES } from './filters.ts';
	import Segmented from './Segmented.svelte';
	import type { CatalogStore } from './store.ts';

	interface Props {
		store: CatalogStore;
		open: boolean;
		onclose: () => void;
		/** Un filtro cambió: la pantalla vuelve arriba y registra el cambio. */
		onchange: () => void;
	}
	let { store, open, onclose, onchange }: Props = $props();
	const st = $derived(store.st);
	const genres = $derived(st.genreList[st.f.kind]);
	const changed = $derived(changedCount(st.f));
	const set = (c: Parameters<typeof store.setFilters>[0]) => (store.setFilters(c), onchange());
</script>

<Sheet id="filters-sheet" title={t('Filtros avanzados')} {open} {onclose}>
	<h3 class="gh first">{t('Géneros')}</h3>
	<div class="genre-chips" aria-busy={!genres}>
		{#if genres}
			{#each genres as g (g.id)}
				<button id="genre-{g.id}" type="button" class="chip" class:on={st.f.genres.includes(g.id)} aria-pressed={st.f.genres.includes(g.id)} onclick={() => (store.toggleGenre(g.id), onchange())}>{g.name}</button>
			{/each}
		{:else}
			{#each Array(8) as _, i (i)}<span class="skel chip-skel"></span>{/each}
		{/if}
	</div>

	<h3 class="gh" id="votes-h">{t('Votos mínimos')}</h3>
	<div class="vote-chips" role="radiogroup" aria-labelledby="votes-h">
		{#each VOTES as v (v)}
			<button id="votes-{v}" type="button" role="radio" class="chip" class:on={st.f.votes === v} aria-checked={st.f.votes === v} onclick={() => st.f.votes !== v && set({ votes: v })}>{v ? `${(v / 1000).toLocaleString('es-AR')}k+` : t('Cualquiera')}</button>
		{/each}
	</div>

	<h3 class="gh" id="lang-h">{t('Idioma original')}</h3>
	<Segmented id="lang" labelledby="lang-h" flush items={LANGS} value={st.f.lang} onpick={(v) => set({ lang: v })} />

	<div class="sheet-actions">
		<button id="filters-reset" type="button" class="btn" disabled={!changed} onclick={() => (store.resetFilters(), onchange())}>{t('Restablecer')}</button>
		<button id="filters-done" type="button" class="btn btn-primary" onclick={onclose}>{t('Ver resultados')}</button>
	</div>
</Sheet>

<style>
	.gh { margin: 20px 0 10px; font-size: 13px; font-weight: 650; color: var(--muted); }
	.gh.first { margin-top: 4px; }
	.genre-chips { display: flex; flex-wrap: wrap; gap: 10px 8px; }
	.chip-skel { width: 74px; height: 34px; border-radius: var(--r-pill); }
	/* Votos: una sola fila que se desliza de costado. */
	.vote-chips { display: flex; gap: 8px; margin: 0 -16px; padding: 2px 16px 4px; overflow-x: auto; scrollbar-width: none; }
	.vote-chips::-webkit-scrollbar { display: none; }
	.vote-chips .chip { font-variant-numeric: tabular-nums; }
	.sheet-actions { position: sticky; bottom: -16px; display: grid; grid-template-columns: 1fr 1.6fr; gap: 8px; margin: 20px -16px -16px; padding: 12px 16px 16px; background: var(--surface); border-top: 1px solid var(--border); }
</style>
