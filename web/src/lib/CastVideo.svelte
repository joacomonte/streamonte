<!-- Tutorial "cómo verlo en la tele" tipo historia: un celu dibujado (HTML/CSS, sin capturas) que recorre Web Video
     Caster pantalla por pantalla, ~3 s cada una, con el toque animado sobre lo que hay que tocar. Tocar a la
     izquierda/derecha vuelve/avanza. Al final: repetir o bajar la app. Las etiquetas de la app van en inglés, como se ve. -->
<script lang="ts">
	import Icon from '$ui/components/Icon.svelte';
	import { casterFor, device } from '$ui/components/tours.ts';
	import { t as tr } from './i18n.svelte.ts';

	let { onclose }: { onclose: () => void } = $props();

	const SCENE_MS = 2500;
	const CAPTIONS = [
		() => tr('Abrí Web Video Caster'),
		() => tr('Tocá la barra de arriba y elegí Pegar'),
		() => tr('Tocá el ▶ amarillo'),
		() => tr('Tocá el video de Streamonte'),
		() => tr('Tocá Connect'),
		() => tr('Elegí tu tele ¡y listo!')
	];
	const store = casterFor(device());

	let dialog = $state<HTMLDialogElement>();
	/** Escena actual; CAPTIONS.length = cartel final. */
	let at = $state(0);
	const done = $derived(at >= CAPTIONS.length);

	$effect(() => {
		dialog?.showModal();
	});
	// Avanza sola; tocar reinicia el conteo de la escena nueva.
	$effect(() => {
		if (at >= CAPTIONS.length) return;
		const id = setTimeout(() => at++, SCENE_MS);
		return () => clearTimeout(id);
	});

	function tap(e: MouseEvent) {
		const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
		at = e.clientX - r.left < r.width / 3 ? Math.max(0, at - 1) : Math.min(CAPTIONS.length, at + 1);
	}
	function key(e: KeyboardEvent) {
		if (e.key === 'ArrowRight') at = Math.min(CAPTIONS.length, at + 1);
		if (e.key === 'ArrowLeft') at = Math.max(0, at - 1);
	}
</script>

{#snippet touch()}<span class="touch" aria-hidden="true"><span></span></span>{/snippet}
{#snippet cast()}<svg viewBox="0 0 24 24"><path d="M3 9V6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-5M3 20h.01M3 16a4 4 0 0 1 4 4M3 12a8 8 0 0 1 8 8" /></svg>{/snippet}
{#snippet toolbar(hot: boolean)}
	<div class="tb">
		<svg viewBox="0 0 24 24"><path d="M4 7h16M4 12h16M4 17h16" /></svg>
		<svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7" /></svg>
		<svg viewBox="0 0 24 24"><path d="M9 5l7 7-7 7" /></svg>
		<span class="sp"></span>
		<span class="pl" class:hot>{#if hot}<i>1</i>{/if}<svg viewBox="0 0 24 24"><path d="M9 7v10l8-5z" /></svg>{#if hot}{@render touch()}{/if}</span>
		<svg viewBox="0 0 24 24"><rect x="5" y="5" width="14" height="14" rx="2" /></svg>
		{@render cast()}
	</div>
{/snippet}
{#snippet tv()}<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="12" rx="2" /><path d="M8 21h8M12 17v4" /></svg>{/snippet}

<dialog id="cast-video" class="cv" bind:this={dialog} aria-label={tr('Cómo verlo en la tele')} onclose={onclose} onkeydown={key} style="--ms: {SCENE_MS}ms">
	<header class="top">
		<div class="bars" aria-hidden="true">
			{#each CAPTIONS as _, i (i)}
				<span class="bar" class:full={i < at}>{#if i === at}{#key at}<i></i>{/key}{/if}</span>
			{/each}
		</div>
		<button id="cast-video-close" type="button" class="x" aria-label={tr('Cerrar')} onclick={() => dialog?.close()}><Icon name="close" size={22} /></button>
	</header>

	{#if !done}
		<!-- Toda la escena es el control: tercio izquierdo vuelve, el resto avanza. -->
		<button id="cast-video-stage" type="button" class="stage" aria-label={tr('Siguiente')} onclick={tap}>
			<div class="phone" aria-hidden="true">
				<div class="screen">
					<div class="status"><b>9:41</b><span class="island"></span><span class="bat"></span></div>
					{#key at}
						<div class="scene">
							{#if at === 0}
								<!-- Inicio del celu: la app entre otras. -->
								<div class="home">
									{#each Array(16) as _, i (i)}
										{#if i === 5}
											<div class="app wvc-app"><span class="ico wvc"><svg viewBox="0 0 24 24"><path d="M9 7v10l8-5z" /></svg></span><small>Web Video Caster</small>{@render touch()}</div>
										{:else}
											<div class="app"><span class="ico" style="--h: {(i * 47) % 360}"></span><small></small></div>
										{/if}
									{/each}
								</div>
							{:else if at === 1}
								{@render toolbar(false)}
								<div class="url"><span class="ph">Search or type URL</span><span class="typed">streamonte.app/play.html#…</span></div>
								<div class="callout"><span class="paste">Paste{@render touch()}</span><span>AutoFill</span></div>
								<div class="page"></div>
							{:else if at === 2}
								{@render toolbar(true)}
								<div class="url"><span class="typed on">streamonte.app/play.html#…</span></div>
								<div class="page"><div class="vid"><svg viewBox="0 0 24 24"><path d="M9 7v10l8-5z" /></svg></div></div>
							{:else if at === 3}
								<div class="nav"><svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7" /></svg>Back<span class="sp"></span>{@render cast()}</div>
								<div class="row video">
									<span class="thumb"><svg viewBox="0 0 24 24"><path d="M4 9h16v10H4zM4 9l2-4h12l2 4M8 5l1.5 4M12 5l1.5 4M16 5l1.5 4" /></svg></span>
									<span class="meta"><b>Streamonte</b><i></i><i class="short"></i><small>x-matroska</small></span>
									{@render touch()}
								</div>
							{:else if at === 4}
								<div class="dim"></div>
								<div class="sheet">
									<div class="sh-h"><span class="cancel">Cancel</span><b>Not connected</b></div>
									<p>You are not connected to a streaming device. Would you like to connect now?</p>
									<div class="opt connect">{@render cast()}Connect{@render touch()}</div>
									<div class="opt"><svg viewBox="0 0 24 24"><path d="M12 4v11M7 10l5 5 5-5M5 20h14" /></svg>Download</div>
									<div class="opt"><svg viewBox="0 0 24 24"><path d="M4 7h11M4 12h11M4 17h7M18 14v6M15 17h6" /></svg>Add to playlist</div>
									<div class="opt"><svg viewBox="0 0 24 24"><path d="M12 15V4M8 8l4-4 4 4M5 13v6h14v-6" /></svg>Open with…</div>
								</div>
							{:else}
								<div class="dim"></div>
								<div class="sheet devices">
									<div class="dev first"><span class="d-ico">{@render tv()}</span><span><b>Living TV</b><small>Chromecast</small></span>{@render touch()}</div>
									<div class="dev"><span class="d-ico">{@render tv()}</span><span><b>Smart TV</b><small>DLNA</small></span></div>
									<div class="dev"><span class="d-ico"><svg viewBox="0 0 24 24"><path d="M5 17H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h16a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1h-1M8 21l4-5 4 5z" /></svg></span><span><b>Apple TV</b><small>AirPlay</small></span></div>
								</div>
								<!-- Después del toque: la tele arranca. -->
								<div class="playing">
									<svg viewBox="0 0 120 96"><rect class="tvb" x="6" y="6" width="108" height="66" rx="8" /><path class="tvb" d="M42 88h36M60 72v16" /><path class="go" d="M52 26v26l22-13z" /></svg>
									<b>Living TV</b>
								</div>
							{/if}
						</div>
					{/key}
				</div>
			</div>
			{#key at}<p class="cap"><b>{at + 1}</b>{CAPTIONS[at]()}</p>{/key}
		</button>
	{:else}
		<div class="end">
			<svg class="end-mark" viewBox="0 0 120 120" aria-hidden="true">
				<circle cx="60" cy="60" r="50" />
				<path d="M38 62l15 15 30-32" />
			</svg>
			<b class="end-title">{tr('¡A disfrutar!')}</b>
			<button id="cast-video-replay" type="button" class="cta" onclick={() => (at = 0)}><Icon name="play" size={20} />{tr('Ver de nuevo')}</button>
			{#each store as app (app.href)}
				<a id="cast-video-store-{app.store === 'App Store' ? 'ios' : 'android'}" class="get" href={app.href} target="_blank" rel="noopener">
					<img src={app.icon} alt="" width="28" height="28" />{tr('¿No la tenés? Bajala')} · {app.store}
				</a>
			{/each}
		</div>
	{/if}
</dialog>

<style>
	.cv { position: fixed; inset: 0; width: 100%; height: 100dvh; max-width: none; max-height: none; margin: 0; padding: 0; border: 0; background: radial-gradient(120% 70% at 50% 40%, #16161d, #050507); color: #fff; display: flex; flex-direction: column; }
	.cv:not([open]) { display: none; }
	.cv::backdrop { background: #000; }
	.cv[open] { animation: cv-in 0.35s var(--out); }
	@keyframes cv-in { from { opacity: 0; transform: scale(1.04); } }

	.top { display: flex; align-items: center; gap: 12px; padding: max(12px, env(safe-area-inset-top)) 16px 8px; }
	.bars { flex: 1; display: flex; gap: 5px; }
	.bar { flex: 1; height: 3px; border-radius: 3px; background: rgb(255 255 255 / 0.22); overflow: hidden; }
	.bar.full { background: #fff; }
	.bar i { display: block; height: 100%; background: #fff; transform-origin: left; animation: fill var(--ms) linear forwards; }
	@keyframes fill { from { transform: scaleX(0); } }
	.x { display: grid; place-items: center; width: 40px; height: 40px; border: 0; border-radius: 50%; background: rgb(255 255 255 / 0.1); color: #fff; }

	.stage { flex: 1; min-height: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 22px; padding: 4px 16px 28px; border: 0; background: none; color: inherit; font: inherit; cursor: pointer; -webkit-tap-highlight-color: transparent; }

	/* El celu: adentro todo se mide en `cqw` (% del ancho de la pantalla), así escala entero. */
	.phone { width: min(70vw, 270px, 31dvh); padding: 2.4%; border-radius: 15% / 7%; background: linear-gradient(145deg, #3a3a42, #17171b); box-shadow: 0 40px 90px -30px rgb(0 0 0 / 0.95), inset 0 0 0 1px rgb(255 255 255 / 0.08); animation: phone-in 0.6s var(--out) both; }
	@keyframes phone-in { from { opacity: 0; transform: translateY(24px) rotate(-3deg) scale(0.94); } }
	.screen { position: relative; container-type: inline-size; aspect-ratio: 9 / 19.2; overflow: hidden; border-radius: 12% / 5.6%; background: #101014; font-size: 4.4cqw; text-align: left; }
	.screen svg { width: 6.4cqw; height: 6.4cqw; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; flex: none; }
	.status { position: absolute; inset: 0 0 auto; z-index: 6; display: flex; align-items: center; justify-content: space-between; height: 11cqw; padding: 0 7cqw; font-size: 3.8cqw; }
	.island { position: absolute; left: 50%; top: 2.6cqw; width: 26cqw; height: 6.8cqw; border-radius: 9cqw; background: #000; transform: translateX(-50%); }
	.bat { width: 6.4cqw; height: 3cqw; border-radius: 1cqw; background: #fff; }

	.scene { position: absolute; inset: 0; padding-top: 12cqw; display: flex; flex-direction: column; animation: scene-in 0.45s var(--out) both; }
	@keyframes scene-in { from { opacity: 0; transform: translateX(8cqw); filter: blur(4px); } }

	/* El dedo: aparece, aprieta y deja una onda; lo que lo contiene se ilumina a la vez (`hit`). */
	.touch { position: absolute; left: 50%; top: 50%; z-index: 4; width: 0; height: 0; pointer-events: none; }
	.touch::before, .touch span { content: ''; position: absolute; left: -8cqw; top: -8cqw; width: 16cqw; height: 16cqw; border-radius: 50%; }
	.touch::before { background: rgb(255 255 255 / 0.3); box-shadow: 0 0 0 1cqw #fff, 0 0 0 2cqw rgb(0 0 0 / 0.3), 0 2cqw 6cqw rgb(0 0 0 / 0.5); opacity: 0; animation: press calc(var(--ms) * 0.45) calc(var(--ms) * 0.35) var(--out) forwards; }
	.touch span { border: 0.7cqw solid #fff; opacity: 0; animation: ripple 0.8s calc(var(--ms) * 0.52) var(--out) 2; }
	@keyframes press { 0% { opacity: 0; transform: scale(1.8); } 40% { opacity: 1; transform: scale(0.95); } 60%, 100% { opacity: 1; transform: scale(0.85); } }
	@keyframes ripple { from { opacity: 0.9; transform: scale(0.6); } to { opacity: 0; transform: scale(2.6); } }
	@keyframes hit { 0%, 100% { background-color: transparent; } 30% { background-color: rgb(255 255 255 / 0.12); } }

	/* 1 · inicio */
	.home { flex: 1; display: grid; grid-template-columns: repeat(4, 1fr); align-content: start; gap: 5cqw 3cqw; padding: 6cqw 6cqw 0; background: radial-gradient(90% 60% at 20% 10%, #2b2f5c, transparent), radial-gradient(80% 60% at 90% 90%, #3a1f4d, transparent), #121225; }
	.app { position: relative; display: flex; flex-direction: column; align-items: center; gap: 1.6cqw; }
	.app small { width: 70%; height: 2cqw; border-radius: 1cqw; background: rgb(255 255 255 / 0.18); }
	.ico { width: 17cqw; aspect-ratio: 1; border-radius: 4.4cqw; background: linear-gradient(150deg, hsl(var(--h) 30% 40% / 0.65), hsl(var(--h) 30% 24% / 0.65)); }
	.ico.wvc { display: grid; place-items: center; background: linear-gradient(160deg, #ffb547, #f59e0b); box-shadow: 0 1.5cqw 5cqw rgb(245 158 11 / 0.45); animation: wiggle 0.6s calc(var(--ms) * 0.15) ease-in-out 2; }
	.ico.wvc svg { width: 10cqw; height: 10cqw; padding: 1.6cqw; border-radius: 50%; background: #2563eb; fill: #fff; stroke: none; }
	.wvc-app small { width: auto; height: auto; background: none; font-size: 2.6cqw; white-space: nowrap; color: #fff; }
	.wvc-app .touch { top: 8.5cqw; }
	@keyframes wiggle { 25% { transform: rotate(-6deg) scale(1.06); } 75% { transform: rotate(6deg) scale(1.06); } }

	/* 2-3 · navegador de la app */
	.tb { display: flex; align-items: center; gap: 3.6cqw; padding: 2cqw 4cqw; color: #c9c9d1; }
	.sp { flex: 1; }
	.pl { position: relative; display: grid; place-items: center; width: 8.6cqw; height: 8.6cqw; border-radius: 50%; background: #3a3a42; }
	.screen .pl svg { width: 5.4cqw; height: 5.4cqw; fill: #9a9aa3; stroke: none; }
	.pl.hot { background: #facc15; animation: beat 0.9s 0.3s var(--ease) 3; }
	.screen .pl.hot svg { fill: #111; }
	.pl i { position: absolute; right: -1.4cqw; top: -1.4cqw; display: grid; place-items: center; width: 4.6cqw; height: 4.6cqw; border-radius: 50%; background: #ef4444; color: #fff; font-size: 2.8cqw; font-style: normal; font-weight: 700; }
	@keyframes beat { 50% { transform: scale(1.22); } }
	.url { position: relative; margin: 1cqw 4cqw; height: 9.6cqw; display: flex; align-items: center; padding: 0 3cqw; border-radius: 2.4cqw; background: #26262d; font-size: 3.8cqw; color: #8b8b95; overflow: hidden; }
	.ph { animation: gone 0.01s calc(var(--ms) * 0.7) forwards; }
	.typed { position: absolute; left: 3cqw; color: #fff; white-space: nowrap; clip-path: inset(0 100% 0 0); animation: type 0.6s calc(var(--ms) * 0.7) steps(18) forwards; }
	.typed.on { clip-path: none; animation: none; }
	@keyframes type { to { clip-path: inset(0 0 0 0); } }
	@keyframes gone { to { opacity: 0; } }
	.callout { position: absolute; left: 6cqw; top: 36cqw; z-index: 2; display: flex; gap: 1cqw; padding: 1cqw; border-radius: 3cqw; background: #3b3b44; box-shadow: 0 2cqw 6cqw rgb(0 0 0 / 0.5); font-size: 3.6cqw; animation: pop-in 0.35s calc(var(--ms) * 0.12) var(--out) both, gone 0.2s calc(var(--ms) * 0.68) forwards; }
	.callout::before { content: ''; position: absolute; left: 7cqw; top: -1.6cqw; border: 1.8cqw solid transparent; border-top: 0; border-bottom-color: #3b3b44; }
	.callout span { position: relative; padding: 1.6cqw 3cqw; border-radius: 2cqw; }
	.paste { animation: hit 0.5s calc(var(--ms) * 0.5) both; }
	@keyframes pop-in { from { opacity: 0; transform: translateY(-2cqw) scale(0.9); } }
	.page { flex: 1; margin-top: 3cqw; background: linear-gradient(#18181d, #121216); }
	.vid { display: grid; place-items: center; margin: 8cqw 5cqw; aspect-ratio: 16 / 9; border-radius: 3cqw; background: #000; }
	.screen .vid svg { width: 12cqw; height: 12cqw; fill: #333; stroke: none; }

	/* 4 · el video detectado */
	.nav { display: flex; align-items: center; gap: 1.4cqw; padding: 3cqw 4cqw; font-size: 4.2cqw; border-bottom: 1px solid #222; }
	.row { position: relative; display: flex; gap: 3.4cqw; padding: 4cqw; }
	.video { animation: hit 0.5s calc(var(--ms) * 0.5) both; }
	.thumb { display: grid; place-items: center; width: 22cqw; aspect-ratio: 1; border-radius: 2cqw; background: #facc15; color: #fff; flex: none; }
	.screen .thumb svg { width: 13cqw; height: 13cqw; stroke-width: 2.4; }
	.meta { display: flex; flex-direction: column; gap: 1.8cqw; min-width: 0; flex: 1; }
	.meta b { font-size: 4.8cqw; font-weight: 600; }
	.meta i { height: 2.4cqw; border-radius: 1.2cqw; background: #3a3a42; }
	.meta i.short { width: 70%; }
	.meta small { font-size: 3.6cqw; color: #a1a1aa; }
	.row .touch { left: 45%; }

	/* 5-6 · hojas de la app */
	.dim { position: absolute; inset: 0; background: rgb(0 0 0 / 0.55); }
	.sheet { position: absolute; inset: auto 0 0; display: flex; flex-direction: column; padding: 4cqw 0 8cqw; border-radius: 6cqw 6cqw 0 0; background: #1f1f25; animation: sheet-up 0.45s 0.1s var(--out) both; }
	@keyframes sheet-up { from { transform: translateY(100%); } }
	.sh-h { position: relative; text-align: center; padding: 1cqw 0 3cqw; font-size: 4.4cqw; }
	.cancel { position: absolute; left: 4cqw; color: #60a5fa; font-size: 3.8cqw; }
	.sheet p { margin: 0 5cqw 3cqw; font-size: 3.4cqw; line-height: 1.35; color: #9a9aa3; }
	.opt { position: relative; display: flex; align-items: center; gap: 4cqw; padding: 3.6cqw 5cqw; border-top: 1px solid #2c2c33; font-size: 4.2cqw; }
	.connect { animation: hit 0.5s calc(var(--ms) * 0.5) both; }
	.connect .touch { left: 30%; }
	.dev { position: relative; display: flex; align-items: center; gap: 4cqw; padding: 3.6cqw 5cqw; }
	.dev span:not(.d-ico) { display: flex; flex-direction: column; gap: 0.6cqw; }
	.dev b { font-size: 4.4cqw; font-weight: 500; }
	.dev small { font-size: 3.4cqw; color: #9a9aa3; }
	.d-ico { display: grid; place-items: center; width: 11cqw; height: 11cqw; border-radius: 3cqw; background: #2c2c33; }
	.first { animation: hit 0.5s calc(var(--ms) * 0.4) both; }
	.first .touch { left: 35%; }
	.devices .touch::before { animation-delay: calc(var(--ms) * 0.25); }
	.devices .touch span { animation-delay: calc(var(--ms) * 0.4); }
	.playing { position: absolute; inset: 0; z-index: 5; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4cqw; background: radial-gradient(70% 50% at 50% 45%, #1e3a8a, #0b0b10); font-size: 4.6cqw; opacity: 0; animation: show 0.4s calc(var(--ms) * 0.62) var(--out) forwards; }
	.screen .playing svg { width: 60cqw; height: auto; stroke-width: 3; }
	.playing .tvb { stroke: #fff; }
	.playing .go { fill: #fff; stroke: none; transform-box: fill-box; transform-origin: center; animation: pop-in 0.5s calc(var(--ms) * 0.7) var(--out) both; }
	@keyframes show { from { opacity: 0; transform: scale(1.08); } to { opacity: 1; transform: none; } }

	.cap { display: flex; align-items: center; gap: 12px; margin: 0; max-width: 380px; font-size: 20px; font-weight: 650; line-height: 1.25; text-align: left; text-wrap: balance; animation: cap-in 0.55s 0.12s var(--out) both; }
	.cap b { flex: none; display: grid; place-items: center; width: 34px; height: 34px; border-radius: 11px; background: var(--accent-fg); color: var(--bg); font-size: 16px; }
	@keyframes cap-in { from { opacity: 0; transform: translateY(10px); filter: blur(6px); } }

	.end { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 18px; padding: 16px 16px 40px; }
	.end-mark { width: 120px; }
	.end-mark circle { fill: none; stroke: var(--green); stroke-width: 6; stroke-dasharray: 315; stroke-dashoffset: 315; animation: draw 0.6s var(--out) forwards; }
	.end-mark path { fill: none; stroke: #fff; stroke-width: 7; stroke-linecap: round; stroke-linejoin: round; stroke-dasharray: 70; stroke-dashoffset: 70; animation: draw 0.35s 0.5s var(--out) forwards; }
	@keyframes draw { to { stroke-dashoffset: 0; } }
	.end-title { font-size: 30px; animation: cap-in 0.5s 0.3s var(--out) both; }
	.cta { display: inline-flex; align-items: center; gap: 10px; padding: 16px 28px; border: 0; border-radius: 999px; background: #fff; color: #000; font: inherit; font-size: 17px; font-weight: 700; animation: cap-in 0.5s 0.45s var(--out) both; }
	.get { display: inline-flex; align-items: center; gap: 10px; color: rgb(255 255 255 / 0.75); font-size: 15px; text-decoration: none; animation: cap-in 0.5s 0.55s var(--out) both; }
	.get img { border-radius: 7px; }
</style>
