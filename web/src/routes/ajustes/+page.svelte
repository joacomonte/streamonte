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
	type ApiKey = Exclude<KeyName, 'login'>;
	let status = $state<{ tmdb: boolean; torbox: boolean; opensubtitles: boolean; opensubtitles_user: boolean; opensubtitles_pass: boolean } | null>(null);
	/** Lo tipeado en cada campo de key. */
	let typed = $state<Record<ApiKey, string>>({ tmdb: '', torbox: '', opensubtitles: '' });
	let osUser = $state('');
	let osPass = $state('');
	let saving = $state(false);
	let msg = $state('');
	let wiping = $state(false);
	/** Key guardada cuyo campo de reemplazo está abierto abajo. */
	let open = $state<'' | KeyName>('');
	const loginSaved = $derived(!!(status?.opensubtitles_user && status?.opensubtitles_pass));
	const anyMissing = $derived(!status?.tmdb || !status?.torbox || !status?.opensubtitles || !loginSaved);
	const anyTyped = $derived(!!(typed.tmdb || typed.torbox || typed.opensubtitles || osUser || osPass));

	/** Las tres keys, en el orden de la lista; la cuenta de OpenSubtitles va aparte (dos campos). */
	const KEYS: { which: ApiKey; name: string; hint: string; placeholder: string; href: string }[] = [
		{ which: 'tmdb', name: 'TMDB', hint: 'catálogo', placeholder: 'API key (v3)', href: 'https://www.themoviedb.org/settings/api' },
		{ which: 'torbox', name: 'TorBox', hint: 'torrents', placeholder: 'API key', href: 'https://torbox.app/settings' },
		{ which: 'opensubtitles', name: 'OpenSubtitles.com', hint: 'subtítulos', placeholder: 'API key', href: 'https://www.opensubtitles.com/consumers' }
	];

	function clearTyped() {
		typed = { tmdb: '', torbox: '', opensubtitles: '' };
		osUser = osPass = '';
	}

	/** Abre/cierra el reemplazo; al cerrar descarta lo tipeado para que no viaje en otro Guardar. */
	function toggle(which: KeyName) {
		open = open === which ? '' : which;
		clearTyped();
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
			const r = await fetch('/api/keys', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tmdb: typed.tmdb || undefined, torbox: typed.torbox || undefined, opensubtitles: typed.opensubtitles || undefined, opensubtitles_user: osUser || undefined, opensubtitles_pass: osPass || undefined }) });
			const j = await r.json();
			if (!r.ok) throw new Error(j.message);
			status = j;
			clearTyped();
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

<main class="wrap st">
	<section class="st-sec" aria-labelledby="h-profile">
		<h2 class="st-h" id="h-profile">{t('Perfil')}</h2>
		<form id="nick-form" class="st-list" novalidate onsubmit={onNick}>
			<div class="st-row">
				<label class="st-name" for="nick-input">{t('Apodo')}</label>
				<div class="st-inline grow">
					<input id="nick-input" class="st-input" type="text" maxlength="20" autocomplete="nickname" autocapitalize="words" spellcheck="false" aria-invalid={nickBad} aria-describedby="nick-msg" bind:value={nick} oninput={() => (nickMsg = '')} />
					<button id="nick-save" class="st-btn go" type="submit" disabled={nickSaving || nick.trim() === (page.data.nick ?? '')}>
						{#if nickSaving}<span class="spin light"></span>{/if}{t('Guardar')}
					</button>
				</div>
			</div>
		</form>
		<p id="nick-msg" class="st-msg st-foot" class:bad={nickBad} role="status">{nickMsg}</p>
	</section>

	<section class="st-sec" aria-labelledby="h-lang">
		<h2 class="st-h" id="h-lang">{t('Idioma')}</h2>
		<LangPicker id="settings-lang" {...langOptions()} />
	</section>

	<!-- Una sola lista: las keys que faltan muestran su campo (las guarda #keys-save); las guardadas, "Cambiar". Mientras carga status no se muestra para no saltar. -->
	<form id="keys-form" class="st-sec" aria-labelledby="h-keys" onsubmit={save}>
		<h2 class="st-h" id="h-keys">{t('Cuentas y keys')}</h2>
		{#if status}
			<ul id="saved-keys" class="st-list">
				{#each KEYS as k (k.which)}
					{@const has = status[k.which]}
					<li>
						<div class="st-row">
							<span class="st-lbl"><span class="st-name">{k.name}</span><span class="st-sub">{t(k.hint)}</span></span>
							{@render chip(has)}
							{#if has}
								<button id="change-{k.which}" type="button" class="st-link" aria-expanded={open === k.which} aria-controls="panel-{k.which}" onclick={() => toggle(k.which)}>{open === k.which ? t('Cancelar') : t('Cambiar')}</button>
							{:else}
								<a id="get-{k.which}" class="st-link" href={k.href} target="_blank" rel="noreferrer">{t('Conseguir')}<Icon name="external" size={13} /></a>
							{/if}
						</div>
						{#if !has}
							<div class="st-block">
								<input id="key-{k.which}" class="st-input" type="password" autocomplete="off" placeholder={k.placeholder} aria-label="{k.name} API key" bind:value={typed[k.which]} />
							</div>
						{:else if open === k.which}
							<div id="panel-{k.which}" class="st-block panel">
								<div class="st-inline">
									<input id="key-{k.which}" class="st-input" type="password" autocomplete="off" placeholder={k.placeholder} aria-label="{k.name} API key" bind:value={typed[k.which]} />
									{@render actions(k.which, !!typed[k.which])}
								</div>
							</div>
						{/if}
					</li>
				{/each}
				<li>
					<div class="st-row">
						<span class="st-lbl"><span class="st-name">{t('Cuenta de OpenSubtitles.com')}</span><span class="st-sub">{t('opcional')}</span></span>
						{@render chip(loginSaved)}
						{#if loginSaved}
							<button id="change-login" type="button" class="st-link" aria-expanded={open === 'login'} aria-controls="panel-login" onclick={() => toggle('login')}>{open === 'login' ? t('Cancelar') : t('Cambiar')}</button>
						{/if}
					</div>
					{#if !loginSaved}
						<div class="st-block">
							<div class="st-inline">
								<input id="os-user" class="st-input" type="text" autocomplete="off" autocapitalize="none" spellcheck="false" placeholder={status.opensubtitles_user ? t('Escribir otro para reemplazar') : t('Usuario')} aria-label={t('Usuario')} bind:value={osUser} />
								<input id="os-pass" class="st-input" type="password" autocomplete="off" placeholder={status.opensubtitles_pass ? t('Escribir otra para reemplazar') : t('Contraseña')} aria-label={t('Contraseña de OpenSubtitles.com')} bind:value={osPass} />
							</div>
							{#if status.opensubtitles_user || status.opensubtitles_pass}
								<button id="del-os-login" type="button" class="st-link danger" onclick={() => remove('login')}>{t('Borrar usuario y contraseña')}</button>
							{/if}
						</div>
					{:else if open === 'login'}
						<div id="panel-login" class="st-block panel">
							<div class="st-inline">
								<input id="os-user" class="st-input" type="text" autocomplete="off" autocapitalize="none" spellcheck="false" placeholder={t('Usuario')} aria-label={t('Usuario')} bind:value={osUser} />
								<input id="os-pass" class="st-input" type="password" autocomplete="off" placeholder={t('Contraseña')} aria-label={t('Contraseña de OpenSubtitles.com')} bind:value={osPass} />
							</div>
							<div class="st-inline end">{@render actions('login', !!(osUser || osPass))}</div>
						</div>
					{/if}
				</li>
			</ul>
			<div class="foot">
				<p class="st-foot"><Icon name="lock" size={12} />{t('Quedan solo en el servidor')}</p>
				{#if anyMissing}
					<button id="keys-save" class="st-btn go" type="submit" disabled={saving || !anyTyped || open !== ''}>
						{#if saving}<span class="spin light"></span>{/if}{t('Guardar')}
					</button>
				{/if}
			</div>
			<p class="st-msg st-foot" role="status">{msg}</p>
		{/if}
	</form>

	<section class="st-sec" aria-labelledby="h-data">
		<h2 class="st-h" id="h-data">{t('Datos')}</h2>
		<div class="st-list">
			<div class="st-row">
				<span class="st-lbl"><span class="st-name">{t('Caché')}</span><span class="st-sub">{t('de este navegador')}</span></span>
				<button
					id="wipe-cache"
					class="st-btn"
					type="button"
					disabled={wiping}
					onclick={async () => {
						if (!confirm(t('Se borra todo lo que la web guardó en este navegador: catálogo, fichas, opciones, filtros elegidos y tutoriales vistos. El código de acceso y las keys quedan. ¿Borrar?'))) return;
						wiping = true;
						await wipe();
						location.reload();
					}}
				>
					{#if wiping}<span class="spin"></span>{/if}{t('Borrar')}
				</button>
			</div>
			<details id="privacy" class="st-more">
				<summary id="privacy-toggle" class="st-row">
					<span class="st-lbl"><span class="st-name">{t('Privacidad')}</span><span class="st-sub">{t('qué se guarda y por cuánto')}</span></span>
					<span class="st-chev"><Icon name="chev" size={18} /></span>
				</summary>
				<p class="st-block">{t('Para saber cómo se usa la app guardo, por cada dispositivo, un id al azar, tu apodo, el navegador, el modelo del equipo (si el navegador lo informa), la zona horaria, la ciudad aproximada (por la IP) y qué hacés acá: búsquedas, títulos que abrís y opciones que copiás. No se comparte con nadie y se borra solo a los 90 días.')}</p>
			</details>
			<div id="admin">
				<div class="st-row">
					<span class="st-lbl"><span class="st-name">{t('Panel')}</span><span class="st-sub">{t('uso de la app')}</span></span>
					<button id="go-admin" type="button" class="st-btn" aria-expanded={adminOpen} aria-controls="admin-panel" onclick={openAdmin}>{t('Abrir')}</button>
				</div>
				{#if adminOpen}
					<div id="admin-panel" class="st-block panel admin-code" role="group" aria-label={t('Código del panel')}>
						<AdminCode id="admin-pop-code" />
					</div>
				{/if}
			</div>
		</div>
	</section>

	<p id="credits" class="credits">
		{t('Fichas, pósters y géneros:')} <a href="https://www.themoviedb.org/" target="_blank" rel="noopener noreferrer">TMDB</a>. {t('Este producto usa la API de TMDB, pero TMDB no lo respalda ni lo certifica.')}
		{t('Puntajes:')} <a href="https://developer.imdb.com/non-commercial-datasets/" target="_blank" rel="noopener noreferrer">{t('datasets de IMDb')}</a> {t('(uso personal, no comercial).')}
	</p>
</main>

{#snippet chip(ok: boolean)}
	{#if ok}<span class="st-chip ok"><Icon name="check" size={12} />{t('Guardada')}</span>{:else}<span class="st-chip">{t('Falta')}</span>{/if}
{/snippet}

{#snippet actions(which: KeyName, filled: boolean)}
	<button id={which === 'login' ? 'del-os-login' : `del-${which}`} type="button" class="st-link danger" onclick={() => remove(which)}>{t('Borrar')}</button>
	<button id="save-{which}" class="st-btn go" type="submit" disabled={saving || !filled}>
		{#if saving}<span class="spin light"></span>{/if}{t('Guardar')}
	</button>
{/snippet}

<style>
	.row { display: flex; align-items: center; gap: 4px; margin-left: -10px; }
	h1 { margin: 0; font-size: 18px; }
	main { padding: 20px 16px 40px; max-width: 560px; }
	.grow { flex: 1; min-width: 0; justify-content: flex-end; }
	#nick-input { max-width: 260px; }
	.foot { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
	.foot .st-foot { display: inline-flex; align-items: center; gap: 5px; }
	.end { justify-content: flex-end; }
	.panel { transform-origin: top; animation: reveal 0.18s var(--out); }
	.admin-code { align-items: center; }
	.credits { margin: 4px 14px 0; font-size: 11.5px; line-height: 1.5; color: var(--muted); }
	.credits a { color: inherit; text-underline-offset: 2px; }
	@keyframes reveal { from { opacity: 0; transform: translateY(-4px); } }
	@media (prefers-reduced-motion: reduce) { .panel { animation: none; } }
</style>
