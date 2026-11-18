<script>
	// "Pegar magnet" (2026-11-18): el torrent que pegaste en el buscador. Si TorBox lo tiene, sus videos como opciones
	// (copiar link, subtítulos); si no, "Bajarlo en TorBox" con el avance. Arriba, la película o serie si se reconoce.
	import Icon from '#lib/Icon.svelte';
	import Torrents from '#lib/Torrents.svelte';
	import { t as tr } from '#lib/i18n.svelte.js';
	import { page } from '$app/state';

	const hash = $derived(page.params.hash?.toLowerCase() ?? '');
	const dn = $derived(page.url.searchParams.get('dn') ?? '');
	/** @typedef {{state: 'cached' | 'downloading' | 'ready' | 'missing', name: string | null, progress?: number, speed?: number, seeds?: number, eta?: number, files: any[], ident?: any}} Status */
	let st = $state(/** @type {Status | null} */ (null));
	let ident = $state(/** @type {any} */ (null));
	let error = $state('');
	let adding = $state(false);

	/** @param {boolean} who también qué película o serie es (solo la primera vez) */
	async function load(who) {
		const r = await fetch(`/api/magnet?${new URLSearchParams({ hash, dn, ...(who ? { who: '1' } : {}) })}`);
		const j = await r.json();
		if (!r.ok) throw new Error(j.message);
		if (who) ident = j.ident ?? null;
		st = j;
	}
	$effect(() => {
		void hash;
		st = null;
		error = '';
		load(true).catch((e) => (error = e.message));
	});
	// Bajándose en TorBox: se pregunta el avance cada 4 s hasta que termina.
	$effect(() => {
		if (st?.state !== 'downloading') return;
		const id = setInterval(() => load(false).catch(() => {}), 4000);
		return () => clearInterval(id);
	});
	async function download() {
		adding = true;
		error = '';
		try {
			const r = await fetch('/api/magnet', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ hash, dn }) });
			const j = await r.json();
			if (!r.ok) throw new Error(j.message);
			st = { ...j, ident: undefined };
		} catch (e) {
			error = /** @type {Error} */ (e).message;
		} finally {
			adding = false;
		}
	}
	/** @param {number} b */
	const speed = (b) => (b >= 1e6 ? `${(b / 1e6).toFixed(1)} MB/s` : `${Math.round(b / 1e3)} KB/s`);
	/** @param {number} sec */
	const eta = (sec) => (sec >= 3600 ? `${Math.floor(sec / 3600)} h ${Math.round((sec % 3600) / 60)} min` : sec >= 60 ? `${Math.round(sec / 60)} min` : `${sec} s`);
	const name = $derived(ident?.title ?? st?.name ?? dn ?? tr('Torrent pegado'));
</script>

<svelte:head><title>{name} · Streamonte</title></svelte:head>

<main class="mag">
	<a class="back" href="/" aria-label={tr('Volver')}><Icon name="back" size={20} /></a>
	<header class="head">
		{#if ident?.poster}<img class="poster" src={ident.poster} alt="" />{:else}<span class="poster none"><Icon name="link" size={26} /></span>{/if}
		<div class="who">
			<h1>{name}</h1>
			<p class="muted">{[ident ? '' : tr('Torrent pegado'), ident?.year, ident?.s && ident?.e ? `T${ident.s} E${ident.e}` : ident?.s ? `T${ident.s}` : '', ident?.rating ? `★ ${ident.rating}` : ''].filter(Boolean).join(' · ') || (st?.name && st.name !== name ? st.name : '')}</p>
			{#if ident?.id}<a class="to-title" href="/t/{ident.kind}/{ident.id}">{tr('Ver ficha')}</a>{/if}
		</div>
	</header>

	{#if error}
		<p class="status error" role="alert">{error}</p>
	{:else if !st}
		<p class="status"><span class="spin"></span>{tr('Preguntándole a TorBox…')}</p>
	{:else if st.state === 'missing'}
		<!-- No está en TorBox: se ofrece bajarlo en sus servidores. -->
		<div class="card">
			<svg class="art cloud" viewBox="0 0 120 70" aria-hidden="true">
				<path class="c" d="M34 56h52a16 16 0 0 0 0-32 22 22 0 0 0-42-4 15 15 0 0 0-10 36z" />
				<path class="arrow" d="M60 30v20M52 42l8 8 8-8" />
			</svg>
			<b>{tr('TorBox todavía no lo tiene')}</b>
			<span class="muted">{tr('Lo puede bajar en sus servidores: tarda según cuántos lo comparten. Después se ve al instante.')}</span>
			<button id="mag-download" type="button" class="go" disabled={adding} onclick={download}>
				{#if adding}<span class="spin light"></span>{:else}<Icon name="download" size={18} />{/if}{tr('Bajarlo en TorBox')}
			</button>
		</div>
	{:else if st.state === 'downloading'}
		<!-- TorBox lo está bajando: avance en vivo. -->
		<div class="card">
			<svg class="art cloud" viewBox="0 0 120 70" aria-hidden="true">
				<path class="c" d="M34 56h52a16 16 0 0 0 0-32 22 22 0 0 0-42-4 15 15 0 0 0-10 36z" />
				<path class="arrow moving" d="M60 30v20M52 42l8 8 8-8" />
			</svg>
			<b>{tr('TorBox lo está bajando')}</b>
			<span class="bar"><i style:width="{Math.max(3, (st.progress ?? 0) * 100)}%"></i></span>
			<span class="muted nums">{Math.floor((st.progress ?? 0) * 100)} % · {speed(st.speed ?? 0)} · {tr('{n} seeds', { n: st.seeds ?? 0 })}{st.eta ? ` · ${tr('falta {t}', { t: eta(st.eta) })}` : ''}</span>
			<span class="muted small">{tr('Podés cerrar esto: sigue bajando en TorBox y vuelve a aparecer acá.')}</span>
		</div>
	{:else if !st.files.length}
		<p class="status muted">{tr('Este torrent no trae videos.')}</p>
	{:else}
		{#key hash}
			<Torrents imdb={ident?.imdb ?? ''} s={ident?.s ?? null} e={ident?.e ?? null} name={name} orig={ident?.origLang ?? null} runtime={ident?.runtime ?? null} given={st.files} />
		{/key}
	{/if}
</main>

<style>
	.mag { max-width: 720px; margin: 0 auto; padding: 12px 16px 48px; }
	.back { display: inline-grid; place-items: center; width: 44px; height: 44px; margin-left: -8px; color: var(--text); }
	.head { display: flex; gap: 14px; align-items: flex-start; margin: 4px 0 18px; }
	.poster { flex: none; width: 76px; aspect-ratio: 2 / 3; border-radius: 10px; object-fit: cover; background: var(--surface-2); }
	.poster.none { display: grid; place-items: center; color: var(--muted); }
	.who { min-width: 0; display: flex; flex-direction: column; gap: 3px; }
	h1 { margin: 0; font-size: 20px; line-height: 1.2; text-wrap: balance; overflow-wrap: anywhere; }
	.who .muted { margin: 0; font-size: 13px; overflow-wrap: anywhere; }
	.to-title { align-self: flex-start; margin-top: 4px; font-size: 13.5px; font-weight: 600; color: var(--accent-fg); }
	.card { display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 20px 18px; border: 1px solid var(--border); border-radius: 18px; background: var(--surface-2); text-align: center; }
	.card b { font-size: 16.5px; }
	.card .muted { font-size: 13.5px; text-wrap: balance; }
	.card .small { font-size: 12.5px; }
	.nums { font-variant-numeric: tabular-nums; }
	.art { width: 100%; height: auto; fill: none; stroke-linecap: round; stroke-linejoin: round; }
	.cloud { max-width: 130px; }
	.cloud .c { stroke: var(--muted); stroke-width: 3; fill: color-mix(in srgb, var(--accent) 8%, transparent); }
	.cloud .arrow { stroke: var(--accent-fg); stroke-width: 4; }
	.cloud .moving { animation: drop 1.4s var(--ease) infinite; }
	@keyframes drop { 0% { transform: translateY(-6px); opacity: 0; } 40% { opacity: 1; } 100% { transform: translateY(6px); opacity: 0; } }
	.bar { width: min(280px, 90%); height: 8px; margin-top: 4px; border-radius: 999px; background: var(--surface-3, var(--border)); overflow: hidden; }
	.bar i { display: block; height: 100%; border-radius: inherit; background: var(--accent); transition: width 0.6s var(--out); }
	.go { display: inline-flex; align-items: center; justify-content: center; gap: 8px; min-height: 50px; margin-top: 8px; padding: 0 22px; border: 0; border-radius: 999px; background: var(--accent); color: var(--accent-text, #fff); font: inherit; font-size: 15px; font-weight: 650; }
	.go:active { transform: scale(0.98); }
	.go:disabled { opacity: 0.7; }
	.status { display: flex; align-items: center; gap: 10px; padding: 14px 0; margin: 0; font-size: 14px; }
	.status.error { color: var(--red, #e5484d); }
	.spin { width: 16px; height: 16px; border-radius: 50%; border: 2px solid var(--border); border-top-color: var(--accent); animation: spin 0.8s linear infinite; }
	.spin.light { border-color: rgb(255 255 255 / 0.35); border-top-color: #fff; }
	@keyframes spin { to { transform: rotate(360deg); } }
	@media (prefers-reduced-motion: reduce) { .cloud .moving, .spin { animation-duration: 3s; } }
</style>
