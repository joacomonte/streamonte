<script lang="ts">
	// Paso "Subtítulos" de una opción (panel de Reproducir / clic derecho): los que trae el video (de `catalog-subs.js`) y,
	// debajo, `SubsPicker` compartido (buscar afuera + Premium). El estado de lectura de pistas vive en `catalog-subs.js`
	// (`read()`); acá se relee cuando avisa con `subs-changed`.
	import { onMount } from 'svelte';
	import Icon from '../../packages/ui/src/components/Icon.svelte';
	import { t } from '../../packages/ui/src/i18n/runtime.ts';
	import NativeSubs from '../../packages/ui/src/subs/NativeSubs.svelte';
	import SubsPicker from '../../packages/ui/src/subs/SubsPicker.svelte';
	import type { SubsCtx } from '../../packages/ui/src/subs/subs-flow.ts';
	import type { NativeTrack } from '../../packages/ui/src/subs/native-view.ts';
	import type { SubtitleFile } from '../../packages/ui/src/api.ts';
	import type { OptionRef, SubtitleOption } from '../../packages/ui/src/types.ts';

	export type StepState = {
		reading: 'reading' | 'done' | 'failed' | 'skipped' | null;
		torbox: boolean;
		/** null = todavía no se leyeron las pistas. */
		natives: NativeTrack[] | null;
	};
	interface Props {
		hash: string;
		ref: OptionRef;
		/** Dentro de Reproducir: suma "Reproducir sin elegir". */
		playing: boolean;
		read: () => StepState;
		onNoWait: () => void;
		onSkip: () => void;
		onUseNative: (key: string) => Promise<void>;
		/** Se eligió un subtítulo de afuera (ya elegido en el núcleo; Premium ya bajado). */
		onUse: (sub: SubtitleOption, file: SubtitleFile) => Promise<void>;
		onSave: (sub: SubtitleOption) => void;
		onSettings: () => void;
	}
	let { hash, ref, playing, read, onNoWait, onSkip, onUseNative, onUse, onSave, onSettings }: Props = $props();

	let tick = $state(0);
	const st = $derived.by(() => {
		void tick;
		return read();
	});
	onMount(() => {
		const h = () => void tick++;
		document.addEventListener('subs-changed', h);
		return () => document.removeEventListener('subs-changed', h);
	});

	/** Los ids del núcleo traen `:` (wyzie:1). */
	const safe = (id: string) => id.replace(/\W+/g, '-');
	const option = $derived({ hash, release: '', file: null });
</script>

<div class="step" id="cat-subs-menu" role="menu" aria-label={t('Subtítulos')}>
	{#if st.reading === 'reading'}
		<div class="msg" role="status">
			<span class="spin"></span>
			<span>{st.torbox ? t('Leyendo sus pistas en TorBox…') : t('Viendo si el video trae subtítulos… (baja solo el comienzo)')}</span>
			{#if !st.torbox}<button id="cat-subs-noread" type="button" class="ghost" onclick={onNoWait}>{t('No esperar')}</button>{/if}
		</div>
	{:else}
		{#snippet nativeRows(ctx: SubsCtx)}
			<li class="lead">
				{#if st.natives?.length}
					<NativeSubs tracks={st.natives} picked={ctx.picked} tried={ctx.tried} onUse={async (key) => { await onUseNative(key); ctx.pick(key); }} />
				{:else}
					<div class="none"><b>{st.natives ? t('El video no trae subtítulos en español') : t('Sin confirmar: no se pudieron leer sus pistas')}</b><span>{t('Los buscamos afuera, calzados a este archivo.')}</span></div>
				{/if}
			</li>
		{/snippet}
		{#snippet foundActions(sub: SubtitleOption, ctx: SubsCtx)}
			<button id="cat-sub-pick-{safe(sub.id)}" type="button" class="ghost" onclick={async () => { const got = await ctx.use(sub); if (got) await onUse(sub, got); }}>{t('Usar')}</button>
			{#if sub.path}<button id="cat-sub-dl-{safe(sub.id)}" type="button" class="btn-icon save" aria-label={t('Bajar a la Mac')} title={t('Bajar a la Mac')} onclick={() => onSave(sub)}><Icon name="download" size={14} /></button>{/if}
		{/snippet}
		<SubsPicker {ref} {option} autoSearch={!st.natives?.length} lead={nativeRows} actions={foundActions} {onSettings} onUse={onUse} />
	{/if}
	{#if playing}
		<div class="foot"><button id="cat-subs-skip" type="button" class="ghost" onclick={onSkip}>{t('Reproducir sin elegir')}</button></div>
	{/if}
</div>

<style>
	.step { display: grid; grid-template-columns: minmax(0, 1fr); max-height: min(600px, 64vh); overflow-y: auto; padding: 6px 8px 4px; }
	.msg { display: flex; align-items: center; gap: 8px; padding: 12px 14px; border-radius: 18px; background: var(--nu-well); box-shadow: var(--nu-press); font-size: 13px; color: var(--muted); }
	.msg .ghost { margin-left: auto; }
	.lead { list-style: none; }
	.none { display: grid; gap: 4px; padding: 14px 16px; border-radius: 18px; background: var(--nu-well); box-shadow: var(--nu-press); }
	.none b { font-size: 14px; color: var(--text); }
	.none span { font-size: 13px; color: var(--muted); }
	.save { width: 32px; height: 32px; }
	.foot { display: flex; justify-content: flex-end; margin-top: 10px; }
	/* Secundario: ghost gris tenue. */
	.ghost { flex: none; height: 34px; padding: 0 12px; border: 0; border-radius: 12px; background: none; color: var(--muted); font: inherit; font-size: 13px; font-weight: 600; cursor: pointer; transition: color 0.15s, background 0.15s; }
	@media (hover: hover) { .ghost:hover { color: var(--text); background: rgb(255 255 255 / 0.05); } }
	.ghost:focus-visible { outline: 2px solid var(--accent-fg); outline-offset: 2px; }
</style>
