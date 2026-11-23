<script lang="ts">
	// Votos en 3 posiciones (2026-11-23, variante 2A): pista fina con muescas, una perilla que salta con resorte y arriba
	// 1, 2 o 3 personitas del color del nivel. Los demás valores (cualquiera, 5k, 25k…) siguen en la hoja de Filtros: con
	// uno de esos, la perilla queda en el más cercano y arriba se lee el valor exacto.
	import Icon from '../components/Icon.svelte';
	import { t } from '../i18n/runtime.ts';
	import { votesLabel, type Filters } from './filters.ts';
	import type { CatalogStore } from './store.ts';

	interface Props {
		store: CatalogStore;
		onset: (changes: Partial<Filters>) => void;
	}
	let { store, onset }: Props = $props();
	const st = $derived(store.st);

	/** Votos mínimos de cada posición y su nombre. */
	const LEVELS: [number, string][] = [
		[1000, 'De nicho'],
		[10000, 'Conocidas'],
		[100000, 'Muy populares']
	];
	const COLORS = ['var(--accent-fg, var(--accent))', 'var(--amber)', 'var(--red)'];
	/** Posición más cercana (en escala logarítmica) a los votos elegidos. */
	const nearest = (v: number) => {
		const lv = Math.log10(Math.max(1, v));
		return LEVELS.reduce((best, [n], i) => (Math.abs(Math.log10(n) - lv) < Math.abs(Math.log10(LEVELS[best][0]) - lv) ? i : best), 0);
	};
	const level = $derived(nearest(st.f.votes));
	const exact = $derived(LEVELS[level][0] === st.f.votes);
	/** Mientras se arrastra: posición continua 0–2 (null = quieta). */
	let dragAt = $state<number | null>(null);
	const pos = $derived(dragAt ?? level);
	const shown = $derived(dragAt == null ? level : Math.round(dragAt));

	function pick(i: number) {
		if (LEVELS[i][0] !== st.f.votes) onset({ votes: LEVELS[i][0] });
	}
	let track = $state<HTMLElement>();
	const at = (x: number) => {
		const r = track!.getBoundingClientRect();
		return Math.min(2, Math.max(0, ((x - r.left - 12) / (r.width - 24)) * 2));
	};
	function down(e: PointerEvent & { currentTarget: HTMLElement }) {
		e.currentTarget.setPointerCapture(e.pointerId);
		dragAt = at(e.clientX);
	}
	function move(e: PointerEvent) {
		if (dragAt == null) return;
		const next = at(e.clientX);
		if (Math.round(next) !== Math.round(dragAt)) navigator.vibrate?.(3);
		dragAt = next;
	}
	function up() {
		if (dragAt == null) return;
		const i = Math.round(dragAt);
		dragAt = null;
		pick(i);
	}
	function key(e: KeyboardEvent) {
		const d = ({ ArrowLeft: -1, ArrowDown: -1, ArrowRight: 1, ArrowUp: 1 } as Record<string, number>)[e.key];
		if (!d) return;
		e.preventDefault();
		pick(Math.min(2, Math.max(0, level + d)));
	}
</script>

<div class="votes" style:--p={pos} style:--kc={COLORS[shown]}>
	<div class="head">
		<span class="k">{t('Votos')}</span>
		{#key `${shown}${st.f.votes}`}
			<span id="votes-value" class="val"><b>{t(LEVELS[shown][1])}</b> <span class="m">· {dragAt != null || exact ? votesLabel(LEVELS[shown][0]) : votesLabel(st.f.votes)}</span></span>
		{/key}
	</div>
	<div
		bind:this={track}
		id="votes-slider"
		class="track"
		class:drag={dragAt != null}
		role="slider"
		tabindex="0"
		aria-label={t('Votos')}
		aria-valuemin={0}
		aria-valuemax={2}
		aria-valuenow={level}
		aria-valuetext={`${t(LEVELS[level][1])} · ${votesLabel(st.f.votes)}`}
		onpointerdown={down}
		onpointermove={move}
		onpointerup={up}
		onpointercancel={up}
		onkeydown={key}
	>
		<span class="fill" aria-hidden="true"></span>
		{#each LEVELS as _, i (i)}<span class="notch" style:--i={i} aria-hidden="true"></span>{/each}
		{#key shown}<span class="crowd" aria-hidden="true">{#each Array(shown + 1) as _, i (i)}<span style:--d="{i * 50}ms"><Icon name="user" size={15} /></span>{/each}</span>{/key}
		<span class="knob" aria-hidden="true"></span>
	</div>
	<div class="labels">
		{#each LEVELS as [, name], i (i)}
			<button id="votes-pick-{i}" type="button" class:on={shown === i} onclick={() => pick(i)}>{t(name)}</button>
		{/each}
	</div>
</div>

<style>
	.votes { margin-top: 14px; user-select: none; -webkit-user-select: none; }
	.head { display: flex; justify-content: space-between; align-items: baseline; }
	.k { font-size: 11px; font-weight: 700; color: var(--muted); text-transform: uppercase; letter-spacing: 0.07em; }
	.val { font-size: 13px; font-weight: 700; font-variant-numeric: tabular-nums; animation: tick 0.3s var(--out); }
	.val .m { color: var(--muted); font-weight: 500; }
	@keyframes tick { from { transform: translateY(40%); opacity: 0; filter: blur(2px); } }
	/* Pista: 12 px de margen a cada lado para que la perilla no se corte. */
	.track { position: relative; height: 36px; margin-top: 16px; touch-action: none; cursor: pointer; outline-offset: 2px; border-radius: var(--r-sm); }
	.track::before { content: ''; position: absolute; left: 12px; right: 12px; top: 16px; height: 4px; border-radius: 4px; background: var(--surface-3); }
	.fill {
		position: absolute;
		left: 12px;
		top: 16px;
		height: 4px;
		right: 12px;
		border-radius: 4px;
		/* El degradé ocupa toda la pista y se recorta hasta la perilla: el rojo solo aparece en "Muy populares". */
		background: linear-gradient(90deg, var(--accent-fg, var(--accent)), var(--amber), var(--red));
		clip-path: inset(0 calc((1 - var(--p) / 2) * 100%) 0 0 round 4px);
		transition: clip-path 0.5s var(--spring, cubic-bezier(0.34, 1.56, 0.64, 1));
	}
	.notch { position: absolute; top: 13px; left: calc(12px + (100% - 24px) * var(--i) / 2); width: 10px; height: 10px; margin-left: -5px; border-radius: 50%; background: var(--surface-3); box-shadow: 0 0 0 2px var(--bg); }
	.knob {
		position: absolute;
		top: 6px;
		left: calc(12px + (100% - 24px) * var(--p) / 2);
		width: 24px;
		height: 24px;
		margin-left: -12px;
		border-radius: 50%;
		background: var(--text);
		box-shadow: 0 0 0 4px color-mix(in srgb, var(--kc) 35%, transparent), 0 0 16px var(--kc);
		transition: left 0.5s var(--spring, cubic-bezier(0.34, 1.56, 0.64, 1)), box-shadow 0.3s;
	}
	.crowd {
		position: absolute;
		bottom: calc(100% - 4px);
		left: calc(12px + (100% - 24px) * var(--p) / 2);
		translate: -50% 0;
		display: flex;
		color: var(--kc);
		pointer-events: none;
		transition: left 0.5s var(--spring, cubic-bezier(0.34, 1.56, 0.64, 1));
	}
	.crowd > span { display: flex; animation: pop 0.4s var(--spring, cubic-bezier(0.34, 1.56, 0.64, 1)) var(--d) backwards; }
	.crowd > span + span { margin-left: -3px; }
	@keyframes pop { from { transform: scale(0) translateY(6px); } }
	.drag .fill, .drag .knob, .drag .crowd { transition: none; }
	.labels { display: grid; grid-template-columns: repeat(3, 1fr); margin-top: 2px; }
	.labels button { min-height: 32px; padding: 0; border: 0; background: none; color: var(--muted); font: inherit; font-size: 12.5px; font-weight: 650; transition: color 0.25s; }
	.labels button:nth-child(1) { text-align: left; }
	.labels button:nth-child(3) { text-align: right; }
	.labels button.on { color: var(--text); }
</style>
