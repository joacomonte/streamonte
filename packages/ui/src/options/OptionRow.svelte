<script lang="ts">
	// Una opción (diseño de design/opciones-final.html): a la izquierda peso, badges y calidad de imagen; al medio (desktop)
	// el veredicto, la prueba en curso o la reproducción, con la gente debajo; a la derecha la cápsula de idioma y ▶ (copiar
	// el link en la web). Solo dibuja `row` (ver `row.ts`): la arma cada app. El CSS es `packages/ui/css/options.css`.
	import Icon from '../components/Icon.svelte';
	import type { IconName } from '../components/icons.ts';
	import { t } from '../i18n/runtime.ts';
	import { since } from './since.ts';
	import type { OptionRowView, Tip, Verdict } from './row.ts';

	let { row }: { row: OptionRowView } = $props();
	const still = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
	const a = $derived(row.action);
</script>

{#snippet ic(name: IconName, size: number)}<span class="ico" aria-hidden="true"><Icon {name} {size} /></span>{/snippet}
{#snippet tip(x: Tip | null)}{#if x && !still}<span class="cat-tip" aria-hidden="true" use:since={{ prop: 'animation-delay', at: x.start + x.delay }}>{x.text}</span>{/if}{/snippet}
{#snippet signal(v: Verdict)}
	{@const bars = 3 - v.level}
	<span class="cat-health-ic" aria-hidden="true"><svg viewBox="0 0 16 14" width="16" height="14" aria-hidden="true">{#each [1, 2, 3] as b (b)}<rect x={b * 5 - 4} y={12 - b * 4} width="3.4" height={b * 4} rx="1" class:on={b <= bars} class:maybe={v.probable && b === bars} />{/each}</svg></span>
{/snippet}
{#snippet verdict(v: Verdict)}
	<button id={v.id} type="button" class="cat-verdict cat-health-{['good', 'fair', 'risky'][v.level]}" class:compact={v.compact} title={v.tip} aria-label={v.aria} onclick={v.onclick}>
		{@render signal(v)}{#if !v.compact}<strong>{v.word}</strong>{/if}
	</button>
{/snippet}

<li class="cat-opt" class:tb-idle={row.idle} class:pend={a.kind === 'play' && a.dock.length > 0} class:best={row.best} class:too-big={row.tooBig} class:skipped={row.skipped}
	title={row.title} data-tip-delay="2000" data-hash={row.hash}>
	{#if row.best}<span class="cat-best-tags"><span class="cat-best-tag">{row.bestText}</span></span>{/if}
	<span class="cat-size-cell">
		<span class="cat-size-line">
			<span class="cat-size">{row.size}</span>
			{#if row.hdr}<span class="cat-tag cat-hdr" title={row.hdr}>HDR</span>{/if}
			{#if row.res}<span class="cat-tag cat-res" title={t('Resolución')}>{row.res}</span>{/if}
			{#if row.heavy}<span class="cat-tag cat-heavy" title={row.heavy}>{t('Puede cortarse')}</span>{/if}
			{#if row.failedBefore}<span class="cat-tag cat-failed-before" title={row.failedBefore}>{t('Falló antes')}</span>{/if}
			{#if row.torbox}<span class="cat-tag cat-torbox" title={row.torbox}>TorBox</span>{/if}
			{#if row.audio}
				{@const au = row.audio}
				{#if au.tappable}
					<button id={au.id} type="button" class="cat-tag cat-lang es-audio" class:likely={au.state === 'likely'} class:check={au.state === 'check'} title={au.title} aria-label={au.title} onclick={au.onclick}>
						{#if au.state === 'spain'}{@render ic('speaker', 11)}{/if}{au.text}{@render tip(au.tip)}
					</button>
				{:else if au.state === 'lat'}
					<span class="cat-tag cat-lang ok" title={au.title}>{@render ic('check', 10)}LAT{@render tip(au.tip)}</span>
				{:else}
					<span class="cat-tag cat-lang no" title={au.title}><s>LAT</s>{@render tip(au.tip)}</span>
				{/if}
			{/if}
			{#if row.subs}
				<span class="cat-tag cat-lang {row.subs.state}" title={row.subs.title}>{@render ic('subs', 11)}{row.subs.state === 'unk' ? 'ES?' : 'ES'}{@render tip(row.subs.tip)}</span>
			{/if}
		</span>
		<span class="cat-quality" class:cam={row.quality.known && row.quality.cam}>
			{#if row.quality.known}
				<span class="cat-quality-q" title={row.quality.tip}>{@render ic('monitor', 13)}<span class="cat-stars" role="img" aria-label={t('{a} de 4', { a: row.quality.stars })}>{#each [1, 2, 3, 4] as i (i)}<i class:on={i <= (row.quality.known ? row.quality.stars : 0)}>★</i>{/each}</span>{row.quality.name}</span>
			{:else}
				<button id={row.quality.id} type="button" class="cat-quality-unknown" title={row.quality.tip}>{@render ic('info', 13)}{t('Calidad sin dato')}</button>
			{/if}
		</span>
		{#if row.nofit}<span class="cat-nofit" title={row.nofit.title}>{@render ic('ban', 12)}{row.nofit.text}</span>{/if}
	</span>
	{#if row.mid}
		{@const m = row.mid.main}
		{@const p = row.mid.people}
		<span class="cat-mid">
			{#if m?.kind === 'status'}
				<span class="cat-status st-{m.state}" role="status">
					<span class="cat-status-line">
						{#if m.state === 'playing'}<span class="cat-eq" aria-hidden="true"><i></i><i></i><i></i></span>
						{:else if m.state === 'paused' || m.state === 'download-paused' || m.state === 'ask-after-close'}{@render ic('pause', 15)}
						{:else if m.state === 'background'}{@render ic('download', 15)}
						{:else if m.state === 'failed'}{@render ic('ban', 15)}
						{:else}<span class="cat-deep-spin small" aria-hidden="true"></span>{/if}
						<b>{m.text}</b>
					</span>
					{#if m.progress != null}<span class="cat-status-bar" title={m.progressTip}><i style:width="{Math.max(2, Math.round(m.progress * 100))}%"></i></span>{/if}
				</span>
			{:else if m?.kind === 'bg'}
				<span class="cat-speed bg-{m.cls}" title={m.tip} role="status">{m.text}</span>
			{:else if m?.kind === 'waiting'}
				<span class="cat-waiting" role="status"><span class="cat-waiting-dot" aria-hidden="true"></span>{m.text}</span>
			{:else if m?.kind === 'testing'}
				<span class="cat-testing" class:quick={m.quick} class:phase-count={m.counting} class:phase-meta={!m.counting} role="status" use:since={{ prop: '--t', at: m.since }}>
					<span class="cat-testing-line"><span class="cat-radar" aria-hidden="true"></span><span class="cat-testing-step">{m.step}</span>{m.label}</span>
					<span class="cat-testing-bar"><i></i></span>
				</span>
			{:else if m?.kind === 'failed'}
				<span class="cat-failed">
					<!-- svelte-ignore a11y_no_noninteractive_tabindex (enfocable para leer el porqué con el teclado) -->
					<span class="cat-failed-msg" title={m.tip} tabindex="0">{@render ic('ban', 14)}{m.text}</span>
					<button id={m.id} type="button" class="cat-retry" onclick={m.onclick}>{m.retry}</button>
				</span>
			{:else if m?.kind === 'verdict'}
				{@render verdict(m.verdict)}
			{:else if m?.kind === 'check'}
				<button id={m.id} type="button" class="cat-test" title={m.title} onclick={m.onclick}><span class="cat-radar" aria-hidden="true"></span>{m.text}</button>
			{/if}
			{#if p}
				<span class="cat-people" title={p.tip}>{#if p.verdict}{@render verdict(p.verdict)}{/if}<b>{p.seeds}</b>{p.text}</span>
			{/if}
		</span>
	{/if}
	<span class="cat-opt-actions">
		{#if a.kind === 'cancel'}
			<button id={a.id} type="button" class="cat-stop" data-anchor="opt-{row.hash}" title={a.title} onclick={a.onclick}>{@render ic('stop', 16)}{a.text}</button>
		{:else if a.kind === 'stop'}
			<span class="cat-play-btns">
				{#if a.subchange}<button id={a.subchange.id} type="button" class="cat-subchange" title={a.subchange.title} onclick={a.subchange.onclick}>{@render ic('subs', 15)}</button>{/if}
				<button id={a.id} type="button" class="cat-stop" title={a.title} onclick={a.onclick}>{@render ic('stop', 16)}{a.text}</button>
			</span>
		{:else}
			{@const play = a}
			<span class="cat-play-btns">
				{#if a.bg}<button id={a.bg.id} type="button" class="cat-bg-btn" class:on={a.bg.on} aria-pressed={a.bg.on} title={a.bg.title} onclick={a.bg.onclick}>{@render ic(a.bg.on ? 'stop' : 'download', 15)}</button>{/if}
				{#snippet playBtn()}
					<button id={play.id} type="button" class="cat-play" class:torbox={play.tone === 'torbox'} class:ghost={play.tone === 'ghost'} class:busy={play.state === 'busy'} class:ok={play.state === 'ok'} class:err={play.state === 'err'}
						data-anchor="opt-{row.hash}" aria-label={play.label} title={play.title} disabled={play.state === 'busy'} onclick={play.onclick}>{@render ic(play.state === 'ok' ? 'check' : 'play', 18)}</button>
				{/snippet}
				{#if a.dock.length}
					<span class="cat-dock">
						<span class="cat-dock-acts">
							{#each a.dock as d (d.id)}
								<button id={d.id} type="button" class="cat-dock-btn" class:loading={!!d.busy && !!d.cancel} class:reading={!!d.busy} title={d.title} aria-label={d.aria} onclick={d.onclick}>
									{#if d.busy}<span class="cat-dock-ic"><span class="cat-res-spin" aria-hidden="true"></span>{@render ic('stop', 11)}</span><span class="cat-dock-busy">{d.busy}</span><span class="cat-dock-cancel">{d.cancel}</span>
									{:else}{@render ic(d.icon, 13)}{d.text}{/if}
								</button>
							{/each}
						</span>
						<span class="cat-dock-div" aria-hidden="true"></span>
						{@render playBtn()}
					</span>
				{:else}
					{@render playBtn()}
				{/if}
			</span>
		{/if}
	</span>
</li>
