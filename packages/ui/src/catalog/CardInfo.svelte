<script lang="ts" module>
	import type { Api } from '../api.ts';
	import type { SeasonRatings, TitleDetails } from '../types.ts';

	// Las fichas ya pedidas se reusan: volver a pasar el mouse no pide nada.
	const details = new Map<string, Promise<TitleDetails | null>>();
	const ratings = new Map<string, Promise<SeasonRatings | null>>();
	const load = <T,>(cache: Map<string, Promise<T | null>>, key: string, get: () => Promise<T>) => {
		let hit = cache.get(key);
		if (!hit) cache.set(key, (hit = get().catch(() => null)));
		return hit;
	};
	export const loadDetails = (api: Api, kind: TitleDetails['kind'], id: string) => load(details, `${kind}${id}`, () => api.title.details(kind, id));
	export const loadRatings = (api: Api, imdb: string) => load(ratings, imdb, () => api.title.seasonRatings(imdb, true));
</script>

<script lang="ts">
	// Detalles sobre el póster al pasar el mouse: géneros, duración, categoría por puntaje, premios y, en series, barras por temporada.
	// Se monta recién cuando el mouse se detiene un momento encima (Grid.svelte); la ficha queda en caché.
	import { onMount } from 'svelte';
	import Icon from '../components/Icon.svelte';
	import { getApi } from '../context.ts';
	import { t } from '../i18n/runtime.ts';
	import type { Outlook } from '../season.ts';
	import type { Chart } from '../title/title-state.ts';
	import type { CatalogItem } from '../types.ts';
	import { cardMeta, cardSeasons, ratingTier } from './card-info.ts';

	let { item }: { item: CatalogItem } = $props();
	const api = getApi();
	/** undefined = cargando, null = no hay ficha. */
	let d = $state<TitleDetails | null | undefined>(undefined);
	let seasons = $state<{ chart: Chart | null; outlook: Outlook | null } | null | undefined>(undefined);
	const tier = $derived(d ? ratingTier(d.kind, d.rating) : null);
	const day = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }).replace('.', '');

	onMount(async () => {
		d = await loadDetails(api, item.kind, item.id);
		if (!d || item.kind !== 'tv' || !d.imdb) return void (seasons = null);
		const r = await loadRatings(api, d.imdb);
		seasons = r && cardSeasons(d, r);
	});
</script>

<span id="cat-info-{item.id}" class="info" aria-hidden="true">
	{#if d === undefined}
		<span class="skel line"></span><span class="skel line"></span><span class="skel line short"></span>
	{:else if d}
		{#if d.genres.length}<span class="genres">{#each d.genres.slice(0, 3) as g (g)}<span>{g}</span>{/each}</span>{/if}
		{#if item.kind === 'tv'}
			<span class="seasons">
				{#if seasons === undefined}
					<span class="skel line"></span>
				{:else if seasons}
					{#if seasons.chart}
						<span class="sbars">
							{#each seasons.chart.bars as b (b.season)}
								<span class="sbar {b.tone}"><i style:height="{b.height}%"></i></span>
							{/each}
						</span>
					{/if}
					{#if seasons.outlook?.tone === 'go'}
						{@const o = seasons.outlook}
						<span class="next soon">
							<span class="when"><Icon name="clock" size={12} />{o.days <= 1 ? t(o.days ? 'mañana' : 'hoy') : t('en {n} días', { n: o.days })}</span>
							T{o.season}{o.episode > 1 ? ` E${o.episode}` : ''} · {day(o.date)}
						</span>
					{:else if seasons.outlook}
						{@const o = seasons.outlook}
						<span class="next {o.tone}">
							<span class="dot"></span>
							{#if o.tone === 'done' || o.tone === 'stop'}{t(o.tone === 'done' ? 'Serie terminada' : 'Serie cancelada')}{:else}{t('{s} · sin fecha', { s: t(o.label) })}{/if}
						</span>
					{/if}
				{/if}
			</span>
		{/if}
		<span class="meta">{cardMeta(d)}</span>
		{#if tier}<span class="tier">{tier.emoji} {t(tier.name)}</span>{/if}
		{#if d.awards}<span class="awards"><Icon name="award" size={13} />{d.awards}</span>{/if}
	{/if}
</span>

<style>
	/* Cubre solo el póster (2:3), no el título de abajo. */
	.info { position: absolute; top: 0; left: 0; right: 0; aspect-ratio: 2 / 3; display: flex; flex-direction: column; justify-content: flex-end; gap: 8px; padding: 14px 12px; border-radius: var(--r-md); pointer-events: none; color: #fff;
		background: linear-gradient(to top, rgb(8 10 14 / 0.96) 0%, rgb(8 10 14 / 0.88) 45%, rgb(8 10 14 / 0.35) 75%, transparent 100%);
		opacity: 0; transform: translateY(6px); transition: opacity 0.22s ease-out, transform 0.28s cubic-bezier(0.16, 1, 0.3, 1); }
	/* Solo con mouse: en el celu un toque no tiene que "hacer hover" (en iOS el primer toque se gastaría ahí). */
	@media (hover: hover) { :global(.card:hover) .info, :global(.card:focus-visible) .info { opacity: 1; transform: none; } }
	.line { height: 10px; border-radius: 4px; opacity: 0.5; }
	.short { width: 60%; }
	.genres { display: flex; flex-wrap: wrap; gap: 5px; }
	.genres span { padding: 2px 8px; border-radius: 999px; font-size: 11px; font-weight: 700; background: rgb(255 255 255 / 0.14); border: 1px solid rgb(255 255 255 / 0.18); }
	.meta { font-size: 12px; font-weight: 600; color: rgb(255 255 255 / 0.75); font-variant-numeric: tabular-nums; }
	.tier { font-size: 12.5px; font-weight: 700; }
	.awards { display: flex; align-items: center; gap: 5px; font-size: 12px; font-weight: 700; color: #f2c94c; }
	.seasons { display: grid; gap: 5px; }
	.seasons:empty { display: none; }
	.sbars { display: flex; align-items: stretch; gap: 3px; height: 26px; }
	.sbar { flex: 1 0 auto; max-width: 14px; display: flex; align-items: flex-end; border-radius: 3px 3px 1px 1px; }
	.sbar i { display: block; width: 100%; border-radius: inherit; }
	.great i { background: var(--green); }
	.good i { background: color-mix(in srgb, var(--green) 55%, var(--yellow)); }
	.meh i { background: var(--yellow); }
	.bad i { background: var(--red); }
	.next { display: flex; align-items: center; gap: 6px; font-size: 11.5px; font-weight: 600; color: rgb(255 255 255 / 0.8); }
	.when { display: inline-flex; align-items: center; gap: 4px; font-weight: 800; color: #fff; }
	.dot { flex: none; width: 7px; height: 7px; border-radius: 50%; background: rgb(255 255 255 / 0.5); }
	.wait .dot { background: var(--yellow); }
	.stop .dot { background: var(--red); }
	@media (prefers-reduced-motion: reduce) { .info { transition: opacity 0.15s; transform: none; } }
</style>
