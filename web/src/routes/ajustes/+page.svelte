<script lang="ts">
	import { onMount } from 'svelte';
	import Icon from '$ui/components/Icon.svelte';
	import { confirmDialog } from '$ui/components/confirm-queue.ts';
	import { wipe } from '#lib/saved.ts';
	import { t } from '#lib/i18n.svelte.ts';
	import Idioma from '$ui/settings/Idioma.svelte';
	import KeyField from '$ui/settings/KeyField.svelte';
	import KeyRow from '$ui/settings/KeyRow.svelte';
	import { createKeysForm } from '$ui/settings/keys-form.svelte.ts';
	import Section from '$ui/settings/Section.svelte';
	import { COMMON_KEYS } from '$ui/settings/keys.ts';
	import { langOptions } from '#lib/langs.ts';
	import AdminCode from '#lib/AdminCode.svelte';
	import { saveNick } from '#lib/nick.ts';
	import { goto, invalidateAll } from '$app/navigation';
	import { page } from '$app/state';

	type Status = { tmdb: boolean; torbox: boolean; opensubtitles: boolean; opensubtitles_user: boolean; opensubtitles_pass: boolean };
	let status = $state<Status | null>(null);
	let osUser = $state('');
	let osPass = $state('');
	let loginOpen = $state(false);
	let loginBusy = $state(false);
	let loginMsg = $state('');
	let wiping = $state(false);
	const loginSaved = $derived(!!(status?.opensubtitles_user && status?.opensubtitles_pass));

	async function post(body: Record<string, string>): Promise<Status> {
		const r = await fetch('/api/keys', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
		const j = await r.json();
		if (!r.ok) throw new Error(j.message);
		return j;
	}
	const NAMES: Record<string, string> = { tmdb: 'la key de TMDB', torbox: 'la key de TorBox', opensubtitles: 'la key de OpenSubtitles.com', login: 'el usuario y la contraseña de OpenSubtitles.com' };
	/** Guardado por key contra /api/keys; el formulario compartido pone el estado y la confirmación. */
	const keysForm = createKeysForm({
		status: () => status ?? {},
		set: async (service, value) => void (status = await post({ [service]: value })),
		remove: async (service) => {
			if (!(await confirmDialog(t('Borrar'), t('¿Borrar {x}?', { x: t(NAMES[service]) }), [
				{ id: 'confirm-cancel', label: t('Cancelar'), value: false },
				{ id: 'confirm-ok', label: t('Borrar'), value: true, primary: true, danger: true },
			]))) return;
			status = await post({ [service]: '' });
		}
	});

	function toggleLogin() {
		loginOpen = !loginOpen;
		osUser = osPass = loginMsg = '';
	}
	async function saveLogin() {
		loginBusy = true;
		loginMsg = '';
		try {
			status = await post({ opensubtitles_user: osUser, opensubtitles_pass: osPass });
			osUser = osPass = '';
			loginOpen = false;
			loginMsg = t('Guardado.');
		} catch (err) {
			loginMsg = (err as Error).message;
		} finally {
			loginBusy = false;
		}
	}
	async function removeLogin() {
		if (!(await confirmDialog(t('Borrar'), t('¿Borrar {x}?', { x: t(NAMES.login) }), [
			{ id: 'confirm-cancel', label: t('Cancelar'), value: false },
			{ id: 'confirm-ok', label: t('Borrar'), value: true, primary: true, danger: true },
		]))) return;
		loginOpen = false;
		status = await post({ opensubtitles_user: '', opensubtitles_pass: '' });
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

</script>

<svelte:head><title>{t('Ajustes')} · Streamonte</title></svelte:head>

<header class="topbar">
	<div class="wrap row">
		<a id="back" class="btn-icon" href="/" aria-label={t('Volver')}><Icon name="back" /></a>
		<h1>{t('Ajustes')}</h1>
	</div>
</header>

<main class="wrap st">
	<Section id="set-profile" headId="h-profile" title={t('Perfil')}>
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
	</Section>

	<Idioma id="set-lang" headId="h-lang" pickerId="settings-lang" {...langOptions()} />

	<!-- Una sola lista: cada key se guarda sola (Enter o su botón); las que faltan muestran su campo, las guardadas "Cambiar". Mientras carga status no se muestra para no saltar. -->
	<section id="keys-form" class="st-sec" aria-labelledby="h-keys">
		<h2 class="st-h" id="h-keys">{t('Cuentas y keys')}</h2>
		{#if status}
			<ul id="saved-keys" class="st-list">
				{#each COMMON_KEYS as k (k.service)}
					<KeyField form={keysForm} service={k.service} name={k.name} hint={t(k.hint)} placeholder={k.placeholder} href={k.href} primary />
				{/each}
				<KeyRow service="login" name={t('Cuenta de OpenSubtitles.com')} hint={t('opcional')} has={loginSaved} editing={loginOpen} panelId="panel-login" onchange={toggleLogin}>
					{#if !loginSaved || loginOpen}
						<div id="panel-login" class="st-block">
							<div class="st-inline">
								<input id="os-user" class="st-input" type="text" autocomplete="off" autocapitalize="none" spellcheck="false" placeholder={status.opensubtitles_user ? t('Escribir otro para reemplazar') : t('Usuario')} aria-label={t('Usuario')} bind:value={osUser} />
								<input id="os-pass" class="st-input" type="password" autocomplete="off" placeholder={status.opensubtitles_pass ? t('Escribir otra para reemplazar') : t('Contraseña')} aria-label={t('Contraseña de OpenSubtitles.com')} bind:value={osPass} />
							</div>
							<div class="st-inline end">
								{#if status.opensubtitles_user || status.opensubtitles_pass}
									<button id="del-os-login" type="button" class="st-link danger" onclick={removeLogin}>{t('Borrar')}</button>
								{/if}
								<button id="save-login" class="st-btn go" type="button" disabled={loginBusy || !(osUser || osPass)} onclick={saveLogin}>
									{#if loginBusy}<span class="spin light"></span>{/if}{t('Guardar')}
								</button>
							</div>
						</div>
					{/if}
				</KeyRow>
			</ul>
			<p class="st-foot foot"><Icon name="lock" size={12} />{t('Quedan solo en el servidor')}</p>
			<p class="st-msg st-foot" role="status">{loginMsg}</p>
		{/if}
	</section>

	<Section id="set-data" headId="h-data" title={t('Datos')}>
		<div class="st-list">
			<div class="st-row">
				<span class="st-lbl"><span class="st-name">{t('Caché')}</span><span class="st-sub">{t('de este navegador')}</span></span>
				<button
					id="wipe-cache"
					class="st-btn"
					type="button"
					disabled={wiping}
					onclick={async () => {
						if (!(await confirmDialog(t('Borrar caché'), t('Se borra todo lo que la web guardó en este navegador: catálogo, fichas, opciones, filtros elegidos y tutoriales vistos. El código de acceso y las keys quedan. ¿Borrar?'), [
							{ id: 'confirm-cancel', label: t('Cancelar'), value: false },
							{ id: 'confirm-ok', label: t('Borrar'), value: true, primary: true, danger: true },
						]))) return;
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
	</Section>

	<p id="credits" class="credits">
		{t('Fichas, pósters y géneros:')} <a href="https://www.themoviedb.org/" target="_blank" rel="noopener noreferrer">TMDB</a>. {t('Este producto usa la API de TMDB, pero TMDB no lo respalda ni lo certifica.')}
		{t('Puntajes:')} <a href="https://developer.imdb.com/non-commercial-datasets/" target="_blank" rel="noopener noreferrer">{t('datasets de IMDb')}</a> {t('(uso personal, no comercial).')}
	</p>
</main>

<style>
	.row { display: flex; align-items: center; gap: 4px; margin-left: -10px; }
	h1 { margin: 0; font-size: 18px; }
	main { padding: 20px 16px 40px; max-width: 560px; }
	.grow { flex: 1; min-width: 0; justify-content: flex-end; }
	#nick-input { max-width: 260px; }
	.foot { display: inline-flex; align-items: center; gap: 5px; }
	.end { justify-content: flex-end; }
	.panel { transform-origin: top; animation: reveal 0.18s var(--out); }
	.admin-code { align-items: center; }
	.credits { margin: 4px 14px 0; font-size: 11.5px; line-height: 1.5; color: var(--muted); }
	.credits a { color: inherit; text-underline-offset: 2px; }
	@keyframes reveal { from { opacity: 0; transform: translateY(-4px); } }
	@media (prefers-reduced-motion: reduce) { .panel { animation: none; } }
</style>
