<script lang="ts">
	// Una fila de subtítulo: grupo + "fuente resolución" + LAT; debajo, cuánto calza. Las acciones las pone quien la usa.
	import type { Snippet } from 'svelte';
	import Icon from '../components/Icon.svelte';
	import { t } from '../i18n/runtime.ts';
	import { levelWhy, levelWord } from './subs-logic.ts';

	interface Props {
		head: string;
		spec: string;
		latino?: boolean;
		/** 0-3; null = sin medidor. */
		lvl?: number | null;
		on?: boolean;
		tried?: boolean;
		title?: string;
		actions?: Snippet;
	}
	let { head, spec, latino = false, lvl = null, on = false, tried = false, title = '', actions }: Props = $props();
</script>

<li class="sub" class:on class:tried title={tried ? t('Probado · no sincronizó') : title}>
	<span class="mark">{#if on}<Icon name="check" size={16} />{/if}</span>
	<span class="sub-text">
		<span class="l1"><b>{head}</b><span class="spec">{spec}</span>{#if latino}<span class="lat">LAT</span>{/if}{#if tried}<span class="why">{t('probado')}</span>{/if}</span>
		{#if lvl != null}<span class="fit l{lvl}" title={levelWhy(lvl)}><span class="dots" aria-hidden="true">{#each [1, 2, 3] as n (n)}<i class:on={n <= lvl}></i>{/each}</span>{levelWord(lvl)}</span>{/if}
	</span>
	{@render actions?.()}
</li>

<style>
	.sub { display: grid; grid-template-columns: 18px minmax(0, 1fr) auto auto; align-items: center; gap: 8px; min-height: 52px; padding: 4px 4px 4px 6px; border-radius: var(--r-md); }
	.sub.on { background: color-mix(in srgb, var(--accent) 16%, transparent); }
	.mark { display: grid; place-items: center; color: var(--accent-fg); }
	.sub-text { min-width: 0; display: flex; flex-direction: column; gap: 1px; color: var(--text); }
	.l1 { display: flex; align-items: baseline; gap: 7px; min-width: 0; white-space: nowrap; overflow: hidden; }
	.l1 b { font-size: 14px; font-weight: 650; }
	.spec { font-size: 13px; color: var(--muted); overflow: hidden; text-overflow: ellipsis; }
	.lat { align-self: center; padding: 0 4px; border: 1px solid var(--border-strong); border-radius: 4px; font-size: 10px; font-weight: 700; letter-spacing: 0.04em; color: var(--muted); }
	.why { font-size: 11px; color: var(--muted); }
	.sub.tried b, .sub.tried .spec { color: var(--muted); text-decoration: line-through; }
	/* Nivel de match: palabra con color; el ámbar queda para lo que cuesta cuota. */
	.fit { display: inline-flex; align-items: center; gap: 5px; font-size: 11px; font-weight: 500; color: var(--muted); }
	/* Medidor de 3 puntos: cuántos calzan (perfecto = 3, puede desfasar = 0). */
	.dots { display: inline-flex; gap: 2px; }
	.dots i { width: 6px; height: 6px; border-radius: 50%; background: currentColor; opacity: 0.25; }
	.dots i.on { opacity: 1; }
	.fit.l3 { color: light-dark(#12733a, #4ade80); font-weight: 600; }
	.fit.l2 { color: light-dark(#3d7a55, #b5d86a); }
	.fit.l1 { color: light-dark(#76681c, #d9a85b); }
</style>
