<script lang="ts">
	// Los subtítulos que trae el video (desktop y web): el recomendado en una tarjeta elevada (un toque lo usa) y el resto
	// en una lista gris hundida, cada uno con qué tipo es. Diseño: docs/mockups/subs-step/index.html?v=A&s=full&ui=neu.
	import type { SpanishVariant } from '../latino.ts';
	import Icon from '../components/Icon.svelte';
	import { t } from '../i18n/runtime.ts';
	import { nativeView, type NativeTrack } from './native-view.ts';

	interface Props {
		tracks: NativeTrack[];
		/** La clave elegida ahora y las que se probaron y no sincronizaron. */
		picked: string | null;
		tried: string[];
		onUse: (key: string) => void;
		/** Lo que hace el toque ("Usar"; web: "Copiar"). */
		useLabel?: string;
		variant?: SpanishVariant;
	}
	let { tracks, picked, tried, onUse, useLabel = t('Usar'), variant = 'lat' }: Props = $props();

	const view = $derived(nativeView(tracks, 'es', variant));
	const isTried = (key: string) => picked !== key && tried.includes(key);
</script>

<div class="nat">
	{#if view.best}
		{@const b = view.best}
		<button id={b.id} type="button" class="best" class:tried={isTried(b.key)} title={isTried(b.key) ? t('Probado · no sincronizó') : undefined} onclick={() => onUse(b.key)}>
			<span class="cc" aria-hidden="true">CC</span>
			<span class="eyebrow">{b.isDefault ? t('Recomendado · por defecto') : t('Recomendado')}</span>
			<span class="name">{b.name}</span>
			<span class="why">{b.kindText}{#if b.format}<span class="fmt">{b.format}</span>{/if}</span>
			<span class="go">{#if picked === b.key}<Icon name="check" size={18} />{:else}{useLabel}{/if}</span>
		</button>
	{/if}
	{#if view.rest.length}
		<p class="lbl">{view.best ? t('También vienen') : t('Vienen con el video')}</p>
		<div class="rest">
			{#each view.rest as l (l.key)}
				<button id={l.id} type="button" class="alt" class:on={picked === l.key} class:tried={isTried(l.key)} title={isTried(l.key) ? t('Probado · no sincronizó') : undefined} onclick={() => onUse(l.key)}>
					<span class="n">{l.name}</span>
					<span class="tag">{l.kindText}</span>{#if l.format}<span class="fmt">{l.format}</span>{/if}
					<span class="end">{#if picked === l.key}<Icon name="check" size={15} />{:else}{useLabel}{/if}</span>
				</button>
			{/each}
		</div>
	{/if}
</div>

<style>
	.nat { display: grid; gap: 12px; }
	button { font: inherit; color: inherit; cursor: pointer; text-align: left; }
	button:focus-visible { outline: 2px solid rgb(255 255 255 / 0.4); outline-offset: 2px; }

	/* Recomendado: botón primario = vidrio esmerilado + relieve neumórfico (al apretar, hundido). */
	.best { position: relative; display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; gap: 3px 14px; width: 100%; padding: 14px 16px; border: 1px solid var(--nu-frost-border); border-radius: 20px; background: linear-gradient(150deg, rgb(255 255 255 / 0.15), rgb(255 255 255 / 0.1)); backdrop-filter: var(--nu-frost-blur); -webkit-backdrop-filter: var(--nu-frost-blur); box-shadow: var(--nu-frost-shadow); transition: background 0.15s, box-shadow 0.15s, transform 0.15s var(--ease); }
	@media (hover: hover) { .best:hover { background: linear-gradient(150deg, rgb(255 255 255 / 0.2), rgb(255 255 255 / 0.13)); } }
	.best:active { box-shadow: var(--nu-frost-press); transform: scale(0.99); }
	.cc { grid-row: 1 / span 3; display: grid; place-items: center; width: 42px; height: 42px; border-radius: 14px; border: 1px solid var(--nu-frost-border); background: var(--nu-frost-bg); box-shadow: var(--nu-raise-sm); color: #fff; font-size: 13px; font-weight: 800; letter-spacing: 0.03em; }
	.eyebrow { grid-column: 2; font-size: 11px; font-weight: 800; letter-spacing: 0.06em; text-transform: uppercase; color: var(--accent-fg); }
	.name { grid-column: 2; font-size: 16px; font-weight: 750; color: var(--text); }
	.why { grid-column: 2; display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 8px; font-size: 13px; color: var(--muted); }
	.why .fmt { font-family: var(--mono); font-size: 11px; color: var(--dim); }
	.go { grid-column: 3; grid-row: 1 / span 3; display: grid; place-items: center; min-width: 28px; font-size: 13px; font-weight: 650; color: rgb(255 255 255 / 0.7); }

	/* El resto: hundido, gris y chico; el toque aparece al pasar el mouse (en el celu, siempre). */
	.lbl { margin: 2px 4px 0; font-size: 11px; font-weight: 700; letter-spacing: 0.05em; text-transform: uppercase; color: var(--dim); }
	.rest { display: grid; padding: 6px; border-radius: 18px; background: var(--nu-well); box-shadow: var(--nu-press); }
	.alt { position: relative; display: flex; flex-wrap: wrap; align-items: center; gap: 4px 10px; width: 100%; min-height: 38px; padding: 6px 10px; border: 0; border-radius: 12px; background: none; color: var(--muted); font-size: 13px; transition: background 0.15s, color 0.15s; }
	@media (hover: hover) { .alt:hover { background: rgb(255 255 255 / 0.04); color: var(--text); } }
	.alt.on { color: var(--text); }
	.n { font-weight: 600; white-space: nowrap; }
	.tag { display: inline-flex; align-items: center; height: 18px; padding: 0 6px; border-radius: var(--r-xs); background: rgb(0 0 0 / 0.18); box-shadow: var(--nu-press-sm); color: var(--dim); font-size: 11px; font-weight: 600; white-space: nowrap; }
	.fmt { font-family: var(--mono); font-size: 10px; color: var(--dim); white-space: nowrap; }
	/* Encima del final de la fila (no le quita lugar a las etiquetas). */
	.end { position: absolute; right: 6px; top: 50%; transform: translateY(-50%); display: inline-flex; padding: 3px 6px 3px 14px; border-radius: 8px; background: linear-gradient(90deg, transparent, var(--nu-bg) 12px); color: var(--dim); font-size: 12px; white-space: nowrap; opacity: 0; transition: opacity 0.15s; }
	.alt.on .end { opacity: 1; color: var(--accent-fg); }
	@media (hover: hover) { .alt:hover .end, .alt:focus-visible .end { opacity: 1; } }
	@media (hover: none) { .end { position: static; transform: none; margin-left: auto; padding: 0; background: none; opacity: 1; } }
	.tried .name, .tried .n { text-decoration: line-through; color: var(--muted); }
</style>
