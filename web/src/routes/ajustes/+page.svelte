<script lang="ts">
	import { onMount } from 'svelte';
	import Icon from '$ui/components/Icon.svelte';
	import { wipe } from '#lib/saved.ts';
	import { t } from '#lib/i18n.svelte.ts';
	import LangPicker from '$ui/components/LangPicker.svelte';
	import { langOptions } from '#lib/langs.ts';
	import AdminCode from '#lib/AdminCode.svelte';
	import { saveNick } from '#lib/nick.ts';
	import { goto, invalidateAll } from '$app/navigation';
	import { page } from '$app/state';

	type KeyName = 'tmdb' | 'torbox' | 'opensubtitles' | 'login';
	let status = $state<{ tmdb: boolean; torbox: boolean; opensubtitles: boolean; opensubtitles_user: boolean; opensubtitles_pass: boolean } | null>(null);
	let tmdb = $state('');
	let torbox = $state('');
	let opensubtitles = $state('');
	let osUser = $state('');
	let osPass = $state('');
	let saving = $state(false);
	let msg = $state('');
	let wiping = $state(false);
	/** Key guardada cuyo campo de reemplazo está abierto abajo. */
	let open = $state<'' | KeyName>('');
	const loginSaved = $derived(!!(status?.opensubtitles_user && status?.opensubtitles_pass));
	const anySaved = $derived(!!(status?.tmdb || status?.torbox || status?.opensubtitles || loginSaved));
	const anyMissing = $derived(!status?.tmdb || !status?.torbox || !status?.opensubtitles || !loginSaved);

	/** Abre/cierra el reemplazo; al cerrar descarta lo tipeado para que no viaje en otro Guardar. */
	function toggle(which: KeyName) {
		open = open === which ? '' : which;
		tmdb = torbox = opensubtitles = osUser = osPass = '';
		msg = '';
	}

	// Apodo: mismo validador que la bienvenida (lib/nick.ts).
	let nick = $state((() => page.data.nick ?? '')());
	let nickMsg = $state('');
	let nickBad = $state(false);
	let nickSaving = $state(false);
	async function onNick(e: SubmitEvent) {
		e.preventDefault();
		nickSaving = true;
		const r = await saveNick(nick);
		nickSaving = false;
		nickBad = !r.nick;
		nickMsg = r.nick ? t('Guardado.') : t(r.error ?? '');
		if (r.nick) {
			nick = r.nick;
			invalidateAll();
		}
	}

	/** Panel de uso: si este equipo ya entró, va directo; si no, pide el código acá mismo. */
	let adminOpen = $state(false);
	function openAdmin() {
		let ok = false;
		try {
			ok = localStorage.getItem('sw.admin') === '1';
		} catch {
			/* sin almacenamiento */
		}
		if (ok) goto('/admin');
		else adminOpen = !adminOpen;
	}

	onMount(async () => {
		status = await (await fetch('/api/keys')).json();
	});

	async function save(e: SubmitEvent) {
		e.preventDefault();
		saving = true;
		msg = '';
		try {
			const r = await fetch('/api/keys', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tmdb: tmdb || undefined, torbox: torbox || undefined, opensubtitles: opensubtitles || undefined, opensubtitles_user: osUser || undefined, opensubtitles_pass: osPass || undefined }) });
			const j = await r.json();
			if (!r.ok) throw new Error(j.message);
			status = j;
			tmdb = torbox = opensubtitles = osUser = osPass = '';
			open = '';
			msg = t('Guardado.');
		} catch (err) {
			msg = (err as Error).message;
		} finally {
			saving = false;
		}
	}
	const NAMES = { tmdb: 'la key de TMDB', torbox: 'la key de TorBox', opensubtitles: 'la key de OpenSubtitles.com', login: 'el usuario y la contraseña de OpenSubtitles.com' };
	async function remove(which: KeyName) {
		if (!confirm(t('¿Borrar {x}?', { x: t(NAMES[which]) }))) return;
		open = '';
		const body = which === 'login' ? { opensubtitles_user: '', opensubtitles_pass: '' } : { [which]: '' };
		const r = await fetch('/api/keys', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
		status = await r.json();
	}
</script>

<svelte:head><title>{t('Ajustes')} · Streamonte</title></svelte:head>

<header class="topbar">
	<div class="wrap row">
		<a id="back" class="btn-icon" href="/" aria-label={t('Volver')}><Icon name="back" /></a>
		<h1>{t('Ajustes')}</h1>
	</div>
</header>

<main class="wrap">
	<!-- Las keys que faltan van arriba y grandes; las guardadas, abajo en una fila. Mientras carga status no se muestra nada para no saltar. -->
	<form id="keys-form" onsubmit={save}>
		{#if status && anyMissing}
			<p class="muted">{t('Las keys quedan solo en el servidor; el navegador nunca las ve.')}</p>

			{#if !status.tmdb}
				<label class="field" for="key-tmdb">
					<span class="lbl">TMDB <small class="muted">{t('catálogo, filtros y pósters')}</small></span>
					<input id="key-tmdb" type="password" autocomplete="off" placeholder="API key (v3)" bind:value={tmdb} />
					<span class="help"><a href="https://www.themoviedb.org/settings/api" target="_blank" rel="noreferrer">{t('Conseguila gratis')}</a></span>
				</label>
			{/if}

			{#if !status.torbox}
				<label class="field" for="key-torbox">
					<span class="lbl">TorBox <small class="muted">{t('torrents en caché y links https')}</small></span>
					<input id="key-torbox" type="password" autocomplete="off" placeholder="API key" bind:value={torbox} />
					<span class="help"><a href="https://torbox.app/settings" target="_blank" rel="noreferrer">{t('Está en tu cuenta')}</a></span>
				</label>
			{/if}

			{#if !status.opensubtitles}
				<label class="field" for="key-opensubtitles">
					<span class="lbl">OpenSubtitles.com <small class="muted">{t('subtítulos Premium: pocas descargas por día, solo cuando tocás uno')}</small></span>
					<input id="key-opensubtitles" type="password" autocomplete="off" placeholder="API key" bind:value={opensubtitles} />
					<span class="help"><a href="https://www.opensubtitles.com/consumers" target="_blank" rel="noreferrer">{t('Creala con tu cuenta gratis')}</a></span>
				</label>
			{/if}

			{#if !loginSaved}
				<label class="field" for="os-user">
					<span class="lbl">{t('Cuenta de OpenSubtitles.com')} <small class="muted">{t('opcional: muestra cuántas descargas te quedan desde el arranque')}</small></span>
					<input id="os-user" type="text" autocomplete="off" autocapitalize="none" spellcheck="false" placeholder={status.opensubtitles_user ? t('Escribir otro para reemplazar') : t('Usuario')} bind:value={osUser} />
				</label>
				<label class="field" for="os-pass">
					<input id="os-pass" type="password" autocomplete="off" placeholder={status.opensubtitles_pass ? t('Escribir otra para reemplazar') : t('Contraseña')} bind:value={osPass} aria-label={t('Contraseña de OpenSubtitles.com')} />
					{#if status.opensubtitles_user || status.opensubtitles_pass}
						<span class="help"><button id="del-os-login" type="button" class="link" onclick={() => remove('login')}>{t('Borrar usuario y contraseña')}</button></span>
					{/if}
				</label>
			{/if}

			<button id="keys-save" class="btn btn-primary" type="submit" disabled={saving || (!tmdb && !torbox && !opensubtitles && !osUser && !osPass)}>
				{#if saving}<span class="spin"></span>{/if}{t('Guardar')}
			</button>
			{#if msg && open === ''}<p class="msg" role="status">{msg}</p>{/if}
		{/if}
	</form>

	<form id="nick-form" class="field saved" novalidate onsubmit={onNick}>
		<label class="lbl" for="nick-input">{t('Apodo')}</label>
		<div class="pact">
			<input id="nick-input" class="grow" type="text" maxlength="20" autocomplete="nickname" autocapitalize="words" spellcheck="false" aria-invalid={nickBad} aria-describedby="nick-msg" bind:value={nick} oninput={() => (nickMsg = '')} />
			<button id="nick-save" class="btn btn-primary" type="submit" disabled={nickSaving || nick.trim() === (page.data.nick ?? '')}>
				{#if nickSaving}<span class="spin"></span>{/if}{t('Guardar')}
			</button>
		</div>
		<p id="nick-msg" class="help-text" class:bad={nickBad} role="status">{nickMsg}</p>
	</form>

	<section class="field saved">
		<span class="lbl">{t('Idioma')}</span>
		<LangPicker id="settings-lang" {...langOptions()} />
	</section>

	<section class="field saved">
		<span class="lbl">{t('Caché')}</span>
		<p class="help-text">{t('Catálogo, fichas y opciones quedan guardados en este navegador para abrir al instante. Si algo se ve raro, borralos: la web queda como recién instalada, sin pedirte el código de nuevo.')}</p>
		<button
			id="wipe-cache"
			class="btn"
			type="button"
			disabled={wiping}
			onclick={async () => {
				if (!confirm(t('Se borra todo lo que la web guardó en este navegador: catálogo, fichas, opciones, filtros elegidos y tutoriales vistos. El código de acceso y las keys quedan. ¿Borrar?'))) return;
				wiping = true;
				await wipe();
				location.reload();
			}}
		>
			{#if wiping}<span class="spin"></span>{/if}{t('Borrar caché')}
		</button>
	</section>

	{#if anySaved}
		<section id="saved-keys" class="field saved">
			<span class="lbl">{t('Keys guardadas')} <small class="muted">{t('Quedan solo en el servidor')}</small></span>
			<ul class="kept">
				{#if status?.tmdb}
					<li>
						{@render head('tmdb', 'TMDB', t('catálogo'))}
						{#if open === 'tmdb'}
							<div id="panel-tmdb" class="panel">
								<input id="key-tmdb" form="keys-form" type="password" autocomplete="off" placeholder={t('Pegar otra para reemplazar')} aria-label="TMDB API key" bind:value={tmdb} />
								{@render actions('tmdb', !!tmdb, 'https://www.themoviedb.org/settings/api', t('Conseguila gratis'))}
							</div>
						{/if}
					</li>
				{/if}
				{#if status?.torbox}
					<li>
						{@render head('torbox', 'TorBox', 'torrents')}
						{#if open === 'torbox'}
							<div id="panel-torbox" class="panel">
								<input id="key-torbox" form="keys-form" type="password" autocomplete="off" placeholder={t('Pegar otra para reemplazar')} aria-label="TorBox API key" bind:value={torbox} />
								{@render actions('torbox', !!torbox, 'https://torbox.app/settings', t('Está en tu cuenta'))}
							</div>
						{/if}
					</li>
				{/if}
				{#if status?.opensubtitles}
					<li>
						{@render head('opensubtitles', 'OpenSubtitles.com', t('subtítulos'))}
						{#if open === 'opensubtitles'}
							<div id="panel-opensubtitles" class="panel">
								<input id="key-opensubtitles" form="keys-form" type="password" autocomplete="off" placeholder={t('Pegar otra para reemplazar')} aria-label="OpenSubtitles.com API key" bind:value={opensubtitles} />
								{@render actions('opensubtitles', !!opensubtitles, 'https://www.opensubtitles.com/consumers', t('Creala con tu cuenta gratis'))}
							</div>
						{/if}
					</li>
				{/if}
				{#if loginSaved}
					<li>
						{@render head('login', t('Cuenta de OpenSubtitles.com'), '')}
						{#if open === 'login'}
							<div id="panel-login" class="panel">
								<input id="os-user" form="keys-form" type="text" autocomplete="off" autocapitalize="none" spellcheck="false" placeholder={t('Escribir otro para reemplazar')} aria-label={t('Usuario')} bind:value={osUser} />
								<input id="os-pass" form="keys-form" type="password" autocomplete="off" placeholder={t('Escribir otra para reemplazar')} aria-label={t('Contraseña de OpenSubtitles.com')} bind:value={osPass} />
								{@render actions('login', !!(osUser || osPass), '', '')}
							</div>
						{/if}
					</li>
				{/if}
			</ul>
			{#if msg && open === '' && !anyMissing}<p class="msg" role="status">{msg}</p>{/if}
		</section>
	{/if}

	<section id="privacy" class="field saved">
		<span class="lbl">{t('Privacidad')}</span>
		<p class="help-text">{t('Para saber cómo se usa la app guardo, por cada dispositivo, un id al azar, tu apodo, el navegador, el modelo del equipo (si el navegador lo informa), la zona horaria, la ciudad aproximada (por la IP) y qué hacés acá: búsquedas, títulos que abrís y opciones que copiás. No se comparte con nadie y se borra solo a los 90 días.')}</p>
	</section>

	<section id="admin" class="field saved">
		<div class="kept">
			<div class="krow">
				<span class="kname">{t('Panel')} <span class="muted">· {t('uso de la app')}</span></span>
				<button id="go-admin" type="button" class="link" aria-expanded={adminOpen} aria-controls="admin-panel" onclick={openAdmin}>{t('Abrir')}</button>
			</div>
			{#if adminOpen}
				<div id="admin-panel" class="panel admin-code">
					<p class="help-text">{t('Código del panel')}</p>
					<AdminCode id="admin-pop-code" />
				</div>
			{/if}
		</div>
	</section>

	<section id="credits" class="field saved">
		<span class="lbl">{t('Datos')}</span>
		<p class="help-text">
			{t('Fichas, pósters y géneros:')} <a href="https://www.themoviedb.org/" target="_blank" rel="noopener noreferrer">TMDB</a>. {t('Este producto usa la API de TMDB, pero TMDB no lo respalda ni lo certifica.')}
			{t('Puntajes:')} <a href="https://developer.imdb.com/non-commercial-datasets/" target="_blank" rel="noopener noreferrer">{t('datasets de IMDb')}</a> {t('(uso personal, no comercial).')}
		</p>
	</section>
</main>

{#snippet head(which: KeyName, name: string, hint: string)}
	<div class="krow">
		<span class="ok"><Icon name="check" size={16} /></span>
		<span class="kname">{name}{#if hint}<span class="muted">{` · ${hint}`}</span>{/if}</span>
		<button id="change-{which}" type="button" class="link" aria-expanded={open === which} aria-controls="panel-{which}" onclick={() => toggle(which)}>{open === which ? t('Cancelar') : t('Cambiar')}</button>
	</div>
{/snippet}

{#snippet actions(which: KeyName, filled: boolean, href: string, hrefText: string)}
	<div class="pact">
		<span class="help">
			{#if href}<a href={href} target="_blank" rel="noreferrer">{hrefText}</a> ·{/if}
			<button id={which === 'login' ? 'del-os-login' : `del-${which}`} type="button" class="link" onclick={() => remove(which)}>{which === 'login' ? t('Borrar usuario y contraseña') : t('Borrar')}</button>
		</span>
		<button id="save-{which}" form="keys-form" class="btn btn-primary" type="submit" disabled={saving || !filled}>
			{#if saving}<span class="spin"></span>{/if}{t('Guardar')}
		</button>
	</div>
	{#if msg}<p class="msg" role="status">{msg}</p>{/if}
{/snippet}

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
		border-radius: var(--r-sm);
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
	.help-text a { color: var(--accent-fg); text-underline-offset: 2px; }
	.kept { list-style: none; margin: 0; padding: 0; border: 1px solid var(--border); border-radius: var(--r-sm); }
	.kept li + li { border-top: 1px solid var(--border); }
	.krow { display: flex; align-items: center; gap: 10px; padding-left: 12px; font-size: 14px; }
	.ok { display: inline-flex; color: var(--green); }
	.kname { flex: 1; min-width: 0; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.kname .muted { font-weight: 400; }
	.krow .link { padding: 0 12px; }
	.panel { display: flex; flex-direction: column; gap: 8px; padding: 2px 12px 12px; transform-origin: top; animation: reveal 0.18s ease-out; }
	.pact { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
	.pact .help { margin: 0; flex-wrap: wrap; }
	.pact .btn { height: 40px; padding: 0 16px; }
	#nick-form .pact .btn { height: 46px; }
	.grow { flex: 1; min-width: 0; }
	.help-text.bad { color: var(--red); }
	#nick-msg { min-height: 1.45em; }
	.admin-code { align-items: center; }
	@keyframes reveal { from { opacity: 0; transform: translateY(-6px); } }
</style>
