<script lang="ts">
	import { onMount } from 'svelte';
	import Icon from '$ui/components/Icon.svelte';
	import { confirmDialog } from '$ui/components/confirm-queue.ts';
	import { wipe } from '#lib/saved.ts';
	import { i18n, t } from '#lib/i18n.svelte.ts';
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
	import Board, { type BoardTile } from '$ui/settings/board/Board.svelte';
	import KeysArt from '$ui/settings/board/art/KeysArt.svelte';
	import LangArt from '$ui/settings/board/art/LangArt.svelte';
	import Plate from '$ui/settings/board/art/Plate.svelte';
	import CacheArt from '$ui/settings/board/art/CacheArt.svelte';
	import AnimalFan from '$ui/settings/board/art/AnimalFan.svelte';

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

	// Tablero: cada ficha muestra el estado de un vistazo y su panel lleva las filas de siempre.
	const keyChips = $derived([
		...COMMON_KEYS.map((k) => ({ name: k.name, on: !!status?.[k.service] })),
		{ name: t('Cuenta de OpenSubtitles.com'), on: loginSaved }
	]);
	const keysSaved = $derived(keyChips.filter((c) => c.on).length);
	const tiles = $derived<BoardTile[]>([
		{ id: 'keys', label: t('Llaves'), title: t('Llaves y cuentas'), icon: 'key', summary: keysSummary, art: keysHeroArt, hero: t('Ninguna es obligatoria: cada una suma algo.'), panel: keysPanel },
		{ id: 'profile', label: t('Perfil'), icon: 'user', summary: profileSummary, art: profileHeroArt, hero: t('Tu clave para entrar son estos 2 animales.'), panel: profilePanel },
		{ id: 'lang', label: t('Idioma'), icon: 'globe', summary: langSummary, art: langHeroArt, hero: t('La app y los títulos van por separado.'), panel: langPanel },
		{ id: 'data', label: t('Datos'), icon: 'folder', summary: dataSummary, art: dataHeroArt, hero: t('Caché, privacidad y panel de uso.'), panel: dataPanel }
	]);

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

{#snippet keysSummary()}
	<span class="board-b row">
		<span class="w-keys"><KeysArt on={keyChips.map((c) => c.on)} /></span>
		<span class="b-i">
			{#if status}<span class="b-big">{t('{n} de {m} guardadas', { n: keysSaved, m: keyChips.length })}</span>{/if}
			<span class="b-chips">
				{#each keyChips as c (c.name)}<span class="b-chip" class:on={c.on}><i></i>{c.name}</span>{/each}
			</span>
		</span>
	</span>
{/snippet}
{#snippet keysHeroArt()}<KeysArt on={keyChips.map((c) => c.on)} />{/snippet}
{#snippet keysPanel()}
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
{/snippet}

{#snippet profileSummary()}
	<span class="board-b">
		<span class="b-i"><span class="b-big nick-big">{page.data.nick ?? ''}</span><span class="b-sub">{t('Tu clave: estos 2')}</span></span>
		{#if animals}<AnimalFan {animals} />{/if}
	</span>
{/snippet}
{#snippet profileHeroArt()}<span class="hero-user"><Icon name="user" size={48} /></span>{/snippet}
{#snippet profilePanel()}
	<Section id="set-profile" headId="h-profile" title={t('Perfil')}>
		<div class="nick-card">
			<span class="nick-ava" aria-hidden="true">{(page.data.nick ?? '?').slice(0, 1).toUpperCase()}</span>
			<span class="nick-txt"><span class="nick-lbl">{t('Apodo')}</span><b id="nick-current">{page.data.nick ?? ''}</b></span>
			<button id="nick-switch" class="st-btn" type="button" disabled={switching} onclick={onSwitch}>
				{#if switching}<span class="spin light"></span>{/if}{t('Cambiar de usuario')}
			</button>
		</div>
		<p id="nick-msg" class="st-msg st-foot bad" role="status">{nickMsg}</p>
		{#if animals}
			<MyAnimals {animals} />
		{:else if animalsLoaded && page.data.nick}
			<p id="my-animals" class="st-msg st-foot">{t('Entrá de nuevo con tus animales para verlos acá')}</p>
		{/if}
	</Section>
{/snippet}

{#snippet langSummary()}
	<span class="board-b row stack">
		<span class="w-lang"><LangArt /></span>
		<span class="b-i">
			<Plate titles={i18n.titles} />
			<span class="b-sub">{t('Así se ven los títulos')}</span>
			<span class="b-row"><span class="b-stt">{t('App')}: {i18n.lang === 'es' ? 'Español' : 'English'}</span></span>
		</span>
	</span>
{/snippet}
{#snippet langHeroArt()}<LangArt />{/snippet}
{#snippet langPanel()}
	<Idioma id="set-lang" headId="h-lang" pickerId="settings-lang" {...langOptions()} />
{/snippet}

{#snippet dataSummary()}
	<span class="board-b row">
		<span class="w-data"><CacheArt fill={0.35} /></span>
		<span class="b-i"><span class="b-big">{t('Caché')}</span><span class="b-sub">{t('de este navegador')}</span><span class="b-sub">{t('Se vuelve a llenar sola')}</span></span>
	</span>
{/snippet}
{#snippet dataHeroArt()}<CacheArt fill={0.35} />{/snippet}
{#snippet dataPanel()}
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
{/snippet}

<main class="wrap st">
	<div class="frost-page">
		<Board {tiles} areas="'keys keys profile' 'lang data profile'" areasNarrow="'keys keys' 'profile profile' 'lang data'" />
	</div>

	<p id="credits" class="credits">
		{t('Fichas, pósters y géneros:')} <a href="https://www.themoviedb.org/" target="_blank" rel="noopener noreferrer">TMDB</a>. {t('Este producto usa la API de TMDB, pero TMDB no lo respalda ni lo certifica.')}
		{t('Puntajes:')} <a href="https://developer.imdb.com/non-commercial-datasets/" target="_blank" rel="noopener noreferrer">{t('datasets de IMDb')}</a> {t('(uso personal, no comercial).')}
	</p>
</main>

<style>
	.row { display: flex; align-items: center; gap: 4px; margin-left: -10px; }
	h1 { margin: 0; font-size: 18px; }
	main { padding: 20px 16px 40px; max-width: 780px; }
	.frost-page { position: relative; padding: 12px; border-radius: 30px; background: rgb(17 21 28 / 0.6); border: 1px solid rgb(255 255 255 / 0.08); box-shadow: 0 40px 90px -30px rgb(0 0 0 / 0.85), inset 0 1px 0 rgb(255 255 255 / 0.08); backdrop-filter: blur(34px) saturate(1.5); -webkit-backdrop-filter: blur(34px) saturate(1.5); margin-bottom: 18px; }
	.frost-page :global(.board:has(.board-panel)) { min-height: 620px; }
	.frost-page :global(.b-chip) { max-width: 100%; overflow: hidden; text-overflow: ellipsis; }
	.w-keys { flex: none; width: 36%; max-width: 200px; }
	.w-keys :global(svg), .w-lang :global(svg), .w-data :global(svg) { display: block; width: 100%; height: auto; }
	.hero-user { display: grid; place-items: center; width: 100%; height: 100%; color: var(--muted); }
	.w-lang { flex: none; width: 42%; max-width: 120px; }
	.w-data { flex: none; width: 56px; }
	.nick-big { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.foot { display: inline-flex; align-items: center; gap: 5px; }
	.end { justify-content: flex-end; }
	.panel { transform-origin: top; animation: reveal 0.18s var(--out); }
	.admin-code { align-items: center; }
	.credits { margin: 4px 14px 0; font-size: 11.5px; line-height: 1.5; color: var(--muted); }
	.credits a { color: inherit; text-underline-offset: 2px; }
	@keyframes reveal { from { opacity: 0; transform: translateY(-4px); } }
	@media (prefers-reduced-motion: reduce) { .panel { animation: none; } }
</style>
