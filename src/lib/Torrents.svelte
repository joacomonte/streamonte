<script>
	// Torrents de un video que TorBox tiene en caché, del más pesado al más liviano. Por fila: peso, calidad de
	// imagen (como el desktop) y copiar el link https de TorBox. Los subtítulos son de cada torrent: aparecen al copiar
	// su link (nativos primero; si no trae, se buscan afuera; Premium plegado al final).
	import Icon from './Icon.svelte';
	import Sheet from './Sheet.svelte';
	import Tour from './Tour.svelte';
	import { castSteps, device, markSeen, seen } from './tours.js';
	import * as saved from './saved.js';
	import { loc, t as tr } from './i18n.svelte.js';
	import { untrack } from 'svelte';

	/** `orig`: idioma original (ISO 639-1 de TMDB): el audio que sale por defecto. @type {{imdb: string, s?: number | null, e?: number | null, name: string, orig?: string | null}} */
	let { imdb, s = null, e = null, name, orig = null } = $props();

	/** @typedef {{hash: string, release: string, file: string | null, res: string | null, hdr: string[], source: string | null, lat: boolean, multi: boolean, size: number | null, seeds: number, addons: string[], subFile: boolean}} Torrent */
	/** @typedef {{id: string, release: string, latino: boolean, format: string, downloads: number, exact?: boolean, fps?: number | null, last?: number | null, group?: string, premium?: boolean}} Sub */
	/** @typedef {{label: string, kind: string, track: number, url: string}} Native */
	/** @typedef {{hasKey: boolean, remaining: number | null, perDay: number | null, resetsAt: number | null, login?: string | null}} Quota */

	const RES = [
		['2160p', '4K'],
		['1080p', '1080p'],
		['720p', '720p']
	];
	/** Calidad de imagen por la fuente del release, como el desktop (streamonte/ui/src/catalog-options.js): [nombre, estrellas de 4]. */
	const QUALITY = /** @type {Record<string, [string, number]>} */ ({
		REMUX: ['Máster', 4],
		BluRay: ['Blu-ray', 3],
		'WEB-DL': ['Streaming', 2],
		WEBRip: ['Streaming', 2],
		WEB: ['Streaming', 2],
		HDTV: ['TV', 1],
		DVDRip: ['DVD', 1]
	});
	const qs = $derived(new URLSearchParams({ imdb, ...(s && e ? { s: String(s), e: String(e) } : {}) }).toString());

	let data = $state(/** @type {{list: Torrent[], found: number, sources: number} | null} */ (null));
	let error = $state('');
	let res = $state('');
	let onlyLat = $state(false);
	let onlyHdr = $state(false);
	/** Solo las que ya se sabe que traen subs en español (verificadas o con .srt en el torrent). */
	let onlyEs = $state(false);
	/** Estado del botón copiar por hash. @type {Record<string, 'busy' | 'ok' | 'err'>} */
	let copy = $state({});
	/** Link que el navegador no dejó copiar solo (http en la LAN): se muestra para copiarlo a mano. */
	let manual = $state(/** @type {{url: string, release: string, kind: 'video' | 'sub'} | null} */ (null));
	let subsOpen = $state(false);
	/** Hoja de "Link copiado": qué se copió (video o subtítulo) y su nombre. */
	let copied = $state(/** @type {{kind: 'video' | 'sub', name: string} | null} */ (null));
	/** @type {HTMLElement | undefined} */
	let toastEl = $state();
	// Toast que se va solo; si se copia otro, vuelve a contar.
	$effect(() => {
		if (!toastEl) return;
		if (!copied) {
			if (toastEl.matches(':popover-open')) toastEl.hidePopover();
			return;
		}
		if (toastEl.matches(':popover-open')) toastEl.hidePopover();
		toastEl.showPopover();
		const id = setTimeout(() => (copied = null), 2800);
		return () => clearTimeout(id);
	});
	let tutorialOpen = $state(false);
	/** Ofrecer el tutorial de la tele al copiar un video: hasta "Ahora no" (esta visita) o "No mostrar más" (siempre). */
	let castOffer = $state(false);
	let castAsked = false;
	/** @param {'show' | 'later' | 'never'} pick */
	function answerOffer(pick) {
		castOffer = false;
		if (pick === 'never') markSeen('cast-never');
		if (pick === 'show') tutorialOpen = true;
	}
	/** Los encontrados afuera para el torrent copiado (null = no se buscó). */
	let subs = $state(/** @type {Sub[] | null} */ (null));
	let searching = $state(false);
	let subsError = $state('');
	/** El último subtítulo copiado y los que se copiaron antes (no sincronizaron): "Probaste N". */
	let picked = $state(/** @type {string | null} */ (null));
	let tried = $state(/** @type {string[]} */ ([]));
	/** Premium (OpenSubtitles.com): buscar es gratis y corre al abrir la fila; cada copia baja uno (gasta 1). */
	let prem = $state(/** @type {{open: boolean, status: 'idle' | 'loading' | 'ready' | 'empty' | 'error', results: Sub[], busy: string | null}} */ ({ open: false, status: 'idle', results: [], busy: null }));
	let quota = $state(/** @type {Quota | null} */ (null));

	// Solo depende del video (`qs`): lo demás va en `untrack`, así nada que llegue
	// después (subs, cuota, copias) vuelve a disparar el pedido ni vacía la lista que ya se ve.
	$effect(() => {
		const url = `/api/torrents?${qs}`;
		let alive = true;
		const hit = saved.peek(url);
		untrack(() => {
			error = '';
			copy = {};
			resetSubs();
			match = null;
			// Lista guardada 1 hora (saved.js): se pinta en este mismo cuadro, sin pasar por la carga ni redibujar.
			data = hit;
		});
		if (hit) return;
		saved.json(fetch, url, saved.HOUR)
			.then(({ ok, data: j }) => {
				if (!alive) return;
				if (!ok) error = j.message;
				else data = j;
			})
			.catch((err) => alive && (error = err.message));
		return () => (alive = false);
	});

	/** @param {string} r */
	const count = (r) => (data?.list ?? []).filter((t) => t.res === r).length;
	/** Resolución elegida; por defecto 4K y, si no hay, la mejor que haya (sin datos de resolución: todas). */
	const shown = $derived(res && count(res) ? res : (RES.find(([v]) => count(v))?.[0] ?? ''));
	const list = $derived((data?.list ?? []).filter((t) => (!shown || t.res === shown) && (!onlyLat || t.lat) && (!onlyHdr || t.hdr.length) && (!onlyEs || hasEs(t))));
	/** @param {Torrent} t */
	const hasEs = (t) => t.subFile || (typeof subsEs[t.hash] === 'number' && /** @type {number} */ (subsEs[t.hash]) > 0);
	/** El video que copiaste: los subtítulos se ordenan por cuánto calzan con él. */
	let match = $state(/** @type {{release: string, natives?: Native[], file?: {hash: string, size: string}, video?: {fps: number | null, duration: number | null}} | null} */ (null));
	/** Fuente del release: HDTV, web y Blu-ray del mismo capítulo pueden tener otro corte. @param {string} x */
	const sourceOf = (x) =>
		/web[ ._-]?dl|web[ ._-]?rip|\bweb\b|amzn|\bnf\b|hmax|dsnp/i.test(x) ? 'WEB' : /blu-?ray|bdrip|brrip|remux/i.test(x) ? 'BluRay' : /hdtv/i.test(x) ? 'HDTV' : /dvd/i.test(x) ? 'DVD' : null;
	/** Grupo del release (`…-KILLERS`). @param {string} x */
	const groupOf = (x) => x.match(/-([a-z0-9]+)(?:\.[a-z0-9]{2,4})?$/i)?.[1] ?? '';
	/** Cuánto calza con el video copiado, como el desktop (crates/core/src/subtitles.rs): 3 hecho para ese archivo,
	 * 2 mismo release (grupo y, si se sabe, fuente), 1 mismos fps y termina dentro del video, 0 nada. @param {Sub} sub */
	function level(sub) {
		if (sub.exact) return 3;
		const rel = match?.release ?? '';
		const g = groupOf(rel).toLowerCase();
		const [a, b] = [sourceOf(rel), sourceOf(sub.release)];
		if (g && ((sub.group ?? '').toLowerCase() === g || groupOf(sub.release).toLowerCase() === g) && (!a || !b || a === b)) return 2;
		const v = match?.video;
		const ends = !v?.duration || !sub.last || (sub.last >= v.duration * 0.8 && sub.last <= v.duration + 5);
		return v?.fps && sub.fps && Math.abs(v.fps - sub.fps) < 0.05 && ends ? 1 : 0;
	}
	console.assert((() => { const s = { id: '', latino: false, format: '', downloads: 0 }; const old = match; match = { release: 'X.WEB-DL-NTb', video: { fps: 23.976, duration: 3000 } };
		const r = level({ ...s, release: 'X.1080p.WEB-DL-NTb' }) === 2 && level({ ...s, release: 'X.BluRay-NTb' }) === 0 && level({ ...s, release: 'X.BluRay-DEMAND', fps: 23.976, last: 2900 }) === 1; match = old; return r; })());
	const LEVEL = ['', 'probable', 'muy probable', 'perfecto'].map((x) => () => tr(x));
	const WHY = ['', 'Mismos fps y misma duración que el video', 'Mismo release: mismo grupo y fuente', 'Hecho para este mismo archivo'].map((x) => () => tr(x));
	/** Exacto → mismo release → mismos fps y duración → resto; adentro, latinos y más bajados. @param {Sub[]} list */
	const rank = (list) => list.map((sub) => ({ ...sub, level: level(sub) }))
		.sort((a, b) => b.level - a.level || Number(b.latino) - Number(a.latino) || b.downloads - a.downloads);
	const ranked = $derived(subs ? rank(subs) : []);
	const premRanked = $derived(rank(prem.results));
	/** Encabezado de la fila: grupo del release y "fuente resolución". @param {Sub} sub */
	const headOf = (sub) => sub.group || groupOf(sub.release) || (sub.premium ? 'OpenSubtitles' : 'OpenSubtitles.org');
	/** @param {Sub} sub */
	const specOf = (sub) => [sourceOf(sub.release), sub.release.match(/\b(2160p|1080p|720p|480p)\b/i)?.[1]].filter(Boolean).join(' ') || tr('sin release');

	/** @param {number | null} b */
	const gb = (b) => (b == null ? '—' : b >= 1024 ** 3 ? `${(b / 1024 ** 3).toLocaleString(loc(), { maximumFractionDigits: 1, minimumFractionDigits: 1 })} GB` : `${Math.round(b / 1024 ** 2)} MB`);

	/** Link de TorBox recién pedido (uno nuevo en cada copia); `choices` si hay audio en inglés y en latino.
	 * @param {Torrent} t @returns {Promise<{url: string, choices?: {key: string, label: string, url: string}[], file?: {hash: string, size: string}, natives?: Native[], video?: {fps: number | null, duration: number | null}, subsEs?: number, ids?: {tid: number, fid: number}}>} */
	async function linkOf(t) {
		const r = await fetch(`/api/link?${qs}&${new URLSearchParams({ hash: t.hash, name: t.release, file: t.file ?? '', orig: orig ?? '' })}`);
		const j = await r.json();
		if (!r.ok) throw new Error(j.message);
		return j;
	}
	/** Elegir audio: el toque en la opción es el que copia (por http hace falta un toque para copiar). */
	let audioFor = $state(/** @type {{t: Torrent, choices: {key: string, label: string, url: string}[]} | null} */ (null));

	/** Subs en español que trae el video adentro, por hash: cuántos (0 = ninguno), 'busy' mientras se consulta o
	 * 'err' si falló. Es del torrent y no cambia: se guarda para siempre (saved.remember). */
	let subsEs = $state(/** @type {Record<string, number | 'busy' | 'err' | null>} */ ({}));
	$effect(() => {
		for (const t of data?.list ?? []) if (!(t.hash in subsEs)) subsEs[t.hash] = saved.recall(`subs:${t.hash}`);
	});
	/** @param {string} hash @param {number} n */
	function knowSubs(hash, n) {
		subsEs[hash] = n;
		saved.remember(`subs:${hash}`, n);
	}
	/** Solo a pedido (el botón "?" de la opción, o solo al copiar su link): lee el encabezado del video. Con `ids`
	 * (del link recién copiado) es un pedido a TorBox; sin ellos, también agrega el torrent. false si falló.
	 * @param {Torrent} t @param {{tid: number, fid: number}} [ids] */
	async function probe(t, ids) {
		subsEs[t.hash] = 'busy';
		try {
			const r = await fetch(`/api/tracks?${qs}&${new URLSearchParams({ hash: t.hash, name: t.release, file: t.file ?? '', ...(ids ? { tid: String(ids.tid), fid: String(ids.fid) } : {}) })}`);
			if (!r.ok) throw new Error();
			knowSubs(t.hash, (await r.json()).subs.length);
			return true;
		} catch {
			subsEs[t.hash] = 'err';
			return false;
		}
	}
	/** @param {Torrent} t */
	const subBadge = (t) => {
		const n = subsEs[t.hash];
		if (typeof n === 'number' && n > 0) return { on: true, text: 'Sub ES', title: tr(n > 1 ? 'El video trae {n} subtítulos en español adentro' : 'El video trae {n} subtítulo en español adentro', { n }) };
		if (t.subFile) return { on: true, text: 'Sub ES', title: tr('El torrent trae un archivo de subtítulo en español') };
		if (n === 0) return { on: false, text: 'Sin sub ES', title: tr('El video no trae subtítulos en español: hay que buscarlos afuera') };
		return null;
	};

	/** Pide el link en el toque; si hay inglés y latino, pregunta antes de copiar. @param {Torrent} t */
	async function copyLink(t) {
		copy[t.hash] = 'busy';
		let got;
		try {
			got = await linkOf(t);
		} catch (err) {
			error = /** @type {Error} */ (err).message;
			return done(t, 'err');
		}
		delete copy[t.hash];
		if (got.subsEs != null) knowSubs(t.hash, got.subsEs);
		// Link de descarga (plan sin streaming): de paso se leen sus pistas, sin volver a agregar el torrent.
		else if (got.ids && typeof subsEs[t.hash] !== 'number') probe(t, got.ids);
		subsFor(t, got.file, got.natives, got.video);
		if (got.choices?.length) audioFor = { t, choices: got.choices };
		else copyUrl(t, got.url);
	}
	function resetSubs() {
		subs = null;
		searching = false;
		subsError = '';
		picked = null;
		tried = [];
		prem = { open: false, status: 'idle', results: [], busy: null };
	}
	/** Subtítulos del torrent copiado, con lo que ya trajo su link (sin volver a TorBox): los que trae el video
	 * (`natives`, cada uno con el link del video con ese subtítulo puesto); si no trae en español, se buscan afuera.
	 * @param {Torrent} t @param {{hash: string, size: string} | undefined} file @param {Native[]} [natives]
	 * @param {{fps: number | null, duration: number | null}} [video] */
	function subsFor(t, file, natives, video) {
		resetSubs();
		match = { release: t.release, natives, file, video };
		if (!natives?.length) searchSubs();
	}
	/** Afuera (OpenSubtitles.org): con el hash del archivo suma los hechos para ese archivo exacto. */
	async function searchSubs() {
		const q = qs;
		const m = match;
		searching = true;
		try {
			const r = await fetch(`/api/subs?${q}${m?.file ? `&${new URLSearchParams(m.file)}` : ''}`);
			const j = await r.json();
			if (q !== qs || m !== match) return;
			if (!r.ok) subsError = j.message;
			else subs = j;
		} catch (err) {
			subsError = /** @type {Error} */ (err).message;
		} finally {
			searching = false;
		}
	}
	/** Copia ya (Chrome deja unos segundos después del toque); si el navegador no deja, un toque más en la hoja.
	 * @param {Torrent} t @param {string} url */
	async function copyUrl(t, url) {
		if (copyNow(url)) return done(t, 'ok');
		try {
			await navigator.clipboard.writeText(url);
			done(t, 'ok');
		} catch {
			manual = { url, release: t.release, kind: 'video' };
		}
	}
	/** @param {Torrent} t @param {'ok' | 'err'} st */
	function done(t, st) {
		copy[t.hash] = st;
		if (st === 'ok') {
			copied = { kind: 'video', name: t.release };
			// Recién con el link copiado aparecen los subtítulos de ese torrent.
			subsOpen = true;
			if (!castAsked && !seen('cast-never')) castOffer = castAsked = true;
		}
		setTimeout(() => copy[t.hash] === st && delete copy[t.hash], 2500);
	}
	/** Botón Copiar de la hoja manual: dentro del toque, así iOS lo deja copiar. Si tampoco, queda el campo para mantener apretado. */
	function copyManual() {
		if (manual && copyNow(manual.url)) {
			copied = { kind: manual.kind, name: manual.release };
			manual = null;
			if (match && !subsOpen) subsOpen = true;
		}
	}
	/** Link absoluto del .srt (en la LAN, el de la Mac): termina en la extensión para Web Video Caster. @param {Sub} sub */
	const subUrl = (sub) =>
		`${location.origin}/api/subs/${sub.id}/${encodeURIComponent(fileName.replace(/[^\p{L}\p{N}]+/gu, '.'))}.es.${sub.format === 'ass' ? 'ass' : 'srt'}`;
	/** Copia en el mismo toque con un textarea oculto: anda por http, donde no hay `navigator.clipboard`.
	 * iOS no selecciona texto de un campo de solo lectura (y `execCommand` igual dice que copió): por eso editable,
	 * con rango explícito, y se verifica que lo seleccionado sea el texto. @param {string} text */
	function copyNow(text) {
		const ta = document.createElement('textarea');
		ta.value = text;
		ta.contentEditable = 'true';
		ta.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;font-size:16px';
		// Dentro del <dialog> abierto si hay uno: fuera del modal no se puede enfocar.
		([...document.querySelectorAll('dialog[open]')].at(-1) ?? document.body).append(ta);
		ta.focus({ preventScroll: true });
		const range = document.createRange();
		range.selectNodeContents(ta);
		const sel = getSelection();
		sel?.removeAllRanges();
		sel?.addRange(range);
		ta.setSelectionRange(0, text.length);
		const selected = ta.value.slice(ta.selectionStart, ta.selectionEnd) === text;
		const ok = selected && document.execCommand('copy');
		ta.remove();
		return ok;
	}
	/** Copiar otro cuenta el anterior como probado (no sincronizó). @param {string} key */
	function pick(key) {
		if (picked && picked !== key && !tried.includes(picked)) tried = [...tried, picked];
		tried = tried.filter((k) => k !== key);
		picked = key;
	}
	/** @param {Sub} sub */
	async function copySub(sub) {
		pick(`o${sub.id}`);
		const url = subUrl(sub);
		const name = sub.release || tr('Subtítulo');
		if (copyNow(url)) return void (copied = { kind: 'sub', name });
		try {
			await navigator.clipboard.writeText(url);
			copied = { kind: 'sub', name };
		} catch {
			// Último recurso: el navegador no dejó copiar, se muestra para copiarlo a mano.
			manual = { url, release: name, kind: 'sub' };
		}
	}
	/** Copia un nativo: el video con ese subtítulo puesto. @param {Native} n */
	function copyNative(n) {
		pick(`n${n.track}`);
		if (copyNow(n.url)) copied = { kind: 'video', name: tr('Subtítulos del video') };
		else manual = { url: n.url, release: tr('Subtítulos del video'), kind: 'video' };
	}

	async function loadQuota() {
		quota = await fetch('/api/premium/quota').then((r) => r.json()).catch(() => quota);
	}
	async function premiumSearch() {
		prem.status = 'loading';
		const r = await fetch(`/api/premium?${qs}`).catch(() => null);
		const j = await r?.json().catch(() => null);
		if (!r?.ok || !j) return void (prem.status = 'error');
		prem.results = j.results;
		quota = j.quota;
		prem.status = j.results.length ? 'ready' : 'empty';
	}
	function togglePremium() {
		prem.open = !prem.open;
		if (prem.open && quota?.hasKey && prem.status === 'idle') premiumSearch();
	}
	/** "Copiar · 1": baja ese (gasta 1, solo con este toque) y copia el link del .srt servido por la Mac. @param {Sub} sub */
	async function copyPremium(sub) {
		if (prem.busy || quota?.remaining === 0) return;
		prem.busy = sub.id;
		try {
			const r = await fetch(`/api/premium/${sub.id}`, { method: 'POST' });
			const j = await r.json();
			if (!r.ok) throw new Error(j.message);
			quota = j;
			pick(`p${sub.id}`);
			const url = `${location.origin}/api/premium/${sub.id}/${encodeURIComponent(fileName.replace(/[^\p{L}\p{N}]+/gu, '.'))}.es.srt`;
			const name = sub.release || tr('Subtítulo');
			if (copyNow(url)) copied = { kind: 'sub', name };
			else manual = { url, release: name, kind: 'sub' };
		} catch (err) {
			subsError = /** @type {Error} */ (err).message;
			loadQuota();
		} finally {
			prem.busy = null;
		}
	}
	const quotaText = $derived(
		!quota ? tr('viendo cuántas descargas quedan…')
			: quota.login ? quota.login
			: quota.remaining == null ? tr('no sé cuántas descargas quedan hoy')
				: quota.remaining === 0 ? tr('usaste las {n} de hoy', { n: quota.perDay ?? '' }) + (quota.resetsAt ? tr(' · vuelven {h}', { h: new Date(quota.resetsAt).toLocaleTimeString(loc(), { hour: '2-digit', minute: '2-digit' }) }) : '')
					: tr('quedan {n} de {d} descargas hoy', { n: quota.remaining, d: quota.perDay ?? '' })
	);
	const epLabel = $derived(s && e ? `S${String(s).padStart(2, '0')}E${String(e).padStart(2, '0')}` : tr('esta película'));

	const fileName = $derived(name + (s && e ? ` S${String(s).padStart(2, '0')}E${String(e).padStart(2, '0')}` : ''));
</script>

<section class="torrents" aria-label={tr('Torrents en TorBox')} aria-busy={!data && !error}>
	{#if !data && !error}
		<p class="status"><span class="spin"></span>{tr('Buscando torrents y viendo cuáles tiene TorBox…')}</p>
		{#each Array(4) as _, i (i)}<div class="row-skel skel"></div>{/each}
	{:else if error && !data}
		<p class="status error" role="alert">{error}</p>
	{:else if data}
		<div class="bar">
			<div class="chips" role="toolbar" aria-label={tr('Filtros de torrents')}>
				{#each RES as [v, l] (v)}
					{#if count(v)}
						<button id="res-{v}" type="button" class="chip" class:on={shown === v} aria-pressed={shown === v} onclick={() => (res = v)}>
							{l}<span class="n">{count(v)}</span>
						</button>
					{/if}
				{/each}
			</div>
			<div class="chips toggles" role="toolbar" aria-label={tr('Idioma y HDR')}>
				<button id="only-lat" type="button" class="chip toggle" class:on={onlyLat} aria-pressed={onlyLat} onclick={() => (onlyLat = !onlyLat)}>{tr('Audio LAT')}</button>
				<button id="only-hdr" type="button" class="chip toggle" class:on={onlyHdr} aria-pressed={onlyHdr} onclick={() => (onlyHdr = !onlyHdr)}>HDR</button>
				<button id="only-es" type="button" class="chip toggle" class:on={onlyEs} aria-pressed={onlyEs} title={tr('Solo las verificadas que traen subtítulos en español')} onclick={() => (onlyEs = !onlyEs)}><Icon name="subs" size={14} />{tr('Subs ES')}</button>
			</div>
			<p class="summary" title={tr('TorBox es un servicio pago que baja torrents a sus servidores y te los pasa como video en línea. Estas opciones ya las tiene bajadas: el link se ve al instante en la tele, sin depender de los seeds.')}>{tr('{n} de {f} en TorBox · por tamaño', { n: data.list.length, f: data.found })}</p>
		</div>
		{#if error}<p class="status error" role="alert">{error}</p>{/if}

		{#if !data.list.length}
			<p class="status muted">{tr('TorBox no tiene en caché ninguno de los {n} torrents encontrados.', { n: data.found })}</p>
		{:else if !list.length}
			<p class="status muted">{tr('No hay opciones con estos filtros.')}</p>
		{/if}

		<ul>
			{#each list as t, i (t.hash)}
				{@const q = t.source ? QUALITY[t.source] : null}
				{@const sb = subBadge(t)}
				<li class="opt" class:best={i === 0}>
					{#if i === 0}<span class="best-tag">{tr('Más pesada')}</span>{/if}
					<div class="info">
					<div class="top">
						<span class="size">{gb(t.size)}</span>
						{#if t.res}<span class="tag res">{t.res === '2160p' ? '4K' : t.res}</span>{/if}
						{#if t.hdr.length}<span class="tag hdr">HDR</span>{/if}
						{#if t.lat}<span class="tag lat">{tr('LATINO')}</span>{/if}
						<span class="tag tb" title={tr('TorBox es un servicio pago que baja torrents a sus servidores y te los pasa como video en línea. Estas opciones ya las tiene bajadas: el link se ve al instante en la tele, sin depender de los seeds.')}>TorBox</span>
						{#if sb}<span class="tag cc {sb.on ? 'es' : 'nosub'}" title={sb.title} aria-label={sb.title}><Icon name="subs" size={13} />ES</span>{/if}
					</div>
					<div class="quality" title={q ? tr('Calidad de imagen: {q}', { q: tr(q[0]) }) : tr('El nombre del torrent no dice de dónde salió el video')}>
						<Icon name="monitor" size={14} />
						{#if q}
							<span class="stars" role="img" aria-label={tr('{n} de 4', { n: q[1] })}>
								{#each [1, 2, 3, 4] as n (n)}<span class:on={n <= q[1]}><Icon name="star" size={13} /></span>{/each}
							</span>
							<span class="qname">{tr(q[0])}</span>
						{:else}
							<span class="qname unknown">{tr('Calidad sin dato')}</span>
						{/if}
					</div>
					<!-- Sin dato de subs: un texto chico; un toque es un pedido y deja el badge arriba. -->
					{#if !sb && subsEs[t.hash] === 'busy'}
						<span class="verify busy" role="status"><span class="spin"></span>{tr('Verificando…')}</span>
					{:else if !sb}
						<button
							id="probe-{t.hash}"
							type="button"
							class="verify"
							class:err={subsEs[t.hash] === 'err'}
							title={subsEs[t.hash] === 'err' ? tr('No se pudo ver: tocá para reintentar') : tr('Ver si trae subtítulos en español')}
							onclick={() => probe(t)}
						><Icon name="subs" size={14} />{subsEs[t.hash] === 'err' ? tr('Reintentar') : tr('Verificar subtítulos')}</button>
					{/if}
					</div>
					<div class="acts">
					<!-- Como ▶ del desktop: un botón redondo; lleno solo en la primera fila. -->
					<button
						id="copy-{t.hash}"
						type="button"
						class="copy"
						class:primary={i === 0}
						class:ok={copy[t.hash] === 'ok'}
						class:err={copy[t.hash] === 'err'}
						aria-label={copy[t.hash] === 'err' ? tr('Reintentar copiar el link') : tr('Copiar link de TorBox')}
						disabled={copy[t.hash] === 'busy'}
						onclick={() => copyLink(t)}
					>
						{#if copy[t.hash] === 'busy'}<span class="spin" class:light={i === 0}></span>
						{:else if copy[t.hash] === 'ok'}<Icon name="check" size={18} />
						{:else}<Icon name="link" size={18} />{/if}
					</button>
					</div>
				</li>
			{/each}
		</ul>
	{/if}
</section>

<!-- Una fila de subtítulo (ELEGIDA, mobile): grupo + fuente resolución + LAT; debajo, cuánto calza. -->
{#snippet row(/** @type {{key: string, head: string, spec: string, latino?: boolean, lvl?: number, title?: string}} */ it, /** @type {import('svelte').Snippet} */ actions)}
	{@const on = picked === it.key}
	{@const was = !on && tried.includes(it.key)}
	<li class="sub" class:on class:tried={was} title={was ? tr('Probado · no sincronizó') : it.title}>
		<span class="mark">{#if on}<Icon name="check" size={16} />{/if}</span>
		<span class="sub-text">
			<span class="l1"><b>{it.head}</b><span class="spec">{it.spec}</span>{#if it.latino}<span class="lat">LAT</span>{/if}{#if was}<span class="why">{tr('probado')}</span>{/if}</span>
			{#if it.lvl}<span class="fit l{it.lvl}" title={WHY[it.lvl]()}>{LEVEL[it.lvl]()}</span>{/if}
		</span>
		{@render actions()}
	</li>
{/snippet}

<Sheet id="subs-sheet" title={tr('Subtítulos')} open={subsOpen} onclose={() => (subsOpen = false)}>
	{#if castOffer}
		<div class="offer" role="region" aria-labelledby="cast-offer-title">
			<span class="offer-icon" aria-hidden="true"><Icon name="cast" size={22} /></span>
			<div class="offer-text">
				<strong id="cast-offer-title">{tr('¿Lo querés ver en la tele?')}</strong>
				<span>{tr('Te mostramos cómo mandar el link con Web Video Caster.')}</span>
			</div>
			<div class="offer-actions">
				<button id="cast-offer-show" type="button" class="btn primary" onclick={() => answerOffer('show')}>{tr('Ver tutorial')}</button>
				<button id="cast-offer-later" type="button" class="btn" onclick={() => answerOffer('later')}>{tr('Ahora no')}</button>
				<button id="cast-offer-never" type="button" class="link-btn" onclick={() => answerOffer('never')}>{tr('No mostrar más')}</button>
			</div>
		</div>
	{/if}
	<div class="subs-head">
		<p class="muted">{match ? `${epLabel} · ${groupOf(match.release) || tr('tu torrent')}` : tr('Copiá el link de un torrent.')}</p>
		<button id="subs-tutorial" type="button" class="tut" onclick={() => (tutorialOpen = true)}><Icon name="help" size={15} />{tr('Cómo funciona')}</button>
	</div>
	<ul class="subs">
		<li class="grp">{tr('Vienen con el video')}</li>
		{#if !match}
			<li class="none">{tr('Sin confirmar · copiá un link')}</li>
		{:else if match.natives?.length}
			{#each match.natives as n (n.track)}
				{#snippet nativeActions()}
					<button id="sub-copy-native-{n.track}" type="button" class="iconbtn copy" aria-label={tr('Copiar el video con este subtítulo')} onclick={() => copyNative(n)}><Icon name="copy" size={18} /></button>
				{/snippet}
				{@render row({ key: `n${n.track}`, head: tr(n.label), spec: tr('{k} · pista {n}', { k: tr(n.kind), n: n.track }) }, nativeActions)}
			{/each}
		{:else}
			<li class="none">{tr('Este video no trae en español')}</li>
		{/if}

		{#if match && !subs && !searching && !subsError}
			<li>
				<button id="subs-search-more" type="button" class="more" onclick={searchSubs}>
					<Icon name="search" size={16} /><span><b>{tr('Buscar más subtítulos')}</b><span>{tr('Por si los del video no te sirven')}</span></span>
				</button>
			</li>
		{:else if searching}
			<li class="grp">{tr('Encontrados para vos')}</li>
			<li class="msg"><span class="spin"></span>{tr('Buscando en OpenSubtitles.org…')}</li>
		{:else if subs || subsError}
			<li class="grp">{tr('Encontrados para vos')}</li>
			{#if subsError && !subs}<li class="msg err">{subsError}</li>{:else if !ranked.length}<li class="none">{tr('No encontré en OpenSubtitles.org')}</li>{/if}
			{#each ranked as sub (sub.id)}
				{#snippet foundActions()}
					<a id="sub-{sub.id}" class="iconbtn dl" href="/api/subs/{sub.id}?{new URLSearchParams({ name: fileName, ext: sub.format })}" download aria-label={tr('Bajar el .{f}', { f: sub.format })}><Icon name="download" size={16} /></a>
					<button id="sub-copy-{sub.id}" type="button" class="iconbtn copy" aria-label={tr('Copiar link')} onclick={() => copySub(sub)}><Icon name="copy" size={18} /></button>
				{/snippet}
				{@render row({ key: `o${sub.id}`, head: headOf(sub), spec: specOf(sub), latino: sub.latino, lvl: sub.level, title: sub.release }, foundActions)}
			{/each}

			<!-- Premium, plegado (ELEGIDA): buscar es gratis y corre al abrir; cada "Copiar · 1" baja uno. -->
			{@const hot = tried.length >= 2 && quota?.hasKey}
			<li class="sep"></li>
			<li>
				<button id="prem-gate" type="button" class="gate" class:hot aria-expanded={prem.open} onclick={async () => { if (!quota) await loadQuota(); togglePremium(); }}>
					<span class="gi"><Icon name="lock" size={16} /></span>
					<span>
						<b>{hot ? tr('¿Ninguno anduvo? Buscá en Premium') : tr('Buscar en Premium')}</b>
						<span class="gs">{quota && !quota.hasKey ? tr('Necesita tu API key de opensubtitles.com') : hot ? tr('Probaste {n} y no sincronizaron · {q}', { n: tried.length, q: quotaText }) : tr('Último recurso · {q}', { q: quotaText })}</span>
					</span>
					<span class="chev" class:up={prem.open}><Icon name="chev" size={16} /></span>
				</button>
			</li>
			{#if prem.open}
				{#if quota && !quota.hasKey}
					<li class="msg"><Icon name="lock" size={15} /><span>{tr('Necesita tu API key de opensubtitles.com.')}</span><a id="prem-key" class="btn small-btn" href="/ajustes">{tr('Ajustes')}</a></li>
				{:else if prem.status === 'loading' || prem.status === 'idle'}
					<li class="msg"><span class="spin"></span>{tr('Buscando en opensubtitles.com…')}</li>
				{:else if prem.status === 'error'}
					<li class="msg err"><span>{tr('opensubtitles.com no respondió. No se gastó ninguna descarga.')}</span><button id="prem-retry" type="button" class="btn small-btn" onclick={premiumSearch}>{tr('Reintentar')}</button></li>
				{:else if prem.status === 'empty'}
					<li class="msg"><span>{tr('Tampoco hay en español para {x}. No se gastó ninguna descarga.', { x: epLabel })}</span></li>
				{:else}
					{#each premRanked as sub (sub.id)}
						{#snippet premActions()}
							<button id="prem-copy-{sub.id}" type="button" class="btn small-btn cost-btn" aria-disabled={quota?.remaining === 0} onclick={() => copyPremium(sub)}>
								{#if prem.busy === sub.id}<span class="spin"></span>{:else}<Icon name="copy" size={14} />{tr('Copiar')} <span class="cost">· 1</span>{/if}
							</button>
						{/snippet}
						{@render row({ key: `p${sub.id}`, head: headOf(sub), spec: specOf(sub), latino: sub.latino, lvl: sub.level, title: sub.release }, premActions)}
					{/each}
				{/if}
			{/if}
		{/if}
	</ul>
</Sheet>

<Sheet id="audio-sheet" title={tr('¿En qué audio?')} open={!!audioFor} onclose={() => (audioFor = null)}>
	{#if audioFor}
		<p class="muted audio-hint">{tr('Este video trae los dos. Elegí uno y se copia el link.')}</p>
		<div class="audio-opts">
			{#each audioFor.choices as c (c.label)}
				<button
					id="audio-{c.key}"
					type="button"
					class="audio-opt"
					onclick={() => {
						const t = /** @type {Torrent} */ (audioFor?.t);
						audioFor = null;
						copyUrl(t, c.url);
					}}
				>
					{c.label}
				</button>
			{/each}
		</div>
	{/if}
</Sheet>

<!-- Toast: `popover` va a la capa de arriba, así se ve también sobre la hoja de subtítulos. -->
<div id="copied-toast" class="toast" popover="manual" bind:this={toastEl} role="status">
	{#key copied}
		<svg class="toast-mark" viewBox="0 0 56 56" aria-hidden="true">
			<circle cx="28" cy="28" r="26" />
			<path d="M17 29l7.5 7.5L40 21" />
		</svg>
	{/key}
	<span class="toast-text">
		<strong>{tr('Link copiado')}</strong>
		<span>{copied?.kind === 'sub' ? tr('Pegalo en Web Video Caster: CC → link') : tr('Pegalo en Web Video Caster')}</span>
	</span>
	<button id="toast-tutorial" type="button" class="toast-btn" onclick={() => { copied = null; tutorialOpen = true; }}>{tr('Tutorial')}</button>
</div>

{#if tutorialOpen}
	<Tour id="cast-tour" label={tr('Cómo verlo en la tele')} open steps={castSteps(device())} onclose={() => (tutorialOpen = false)} />
{/if}

<Sheet id="link-sheet" title={tr('Link listo')} open={!!manual} onclose={() => (manual = null)}>
	{#if manual}
		<p class="muted small">{tr('Tocá Copiar para llevarlo al portapapeles.')}</p>
		<input id="link-input" class="link-input" readonly value={manual.url} onfocus={(ev) => ev.currentTarget.select()} />
		<div class="actions">
			<button id="link-copy" type="button" class="btn primary" onclick={copyManual}>
				<Icon name="copy" size={16} />{tr('Copiar')}
			</button>
			{#if manual.kind === 'video'}<a id="link-open" class="btn" href={manual.url} target="_blank" rel="noreferrer">{tr('Abrir')}</a>{/if}
		</div>
	{/if}
</Sheet>

<style>
	.torrents { margin-top: 8px; }
	.status { display: flex; align-items: center; gap: 10px; padding: 14px 0; margin: 0; font-size: 14px; }
	.row-skel { height: 132px; border-radius: var(--radius-card); margin-bottom: 10px; }


	.bar { position: sticky; top: calc(var(--safe-top) + 64px); z-index: 5; background: var(--bg); padding: 8px 0 6px; }
	.chips { display: flex; gap: 8px; overflow-x: auto; scrollbar-width: none; margin: 0 -16px; padding: 5px 16px; }
	.chips::-webkit-scrollbar { display: none; }
	.toggles { margin-top: 4px; }
	.toggle:not(.on) { border-style: dashed; background: transparent; color: var(--muted); }
	.summary { margin: 4px 0 0; font-size: 11.5px; color: color-mix(in srgb, var(--muted) 75%, transparent); font-variant-numeric: tabular-nums; }

	ul { list-style: none; margin: 0; padding: 0; }
	.opt {
		position: relative;
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		align-items: center;
		gap: 10px;
		padding: 10px 10px 10px 14px;
		margin-top: 8px;
		border-radius: 14px;
		background: var(--bg);
		border: 1px solid var(--border);
	}
	.info { min-width: 0; }
	/* La primera fila, como la mejor opción del desktop: tinte verde y etiqueta arriba. */
	.opt.best { margin-top: 18px; border-color: color-mix(in srgb, var(--green) 55%, var(--border)); background: color-mix(in srgb, var(--green) 6%, var(--bg)); }
	.best-tag { position: absolute; top: -9px; left: 14px; padding: 1px 8px; border-radius: 999px; font-size: 10px; font-weight: 800; letter-spacing: 0.04em; text-transform: uppercase; background: var(--green); color: var(--bg); }
	.copy {
		position: relative;
		display: grid;
		place-items: center;
		width: 44px;
		height: 44px;
		padding: 0;
		border-radius: 50%;
		border: 1px solid var(--border-strong);
		background: var(--surface);
		color: var(--text);
		transition: transform 0.2s var(--out), box-shadow 0.2s var(--ease), background 0.2s var(--ease);
	}
	.copy.primary { border-color: transparent; background: var(--accent); color: var(--accent-text); }
	.copy:active:not(:disabled) { transform: scale(0.92); }
	.copy.ok { border-color: transparent; background: var(--green); color: var(--bg); }
	.copy.err { border-color: var(--red); color: var(--red); }
	.copy:disabled { cursor: default; }
	.spin.light { border-color: rgb(255 255 255 / 0.35); border-top-color: #fff; }
	.top { display: flex; flex-wrap: wrap; align-items: center; gap: 5px 6px; }
	.size { font-size: 17.5px; font-weight: 750; letter-spacing: -0.02em; font-variant-numeric: tabular-nums; margin-right: 2px; }
	.tag {
		padding: 1px 6px;
		border-radius: 6px;
		border: 1.5px solid currentColor;
		font-size: 10.5px;
		font-weight: 750;
		letter-spacing: 0.05em;
		color: var(--muted);
		white-space: nowrap;
	}
	.tag.res { color: var(--accent-fg); }
	.tag.lat, .tag.es { color: var(--green); }
	.acts { display: flex; align-items: center; gap: 8px; }
	/* Badge de subs compacto (cc + ES): entra en la línea de los tags. (`.sub` ya es la fila de subtítulo.) */
	.tag.cc { display: inline-flex; align-items: center; gap: 3px; padding: 1px 5px 1px 4px; }
	.tag.tb { color: #3ecf8e; }
	/* "Verificar subtítulos": texto chico debajo de la calidad; sin borde ni caja, solo el color del acento. */
	.verify {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		min-height: 32px;
		margin: 2px 0 -6px;
		padding: 0;
		border: 0;
		background: none;
		color: var(--accent-fg);
		font-size: 12.5px;
		font-weight: 650;
	}
	button.verify:active { opacity: 0.6; }
	.verify.err { color: var(--amber); }
	.verify.busy { color: var(--muted); }
	.verify .spin { width: 12px; height: 12px; border-width: 2px; }
	.tag.nosub { color: var(--amber); border-color: color-mix(in srgb, var(--amber) 45%, transparent); background: color-mix(in srgb, var(--amber) 10%, transparent); }
	.quality { display: flex; align-items: center; gap: 5px; margin-top: 5px; color: var(--muted); font-size: 13.5px; }
	.stars { display: inline-flex; gap: 1px; color: color-mix(in srgb, var(--muted) 45%, transparent); }
	.stars :global(svg) { fill: currentColor; stroke-width: 1.5; }
	.stars .on { color: #e6b54a; }
	.qname { font-weight: 600; color: var(--text); }
	.qname.unknown { font-weight: 500; color: var(--muted); font-size: 13.5px; }
	.audio-hint { margin: 0 0 14px; font-size: 14px; }
	.audio-opts { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
	.audio-opt {
		min-height: 64px;
		border-radius: var(--radius-card);
		border: 1px solid var(--border-strong);
		background: var(--surface-2);
		font-size: 17px;
		font-weight: 700;
		transition: transform 0.15s var(--out), border-color 0.15s var(--ease);
	}
	.audio-opt:active { transform: scale(0.97); border-color: var(--accent-fg); }
	.toast {
		inset: auto 12px calc(16px + var(--safe-bottom)) 12px;
		margin: 0 auto;
		max-width: 420px;
		width: auto;
		display: none;
		align-items: center;
		gap: 12px;
		padding: 10px 10px 10px 12px;
		border: 1px solid var(--border);
		border-radius: 16px;
		background: color-mix(in srgb, var(--surface) 92%, transparent);
		backdrop-filter: blur(14px);
		-webkit-backdrop-filter: blur(14px);
		color: var(--text);
		box-shadow: 0 10px 30px var(--shadow-lg);
	}
	.toast:popover-open { display: flex; animation: toast-in 0.32s var(--out); }
	@keyframes toast-in { from { transform: translateY(24px); opacity: 0; } }
	.toast-mark { flex: none; width: 34px; height: 34px; fill: none; stroke-linecap: round; stroke-linejoin: round; }
	.toast-mark circle { fill: color-mix(in srgb, var(--green) 16%, transparent); stroke: var(--green); stroke-width: 3; transform-origin: center; animation: ring 0.45s var(--out) both; }
	.toast-mark path { stroke: var(--green); stroke-width: 5; stroke-dasharray: 36; stroke-dashoffset: 36; animation: draw 0.35s 0.2s var(--out) forwards; }
	@keyframes ring { from { transform: scale(0.6); opacity: 0; } }
	@keyframes draw { to { stroke-dashoffset: 0; } }
	@media (prefers-reduced-motion: reduce) { .toast-mark path { stroke-dashoffset: 0; } }
	.toast-text { flex: 1; min-width: 0; display: flex; flex-direction: column; font-size: 13px; color: var(--muted); }
	.toast-text strong { font-size: 14.5px; color: var(--text); }
	.toast-btn { flex: none; min-height: 36px; padding: 0 12px; border: 0; border-radius: 999px; background: var(--surface-3); color: var(--text); font-size: 13px; font-weight: 650; position: relative; }
	.toast-btn::after { content: ''; position: absolute; inset: -4px 0; }
	.small { font-size: 12.5px; margin: 6px 0 0; }
	.actions { display: grid; grid-template-columns: 1fr auto; gap: 8px; margin-top: 10px; }
	.subs-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 4px; }
	.subs-head p { margin: 0; font-size: 13px; }
	.small-btn { min-height: 36px; padding: 0 12px; font-size: 13px; position: relative; }
	.small-btn::after { content: ''; position: absolute; inset: -4px 0; }
	.subs { margin-top: 4px; }
	.grp { padding: 14px 0 4px; font-size: 11px; font-weight: 800; letter-spacing: 0.06em; text-transform: uppercase; color: var(--dim, var(--muted)); }
	.none { padding: 2px 0 8px 28px; font-size: 12.5px; color: var(--muted); font-style: italic; }
	.msg { display: flex; align-items: center; gap: 8px; padding: 10px 0; font-size: 13px; color: var(--muted); }
	.msg .btn { margin-left: auto; }
	.msg.err { color: var(--red); }
	.sep { height: 1px; margin: 10px 0 6px; background: var(--border); }
	.sub { display: grid; grid-template-columns: 18px minmax(0, 1fr) auto auto; align-items: center; gap: 8px; min-height: 52px; padding: 4px 4px 4px 6px; border-radius: 10px; }
	.sub.on { background: color-mix(in srgb, var(--accent) 16%, transparent); }
	.mark { display: grid; place-items: center; color: var(--accent-fg); }
	.sub-text { min-width: 0; display: flex; flex-direction: column; gap: 1px; color: var(--text); }
	.l1 { display: flex; align-items: baseline; gap: 7px; min-width: 0; white-space: nowrap; overflow: hidden; }
	.l1 b { font-size: 14px; font-weight: 650; }
	.spec { font-size: 13px; color: var(--muted); overflow: hidden; text-overflow: ellipsis; }
	.lat { align-self: center; padding: 0 4px; border: 1px solid var(--border-strong); border-radius: 4px; font-size: 10px; font-weight: 700; letter-spacing: 0.04em; color: var(--muted); }
	.why { font-size: 11px; color: var(--muted); }
	.sub.tried b, .sub.tried .spec { color: var(--muted); text-decoration: line-through; }
	/* Nivel de match (ELEGIDA): palabra con color; el ámbar queda para lo que cuesta cuota. */
	.fit { font-size: 11px; font-weight: 500; }
	.fit.l3 { color: light-dark(#12733a, #4ade80); font-weight: 600; }
	.fit.l2 { color: light-dark(#3d7a55, #b5d86a); }
	.fit.l1 { color: light-dark(#76681c, #d9a85b); }
	.iconbtn { display: grid; place-items: center; width: 40px; height: 40px; border: 0; border-radius: 10px; background: none; color: var(--muted); }
	.iconbtn.dl { width: 34px; }
	.iconbtn.copy { color: var(--accent-fg); background: color-mix(in srgb, var(--accent) 12%, transparent); }
	.cost { color: light-dark(#9a5b00, #f5b041); font-weight: 700; }
	.cost-btn { grid-column: span 2; display: inline-flex; align-items: center; gap: 6px; }
	.cost-btn[aria-disabled='true'] { opacity: 0.45; }
	.more, .gate { display: grid; align-items: center; gap: 10px; width: 100%; padding: 10px 12px; border-radius: 12px; color: var(--text); text-align: left; }
	.more { grid-template-columns: 28px minmax(0, 1fr); margin-top: 6px; border: 1px dashed var(--border-strong); background: none; }
	.more :global(svg) { justify-self: center; color: var(--accent-fg); }
	.more b, .gate b { display: block; font-size: 14px; }
	.more span span, .gs { font-size: 12px; color: var(--muted); }
	.gate { grid-template-columns: 30px minmax(0, 1fr) auto; border: 1px solid var(--border); background: var(--surface); }
	.gate.hot { border-color: color-mix(in srgb, light-dark(#9a5b00, #f5b041) 70%, var(--border)); background: color-mix(in srgb, light-dark(#9a5b00, #f5b041) 7%, var(--surface)); }
	.gi { display: grid; place-items: center; width: 30px; height: 30px; border-radius: 8px; background: var(--surface-3); color: light-dark(#9a5b00, #f5b041); }
	.chev { display: inline-flex; color: var(--muted); transition: transform 0.2s var(--ease); }
	.chev.up { transform: rotate(180deg); }
	.tut { display: inline-flex; align-items: center; gap: 6px; min-height: 36px; padding: 0 12px; border: 1px solid var(--border-strong); border-radius: 999px; background: var(--surface); font-size: 13px; font-weight: 600; }
	.tut :global(svg) { color: var(--accent-fg); }
	.offer {
		display: grid;
		grid-template-columns: 40px 1fr;
		gap: 4px 12px;
		margin-bottom: 14px;
		padding: 14px;
		border-radius: 14px;
		background: color-mix(in srgb, var(--accent) 10%, var(--surface));
		border: 1px solid color-mix(in srgb, var(--accent) 30%, transparent);
		animation: offer-in 0.45s var(--out) both;
	}
	@keyframes offer-in { from { opacity: 0; transform: translateY(-8px); } }
	.offer-icon { width: 40px; height: 40px; display: grid; place-items: center; border-radius: 12px; background: color-mix(in srgb, var(--accent) 18%, transparent); color: var(--accent-fg); }
	.offer-text { display: flex; flex-direction: column; gap: 2px; font-size: 14px; }
	.offer-text strong { font-size: 15px; }
	.offer-text span { color: var(--muted); }
	.offer-actions { grid-column: 1 / -1; display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-top: 10px; }
	.offer-actions .btn { flex: 1; height: 44px; }
	.link-btn { flex-basis: 100%; min-height: 36px; border: 0; background: none; color: var(--muted); font-size: 13px; text-decoration: underline; text-underline-offset: 3px; }
	@media (prefers-reduced-motion: reduce) { .offer { animation: none; } }
	.link-input { width: 100%; height: 44px; margin: 10px 0 0; padding: 0 10px; border-radius: var(--radius); border: 1px solid var(--border-strong); background: var(--surface-2); font-size: 16px; }
</style>
