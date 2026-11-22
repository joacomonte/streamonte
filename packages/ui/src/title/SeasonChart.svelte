<script lang="ts">
	// Puntaje de IMDb por temporada como barras: alto relativo (la mejor llena la barra, la base es un punto debajo de la peor), color por
	// nota, estado de la serie y si mejoró o decayó. Tocar una barra elige esa temporada. `ratings`: undefined = cargando, null = falló.
	import Icon from '../components/Icon.svelte';
	import { t } from '../i18n/runtime.ts';
	import type { Outlook } from '../season.ts';
	import type { SeasonRatings } from '../types.ts';
	import { chartModel } from './title-state.ts';
	import type { TitleIds } from './title-state.ts';

	interface Props {
		ratings: SeasonRatings | null | undefined;
		outlook: Outlook | null;
		current: number | null;
		onpick: (season: number) => void;
		ids: TitleIds;
		/** Idioma de los números y fechas (BCP 47). */
		locale: string;
	}
	let { ratings, outlook, current, onpick, ids, locale }: Props = $props();

	const chart = $derived(ratings ? chartModel(ratings, outlook) : null);
	const fmt = (x: number) => x.toLocaleString(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
	const day = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString(locale, { day: 'numeric', month: 'short' }).replace('.', '');
</script>

{#if ratings === undefined}
	<div class="chart" aria-busy="true"><div class="skel chart-skel"></div></div>
{:else if chart}
	<section class="chart" aria-label={t('Puntaje por temporada')}>
		<div class="head">
			<h2>{t('Puntaje por temporada')}</h2>
			<span class="src">IMDb</span>
		</div>
		{#if chart.end || chart.trend}
			<div class="meta">
				{#if chart.end && outlook}<span class="pill end" class:stop={chart.end === 'stop'} title={t('No hay más temporadas')}><Icon name={chart.end === 'done' ? 'flag' : 'ban'} size={13} />{t(outlook.label)}</span>{/if}
				{#if chart.trend}
					<span class="pill {chart.trend.tone}"><Icon name={chart.trend.icon} size={14} />{chart.trend.tone === 'flat' ? t('Estable') : t(chart.trend.delta > 0 ? 'Mejoró +{d}' : 'Decayó −{d}', { d: fmt(Math.abs(chart.trend.delta)) })}</span>
				{/if}
			</div>
		{/if}
		<div class="bars">
			{#each chart.bars as x (x.season)}
				<button
					id={ids.bar(x.season)}
					type="button"
					class="col {x.tone}"
					class:best={x.best}
					class:current={x.season === current}
					aria-label={t('Temporada {s}: {r} ({n} episodios con puntaje)', { s: x.season, r: fmt(x.rating), n: (ratings?.seasons ?? []).find((s) => s.season === x.season)?.episodes ?? 0 })}
					onclick={() => onpick(x.season)}
				>
					<span class="val">{fmt(x.rating)}</span>
					<span class="track"><i style:height="{x.height}%"></i></span>
					<span class="n">{t('T{n}', { n: x.season })}</span>
				</button>
			{/each}
			{#if chart.ghost && outlook}
				<span class="col ghost" class:go={chart.ghost.go} title={t('Temporada {n}', { n: chart.ghost.season }) + ': ' + (chart.ghost.date ? day(chart.ghost.date) : t('{s}, sin fecha anunciada', { s: t(outlook.label) }))}>
					<span class="val">{chart.ghost.date ? day(chart.ghost.date) : '?'}</span>
					<span class="track"><i style:height="{chart.ghost.height}%"></i></span>
					<span class="n">{t('T{n}', { n: chart.ghost.season })}</span>
				</span>
			{/if}
		</div>
	</section>
{/if}

<style>
	.chart { margin-top: 18px; padding: 14px 14px 10px; border-radius: var(--r-lg, 16px); border: 1px solid var(--border); background: var(--surface); }
	.chart-skel { height: 150px; border-radius: var(--r-md, 12px); }
	.head { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
	h2 { margin: 0; font-size: 15px; }
	.src { font-size: 11px; font-weight: 750; letter-spacing: 0.05em; color: var(--muted); }
	.meta { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
	.pill.stop, .pill.down { --t: var(--red); }
	.pill.up { --t: var(--green); }
	.pill.flat { --t: var(--accent-fg); }
	.bars { display: flex; gap: 6px; height: 148px; margin: 12px -14px 0; padding: 0 14px 4px; overflow-x: auto; scrollbar-width: none; }
	.bars::-webkit-scrollbar { display: none; }
	.col { flex: 1 0 34px; max-width: 72px; display: flex; flex-direction: column; align-items: center; gap: 4px; padding: 0; border: 0; background: none; color: var(--muted); font: inherit; }
	button.col { cursor: pointer; }
	.track { flex: 1; width: 100%; display: flex; align-items: flex-end; border-radius: var(--r-sm, 8px); background: color-mix(in srgb, var(--text) 5%, transparent); }
	.track i { display: block; width: 100%; border-radius: inherit; transition: height 0.4s var(--out), filter 0.12s; }
	.great i { background: var(--green); }
	.good i { background: color-mix(in srgb, var(--green) 55%, var(--yellow)); }
	.meh i { background: var(--yellow); }
	.bad i { background: var(--red); }
	.val { font-size: 12px; font-weight: 700; color: var(--text); font-variant-numeric: tabular-nums; }
	.n { font-size: 11.5px; font-weight: 650; }
	.best .val { color: var(--green); }
	.best i { box-shadow: 0 0 0 3px color-mix(in srgb, var(--green) 24%, transparent); }
	.current .n { color: var(--text); }
	.current .track { outline: 2px solid var(--accent-fg); outline-offset: 2px; }
	.col:active i { filter: brightness(1.15); }
	.ghost { --c: var(--yellow); color: var(--c); cursor: help; }
	.ghost.go { --c: var(--green); }
	.ghost .track { background: none; }
	.ghost i { background: repeating-linear-gradient(-45deg, color-mix(in srgb, var(--c) 22%, transparent) 0 4px, transparent 4px 8px); border: 1.5px dashed var(--c); }
	.ghost .val { color: var(--c); }
</style>
