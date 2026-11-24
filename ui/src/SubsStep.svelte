<script lang="ts">
	// Paso "Subtítulos" de una opción (panel de Reproducir / clic derecho): los que trae el video (de `catalog-subs.js`) y,
	// debajo, `SubsPicker` compartido (buscar afuera + Premium). El estado de lectura de pistas vive en `catalog-subs.js`
	// (`read()`); acá se relee cuando avisa con `subs-changed`.
	import { onMount } from 'svelte';
	import Icon from '../../packages/ui/src/components/Icon.svelte';
	import { t } from '../../packages/ui/src/i18n/runtime.ts';
	import SubRow from '../../packages/ui/src/subs/SubRow.svelte';
	import SubsPicker from '../../packages/ui/src/subs/SubsPicker.svelte';
	import type { SubsCtx } from '../../packages/ui/src/subs/subs-flow.ts';
	import type { SubtitleFile } from '../../packages/ui/src/api.ts';
	import type { OptionRef, SubtitleOption } from '../../packages/ui/src/types.ts';
	import type { NativeSpanish } from './types.ts';

	export type StepState = {
		reading: 'reading' | 'done' | 'failed' | 'skipped' | null;
		torbox: boolean;
		/** null = todavía no se leyeron las pistas. */
		natives: NativeSpanish[] | null;
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
	const VARIANT = { latino: t('Latinoamérica'), spain: t('España'), unknown: t('Español') };
	const option = $derived({ hash, release: '', file: null });
</script>

<div class="step" id="cat-subs-menu" role="menu" aria-label={t('Subtítulos')}>
	{#if st.reading === 'reading'}
		<p class="grp">{t('Vienen con el video')}</p>
		<div class="msg" role="status">
			<span class="spin"></span>
			<span>{st.torbox ? t('Leyendo sus pistas en TorBox…') : t('Viendo si el video trae subtítulos… (baja solo el comienzo)')}</span>
			{#if !st.torbox}<button id="cat-subs-noread" type="button" class="btn btn-sm" onclick={onNoWait}>{t('No esperar')}</button>{/if}
		</div>
	{:else}
		{#snippet nativeRows(ctx: SubsCtx)}
			<li class="grp">{t('Vienen con el video')}</li>
			{#each st.natives ?? [] as n, i (n.key)}
				<SubRow head={VARIANT[n.variant]} spec={n.kind} title={n.place} on={ctx.picked === n.key} tried={ctx.picked !== n.key && ctx.tried.includes(n.key)}>
					{#snippet actions()}
						<button id="cat-sub-native-{i}" type="button" class="btn btn-sm" onclick={async () => { await onUseNative(n.key); ctx.pick(n.key); }}>{t('Usar')}</button>
					{/snippet}
				</SubRow>
			{/each}
			{#if !st.natives?.length}<li class="none">{st.natives ? t('Este video no trae en español') : t('Sin confirmar: no se pudieron leer sus pistas')}</li>{/if}
		{/snippet}
		{#snippet foundActions(sub: SubtitleOption, ctx: SubsCtx)}
			<button id="cat-sub-pick-{safe(sub.id)}" type="button" class="btn btn-sm" onclick={async () => { const got = await ctx.use(sub); if (got) await onUse(sub, got); }}>{t('Usar')}</button>
			{#if sub.path}<button id="cat-sub-dl-{safe(sub.id)}" type="button" class="btn-icon save" aria-label={t('Bajar a la Mac')} title={t('Bajar a la Mac')} onclick={() => onSave(sub)}><Icon name="download" size={14} /></button>{/if}
		{/snippet}
		<SubsPicker {ref} {option} autoSearch={!st.natives?.length} lead={nativeRows} actions={foundActions} {onSettings} onUse={onUse} />
	{/if}
	{#if playing}
		<div class="foot"><button id="cat-subs-skip" type="button" class="btn btn-sm" onclick={onSkip}>{t('Reproducir sin elegir')}</button></div>
	{/if}
</div>

<style>
	.step { display: grid; max-height: min(560px, 60vh); overflow-y: auto; padding: 4px 6px; }
	.grp { margin: 0; padding: 10px 0 4px; font-size: 11px; font-weight: 800; letter-spacing: 0.06em; text-transform: uppercase; color: var(--muted); list-style: none; }
	.msg { display: flex; align-items: center; gap: 8px; padding: 10px 0; font-size: 13px; color: var(--muted); }
	.msg .btn { margin-left: auto; }
	.none { padding: 2px 0 6px 26px; font-size: 12px; color: var(--muted); list-style: none; }
	.save { width: 32px; height: 32px; }
	.foot { display: flex; justify-content: flex-end; margin-top: 6px; }
</style>
