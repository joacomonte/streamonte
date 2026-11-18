<script>
	import { onMount } from 'svelte';
	import Icon from '#lib/Icon.svelte';
	import { clear } from '#lib/saved.js';

	/** @type {{tmdb: boolean, torbox: boolean, opensubtitles: boolean, opensubtitles_user: boolean, opensubtitles_pass: boolean} | null} */
	let status = $state(null);
	let tmdb = $state('');
	let torbox = $state('');
	let opensubtitles = $state('');
	let osUser = $state('');
	let osPass = $state('');
	let saving = $state(false);
	let msg = $state('');
	let cleared = $state('');

	onMount(async () => {
		status = await (await fetch('/api/keys')).json();
	});

	/** @param {SubmitEvent} e */
	async function save(e) {
		e.preventDefault();
		saving = true;
		msg = '';
		try {
			const r = await fetch('/api/keys', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tmdb: tmdb || undefined, torbox: torbox || undefined, opensubtitles: opensubtitles || undefined, opensubtitles_user: osUser || undefined, opensubtitles_pass: osPass || undefined }) });
			const j = await r.json();
			if (!r.ok) throw new Error(j.message);
			status = j;
			tmdb = torbox = opensubtitles = osUser = osPass = '';
			msg = 'Guardado.';
		} catch (err) {
			msg = /** @type {Error} */ (err).message;
		} finally {
			saving = false;
		}
	}
	const NAMES = { tmdb: 'la key de TMDB', torbox: 'la key de TorBox', opensubtitles: 'la key de OpenSubtitles.com', login: 'el usuario y la contraseña de OpenSubtitles.com' };
	/** @param {'tmdb' | 'torbox' | 'opensubtitles' | 'login'} which */
	async function remove(which) {
		if (!confirm(`¿Borrar ${NAMES[which]}?`)) return;
		const body = which === 'login' ? { opensubtitles_user: '', opensubtitles_pass: '' } : { [which]: '' };
		const r = await fetch('/api/keys', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
		status = await r.json();
	}
</script>

<svelte:head><title>Ajustes · Streamonte</title></svelte:head>

<header class="topbar">
	<div class="wrap row">
		<a id="back" class="icon-btn" href="/" aria-label="Volver"><Icon name="back" /></a>
		<h1>Ajustes</h1>
	</div>
</header>

<main class="wrap">
	<form id="keys-form" onsubmit={save}>
		<p class="muted">Las keys quedan solo en esta Mac (<code>.data/keys.json</code>); el navegador nunca las ve.</p>

		<label class="field" for="key-tmdb">
			<span class="lbl">
				TMDB <small class="muted">catálogo, filtros y pósters</small>
				{#if status?.tmdb}<span class="badge lat">cargada</span>{/if}
			</span>
			<input id="key-tmdb" type="password" autocomplete="off" placeholder={status?.tmdb ? 'Pegar otra para reemplazar' : 'API key (v3)'} bind:value={tmdb} />
			<span class="help">
				<a href="https://www.themoviedb.org/settings/api" target="_blank" rel="noreferrer">Conseguila gratis</a>
				{#if status?.tmdb}· <button id="del-tmdb" type="button" class="link" onclick={() => remove('tmdb')}>Borrar</button>{/if}
			</span>
		</label>

		<label class="field" for="key-torbox">
			<span class="lbl">
				TorBox <small class="muted">torrents en caché y links https</small>
				{#if status?.torbox}<span class="badge lat">cargada</span>{/if}
			</span>
			<input id="key-torbox" type="password" autocomplete="off" placeholder={status?.torbox ? 'Pegar otra para reemplazar' : 'API key'} bind:value={torbox} />
			<span class="help">
				<a href="https://torbox.app/settings" target="_blank" rel="noreferrer">Está en tu cuenta</a>
				{#if status?.torbox}· <button id="del-torbox" type="button" class="link" onclick={() => remove('torbox')}>Borrar</button>{/if}
			</span>
		</label>

		<label class="field" for="key-opensubtitles">
			<span class="lbl">
				OpenSubtitles.com <small class="muted">subtítulos Premium: pocas descargas por día, solo cuando tocás uno</small>
				{#if status?.opensubtitles}<span class="badge lat">cargada</span>{/if}
			</span>
			<input id="key-opensubtitles" type="password" autocomplete="off" placeholder={status?.opensubtitles ? 'Pegar otra para reemplazar' : 'API key'} bind:value={opensubtitles} />
			<span class="help">
				<a href="https://www.opensubtitles.com/consumers" target="_blank" rel="noreferrer">Creala con tu cuenta gratis</a>
				{#if status?.opensubtitles}· <button id="del-opensubtitles" type="button" class="link" onclick={() => remove('opensubtitles')}>Borrar</button>{/if}
			</span>
		</label>

		<label class="field" for="os-user">
			<span class="lbl">
				Cuenta de OpenSubtitles.com <small class="muted">opcional: muestra cuántas descargas te quedan desde el arranque</small>
				{#if status?.opensubtitles_user && status?.opensubtitles_pass}<span class="badge lat">cargada</span>{/if}
			</span>
			<input id="os-user" type="text" autocomplete="off" autocapitalize="none" spellcheck="false" placeholder={status?.opensubtitles_user ? 'Escribir otro para reemplazar' : 'Usuario'} bind:value={osUser} />
		</label>
		<label class="field" for="os-pass">
			<input id="os-pass" type="password" autocomplete="off" placeholder={status?.opensubtitles_pass ? 'Escribir otra para reemplazar' : 'Contraseña'} bind:value={osPass} aria-label="Contraseña de OpenSubtitles.com" />
			{#if status?.opensubtitles_user || status?.opensubtitles_pass}
				<span class="help"><button id="del-os-login" type="button" class="link" onclick={() => remove('login')}>Borrar usuario y contraseña</button></span>
			{/if}
		</label>

		<button id="keys-save" class="btn primary" type="submit" disabled={saving || (!tmdb && !torbox && !opensubtitles && !osUser && !osPass)}>
			{#if saving}<span class="spin"></span>{/if}Guardar
		</button>
		{#if msg}<p class="msg" role="status">{msg}</p>{/if}
	</form>

	<section class="field saved">
		<span class="lbl">Listas guardadas</span>
		<p class="help-text">Las opciones de cada película o episodio quedan guardadas 1 hora en este navegador para abrir al instante.</p>
		<button id="clear-saved" class="btn" type="button" onclick={() => { const n = clear(); cleared = n ? `Borré ${n} lista${n > 1 ? 's' : ''}.` : 'No había listas guardadas.'; }}>
			Borrar listas guardadas
		</button>
		{#if cleared}<p class="msg" role="status">{cleared}</p>{/if}
	</section>
</main>

<style>
	.row { display: flex; align-items: center; gap: 4px; margin-left: -10px; }
	h1 { margin: 0; font-size: 18px; }
	main { padding: 16px; max-width: 560px; }
	form { display: flex; flex-direction: column; gap: 18px; }
	p { margin: 0; font-size: 14px; }
	.field { display: flex; flex-direction: column; gap: 6px; }
	.lbl { display: flex; align-items: center; gap: 8px; font-weight: 650; flex-wrap: wrap; }
	.lbl small { font-weight: 400; }
	input {
		height: 46px;
		padding: 0 12px;
		border-radius: var(--radius);
		border: 1px solid var(--border-strong);
		background: var(--surface);
		font-size: 16px;
	}
	.help { display: flex; align-items: center; gap: 4px; margin: -8px 0; font-size: 13px; color: var(--muted); }
	.help a, .link { display: inline-flex; align-items: center; min-height: 44px; color: var(--accent-fg); text-underline-offset: 3px; }
	.link { border: 0; background: none; padding: 0 4px; font-size: 13px; text-decoration: underline; }
	.btn { height: 48px; }
	.msg { text-align: center; }
	.saved { margin-top: 28px; padding-top: 20px; border-top: 1px solid var(--border); }
	.help-text { color: var(--muted); font-size: 13px; }
</style>
