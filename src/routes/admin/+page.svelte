<script>
	import Icon from '#lib/Icon.svelte';

	let { data, form } = $props();

	/** Nombre corto del equipo a partir del user-agent. @param {string | null} ua */
	function equipo(ua) {
		if (!ua) return 'Desconocido';
		const os = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? (ua.match(/Android [^;]*;\s*([^;)]+)/)?.[1]?.replace(/ Build.*/, '') ?? 'Android') : /Mac OS X/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : 'Otro';
		const br = /EdgA?\//.test(ua) ? 'Edge' : /CriOS|Chrome\//.test(ua) ? 'Chrome' : /FxiOS|Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : '';
		return br ? `${os} · ${br}` : os;
	}
	/** @param {string | Date} d */
	const cuando = (d) => new Date(d).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
	const ICON = /** @type {Record<string, 'play' | 'search' | 'film' | 'link'>} */ ({ entrar: 'play', buscar: 'search', ver: 'film', 'copiar link': 'link' });
	const sel = $derived(data.dev ? data.dispositivos?.find((x) => x.dispositivo === data.dev) : null);
</script>

<svelte:head><title>Panel · Streamonte</title></svelte:head>

<main class="admin">
	<header class="top">
		<a id="admin-back" class="icon-btn" href={data.dev ? '/admin' : '/'} aria-label="Volver"><Icon name="back" /></a>
		<h1>Panel</h1>
	</header>

	{#if data.locked}
		<form id="admin-login" method="POST" class="login">
			<label for="admin-pass">Contraseña</label>
			<input id="admin-pass" name="pass" type="password" inputmode="numeric" autocomplete="current-password" />
			{#if form?.wrong}<p class="err" role="alert">Contraseña incorrecta</p>{/if}
			<button id="admin-enter" type="submit" class="btn">Entrar</button>
		</form>
	{:else if data.noDb}
		<p class="muted">Falta DATABASE_URL: no hay datos.</p>
	{:else if sel}
		<section class="card">
			<h2>{equipo(sel.equipo)}</h2>
			<p class="muted">Desde {cuando(sel.primera)} · {sel.entradas} entradas · {sel.acciones} acciones</p>
		</section>
		<ol class="feed">
			{#each data.eventos ?? [] as ev, i (i)}
				<li>
					<span class="ico"><Icon name={ICON[ev.accion] ?? 'list'} size={16} /></span>
					<span class="what"><b>{ev.accion}</b>{#if ev.dato}{' '}<span>{ev.dato}</span>{/if}</span>
					<time>{cuando(ev.fecha)}</time>
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
						<span class="name">{equipo(d.equipo)}</span>
						<span class="muted">{cuando(d.ultima)} · {d.entradas} entradas · {d.acciones} acciones</span>
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
	.login { display: flex; flex-direction: column; gap: 10px; max-width: 280px; }
	.login input { font-size: 18px; padding: 12px; border-radius: 12px; border: 1.5px solid var(--border-strong); background: var(--surface); color: var(--text); }
	.err { color: #e5484d; margin: 0; }
	.stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
	.stats div, .card { background: var(--surface); border-radius: 16px; padding: 14px; }
	.stats b { display: block; font-size: 26px; }
	.stats span { color: var(--muted); font-size: 13px; }
	ul, ol { list-style: none; margin: 0; padding: 0; }
	.days li { display: flex; justify-content: space-between; padding: 8px 2px; border-bottom: 1px solid var(--border-strong); font-size: 14px; }
	.devices li a { display: flex; flex-direction: column; gap: 2px; padding: 12px 14px; margin-bottom: 8px; background: var(--surface); border-radius: 14px; color: inherit; text-decoration: none; }
	.devices .name { font-weight: 650; }
	.feed { margin-top: 12px; }
	.feed li { display: grid; grid-template-columns: 24px 1fr auto; gap: 10px; align-items: start; padding: 10px 2px; border-bottom: 1px solid var(--border-strong); font-size: 14px; }
	.feed .ico { color: var(--muted); padding-top: 2px; }
	.feed .what span { color: var(--muted); overflow-wrap: anywhere; }
	.feed time { color: var(--muted); font-size: 12.5px; white-space: nowrap; }
</style>
