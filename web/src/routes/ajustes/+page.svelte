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
	import { logoutNick, myAnimals } from '#lib/apodo.svelte.ts';
	import { ANIMALS, type Animal } from '$ui/animals/animals.ts';
	import MyAnimals from '$ui/animals/MyAnimals.svelte';
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

	async function post(body: Record<string, string | undefined>): Promise<Status> {
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
			]))) return false;
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
			status = await post({ opensubtitles_user: osUser || undefined, opensubtitles_pass: osPass || undefined });
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
		loginMsg = '';
		try {
			status = await post({ opensubtitles_user: '', opensubtitles_pass: '' });
			loginOpen = false;
		} catch (err) {
			loginMsg = (err as Error).message;
		}
	}

	// Apodo: se cierra la sesión y se abre el mismo paso de la bienvenida (apodo + animales, lib/apodo.svelte.ts: el
	// layout lo abre solo al quedar sin apodo). Debajo, los 2 animales del dueño (/api/nick/animales).
	let nickMsg = $state('');
	let switching = $state(false);
	let animals = $state<Animal[] | null>(null);
	let animalsLoaded = $state(false);
	async function onSwitch() {
		switching = true;
		nickMsg = '';
		if (await logoutNick()) await invalidateAll();
		else nickMsg = t('No se pudo guardar. Probá de nuevo.');
		switching = false;
	}
	/** Cada vez que cambia el apodo (entrar con otro, o salir) se vuelven a pedir. */
	$effect(() => {
		animalsLoaded = false;
		animals = null;
		if (!page.data.nick) return;
		let live = true;
		myAnimals().then((ids) => {
			if (!live) return;
			animals = ids?.map((id) => ANIMALS.find((a) => a.id === id)).filter((a): a is Animal => !!a) ?? null;
			if (animals?.length !== 2) animals = null;
			animalsLoaded = true;
		});
		return () => (live = false);
	});

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
		<div class="st-list">
			<div class="st-row">
				<span class="st-name">{t('Apodo')}</span>
				<div class="st-inline grow">
					<b id="nick-current" class="nick-now">{page.data.nick ?? ''}</b>
					<button id="nick-switch" class="st-btn" type="button" disabled={switching} onclick={onSwitch}>
						{#if switching}<span class="spin light"></span>{/if}{t('Cambiar de usuario')}
					</button>
				</div>
			</div>
		</div>
		<p id="nick-msg" class="st-msg st-foot bad" role="status">{nickMsg}</p>
		{#if animals}
			<MyAnimals {animals} />
		{:else if animalsLoaded && page.data.nick}
			<p id="my-animals" class="st-msg st-foot">{t('Entrá de nuevo con tus animales para verlos acá')}</p>
		{/if}
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
	.nick-now { font-size: 14.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; margin-right: 10px; }
	.foot { display: inline-flex; align-items: center; gap: 5px; }
	.end { justify-content: flex-end; }
	.panel { transform-origin: top; animation: reveal 0.18s var(--out); }
	.admin-code { align-items: center; }
	.credits { margin: 4px 14px 0; font-size: 11.5px; line-height: 1.5; color: var(--muted); }
	.credits a { color: inherit; text-underline-offset: 2px; }
	@keyframes reveal { from { opacity: 0; transform: translateY(-4px); } }
	@media (prefers-reduced-motion: reduce) { .panel { animation: none; } }
</style>
