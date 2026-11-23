<script lang="ts">
	// Votos en 3 posiciones (2026-11-23, variante 2A): pista fina con muescas, una perilla que salta con resorte y arriba
	// 1, 2 o 3 personitas del color del nivel. Sin textos fijos: al moverla aparece un momento, bajo la perilla, el nombre
	// del nivel y cuántos votos pide. Los niveles viven en `filters.ts` (`VOTE_LEVELS`).
	import Icon from '../components/Icon.svelte';
	import { t } from '../i18n/runtime.ts';
	import { nearestLevel, VOTE_LEVELS, votesLabel, type Filters } from './filters.ts';
	import type { CatalogStore } from './store.ts';

	interface Props {
		store: CatalogStore;
		onset: (changes: Partial<Filters>) => void;
	}
	let { store, onset }: Props = $props();
	const st = $derived(store.st);

	const COLORS = ['var(--accent-fg, var(--accent))', 'var(--amber)', 'var(--red)'];
	const level = $derived(nearestLevel(st.f.votes));
	/** Mientras se arrastra: posición continua 0–2 (null = quieta). */
	let dragAt = $state<number | null>(null);
	const pos = $derived(dragAt ?? level);
	const shown = $derived(dragAt == null ? level : Math.round(dragAt));

	/** La nota de abajo: visible mientras se mueve y un rato después. */
	let hint = $state(false);
	let hintTimer: ReturnType<typeof setTimeout> | undefined;
	function showHint(stay = false) {
		hint = true;
		clearTimeout(hintTimer);
		if (!stay) hintTimer = setTimeout(() => (hint = false), 1800);
	}
	function pick(i: number) {
		showHint();
		if (VOTE_LEVELS[i].v !== st.f.votes) onset({ votes: VOTE_LEVELS[i].v });
	}
	let track = $state<HTMLElement>();
	const at = (x: number) => {
		const r = track!.getBoundingClientRect();
		return Math.min(2, Math.max(0, ((x - r.left - 12) / (r.width - 24)) * 2));
	};
	function down(e: PointerEvent & { currentTarget: HTMLElement }) {
		e.currentTarget.setPointerCapture(e.pointerId);
		dragAt = at(e.clientX);
		showHint(true);
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
		aria-valuetext={`${t(VOTE_LEVELS[level].label)} · ${votesLabel(st.f.votes)}`}
		onpointerdown={down}
		onpointermove={move}
		onpointerup={up}
		onpointercancel={up}
		onkeydown={key}
	>
		<span class="fill" aria-hidden="true"></span>
		{#each VOTE_LEVELS as _, i (i)}<span class="notch" style:--i={i} aria-hidden="true"></span>{/each}
		{#key shown}<span class="crowd" aria-hidden="true">{#each Array(shown + 1) as _, i (i)}<span style:--d="{i * 50}ms"><Icon name="user" size={15} /></span>{/each}</span>{/key}
		<span class="knob" aria-hidden="true"></span>
	</div>
	<span id="votes-value" class="hint" class:on={hint} aria-hidden="true">
		{#key shown}<span class="hint-in"><b>{t(VOTE_LEVELS[shown].label)}</b> · {votesLabel(VOTE_LEVELS[shown].v)}</span>{/key}
	</span>
</div>

<style>
	/* Abajo queda lugar para la nota, así aparecer no corre la grilla. */
	.votes { position: relative; margin-top: 18px; padding-bottom: 16px; user-select: none; -webkit-user-select: none; }
	/* Pista: 12 px de margen a cada lado para que la perilla no se corte. */
	.track { position: relative; height: 36px; touch-action: none; cursor: pointer; outline-offset: 2px; border-radius: var(--r-sm); }
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
	/* Nota sutil bajo la perilla: pegada a la izquierda en "De nicho", centrada en el medio y a la derecha al final. */
	.hint {
		position: absolute;
		bottom: 0;
		left: calc(100% * var(--p) / 2);
		translate: calc(-50% * var(--p)) 4px;
		font-size: 11.5px;
		color: color-mix(in srgb, var(--muted) 80%, transparent);
		white-space: nowrap;
		font-variant-numeric: tabular-nums;
		opacity: 0;
		filter: blur(3px);
		pointer-events: none;
		transition: opacity 0.35s var(--out), filter 0.35s var(--out), translate 0.35s var(--out), left 0.5s var(--spring, cubic-bezier(0.34, 1.56, 0.64, 1));
	}
	.hint.on { opacity: 1; filter: none; translate: calc(-50% * var(--p)) 0; }
	.hint b { font-weight: 650; color: var(--kc); }
	.hint-in { display: inline-block; animation: hint-in 0.3s var(--out); }
	@keyframes hint-in { from { opacity: 0; transform: translateY(3px); } }
	.drag ~ .hint { transition: opacity 0.35s var(--out), filter 0.35s var(--out), translate 0.35s var(--out); }
</style>
