<script>
	// Torrents de un video que TorBox tiene en caché, en pasos (como el desktop): buscando (fuente por fuente) →
	// ¿audio latino? (búsqueda por escalones) → calidad → lista, con migas para volver. Por fila: peso, calidad de
	// imagen, audio y subs en español, y copiar el link https de TorBox. Los subtítulos son de cada torrent: aparecen
	// al copiar su link (nativos primero; si no trae, se buscan afuera; Premium plegado al final).
	import Icon from './Icon.svelte';
	import Sheet from './Sheet.svelte';
	import Tour from './Tour.svelte';
	import { castSteps, device } from './tours.js';
	import * as saved from './saved.js';
	import { loc, t as tr } from './i18n.svelte.js';
	import { untrack } from 'svelte';
	import { audioOf, isLatino, latBadge } from './audio.js';

	/** `orig`: idioma original (ISO 639-1 de TMDB): el audio que sale por defecto. @type {{imdb: string, s?: number | null, e?: number | null, name: string, orig?: string | null}} */
	let { imdb, s = null, e = null, name, orig = null } = $props();

	/** @typedef {{hash: string, release: string, file: string | null, res: string | null, hdr: string[], source: string | null, lat: boolean, multi: boolean, size: number | null, seeds: number, addons: string[], subFile: boolean, doubt?: boolean}} Torrent */
	/** @typedef {{id: string, release: string, latino: boolean, format: string, downloads: number, exact?: boolean, fps?: number | null, last?: number | null, group?: string, premium?: boolean}} Sub */
	/** @typedef {{label: string, kind: string, track: number, url: string}} Native */
	/** @typedef {{hasKey: boolean, remaining: number | null, perDay: number | null, resetsAt: number | null, login?: string | null}} Quota */

	/** Calidades del paso 3, en orden; `other` junta lo que no es 4K/1080p/720p (o no lo dice). */
	const RES = /** @type {const} */ ([
		['2160p', '4K'],
		['1080p', '1080p'],
		['720p', '720p'],
		['other', 'Otras']
	]);
	/** @param {Torrent} t */
	const resOf = (t) => (t.res === '2160p' || t.res === '1080p' || t.res === '720p' ? t.res : 'other');
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
	let onlyHdr = $state(false);
	/** Solo las que ya se sabe que traen subs en español (verificadas o con .srt en el torrent). */
	let onlyEs = $state(false);
	/** Estado del botón copiar por hash. @type {Record<string, 'busy' | 'ok' | 'err'>} */
	let copy = $state({});
	/** Link que el navegador no dejó copiar solo (http en la LAN): se muestra para copiarlo a mano. */
	let manual = $state(/** @type {{url: string, release: string, kind: 'video' | 'sub', t?: Torrent} | null} */ (null));
	/** Hoja "¡Link copiado!" del video recién copiado: si trae subs en español y, si no, ver los disponibles. */
	let linkDone = $state(/** @type {Torrent | null} */ (null));
	/** El link de video copiado; si es de descarga (no stream), la versión para Web Video Caster y si ya se copió. */
	let doneUrl = $state('');
	let wvcCopied = $state(false);
	/** Link de descarga dentro de /play.html (un <video> que Web Video Caster detecta); el link va después del #. */
	const wvcUrl = $derived(/\.tb-cdn\./.test(doneUrl) && !/\.m3u8/.test(doneUrl) ? `${location.origin}/play.html#${encodeURIComponent(doneUrl)}` : '');
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
	/** "Buscando torrents… 2 de 4 fuentes" / "Chequeando TorBox". */
	let progress = $state(/** @type {{done: number, total: number, torbox: boolean}} */ ({ done: 0, total: 0, torbox: false }));
	$effect(() => {
		const url = `/api/torrents?${qs}`;
		const ctrl = new AbortController();
		const hit = saved.peek(url);
		untrack(() => {
			error = '';
			copy = {};
			resetSubs();
			match = null;
			goStep('audio');
			wantLat = false;
			autoReads = 0;
			progress = { done: 0, total: 0, torbox: false };
			// Lista guardada 1 hora (saved.js): se pinta en este mismo cuadro, sin pasar por la búsqueda.
			data = hit;
		});
		if (!hit) search(url, ctrl.signal);
		return () => {
			ctrl.abort();
			gen++;
		};
	});
	/** Lee la respuesta en líneas (progreso por fuente y al final la lista) y la guarda 1 hora.
	 * @param {string} url @param {AbortSignal} signal */
	async function search(url, signal) {
		try {
			const r = await fetch(url, { signal });
			if (!r.body) throw new Error(tr('No se pudieron buscar'));
			const reader = r.body.pipeThrough(new TextDecoderStream()).getReader();
			let buf = '';
			for (;;) {
				const { done, value } = await reader.read();
				if (done) break;
				buf += value;
				let nl;
				while ((nl = buf.indexOf('\n')) >= 0) {
					const msg = JSON.parse(buf.slice(0, nl));
					buf = buf.slice(nl + 1);
					if (msg.stage === 'sources') progress = { done: msg.done, total: msg.total, torbox: false };
					else if (msg.stage === 'torbox') progress.torbox = true;
					else if (msg.error) error = msg.error;
					else if (msg.result) {
						data = msg.result;
						saved.store(url, msg.result, saved.HOUR);
					}
				}
			}
		} catch (err) {
			if (!signal.aborted) error = /** @type {Error} */ (err).message;
		}
	}

	// ── Pasos ────────────────────────────────────────────────────────────────────────────────────────────────
	/** Paso actual. `latin`: búsqueda de audio latino por escalones; `list`: opciones de la calidad elegida. */
	let step = $state(/** @type {'audio' | 'latin' | 'quality' | 'list'} */ ('audio'));
	let wantLat = $state(false);
	let quality = $state(/** @type {(typeof RES)[number][0]} */ ('2160p'));
	/** Cada cambio de paso (o de video) invalida lo que se estaba leyendo: los bucles miran este número. */
	let gen = 0;
	/** @param {'audio' | 'latin' | 'quality' | 'list'} to */
	function goStep(to) {
		gen++;
		reading = false;
		step = to;
	}

	const all = $derived(data?.list ?? []);
	/** @param {Torrent} t */
	const latOf = (t) => isLatino(t, known(t));
	/** @param {Torrent} t */
	const known = (t) => {
		const v = info[t.hash];
		return v && typeof v === 'object' ? v : null;
	};
	/** Dudosos (MULTI / Dual / español sin aclarar): se confirman leyendo pistas, hasta 10. */
	const doubts = $derived(all.filter((t) => t.doubt && !t.lat).slice(0, 10));
	/** "Seguir buscando": las demás (menos probables), de a 5 y hasta 10. */
	const rest = $derived(all.filter((t) => !t.lat && !t.doubt && !known(t)?.audio));
	let extraRead = $state(0);
	const latin = $derived({
		confirmed: all.filter((t) => known(t)?.audio === 'lat').length,
		byName: all.filter((t) => t.lat && !known(t)?.audio).length,
		unsure: all.filter((t) => known(t)?.audio === 'es').length
	});
	/** Mientras se leen pistas (búsqueda de latino o subs automáticos): muestra Detener. */
	let reading = $state(false);

	/** Lee las pistas de `items` de a una (las que todavía no se leyeron). Se corta si cambia el paso o el video, o
	 * cuando `enough` dice que alcanza. @param {Torrent[]} items @param {(t: Torrent) => boolean} [enough] */
	async function readAll(items, enough = () => false) {
		const my = ++gen;
		reading = true;
		for (const t of items) {
			if (my !== gen) return;
			if (known(t)?.audio) {
				if (enough(t)) break;
				continue;
			}
			await probe(t);
			if (my !== gen) return;
			if (enough(t)) break;
		}
		if (my === gen) reading = false;
	}
	/** @param {boolean} lat */
	function chooseAudio(lat) {
		wantLat = lat;
		extraRead = 0;
		if (!lat) return goStep('quality');
		goStep('latin');
		readAll(doubts);
	}
	function searchMore() {
		const next = rest.slice(0, Math.min(5, 10 - extraRead));
		extraRead += next.length;
		readAll(next);
	}

	/** Paso 3: por calidad, cuántas hay y (con latino) cuántas lo traen. */
	const qualities = $derived(
		RES.map(([v, l]) => {
			const items = all.filter((t) => resOf(t) === v);
			return { v, l, total: items.length, lat: items.filter(latOf).length, sure: items.filter((t) => known(t)?.audio === 'lat').length };
		}).filter((q) => q.total)
	);
	/** Con latino pedido y ninguna en esa calidad: se muestran todas, avisando. */
	const noLatHere = $derived(wantLat && !all.some((t) => resOf(t) === quality && latOf(t)));
	/** @param {(typeof RES)[number][0]} v */
	function chooseQuality(v) {
		quality = v;
		goStep('list');
		autoSubs();
	}
	const list = $derived(
		all.filter((t) => resOf(t) === quality && (!wantLat || noLatHere || latOf(t)) && (!onlyHdr || t.hdr.length) && (!onlyEs || hasEs(t)))
	);
	/** Lecturas automáticas por video (tope 5): en el orden de la lista, hasta dar con una con sub ES (y latino
	 * confirmado si se pidió). El resto queda con "Verificar subtítulos". */
	let autoReads = 0;
	function autoSubs() {
		const good = (/** @type {Torrent} */ t) => (known(t)?.subs ?? 0) > 0 && (!wantLat || known(t)?.audio === 'lat');
		if (list.some(good)) return;
		const left = Math.max(0, 5 - autoReads);
		const items = list.filter((t) => !known(t)?.audio).slice(0, left);
		autoReads += items.length;
		if (items.length) readAll(items, good);
	}
	/** @param {Torrent} t */
	const hasEs = (t) => t.subFile || (known(t)?.subs ?? 0) > 0;
	const still = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
	/** Entrada de cada paso: sube un poco y aparece. @param {Element} _ */
	const stepIn = (_) => ({
		duration: still() ? 0 : 320,
		css: (/** @type {number} */ x) => `transform: translateY(${(1 - x) * 10}px); opacity: ${x};`
	});
	/** El video que copiaste: los subtítulos se ordenan por cuánto calzan con él. */
	let match = $state(/** @type {{hash: string, release: string, natives?: Native[], file?: {hash: string, size: string}, video?: {fps: number | null, duration: number | null}} | null} */ (null));
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
	console.assert((() => { const s = { id: '', latino: false, format: '', downloads: 0 }; const old = match; match = { hash: '', release: 'X.WEB-DL-NTb', video: { fps: 23.976, duration: 3000 } };
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
	/** Opción cuyas pistas de audio se muestran (Audio ES · validar latino). */
	let tracksOf = $state(/** @type {Torrent | null} */ (null));
	let audioFor = $state(/** @type {{t: Torrent, choices: {key: string, label: string, url: string}[]} | null} */ (null));

	/** Lo leído de cada torrent (subs en español y audio, ver audio.js), 'busy' mientras se lee o 'err' si falló.
	 * Es del torrent y no cambia: se guarda para siempre (saved.remember). */
	let info = $state(/** @type {Record<string, import('./audio.js').Tracks | 'busy' | 'err' | null>} */ ({}));
	$effect(() => {
		for (const t of data?.list ?? []) if (!(t.hash in info)) info[t.hash] = saved.recall(`tracks:${t.hash}`);
	});
	/** @param {string} hash @param {import('./audio.js').Tracks} v */
	function know(hash, v) {
		info[hash] = v;
		saved.remember(`tracks:${hash}`, v);
	}
	/** Lee el encabezado del video (subs y audios). Con `ids` (del link recién copiado) es un pedido a TorBox; sin
	 * ellos, también agrega el torrent. false si falló. @param {Torrent} t @param {{tid: number, fid: number}} [ids] */
	async function probe(t, ids) {
		info[t.hash] = 'busy';
		try {
			const r = await fetch(`/api/tracks?${qs}&${new URLSearchParams({ hash: t.hash, name: t.release, file: t.file ?? '', ...(ids ? { tid: String(ids.tid), fid: String(ids.fid) } : {}) })}`);
			if (!r.ok) throw new Error();
			const j = await r.json();
			know(t.hash, { subs: j.subs.length, audio: audioOf(j.audios), audios: j.audios });
			return true;
		} catch {
			info[t.hash] = 'err';
			return false;
		}
	}
	/** @param {Torrent} t */
	const subBadge = (t) => {
		const n = known(t)?.subs;
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
		// Link de descarga (plan sin streaming): de paso se leen sus pistas, sin volver a agregar el torrent.
		if (got.ids && !known(t)) probe(t, got.ids);
		else if (got.subsEs != null && !known(t)) know(t.hash, { subs: got.subsEs, audio: null });
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
	/** Subtítulos de un torrent, con lo que ya trajo su link (sin volver a TorBox). Si el video trae en español lo dice
	 * `info` (una sola fuente para la opción y este panel); `natives` son esos mismos subs como links del stream (solo
	 * con streaming en el plan). Buscar afuera es a pedido ("Ver subtítulos disponibles").
	 * @param {Torrent} t @param {{hash: string, size: string} | undefined} [file] @param {Native[]} [natives]
	 * @param {{fps: number | null, duration: number | null}} [video] */
	function subsFor(t, file, natives, video) {
		resetSubs();
		match = { hash: t.hash, release: t.release, natives, file, video };
	}
	/** Abre los subtítulos de `t` y busca afuera. @param {Torrent} t */
	function showSubs(t) {
		if (match?.hash !== t.hash) subsFor(t);
		linkDone = null;
		subsOpen = true;
		if (!subs && !searching) searchSubs();
	}
	/** Subs en español del video que tiene abierto el panel (de `info`). */
	const matchInfo = $derived(match ? info[match.hash] : null);
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
		doneUrl = url;
		wvcCopied = false;
		if (copyNow(url)) return done(t, 'ok');
		try {
			await navigator.clipboard.writeText(url);
			done(t, 'ok');
		} catch {
			manual = { url, release: t.release, kind: 'video', t };
		}
	}
	/** @param {Torrent} t @param {'ok' | 'err'} st */
	function done(t, st) {
		copy[t.hash] = st;
		if (st === 'ok') linkDone = t;
		setTimeout(() => copy[t.hash] === st && delete copy[t.hash], 2500);
	}
	/** Botón Copiar de la hoja manual: dentro del toque, así iOS lo deja copiar. Si tampoco, queda el campo para mantener apretado. */
	function copyManual() {
		if (manual && copyNow(manual.url)) {
			if (manual.t) linkDone = manual.t;
			else copied = { kind: manual.kind, name: manual.release };
			manual = null;
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
		<!-- Paso 1: hasta que terminan TODAS las fuentes y el chequeo de TorBox. -->
		<div class="searching" role="status">
			<span class="spin"></span>
			<span>
				<strong>{tr('Buscando torrents…')}</strong>
				<span class="muted">{progress.torbox ? tr('Viendo cuáles tiene TorBox') : progress.total ? tr('{n} de {d} fuentes', { n: progress.done, d: progress.total }) : ''}</span>
			</span>
		</div>
		{#if progress.total}<div class="meter" aria-hidden="true"><i style:width="{progress.torbox ? 100 : (progress.done / progress.total) * 90}%"></i></div>{/if}
	{:else if error && !data}
		<p class="status error" role="alert">{error}</p>
	{:else if data && !all.length}
		<p class="status muted">{tr('No hay torrents en TorBox para esto.')}</p>
	{:else if data}
		{#if step !== 'audio'}
			<nav class="crumbs" aria-label={tr('Ruta')}>
				<button id="crumb-torbox" type="button" onclick={() => goStep('audio')}>TorBox</button>
				<span aria-hidden="true">›</span>
				{#if step === 'latin'}
					<span aria-current="page">{tr('Audio latino')}</span>
				{:else}
					<button id="crumb-audio" type="button" onclick={() => goStep(wantLat ? 'latin' : 'audio')}>{wantLat ? tr('Audio latino') : tr('Audio original')}</button>
					<span aria-hidden="true">›</span>
					{#if step === 'quality'}
						<span aria-current="page">{tr('Calidad')}</span>
					{:else}
						<button id="crumb-quality" type="button" onclick={() => goStep('quality')}>{tr(RES.find(([v]) => v === quality)?.[1] ?? '')}</button>
					{/if}
				{/if}
			</nav>
		{/if}

		{#key step}
			<div class="step" in:stepIn>
				{#if step === 'audio'}
					<h3 class="ask">{tr('¿Necesitás audio latino?')}</h3>
					<div class="choices">
						<button id="audio-any" type="button" class="choice" onclick={() => chooseAudio(false)}>
							<strong>{tr('Audio original')}</strong>
							<span class="muted">{tr('{n} opciones en TorBox', { n: all.length })}</span>
						</button>
						<button id="audio-lat" type="button" class="choice" onclick={() => chooseAudio(true)}>
							<strong>{tr('Solo audio latino')}{#if doubts.length}<span class="slow">{tr('Demora más')}</span>{/if}</strong>
							<span class="muted">{[tr('{n} lo dicen en el nombre', { n: all.filter((t) => t.lat).length }), doubts.length ? tr('reviso los audios de {n} dudosos (MULTI / Dual)', { n: doubts.length }) : '', doubts.length ? `~${doubts.length * 3} s` : ''].filter(Boolean).join(' · ')}</span>
						</button>
					</div>
				{:else if step === 'latin'}
					<h3 class="ask">{tr('Audio latino')}</h3>
					<p class="latsum">{tr('{a} con latino confirmado · {b} según el nombre · {c} en español sin aclarar', { a: latin.confirmed, b: latin.byName, c: latin.unsure })}</p>
					{#if reading}
						<p class="status"><span class="spin"></span>{tr('Revisando audios…')}<button id="latin-stop" type="button" class="link-btn inline" onclick={() => goStep('latin')}>{tr('Detener')}</button></p>
					{/if}
					<div class="choices">
						<button id="latin-quality" type="button" class="choice primary" onclick={() => goStep('quality')}><strong>{tr('Elegir la calidad')}</strong></button>
						{#if !reading && rest.length && extraRead < 10}
							<button id="latin-more" type="button" class="choice" onclick={searchMore}>
								<strong>{tr('Seguir buscando · {n} más', { n: Math.min(5, rest.length, 10 - extraRead) })}</strong>
								<span class="muted">{tr('Menos probables: no dicen idioma en el nombre')}</span>
							</button>
						{/if}
					</div>
				{:else if step === 'quality'}
					<h3 class="ask">{tr('¿Qué calidad?')}</h3>
					<div class="choices grid">
						{#each qualities as q (q.v)}
							{@const off = wantLat && !q.lat}
							<button id="quality-{q.v}" type="button" class="choice" class:off onclick={() => chooseQuality(q.v)}>
								<strong>{tr(q.l)}</strong>
								<span class="muted">
									{#if !wantLat}{tr('{n} opciones', { n: q.total })}
									{:else if off}{tr('Ninguna con latino · ver las {n} igual', { n: q.total })}
									{:else}{tr('{n} con latino ({m} confirmados) de {t}', { n: q.lat, m: q.sure, t: q.total })}{/if}
								</span>
							</button>
						{/each}
					</div>
				{:else}
					<div class="bar">
						<div class="chips toggles" role="toolbar" aria-label={tr('Filtros de torrents')}>
							<button id="only-hdr" type="button" class="chip toggle" class:on={onlyHdr} aria-pressed={onlyHdr} onclick={() => (onlyHdr = !onlyHdr)}>HDR</button>
							<button id="only-es" type="button" class="chip toggle" class:on={onlyEs} aria-pressed={onlyEs} title={tr('Solo las verificadas que traen subtítulos en español')} onclick={() => (onlyEs = !onlyEs)}><Icon name="subs" size={14} />{tr('Subs ES')}</button>
						</div>
						<p class="summary" title={tr('TorBox es un servicio pago que baja torrents a sus servidores y te los pasa como video en línea. Estas opciones ya las tiene bajadas: el link se ve al instante en la tele, sin depender de los seeds.')}>{tr('{n} de {f} en TorBox · por tamaño', { n: list.length, f: all.filter((t) => resOf(t) === quality).length })}</p>
					</div>
					{#if noLatHere}<p class="status muted">{tr('Ninguna de esta calidad trae latino: se muestran todas.')}</p>{/if}
					{#if reading}<p class="status"><span class="spin"></span>{tr('Viendo cuál trae subtítulos en español…')}<button id="list-stop" type="button" class="link-btn inline" onclick={() => goStep('list')}>{tr('Detener')}</button></p>{/if}
					{#if error}<p class="status error" role="alert">{error}</p>{/if}
					{#if !list.length}<p class="status muted">{tr('No hay opciones con estos filtros.')}</p>{/if}
					{@render options()}
				{/if}
			</div>
		{/key}
	{/if}
</section>

<!-- Las opciones de la calidad elegida (último paso). -->
{#snippet options()}
	<ul>
		{#each list as t, i (t.hash)}
			{@const q = t.source ? QUALITY[t.source] : null}
			{@const sb = subBadge(t)}
			{@const lb = latBadge(t, known(t))}
			<li class="opt" class:best={i === 0}>
				{#if i === 0}<span class="best-tag">{tr('Más pesada')}</span>{/if}
				<div class="info">
				<div class="top">
					<span class="size">{gb(t.size)}</span>
					{#if t.res}<span class="tag res">{t.res === '2160p' ? '4K' : t.res}</span>{/if}
					{#if t.hdr.length}<span class="tag hdr">HDR</span>{/if}
					{#if lb?.kind === 'es'}
						<button id="audio-info-{t.hash}" type="button" class="tag act" title={tr(lb.title)} onclick={() => (tracksOf = t)}><Icon name="volume" size={13} />{tr(lb.text)}</button>
					{:else if lb?.kind === 'doubt' && info[t.hash] === 'busy'}
						<span class="tag act busy" role="status"><span class="spin"></span>{tr('Leyendo audios…')}</span>
					{:else if lb?.kind === 'doubt'}
						<button id="audio-check-{t.hash}" type="button" class="tag act" title={tr(lb.title)} onclick={() => probe(t)}><Icon name="volume" size={13} />{tr(lb.text)}</button>
					{:else if lb}<span class="tag audio {lb.kind}" title={tr(lb.title)}>{tr(lb.text)}</span>{/if}
					<span class="tag tb" title={tr('TorBox es un servicio pago que baja torrents a sus servidores y te los pasa como video en línea. Estas opciones ya las tiene bajadas: el link se ve al instante en la tele, sin depender de los seeds.')}>TorBox</span>
					{#if sb?.on}<span class="tag cc es" title={sb.title} aria-label={sb.title}><Icon name="subs" size={13} />ES</span>
					{:else if sb}<button id="find-subs-{t.hash}" type="button" class="tag act" title={sb.title} onclick={() => showSubs(t)}><Icon name="subs" size={13} />{tr('Buscar subs ES')}</button>{/if}
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
				{#if !sb && info[t.hash] === 'busy'}
					<span class="verify busy" role="status"><span class="spin"></span>{tr('Verificando…')}</span>
				{:else if !sb}
					<button
						id="probe-{t.hash}"
						type="button"
						class="verify"
						class:err={info[t.hash] === 'err'}
						title={info[t.hash] === 'err' ? tr('No se pudo ver: tocá para reintentar') : tr('Ver si trae subtítulos en español')}
						onclick={() => probe(t)}
					><Icon name="subs" size={14} />{info[t.hash] === 'err' ? tr('Reintentar') : tr('Verificar subtítulos')}</button>
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
{/snippet}

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
		{:else if matchInfo === 'busy'}
			<li class="msg"><span class="spin"></span>{tr('Viendo si trae subtítulos en español…')}</li>
		{:else if matchInfo && typeof matchInfo === 'object' && matchInfo.subs > 0}
			<li class="msg">{tr(matchInfo.subs > 1 ? 'Trae {n} subtítulos en español: elegilos con CC en el reproductor.' : 'Trae {n} subtítulo en español: elegilo con CC en el reproductor.', { n: matchInfo.subs })}</li>
		{:else if matchInfo && typeof matchInfo === 'object'}
			<li class="none">{tr('Este video no trae en español')}</li>
		{:else}
			<li class="none">{tr('Sin confirmar')}</li>
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

<!-- Pistas de audio de una opción con español sin variante: qué dicen, y que latino o España se sabe escuchándolo. -->
<Sheet id="tracks-sheet" title={tr('Pistas de audio')} open={!!tracksOf} onclose={() => (tracksOf = null)}>
	{#if tracksOf}
		{@const a = known(tracksOf)?.audios}
		<p class="muted audio-hint">{tr('Ninguna dice latino ni España: se sabe escuchándolo.')}</p>
		{#if a?.length}
			<ul class="tracks">
				{#each a as x, i (i)}<li><b>{x.language}</b><span>{x.title || '—'}</span></li>{/each}
			</ul>
		{:else}
			<p class="muted small">{tr('No guardé el detalle de sus pistas: verificalo de nuevo para verlo.')}</p>
		{/if}
	{/if}
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

<!-- Al copiar el link de un video: confirmación, si trae subs en español (de `info`) y, abajo, el tutorial. -->
<Sheet id="copied-sheet" title={tr('¡Link copiado!')} open={!!linkDone} onclose={() => (linkDone = null)}>
	{#if linkDone}
		{@const v = info[linkDone.hash]}
		{@const k = known(linkDone)}
		<div class="done-head">
			<svg class="toast-mark" viewBox="0 0 56 56" aria-hidden="true"><circle cx="28" cy="28" r="26" /><path d="M17 29l7.5 7.5L40 21" /></svg>
			<span>{tr('Pegalo en Web Video Caster o en tu reproductor.')}</span>
		</div>
		{#if v === 'busy'}
			<p class="native"><span class="spin"></span>{tr('Viendo si trae subtítulos en español…')}</p>
		{:else if (k?.subs ?? 0) > 0 || linkDone.subFile}
			<p class="native yes"><Icon name="subs" size={18} />{k?.subs ? tr(k.subs > 1 ? 'Trae {n} subtítulos en español: elegilos con CC en el reproductor.' : 'Trae {n} subtítulo en español: elegilo con CC en el reproductor.', { n: k.subs }) : tr('El torrent trae un archivo de subtítulo en español')}</p>
		{:else}
			<p class="native"><Icon name="subs" size={18} />{k ? tr('No trae subtítulos en español.') : tr('No pude ver si trae subtítulos en español.')}</p>
			<button id="see-subs" type="button" class="btn primary see-subs" onclick={() => linkDone && showSubs(linkDone)}><Icon name="search" size={16} />{tr('Ver subtítulos disponibles')}</button>
		{/if}
		{#if wvcUrl}
			<button id="copy-wvc" type="button" class="btn wvc" onclick={() => (wvcCopied = copyNow(wvcUrl))}>
				<Icon name={wvcCopied ? 'check' : 'cast'} size={16} />{wvcCopied ? tr('Copiado: pegalo en Web Video Caster') : tr('Copiar para Web Video Caster')}
			</button>
		{/if}
		<button id="cast-line" type="button" class="cast-line" onclick={() => { linkDone = null; tutorialOpen = true; }}><Icon name="cast" size={15} /><span>{tr('¿Lo vas a ver en la tele?')} <u>{tr('Cómo mandarlo')}</u></span></button>
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


	.bar { position: sticky; top: calc(var(--safe-top) + 64px); z-index: 5; background: var(--bg); padding: 8px 0 6px; }
	.chips { display: flex; gap: 8px; overflow-x: auto; scrollbar-width: none; margin: 0 -16px; padding: 5px 16px; }
	.chips::-webkit-scrollbar { display: none; }
	.toggles { margin-top: 0; }
	/* Pasos */
	.searching { display: flex; align-items: center; gap: 12px; padding: 16px 0 10px; font-size: 14px; }
	.searching > span:last-child { display: flex; flex-direction: column; gap: 2px; }
	.meter { height: 4px; border-radius: 99px; background: var(--surface-3); overflow: hidden; }
	.meter i { display: block; height: 100%; background: var(--accent); border-radius: inherit; transition: width 0.4s var(--out); }
	.crumbs { display: flex; flex-wrap: wrap; align-items: center; gap: 2px 6px; margin: 4px 0 2px; font-size: 13.5px; font-weight: 650; color: var(--muted); }
	.crumbs button { min-height: 36px; padding: 0 2px; border: 0; background: none; color: var(--accent-fg); font: inherit; }
	.crumbs button:active { opacity: 0.6; }
	.ask { margin: 10px 0 10px; font-size: 16px; }
	.choices { display: flex; flex-direction: column; gap: 8px; }
	.choices.grid { display: grid; grid-template-columns: 1fr 1fr; }
	.choice { display: flex; flex-direction: column; align-items: flex-start; gap: 3px; min-height: 64px; padding: 12px 14px; border: 1px solid var(--border); border-radius: 14px; background: var(--surface); text-align: left; transition: background 0.2s var(--ease), transform 0.15s var(--out); }
	.choice strong { display: inline-flex; align-items: center; gap: 8px; font-size: 15px; }
	.choice .muted { font-size: 12.5px; line-height: 1.35; }
	.choice:active { transform: scale(0.985); background: var(--surface-2); }
	.choice.primary { background: var(--accent); border-color: var(--accent); color: var(--accent-text); align-items: center; }
	.choice.off { opacity: 0.55; }
	.slow { padding: 1px 7px; border-radius: 999px; font-size: 10.5px; font-weight: 750; background: color-mix(in srgb, var(--green) 18%, transparent); color: var(--green); }
	.latsum { margin: 0 0 10px; font-size: 13.5px; color: var(--muted); }
	.link-btn.inline { flex-basis: auto; min-height: 32px; margin-left: auto; color: var(--accent-fg); }
	@media (hover: hover) { .choice:hover { background: var(--surface-2); } }
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
	/* Audio: LAT confirmado (verde), según el nombre (gris punteado), sin aclarar (ámbar, como "sin sub ES"). */
	.tag.audio.lat { color: var(--green); }
	.tag.audio.name { border-style: dashed; color: var(--muted); }
	/* Etiquetas que se tocan (Buscar subs ES, validar latino, revisar): grises, mismo tamaño que un badge. */
	.tag.act { display: inline-flex; align-items: center; gap: 4px; background: none; border-color: var(--border-strong); color: var(--muted); font-family: inherit; cursor: pointer; transition: color 0.15s var(--ease), border-color 0.15s var(--ease); }
	.tag.act:active { opacity: 0.7; }
	.tag.act.busy { cursor: default; }
	.tag.act .spin { width: 10px; height: 10px; border-width: 1.5px; }
	@media (hover: hover) { button.tag.act:hover { color: var(--text); border-color: var(--accent-fg); } }
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
	.quality { display: flex; align-items: center; gap: 5px; margin-top: 5px; color: var(--muted); font-size: 13.5px; }
	.stars { display: inline-flex; gap: 1px; color: color-mix(in srgb, var(--muted) 45%, transparent); }
	.stars :global(svg) { fill: currentColor; stroke-width: 1.5; }
	.stars .on { color: #e6b54a; }
	.qname { font-weight: 600; color: var(--text); }
	.qname.unknown { font-weight: 500; color: var(--muted); font-size: 13.5px; }
	.audio-hint { margin: 0 0 14px; font-size: 14px; }
	.tracks { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
	.tracks li { display: flex; gap: 10px; padding: 8px 10px; border-radius: 10px; background: var(--surface-2); font-size: 13.5px; }
	.tracks b { min-width: 44px; font-variant-numeric: tabular-nums; }
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
	/* Hoja "¡Link copiado!" */
	.done-head { display: flex; align-items: center; gap: 12px; }
	.done-head span { font-size: 14px; color: var(--muted); }
	.native { display: flex; align-items: center; gap: 10px; margin: 16px 0 0; padding: 12px 14px; border-radius: 12px; background: var(--surface-2); font-size: 14px; }
	.native.yes { background: color-mix(in srgb, var(--green) 12%, transparent); }
	.native :global(svg) { flex: none; }
	.see-subs { width: 100%; height: 48px; margin-top: 12px; display: inline-flex; align-items: center; justify-content: center; gap: 8px; }
	.wvc { width: 100%; height: 46px; margin-top: 10px; display: inline-flex; align-items: center; justify-content: center; gap: 8px; }
	.cast-line { display: flex; align-items: center; justify-content: center; gap: 6px; width: 100%; min-height: 44px; margin-top: 14px; border: 0; background: none; color: var(--muted); font-size: 13px; }
	.cast-line u { color: var(--accent-fg); text-underline-offset: 3px; }
	.link-btn { flex-basis: 100%; min-height: 36px; border: 0; background: none; color: var(--muted); font-size: 13px; text-decoration: underline; text-underline-offset: 3px; }
	.link-input { width: 100%; height: 44px; margin: 10px 0 0; padding: 0 10px; border-radius: var(--radius); border: 1px solid var(--border-strong); background: var(--surface-2); font-size: 16px; }
</style>
