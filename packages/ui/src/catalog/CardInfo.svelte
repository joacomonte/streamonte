<script lang="ts" module>
	import type { Api } from '../api.ts';
	import type { SeasonRatings, TitleAwards, TitleDetails } from '../types.ts';

	// Las fichas ya pedidas se reusan: volver a pasar el mouse no pide nada.
	const details = new Map<string, Promise<TitleDetails | null>>();
	const ratings = new Map<string, Promise<SeasonRatings | null>>();
	const awards = new Map<string, Promise<TitleAwards | null>>();
	const load = <T,>(cache: Map<string, Promise<T | null>>, key: string, get: () => Promise<T>) => {
		let hit = cache.get(key);
		if (!hit) cache.set(key, (hit = get().catch(() => null)));
		return hit;
	};
	export const loadDetails = (api: Api, kind: TitleDetails['kind'], id: string) => load(details, `${kind}${id}`, () => api.title.details(kind, id));
	export const loadRatings = (api: Api, imdb: string) => load(ratings, imdb, () => api.title.seasonRatings(imdb, true));
	export const loadAwards = (api: Api, imdb: string) => load(awards, imdb, () => api.title.awards(imdb));
</script>

<script lang="ts">
	// Detalles sobre el póster al pasar el mouse: géneros, año · puntaje · duración · premios (íconos con número), categoría por
	// puntaje y, en series, barras por temporada. Los premios ganados van en dorado solo si hay alguno de los eventos grandes (los que
	// nombra la ficha); si no, son el total de IMDb (premios chicos incluidos) y van en gris como las nominaciones.
	// Se monta recién cuando el mouse se detiene un momento encima (Grid.svelte); la ficha queda en caché.
	import { onMount } from 'svelte';
	import Icon from '../components/Icon.svelte';
	import { getApi } from '../context.ts';
	import { t } from '../i18n/runtime.ts';
	import type { Outlook } from '../season.ts';
	import type { Chart } from '../title/title-state.ts';
	import type { CatalogItem } from '../types.ts';
	import { cardAwards, cardAwardsLabel } from '../title/awards.ts';
	import { cardSeasons, ratingTier } from './card-info.ts';

	let { item }: { item: CatalogItem } = $props();
	const api = getApi();
	/** undefined = cargando, null = no hay ficha. */
	let d = $state<TitleDetails | null | undefined>(undefined);
	let seasons = $state<{ chart: Chart | null; outlook: Outlook | null } | null | undefined>(undefined);
	let aw = $state<ReturnType<typeof cardAwards>>(null);
	const tier = $derived(d ? ratingTier(d.kind, d.rating) : null);
	const day = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }).replace('.', '');

	onMount(async () => {
		d = await loadDetails(api, item.kind, item.id);
		// Los premios llegan aparte (IMDb): si tardan o fallan, el resto ya se ve.
		if (d?.imdb) void loadAwards(api, d.imdb).then((a) => (aw = cardAwards(a)));
		if (!d || item.kind !== 'tv' || !d.imdb) return void (seasons = null);
		const r = await loadRatings(api, d.imdb);
		seasons = r && cardSeasons(d, r);
	});
</script>

<!-- Sin ficha no hay velo: nada que mostrar encima del póster. -->
{#if d !== null}
	<span id="cat-info-{item.id}" class="info" aria-hidden="true">
		<span class="body">
			{#if d === undefined}
				<span class="skel line"></span><span class="skel line short"></span>
			{:else}
				{#if d.genres.length}<span class="genres">{d.genres.slice(0, 3).join(' · ')}</span>{/if}
				<!-- La duración solo en películas: en series depende del capítulo. -->
				<!-- Premios en la misma línea, solo ícono + número: Óscar ganados (estatuilla), premios ganados (copa, amarillo) y
				     nominaciones (escarapela, gris). Van al borde derecho; si no entran, bajan juntos a la línea de abajo (también a la derecha). -->
				<span class="meta"><span class="facts">{#if d.year}<span>{d.year}</span>{/if}{#if d.rating}<span class="star">★ {d.rating}</span>{/if}{#if d.kind === 'movie' && d.runtimeMin}<span class="dim">{d.runtimeMin} min</span>{/if}</span>{#if aw}{@const awText = cardAwardsLabel(aw, t)}<span class="aw" role="img" title={awText} aria-label={awText}>{#if aw.oscars}<span class="aw-oscar"><Icon name="oscar" size={13} />{aw.oscars}</span>{/if}{#if aw.wins}<span class="aw-win" class:major={aw.majorWins > 0}><Icon name="trophy" size={11} />{aw.wins}</span>{/if}{#if aw.nominations}<span class="aw-nom"><Icon name="award" size={11} />{aw.nominations}</span>{/if}</span>{/if}</span>
				{#if tier}<span class="tier">{tier.emoji} {t(tier.name)}</span>{/if}
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
			{/if}
		</span>
	</span>
{/if}

<style>
	/* Velo a sangre: mismo recuadro y radio que el póster (2:3), no el título de abajo. Solo se funde; nunca se mueve
	 * por su cuenta (antes subía 6 px y no acompañaba el "apretar" del póster: quedaba una caja corrida).
	 * `width: 100%` y no `left: 0; right: 0`: con aspect-ratio, WebKit (desktop y Safari) achicaba el velo (2026-11-23). */
	.info { position: absolute; top: 0; left: 0; width: 100%; aspect-ratio: 2 / 3; display: flex; flex-direction: column; justify-content: flex-end; padding: 12px 11px; border-radius: var(--r-md); pointer-events: none; color: #fff;
		background: linear-gradient(to top, rgb(6 8 12 / 0.94) 0%, rgb(6 8 12 / 0.8) 38%, rgb(6 8 12 / 0.4) 70%, rgb(6 8 12 / 0.22) 100%);
		opacity: 0; transition: opacity 0.22s ease-out, transform 0.15s var(--ease); }
	.body { display: flex; flex-direction: column; gap: 5px; transform: translateY(6px); transition: transform 0.28s cubic-bezier(0.16, 1, 0.3, 1); }
	/* Solo con mouse: en el celu un toque no tiene que "hacer hover" (en iOS el primer toque se gastaría ahí). */
	@media (hover: hover) {
		:global(.card:hover) .info, :global(.card:focus-visible) .info { opacity: 1; }
		:global(.card:hover) .body, :global(.card:focus-visible) .body { transform: none; }
	}
	/* Acompaña al póster cuando se aprieta (Grid.svelte: .card:active img). */
	:global(.card:active) .info { transform: scale(0.97); }
	.line { height: 9px; border-radius: 4px; opacity: 0.5; }
	.short { width: 60%; }
	.genres { font-size: 11.5px; font-weight: 600; line-height: 1.3; color: rgb(255 255 255 / 0.82); }
	.meta { display: flex; flex-wrap: wrap; align-items: center; row-gap: 3px; white-space: nowrap; font-size: 12px; font-weight: 700; font-variant-numeric: tabular-nums; }
	.facts { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
	.facts > span + span::before { content: ' · '; color: rgb(255 255 255 / 0.5); font-weight: 600; }
	.aw { display: inline-flex; align-items: center; gap: 6px; margin-left: auto; padding-left: 8px; pointer-events: auto; animation: aw-in 0.3s var(--out, ease-out); }
	.aw > span { display: inline-flex; align-items: center; gap: 1px; }
	.aw :global(svg) { flex: none; }
	.aw-oscar { color: #ffd66b; }
	.aw-win { color: rgb(255 255 255 / 0.6); font-weight: 600; }
	.aw-win.major { color: #f2c94c; font-weight: 700; }
	.aw-nom { color: rgb(255 255 255 / 0.6); font-weight: 600; }
	@keyframes aw-in { from { opacity: 0; } }
	.star { color: #f2c94c; }
	.dim { color: rgb(255 255 255 / 0.6); font-weight: 600; }
	.tier { font-size: 12px; font-weight: 700; }
	.seasons { display: grid; gap: 5px; margin-top: 2px; }
	.seasons:empty { display: none; }
	.sbars { display: flex; align-items: stretch; gap: 3px; height: 24px; }
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
	@media (prefers-reduced-motion: reduce) { .info { transition: opacity 0.15s; } .body { transition: none; transform: none; } }
</style>
