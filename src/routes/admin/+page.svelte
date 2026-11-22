<script>
	import Icon from '#lib/Icon.svelte';
	import { invalidateAll } from '$app/navigation';
	import { page } from '$app/state';
	import AdminCode from '#lib/AdminCode.svelte';

	/** @type {import('./$types').PageProps} */
	let { data } = $props();

	let loading = $state(false);
	/** Borrar usuario en dos toques: el primero arma (y avisa), el segundo borra; se desarma solo a los 4 s. */
	let arming = $state(false);
	/** @type {ReturnType<typeof setTimeout> | undefined} */
	let disarm;
	/** @param {MouseEvent} e */
	function armDelete(e) {
		if (arming) return;
		e.preventDefault();
		arming = true;
		clearTimeout(disarm);
		disarm = setTimeout(() => (arming = false), 4000);
	}
	async function refresh() {
		loading = true;
		await invalidateAll();
		loading = false;
	}

	/** Modelos de iPhone por tamaño de pantalla en puntos (lado corto x lado largo): Safari no dice el modelo. */
	const IPHONES = /** @type {Record<string, string>} */ ({
		'320x568': 'SE (1ª) / 5s',
		'375x667': 'SE / 6–8',
		'414x736': '6–8 Plus',
		'375x812': 'X / XS / 11 Pro / 12–13 mini',
		'414x896@2': 'XR / 11',
		'414x896@3': 'XS Max / 11 Pro Max',
		'390x844': '12–14 / 16e',
		'428x926': '12–13 Pro Max / 14 Plus',
		'393x852': '14 Pro / 15 / 15 Pro / 16',
		'430x932': '14 Pro Max / 15 Plus / 15 Pro Max / 16 Plus',
		'402x874': '16 Pro / 17 / 17 Pro',
		'420x912': 'Air',
		'440x956': '16 Pro Max / 17 Pro Max'
	});
	/** @param {string | null} pantalla `393x852@3` */
	function iphone(pantalla) {
		const m = pantalla?.match(/^(\d+)x(\d+)@(\d+)/);
		if (!m) return 'iPhone';
		const [a, b] = [Number(m[1]), Number(m[2])].sort((x, y) => x - y);
		const name = IPHONES[`${a}x${b}@${m[3]}`] ?? IPHONES[`${a}x${b}`];
		return name ? `iPhone ${name}` : 'iPhone';
	}

	/** Nombre corto del equipo a partir del user-agent (y la pantalla, para el iPhone). @param {string | null} ua @param {string | null} [pantalla] */
	function equipo(ua, pantalla = null) {
		if (!ua) return 'Desconocido';
		// Safari congela la versión de iOS en el user-agent; la real va en `Version/`.
		const ios = ua.match(/Version\/(\d+)/)?.[1] ?? ua.match(/OS (\d+)_/)?.[1];
		const os = /iPhone/.test(ua) ? `${iphone(pantalla)}${ios ? ` · iOS ${ios}` : ''}` : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? (ua.match(/Android [^;]*;\s*([^;)]+)/)?.[1]?.replace(/ Build.*/, '') ?? 'Android') : /Mac OS X/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : 'Otro';
		const br = /EdgA?\//.test(ua) ? 'Edge' : /CriOS|Chrome\//.test(ua) ? 'Chrome' : /FxiOS|Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : '';
		return br ? `${os} · ${br}` : os;
	}
	const AR = 'America/Argentina/Buenos_Aires';
	/** Fecha y hora en una zona (la de Argentina por defecto: igual en el servidor y en el navegador).
	 * @param {string | Date} d @param {string} [tz] */
	const cuando = (d, tz = AR) => {
		try {
			return new Date(d).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: tz });
		} catch {
			return '';
		}
	};
	/** La hora local del usuario, solo si su zona no da la misma que Argentina. @param {string | Date} d @param {string | null | undefined} zona */
	const local = (d, zona) => {
		const l = zona ? cuando(d, zona) : '';
		return l && l !== cuando(d) ? l : '';
	};
	/** Hace cuánto. @param {string | Date} d */
	function hace(d) {
		const m = Math.round((Date.now() - new Date(d).getTime()) / 60_000);
		if (m < 1) return 'recién';
		if (m < 60) return `hace ${m} min`;
		const h = Math.round(m / 60);
		return h < 24 ? `hace ${h} h` : `hace ${Math.round(h / 24)} d`;
	}
	/** Un "copiar link": `título · calidad · Latino|Original · TV|Celu` (los viejos no traen el audio y dicen
	 * `dispositivo` en vez de `Celu`). @param {string | null} dato */
	function repro(dato) {
		const p = (dato ?? '').split(' · ');
		return { titulo: p[0] || '?', calidad: p[1] || '?', audio: p.length >= 4 ? p[2] : '—', donde: p.at(-1) === 'TV' ? 'TV' : 'Celu' };
	}
	/** @param {{equipo: string | null, pantalla: string | null}} d */
	const corto = (d) => equipo(d.equipo, d.pantalla).split(' · ')[0];
	/** Nombre de una fila de la lista: el apodo o, si nunca puso uno, su equipo. @param {NonNullable<typeof data.usuarios>[number]} d */
	const nombre = (d) => d.apodo ?? `Sin apodo · ${corto(d)}`;
	const ICON = /** @type {Record<string, import('svelte').ComponentProps<typeof Icon>['name']>} */ ({
		entrar: 'next',
		buscar: 'search',
		ver: 'film',
		conexión: 'wifi',
		audio: 'volume',
		analizar: 'help',
		'se cortó': 'stop',
		'copiar link': 'link',
		filtro: 'sliders',
		subtítulo: 'subs',
		'abrió en la tele': 'tv',
		'play en la tele': 'play'
	});
	/** Usuario abierto (`?u=apodo` o `?d=dispositivo` si no tiene apodo): sus dispositivos, el más reciente primero. */
	const equipos = $derived(data.equipos?.length ? data.equipos : null);
	const titulo = $derived(data.nick ?? (equipos ? `Sin apodo · ${corto(equipos[0])}` : ''));
	const base = $derived(data.nick ? `/admin?u=${encodeURIComponent(data.nick)}` : `/admin?d=${data.dev}`);
	/** @typedef {{id: number, accion: string, dato: string | null, fecha: string, dispositivo: string, zona: string | null}} Ev */
	/** Zona del evento o, en los viejos que no la traen, la última de su dispositivo. @param {Ev} ev */
	const zonaDe = (ev) => ev.zona ?? equipos?.find((e) => e.dispositivo === ev.dispositivo)?.zona;
	/** Historial del usuario con cada "ver" agrupando sus pasos (conexión, audio, link, subs, tele) hasta que vuelve
	 * a entrar, buscar, filtrar o abre otro título. Más nuevo arriba. */
	const items = $derived.by(() => {
		/** @type {(Ev & {pasos?: Ev[]})[]} */
		const out = [];
		/** @type {(Ev & {pasos: Ev[]}) | null} */
		let cur = null;
		for (const ev of [...(data.eventos ?? [])].reverse()) {
			if (ev.accion === 'ver') out.push((cur = { ...ev, pasos: [] }));
			else if (cur && ev.accion !== 'entrar' && ev.accion !== 'buscar' && ev.accion !== 'filtro') cur.pasos.push(ev);
			else {
				cur = null;
				out.push(ev);
			}
		}
		return out.reverse();
	});
	const vid = $derived(Number(page.url.searchParams.get('v')) || null);
	const reproducciones = $derived((data.eventos ?? []).filter((ev) => ev.accion === 'copiar link'));
	// Orden del detalle: reproducciones, pelis/series que abrió, filtros y búsquedas, y el resto.
	const vistos = $derived(items.filter((x) => x.pasos));
	const busquedas = $derived(items.filter((x) => !x.pasos && (x.accion === 'buscar' || x.accion === 'filtro')));
	const resto = $derived(items.filter((x) => !x.pasos && x.accion !== 'buscar' && x.accion !== 'filtro'));
	const primera = $derived(equipos ? equipos.reduce((a, e) => (e.primera < a ? e.primera : a), equipos[0].primera) : '');
	const open = $derived(vid ? items.find((x) => x.id === vid) : null);
</script>

<svelte:head><title>Panel · Streamonte</title></svelte:head>

<main class="admin">
	<header class="top">
		<a id="admin-back" class="icon-btn" href={open ? base : equipos ? '/admin' : '/'} aria-label="Volver"><Icon name="back" /></a>
		<nav class="crumbs" aria-label="Ubicación">
			{#if equipos}
				<a id="crumb-panel" href="/admin">Panel</a>
				<span aria-hidden="true">›</span>
				{#if open}
					<a id="crumb-user" href={base}>{titulo}</a>
					<span aria-hidden="true">›</span>
					<b>{open.dato?.replace(/^(Peli|Serie): /, '')}</b>
				{:else}
					<b>{titulo}</b>
				{/if}
			{:else}
				<h1>Panel</h1>
			{/if}
		</nav>
		{#if !data.locked}
			<button id="admin-refresh" type="button" class="icon-btn refresh" class:spin={loading} aria-label="Actualizar" onclick={refresh} disabled={loading}><Icon name="refresh" /></button>
		{/if}
	</header>

	{#if data.locked}
		<div class="login"><p class="muted">Código del panel</p><AdminCode id="admin-pass" wait={data.wait} /></div>
	{:else if data.noDb}
		<p class="muted">Falta DATABASE_URL: no hay datos.</p>
	{:else if equipos && open}
		<section class="card">
			<h2>{open.dato}</h2>
			<p class="muted">{cuando(open.fecha)} · {open.pasos?.length ?? 0} pasos</p>
		</section>
		<ol class="feed">
			{#each open.pasos ?? [] as ev (ev.id)}
				<li>
					<span class="ico"><Icon name={ICON[ev.accion] ?? 'next'} size={16} /></span>
					<span class="what"><b>{ev.accion}</b>{#if ev.dato}{' '}<span>{ev.dato}</span>{/if}</span>
					{@render hora(ev.fecha, zonaDe(ev))}
				</li>
			{:else}
				<li class="muted">Abrió la ficha y no hizo nada más.</li>
			{/each}
		</ol>
	{:else if equipos}
		<section class="card">
			<h2>{titulo}</h2>
			<p class="muted">Desde {cuando(primera)} · {reproducciones.length} {reproducciones.length === 1 ? 'reproducción' : 'reproducciones'} · {equipos.length} {equipos.length === 1 ? 'dispositivo' : 'dispositivos'}</p>
			<form method="POST" action="?/borrar" class="del-form">
				{#if data.nick}<input type="hidden" name="u" value={data.nick} />{:else}<input type="hidden" name="d" value={data.dev} />{/if}
				<button id="user-delete" type="submit" class="del" class:arming onclick={armDelete}>
					<Icon name="close" size={14} />{arming ? 'Tocá de nuevo para borrar todo' : 'Borrar usuario'}
				</button>
				{#if arming}<span class="muted del-note">Se borra todo lo registrado de este usuario. No se puede deshacer.</span>{/if}
			</form>
		</section>
		{#if reproducciones.length}
			<h2>Reproducciones</h2>
			<ul class="plays">
				{#each reproducciones as ev (ev.id)}
					{@const r = repro(ev.dato)}
					<li>
						<span class="what"><b>{r.titulo}</b><span>{r.calidad} · {r.audio} · {r.donde}</span></span>
						{@render hora(ev.fecha, zonaDe(ev))}
					</li>
				{/each}
			</ul>
		{/if}
		{#if vistos.length}
			<h2>Pelis y series que abrió</h2>
			<ol class="feed">
				{#each vistos as ev (ev.id)}
					<li>
						<a id="ev-{ev.id}" class="row" href="{base}&v={ev.id}">
							<span class="ico"><Icon name={ev.dato?.startsWith('Serie') ? 'tv' : 'film'} size={16} /></span>
							<span class="what"><b>{ev.dato?.replace(/^(Peli|Serie): /, '') ?? '?'}</b>{#if ev.pasos?.length}<em>{ev.pasos.length} pasos</em>{/if}</span>
							{@render hora(ev.fecha, zonaDe(ev))}
							<span class="go" aria-hidden="true"><Icon name="chev" size={16} /></span>
						</a>
					</li>
				{/each}
			</ol>
		{/if}
		{#if busquedas.length}
			<h2>Filtros y búsquedas</h2>
			<ol class="feed">
				{#each busquedas as ev (ev.id)}
					<li>{@render fila(ev)}</li>
				{/each}
			</ol>
		{/if}
		{#if resto.length}
			<h2>Otra actividad</h2>
			<ol class="feed">
				{#each resto as ev (ev.id)}
					<li>{@render fila(ev)}</li>
				{/each}
			</ol>
		{/if}
		<h2>{equipos.length === 1 ? 'Dispositivo' : 'Dispositivos'}</h2>
		<ul class="equipos">
			{#each equipos as e (e.dispositivo)}
				<li class="card">
					<b>{equipo(e.equipo, e.pantalla)}{#if e.modelo}{` · ${e.modelo}`}{/if}</b>
					{#if e.lugar}<p class="muted">{e.lugar}</p>{/if}
					{#if e.zona}<p class="muted">{e.zona} · ahora son las {cuando(new Date(), e.zona).split(' ').at(-1)}</p>{/if}
					<p class="muted">Desde {cuando(e.primera)} · {hace(e.ultima)} · {e.entradas} entradas · {e.acciones} acciones</p>
				</li>
			{/each}
		</ul>
	{:else}
		<section class="stats">
			<div><b>{data.resumen?.usuarios ?? 0}</b><span>usuarios</span></div>
			<div><b>{data.resumen?.activos ?? 0}</b><span>activos 24 h</span></div>
			<div><b>{data.resumen?.reproducciones ?? 0}</b><span>reproducciones</span></div>
		</section>
		<!-- Entradas: contadas pero en segundo plano (cada recarga suma una). -->
		<p class="muted entradas">{data.resumen?.entradas ?? 0} entradas · {data.resumen?.hoy ?? 0} en 24 h</p>

		<h2>Usuarios</h2>
		<ul class="devices">
			{#each data.usuarios ?? [] as d (d.apodo ?? d.dispositivo)}
				<li>
					<a id="user-{d.apodo?.replace(/ /g, '-') ?? d.dispositivo}" href={d.apodo ? `/admin?u=${encodeURIComponent(d.apodo)}` : `/admin?d=${d.dispositivo}`}>
						<span class="info">
							<span class="name">{nombre(d)}</span>
							<span class="muted">{hace(d.ultima)} · {d.reproducciones} {d.reproducciones === 1 ? 'reproducción' : 'reproducciones'}{#if d.dispositivos > 1}{` · ${d.dispositivos} dispositivos`}{/if}</span>
							{#if d.ultimo}<span class="muted last">Último: {repro(d.ultimo).titulo}</span>{/if}
						</span>
						<span class="go" aria-hidden="true"><Icon name="chev" size={18} /></span>
					</a>
				</li>
			{:else}
				<li class="muted">Todavía nadie.</li>
			{/each}
		</ul>

		{#if data.dias?.length}
			<h2>Entradas por día</h2>
			<ul class="days">
				{#each data.dias as d (d.dia)}
					<li><span>{d.dia}</span><span>{d.entradas} entradas · {d.usuarios} {d.usuarios === 1 ? 'usuario' : 'usuarios'}</span></li>
				{/each}
			</ul>
		{/if}
	{/if}
</main>

<!-- Hora de Argentina y, debajo, la local del usuario si vive en otra zona. -->
{#snippet hora(/** @type {string} */ fecha, /** @type {string | null | undefined} */ zona)}
	{@const l = local(fecha, zona)}
	<time>{cuando(fecha)}{#if l}<small>{l} local</small>{/if}</time>
{/snippet}

<!-- Un evento suelto; el único 'entrar' que llega es el primero del usuario. -->
{#snippet fila(/** @type {Ev} */ ev)}
	<div class="row">
		{#if ev.accion === 'entrar'}
			<span class="ico"><Icon name="user" size={16} /></span>
			<span class="what"><b>Usuario nuevo</b></span>
		{:else}
			<span class="ico"><Icon name={ICON[ev.accion] ?? 'next'} size={16} /></span>
			<span class="what"><b>{ev.accion}</b>{#if ev.dato}{' '}<span>{ev.dato}</span>{/if}</span>
		{/if}
		{@render hora(ev.fecha, zonaDe(ev))}
		<span></span>
	</div>
{/snippet}

<style>
	.admin { max-width: 640px; margin: 0 auto; padding: calc(env(safe-area-inset-top) + 12px) 16px 48px; }
	.top { display: flex; align-items: center; gap: 10px; margin-bottom: 16px; }
	h1 { font-size: 22px; margin: 0; }
	h2 { font-size: 15px; color: var(--muted); margin: 24px 0 8px; font-weight: 650; }
	.card h2 { color: var(--text); margin: 0 0 4px; font-size: 18px; }
	.muted { color: var(--muted); font-size: 13.5px; }
	.refresh { margin-left: auto; }
	.refresh.spin :global(svg) { animation: spin 0.8s linear infinite; }
	@keyframes spin { to { transform: rotate(360deg); } }
	.login { display: flex; flex-direction: column; align-items: center; gap: 12px; margin-top: 32px; }
	.stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
	.stats div, .card { background: var(--surface); border-radius: 16px; padding: 14px; }
	.card p { margin: 2px 0 0; }
	.del-form { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 10px; margin-top: 12px; }
	.del { display: inline-flex; align-items: center; gap: 6px; min-height: 36px; padding: 0 12px; border: 1px solid var(--border-strong); border-radius: 10px; background: none; color: var(--muted); font: inherit; font-size: 13.5px; font-weight: 600; cursor: pointer; transition: background 0.2s var(--ease), color 0.2s var(--ease), border-color 0.2s var(--ease); }
	.del:hover { color: var(--red); border-color: color-mix(in srgb, var(--red) 50%, transparent); }
	.del.arming { color: #fff; background: var(--red); border-color: var(--red); animation: arm 0.35s var(--out); }
	.del-note { font-size: 12.5px; animation: arm 0.35s var(--out); }
	@keyframes arm { from { opacity: 0.6; transform: scale(0.97); } }
	@media (prefers-reduced-motion: reduce) { .del.arming, .del-note { animation: none; } }
	.stats b { display: block; font-size: 26px; }
	.stats span { color: var(--muted); font-size: 13px; }
	ul, ol { list-style: none; margin: 0; padding: 0; }
	.days li { display: flex; justify-content: space-between; padding: 8px 2px; border-bottom: 1px solid var(--border-strong); font-size: 14px; }
	.devices li a { display: flex; align-items: center; gap: 10px; padding: 12px 14px; margin-bottom: 8px; background: var(--surface); border-radius: 14px; color: inherit; text-decoration: none; }
	.devices .info { display: flex; flex-direction: column; gap: 2px; flex: 1; min-width: 0; }
	.devices .name { font-weight: 650; }
	.devices .go { color: var(--muted); transform: rotate(-90deg); display: grid; }
	.feed { margin-top: 12px; }
	.feed > li { border-bottom: 1px solid var(--border-strong); font-size: 14px; }
	.feed .row, .feed > li:not(:has(.row)) { display: grid; grid-template-columns: 24px 1fr auto 16px; gap: 10px; align-items: start; padding: 10px 2px; color: inherit; text-decoration: none; }
	.feed > li:not(:has(.row)) { grid-template-columns: 24px 1fr auto; }
	.feed .what em { display: block; font-style: normal; font-size: 12.5px; color: var(--accent-fg, var(--accent)); margin-top: 2px; }
	.feed .go { color: var(--muted); transform: rotate(-90deg); display: grid; align-self: center; }
	.crumbs { display: flex; align-items: center; gap: 6px; min-width: 0; font-size: 15px; white-space: nowrap; overflow: hidden; }
	.crumbs a { color: var(--muted); text-decoration: none; }
	.crumbs b { overflow: hidden; text-overflow: ellipsis; }
	.crumbs span { color: var(--muted); }
	.feed .ico { color: var(--muted); padding-top: 2px; }
	.feed .what span { color: var(--muted); overflow-wrap: anywhere; }
	.feed time, .plays time { color: var(--muted); font-size: 12.5px; white-space: nowrap; text-align: right; }
	time small { display: block; font-size: 11.5px; opacity: 0.8; }
	.devices .last { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.plays li { display: flex; align-items: start; justify-content: space-between; gap: 12px; padding: 10px 2px; border-bottom: 1px solid var(--border-strong); font-size: 14px; }
	.plays .what { display: flex; flex-direction: column; min-width: 0; }
	.plays .what span { color: var(--muted); font-size: 13px; }
	.entradas { margin: 8px 2px 0; }
	.equipos li { margin-bottom: 8px; font-size: 14px; }
</style>
