<script>
	// Puntaje de IMDb por temporada como barras, como el desktop (streamonte/ui/src/catalog-side.js `seasonChart`):
	// alto relativo (la mejor llena la barra, la base es un punto debajo de la peor), color por nota, estado de la
	// serie y si mejoró o decayó. Tocar una barra elige esa temporada.
	import Icon from './Icon.svelte';
	import * as saved from './saved.js';
	import { loc, t } from './i18n.svelte.js';

	/** @type {{imdb: string, status: string | null, next: {season: number, date: string} | null, current: number | null, onpick: (n: number) => void}} */
	let { imdb, status, next, current, onpick } = $props();

	let scores = $state(/** @type {{season: number, rating: number, episodes: number}[] | null} */ (null));
	let failed = $state(false);

	$effect(() => {
		const id = imdb;
		scores = null;
		failed = false;
		let alive = true;
		saved.json(fetch, `/api/scores/${id}`, saved.DAY)
			.then((r) => {
				if (!alive) return;
				if (r.ok) scores = /** @type {import('./types.js').SeasonScore[]} */ (r.data);
				else failed = true;
			})
			.catch(() => alive && (failed = true));
		return () => (alive = false);
	});

	const STATES = /** @type {Record<string, string>} */ ({ returning: 'Renovada', 'in-production': 'En producción', planned: 'Planeada', ended: 'Terminada', canceled: 'Cancelada' });
	/** @param {number} x */
	const tone = (x) => (x >= 8.5 ? 'great' : x >= 7.5 ? 'good' : x >= 6.5 ? 'meh' : 'bad');
	/** @param {number} x */
	const fmt = (x) => x.toLocaleString(loc(), { minimumFractionDigits: 1, maximumFractionDigits: 1 });

	const v = $derived(scores?.map((x) => x.rating) ?? []);
	const top = $derived(Math.max(...v));
	const floor = $derived(Math.min(...v) - 1);
	/** @param {number} x */
	const height = (x) => `${Math.max(12, ((x - floor) / (top - floor || 1)) * 100)}%`;
	const ended = $derived(status === 'ended' || status === 'canceled');
	/** Lo que viene: barra punteada a la altura de la última (con la fecha si se sabe). */
	const upcoming = $derived.by(() => {
		const last = scores?.at(-1)?.season ?? 0;
		if (!scores?.length || ended || !status) return null;
		if (next && next.season > last && new Date(`${next.date}T12:00`) > new Date())
			return { season: next.season, label: new Date(`${next.date}T12:00`).toLocaleDateString(loc(), { day: 'numeric', month: 'short' }).replace('.', ''), go: true };
		return { season: last + 1, label: '?', go: false };
	});
	/** Primera contra última temporada. */
	const trend = $derived.by(() => {
		if (v.length < 2) return null;
		const d = /** @type {number} */ (v.at(-1)) - v[0];
		if (Math.abs(d) < 0.3) return { text: t('Estable'), icon: /** @type {const} */ ('trend-flat'), cls: 'flat' };
		return d > 0 ? { text: t('Mejoró +{d}', { d: fmt(d) }), icon: /** @type {const} */ ('trend-up'), cls: 'up' } : { text: t('Decayó −{d}', { d: fmt(-d) }), icon: /** @type {const} */ ('trend-down'), cls: 'down' };
	});
</script>

{#if !scores && !failed}
	<div class="chart" aria-busy="true"><div class="skel chart-skel"></div></div>
{:else if scores && (scores.length >= 2 || (scores.length && upcoming))}
	<section class="chart" aria-label={t('Puntaje por temporada')}>
		<div class="head">
			<h2>{t('Puntaje por temporada')}</h2>
			<span class="src">IMDb</span>
		</div>
		{#if ended || trend}
			<div class="meta">
				{#if ended && status}<span class="pill end" class:stop={status === 'canceled'}><Icon name={status === 'ended' ? 'flag' : 'ban'} size={13} />{t(STATES[status])}</span>{/if}
				{#if trend}<span class="pill {trend.cls}"><Icon name={trend.icon} size={14} />{trend.text}</span>{/if}
			</div>
		{/if}
		<div class="bars">
			{#each scores as x (x.season)}
				<button
					id="score-s{x.season}"
					type="button"
					class="bar {tone(x.rating)}"
					class:best={x.rating === top}
					class:current={x.season === current}
					aria-label={t('Temporada {s}: {r} ({n} episodios con puntaje)', { s: x.season, r: fmt(x.rating), n: x.episodes })}
					onclick={() => onpick(x.season)}
				>
					<span class="val">{fmt(x.rating)}</span>
					<span class="track"><i style:height={height(x.rating)}></i></span>
					<span class="n">{t('T{n}', { n: x.season })}</span>
				</button>
			{/each}
			{#if upcoming}
				<span class="bar ghost" class:go={upcoming.go} title={t('Temporada {n}', { n: upcoming.season }) + ': ' + (upcoming.go ? upcoming.label : t('{s}, sin fecha anunciada', { s: t(STATES[status ?? ''] ?? '') }))}>
					<span class="val">{upcoming.label}</span>
					<span class="track"><i style:height={height(/** @type {number} */ (v.at(-1)))}></i></span>
					<span class="n">{t('T{n}', { n: upcoming.season })}</span>
				</span>
			{/if}
		</div>
	</section>
{/if}

<style>
	.chart { margin-top: 18px; padding: 14px 14px 10px; border-radius: 16px; border: 1px solid var(--border); background: var(--surface); }
	.chart-skel { height: 150px; border-radius: 10px; }
	.head { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
	h2 { margin: 0; font-size: 15px; }
	.src { font-size: 11px; font-weight: 750; letter-spacing: 0.05em; color: var(--muted); }
	.meta { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
	.pill { --t: var(--muted); display: inline-flex; align-items: center; gap: 5px; height: 26px; padding: 0 10px 0 8px; border-radius: 999px; font-size: 12px; font-weight: 700; color: var(--t); background: color-mix(in srgb, var(--t) 14%, transparent); }
	.pill.stop, .pill.down { --t: var(--red); }
	.pill.up { --t: var(--green); }
	.pill.flat { --t: var(--accent-fg); }
	.bars { display: flex; gap: 6px; height: 148px; margin: 12px -14px 0; padding: 0 14px 4px; overflow-x: auto; scrollbar-width: none; }
	.bars::-webkit-scrollbar { display: none; }
	.bar { flex: 1 0 34px; max-width: 72px; display: flex; flex-direction: column; align-items: center; gap: 4px; padding: 0; border: 0; background: none; color: var(--muted); }
	.track { flex: 1; width: 100%; display: flex; align-items: flex-end; border-radius: 8px; background: color-mix(in srgb, var(--text) 5%, transparent); }
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
	.bar:active i { filter: brightness(1.15); }
	.ghost { --c: var(--yellow); color: var(--c); }
	.ghost.go { --c: var(--green); }
	.ghost .track { background: none; }
	.ghost i { background: repeating-linear-gradient(-45deg, color-mix(in srgb, var(--c) 22%, transparent) 0 4px, transparent 4px 8px); border: 1.5px dashed var(--c); }
	.ghost .val { color: var(--c); }
</style>
