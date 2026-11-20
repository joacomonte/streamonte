<script>
	import Icon from '#lib/Icon.svelte';
	import { invalidateAll } from '$app/navigation';
	import { page } from '$app/state';
	import AdminCode from '#lib/AdminCode.svelte';

	let { data } = $props();

	let loading = $state(false);
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
	/** @param {string | Date} d */
	const cuando = (d) => new Date(d).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
	const ICON = /** @type {Record<string, import('svelte').ComponentProps<typeof Icon>['name']>} */ ({
		entrar: 'next',
		buscar: 'search',
		ver: 'film',
		conexión: 'wifi',
		audio: 'volume',
		analizar: 'help',
		'se cortó': 'stop',
		'copiar link': 'link',
		subtítulo: 'subs',
		'abrió en la tele': 'tv',
		'play en la tele': 'play'
	});
	const sel = $derived(data.dev ? data.dispositivos?.find((x) => x.dispositivo === data.dev) : null);
	/** @typedef {{id: number, accion: string, dato: string | null, fecha: string}} Ev */
	/** Historial del dispositivo con cada "ver" agrupando sus pasos (conexión, audio, link, subs, tele) hasta que vuelve
	 * a entrar, buscar o abre otro título. Más nuevo arriba. */
	const items = $derived.by(() => {
		/** @type {(Ev & {pasos?: Ev[]})[]} */
		const out = [];
		/** @type {(Ev & {pasos: Ev[]}) | null} */
		let cur = null;
		for (const ev of [...(data.eventos ?? [])].reverse()) {
			if (ev.accion === 'ver') out.push((cur = { ...ev, pasos: [] }));
			else if (cur && ev.accion !== 'entrar' && ev.accion !== 'buscar') cur.pasos.push(ev);
			else {
				cur = null;
				out.push(ev);
			}
		}
		return out.reverse();
	});
	const vid = $derived(Number(page.url.searchParams.get('v')) || null);
	const open = $derived(vid ? items.find((x) => x.id === vid) : null);
</script>

<svelte:head><title>Panel · Streamonte</title></svelte:head>

<main class="admin">
	<header class="top">
		<a id="admin-back" class="icon-btn" href={open ? `/admin?d=${data.dev}` : data.dev ? '/admin' : '/'} aria-label="Volver"><Icon name="back" /></a>
		<nav class="crumbs" aria-label="Ubicación">
			{#if sel}
				<a id="crumb-panel" href="/admin">Panel</a>
				<span aria-hidden="true">›</span>
				{#if open}
					<a id="crumb-dev" href="/admin?d={data.dev}">{equipo(sel.equipo, sel.pantalla).split(' · ')[0]}</a>
					<span aria-hidden="true">›</span>
					<b>{open.dato?.replace(/^(Peli|Serie): /, '')}</b>
				{:else}
					<b>{equipo(sel.equipo, sel.pantalla).split(' · ')[0]}</b>
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
		<div class="login"><p class="muted">Código del panel</p><AdminCode id="admin-pass" /></div>
	{:else if data.noDb}
		<p class="muted">Falta DATABASE_URL: no hay datos.</p>
	{:else if sel && open}
		<section class="card">
			<h2>{open.dato}</h2>
			<p class="muted">{cuando(open.fecha)} · {open.pasos?.length ?? 0} pasos</p>
		</section>
		<ol class="feed">
			{#each open.pasos ?? [] as ev (ev.id)}
				<li>
					<span class="ico"><Icon name={ICON[ev.accion] ?? 'next'} size={16} /></span>
					<span class="what"><b>{ev.accion}</b>{#if ev.dato}{' '}<span>{ev.dato}</span>{/if}</span>
					<time>{cuando(ev.fecha)}</time>
				</li>
			{:else}
				<li class="muted">Abrió la ficha y no hizo nada más.</li>
			{/each}
		</ol>
	{:else if sel}
		<section class="card">
			<h2>{equipo(sel.equipo, sel.pantalla)}</h2>
			{#if sel.lugar}<p class="muted">{sel.lugar}</p>{/if}
			<p class="muted">Desde {cuando(sel.primera)} · {sel.entradas} entradas · {sel.acciones} acciones</p>
		</section>
		<ol class="feed">
			{#each items as ev (ev.id)}
				<li>
					{#if ev.pasos}
						<a id="ev-{ev.id}" class="row" href="/admin?d={data.dev}&v={ev.id}">
							<span class="ico"><Icon name="film" size={16} /></span>
							<span class="what"><b>{ev.accion}</b>{' '}<span>{ev.dato}</span>{#if ev.pasos.length}<em>{ev.pasos.length} pasos</em>{/if}</span>
							<time>{cuando(ev.fecha)}</time>
							<span class="go" aria-hidden="true"><Icon name="chev" size={16} /></span>
						</a>
					{:else}
						<div class="row">
							<span class="ico"><Icon name={ICON[ev.accion] ?? 'next'} size={16} /></span>
							<span class="what"><b>{ev.accion}</b>{#if ev.dato && ev.accion !== 'entrar'}{' '}<span>{ev.dato}</span>{/if}</span>
							<time>{cuando(ev.fecha)}</time>
							<span></span>
						</div>
					{/if}
				</li>
			{/each}
		</ol>
	{:else}
		<section class="stats">
			<div><b>{data.resumen?.entradas ?? 0}</b><span>entradas</span></div>
			<div><b>{data.resumen?.hoy ?? 0}</b><span>últimas 24 h</span></div>
			<div><b>{data.resumen?.dispositivos ?? 0}</b><span>dispositivos</span></div>
		</section>

		{#if data.dias?.length}
			<h2>Por día</h2>
			<ul class="days">
				{#each data.dias as d (d.dia)}
					<li><span>{d.dia}</span><span>{d.entradas} entradas · {d.dispositivos} disp.</span></li>
				{/each}
			</ul>
		{/if}

		<h2>Dispositivos</h2>
		<ul class="devices">
			{#each data.dispositivos ?? [] as d (d.dispositivo)}
				<li>
					<a id="dev-{d.dispositivo}" href="/admin?d={d.dispositivo}">
						<span class="info">
							<span class="name">{equipo(d.equipo, d.pantalla)}</span>
							{#if d.lugar}<span class="muted">{d.lugar}</span>{/if}
							<span class="muted">{cuando(d.ultima)} · {d.entradas} entradas · {d.acciones} acciones</span>
						</span>
						<span class="go" aria-hidden="true"><Icon name="chev" size={18} /></span>
					</a>
				</li>
			{:else}
				<li class="muted">Todavía nadie.</li>
			{/each}
		</ul>
	{/if}
</main>

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
	.feed time { color: var(--muted); font-size: 12.5px; white-space: nowrap; }
</style>
