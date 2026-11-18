<script>
	// Torrents de un video que TorBox tiene en caché, en pasos (como el desktop): buscando (fuente por fuente) →
	// ¿audio latino? → el PRIMER BUEN MATCH (`isMatch`), leyendo pistas de a una de mejor a peor calidad, con "Seguir
	// buscando" y "Ver todas las opciones"; migas para volver. Por fila: peso, calidad de
	// imagen, audio y subs en español, y copiar el link https de TorBox. Los subtítulos son de cada torrent: aparecen
	// al copiar su link (nativos primero; si no trae, se buscan afuera; Premium plegado al final).
	import Icon from './Icon.svelte';
	import Sheet from './Sheet.svelte';
	import Tour from './Tour.svelte';
	import { castSteps, device } from './tours.js';
	import * as saved from './saved.js';
	import { loc, t as tr } from './i18n.svelte.js';
	import { untrack } from 'svelte';
	import { audioOf, latBadge } from './audio.js';

	/** `orig`: idioma original (ISO 639-1 de TMDB): el audio que sale por defecto. `runtime`: duración en minutos (de la
	 * ficha), para el bitrate. @type {{imdb: string, s?: number | null, e?: number | null, name: string, orig?: string | null, runtime?: number | null}} */
	let { imdb, s = null, e = null, name, orig = null, runtime = null } = $props();

	/** @typedef {{hash: string, release: string, file: string | null, res: string | null, hdr: string[], source: string | null, lat: boolean, multi: boolean, size: number | null, seeds: number, addons: string[], subFile: boolean, doubt?: boolean}} Torrent */
	/** @typedef {{id: string, release: string, latino: boolean, format: string, downloads: number, exact?: boolean, fps?: number | null, last?: number | null, group?: string, premium?: boolean}} Sub */
	/** @typedef {{label: string, kind: string, track: number, url: string}} Native */
	/** @typedef {{hasKey: boolean, remaining: number | null, perDay: number | null, resetsAt: number | null, login?: string | null}} Quota */

	/** Resoluciones de mejor a peor; `other` junta lo que no es 4K/1080p/720p (o no lo dice). */
	const RES = ['2160p', '1080p', '720p', 'other'];
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
	/** "¿Dónde lo vas a ver?": el link de descarga sirve directo en los reproductores, pero Web Video Caster lo
	 * muestra como texto; para él va dentro de /play.html (un <video> que detecta; el link después del #). El toque en
	 * la opción es el que copia (iOS). */
	let whereFor = $state(/** @type {{t: Torrent, url: string} | null} */ (null));
	/** A dónde se copió el último video: cambia el texto de la hoja "¡Link copiado!". */
	let doneWhere = $state(/** @type {'wvc' | 'app'} */ ('app'));
	/** El stream (.m3u8) anda igual en todos: se copia directo; el de descarga pregunta. @param {Torrent} t @param {string} url */
	function askWhere(t, url) {
		if (/\.tb-cdn\./.test(url) && !/\.m3u8/.test(url)) whereFor = { t, url };
		else copyUrl(t, url);
	}
	/** @param {'wvc' | 'app'} where */
	function copyWhere(where) {
		if (!whereFor) return;
		const { t, url } = whereFor;
		whereFor = null;
		doneWhere = where;
		copyUrl(t, where === 'wvc' ? `${location.origin}/play.html#${encodeURIComponent(url)}` : url);
	}
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
			goStep(net ? 'audio' : 'net');
			wantLat = false;
			found = [];
			showAll = false;
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
	/** Conexión donde se va a ver (2026-11-18): la elige el usuario una vez (queda guardada) y pone el tope de bitrate
	 * del buen match; "¿Se cortó?" baja un nivel. `mbps`: lo más que se le pide al video (el piso del rango). */
	const NET = /** @type {const} */ ([
		{ key: 'terrible', label: 'Muy baja', range: 'Menos de 8 Mbps o señal que se corta: busco una muy liviana', mbps: 4 },
		{ key: 'low', label: 'Baja', range: '8 a 25 Mbps, o la tele en wifi 2.4 GHz', mbps: 10 },
		{ key: 'normal', label: 'Normal', range: '25 a 100 Mbps', mbps: 25 },
		{ key: 'high', label: 'Alta', range: 'Más de 100 Mbps, en wifi 5 GHz o por cable', mbps: Infinity }
	]);
	let net = $state(NET.find((n) => n.key === saved.recall('net')) ?? null);
	/** @param {(typeof NET)[number]} n */
	function chooseNet(n) {
		net = n;
		saved.remember('net', n.key);
		goStep('audio');
	}
	/** Mbps típicos por resolución cuando no se sabe la duración (como el desktop, catalog-options.js `TYPICAL_MBPS`). */
	const TYPICAL = /** @type {Record<string, number>} */ ({ '2160p': 25, '1080p': 8, '720p': 4, other: 3 });
	/** Bitrate que pide el video, en Mbps: peso ÷ duración (la de la ficha); sin alguno de los dos, lo típico. @param {Torrent} t */
	const mbpsOf = (t) => (t.size && runtime ? (t.size * 8) / (runtime * 60) / 1e6 : TYPICAL[resOf(t)]);
	/** ¿Entra en la conexión elegida? @param {Torrent} t */
	const fits = (t) => !net || mbpsOf(t) <= net.mbps;

	/** Paso actual: la conexión (si no se eligió nunca), el audio, o el resultado (buscando el primer buen match, ese
	 * match o, con `showAll`, todas). */
	let step = $state(/** @type {'net' | 'audio' | 'list'} */ ('audio'));
	let wantLat = $state(false);
	/** Buenos matches que se muestran, en el orden en que aparecieron (hashes). */
	let found = $state(/** @type {string[]} */ ([]));
	/** Pidió "Ver todas las opciones". */
	let showAll = $state(false);
	/** Cada cambio de paso (o de video) invalida lo que se estaba leyendo: los bucles miran este número. */
	let gen = 0;
	/** @param {'net' | 'audio' | 'list'} to */
	function goStep(to) {
		gen++;
		reading = false;
		step = to;
	}

	const all = $derived(data?.list ?? []);
	/** @param {Torrent} t */
	const known = (t) => {
		const v = info[t.hash];
		return v && typeof v === 'object' ? v : null;
	};
	/** Con potencial de latino (única regla): leídas, latino o español sin variante; sin leer, que el nombre diga
	 * LATINO o MULTI / Dual / español sin aclarar. Las que no dicen nada de idioma no cuentan. @param {Torrent} t */
	const potential = (t) => (known(t)?.audio ? known(t)?.audio === 'lat' || known(t)?.audio === 'es' : t.lat || !!t.doubt);
	/** @param {Torrent} t */
	const hasEs = (t) => t.subFile || (known(t)?.subs ?? 0) > 0;
	/** Única regla de "buen match": pidiendo latino, latino confirmado en sus pistas (los subs no importan); con audio
	 * original, sub ES nativo (dentro del video o .srt en el torrent). @param {Torrent} t */
	const isMatch = (t) => (wantLat ? known(t)?.audio === 'lat' : hasEs(t));
	/** Única regla de "candidata a leer": sin leer (ni leyéndose ni con error) y que pueda ser lo pedido. Latino: el
	 * nombre dice LATINO o MULTI / Dual / español sin aclarar (las que no dicen nada de idioma no se leen); audio
	 * original: sin saber si trae sub ES. @param {boolean} lat @param {Torrent} t */
	const unread = (lat, t) => typeof info[t.hash] !== 'string' && (lat ? !known(t)?.audio && (t.lat || !!t.doubt) : !hasEs(t) && !known(t));
	/** @param {Torrent} t */
	const qualityRank = (t) => (t.source ? QUALITY[t.source]?.[1] : null) ?? 2.5;
	/** De mejor a peor: más bitrate (más imagen por segundo; la resolución sola no dice cuánto se comprimió), y a igual
	 * bitrate la de mejor calidad de imagen. @param {Torrent} a @param {Torrent} b */
	const byQuality = (a, b) => mbpsOf(b) - mbpsOf(a) || qualityRank(b) - qualityRank(a);
	/** Lo que entra con el audio elegido (latino: solo las con potencial), de mejor a peor. `byBest`: solo las que entran
	 * en la conexión (de ahí sale el buen match); `everything`: todas, para "Ver todas". */
	const everything = $derived((wantLat ? all.filter(potential) : [...all]).sort(byQuality));
	const byBest = $derived(everything.filter(fits));
	const candidates = $derived(byBest.filter((t) => unread(wantLat, t)));
	/** El próximo buen match todavía no mostrado, si viene antes (en calidad) que la próxima candidata; si no, null. */
	const nextMatch = $derived.by(() => {
		const first = byBest.find((t) => unread(wantLat, t) || (isMatch(t) && !found.includes(t.hash)));
		return first && !unread(wantLat, first) ? first : null;
	});
	/** Mientras se leen pistas: muestra Detener. `scan`: avance de la búsqueda en curso. */
	let reading = $state(false);
	let scan = $state({ done: 0, total: 0 });

	/** @param {boolean} lat */
	function chooseAudio(lat) {
		wantLat = lat;
		found = [];
		showAll = false;
		goStep('list');
		findNext();
	}
	/** Lee las candidatas de a una, de mejor a peor calidad, hasta el próximo buen match (lo suma a `found`) o hasta
	 * agotarlas. Se corta con Detener o si cambia el paso o el video. */
	async function findNext() {
		const my = ++gen;
		reading = true;
		scan = { done: 0, total: candidates.length };
		for (;;) {
			if (nextMatch) {
				found = [...found, nextMatch.hash];
				break;
			}
			const t = candidates[0];
			if (!t) break;
			await probe(t);
			if (my !== gen) return;
			scan.done++;
		}
		reading = false;
	}
	function stopSearch() {
		gen++;
		reading = false;
	}
	/** "Ver todas las opciones": la lista completa, con los filtros. */
	const list = $derived(everything.filter((t) => (!onlyHdr || t.hdr.length) && (!onlyEs || hasEs(t))));
	/** "¿Se cortó?": baja un nivel de conexión y busca de nuevo con el tope nuevo. */
	function lighter() {
		const i = NET.findIndex((n) => n.key === net?.key);
		if (i <= 0) return;
		net = NET[i - 1];
		saved.remember('net', net.key);
		linkDone = null;
		chooseAudio(wantLat);
	}
	/** Qué se ve en el paso de resultado: buscando el primer match, el resultado o todas. */
	const screen = $derived(step === 'net' || step === 'audio' ? step : showAll ? 'all' : reading && !found.length ? 'search' : 'match');
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
		else askWhere(t, got.url);
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
		{#if step !== 'net' && net}
			<nav class="crumbs" aria-label={tr('Ruta')}>
				<button id="crumb-net" type="button" title={tr('Cambiar la conexión')} onclick={() => goStep('net')}>{tr('Conexión {c}', { c: tr(net.label).toLowerCase() })}</button>
				{#if step === 'list'}
					<span aria-hidden="true">›</span>
					<button id="crumb-audio" type="button" onclick={() => goStep('audio')}>{wantLat ? tr('Audio latino') : tr('Audio original')}</button>
				{/if}
			</nav>
		{/if}

		{#key screen}
			<div class="step" in:stepIn>
				{#if screen === 'net'}
					<h3 class="ask">{tr('¿Cómo es tu internet donde lo vas a ver?')}</h3>
					<div class="choices">
						<!-- La más rápida arriba; NET queda de menor a mayor para que "¿Se cortó?" baje un nivel. -->
						{#each [...NET].reverse() as n (n.key)}
							<button id="net-{n.key}" type="button" class="choice" class:primary={net?.key === n.key} onclick={() => chooseNet(n)}>
								<strong>{tr(n.label)}</strong>
								<span class="muted">{tr(n.range)}</span>
							</button>
						{/each}
					</div>
				{:else if screen === 'audio'}
					{@const named = all.filter((t) => t.lat).length}
					{@const doubtful = all.filter((t) => t.doubt && !t.lat).length}
					{@const toRead = all.filter((t) => unread(true, t)).length}
					<h3 class="ask">{tr('¿Necesitás audio latino?')}</h3>
					<div class="choices">
						<button id="audio-any" type="button" class="choice" onclick={() => chooseAudio(false)}>
							<strong>{tr('Audio original')}</strong>
							<span class="muted">{tr('{n} opciones en TorBox', { n: all.length })} · {tr('busco la primera que traiga subtítulos en español adentro')}</span>
						</button>
						<button id="audio-lat" type="button" class="choice" class:off={!all.some(potential)} disabled={!all.some(potential)} onclick={() => chooseAudio(true)}>
							<strong>{tr('Solo audio latino')}{#if toRead}<span class="slow">{tr('Demora más')}</span>{/if}</strong>
							<span class="muted">{all.some(potential)
								? [named ? tr('{n} lo dicen en el nombre', { n: named }) : '', doubtful ? tr('{n} dudosas (MULTI / Dual)', { n: doubtful }) : '', toRead ? tr('reviso de a una, de mejor a peor calidad, hasta encontrar latino') : ''].filter(Boolean).join(' · ')
								: tr('No hay torrents con audio latino')}</span>
						</button>
					</div>
				{:else if screen === 'search'}
					<h3 class="ask">{wantLat ? tr('Buscando audio latino') : tr('Buscando subtítulos en español')}</h3>
					<p class="status"><span class="spin"></span>{tr('Leyendo pistas · {a} de {n}', { a: Math.min(scan.done + 1, scan.total), n: scan.total })}<button id="search-stop" type="button" class="link-btn inline" onclick={stopSearch}>{tr('Detener')}</button></p>
					<p class="muted latsum">{wantLat ? tr('De a una, de mejor a peor calidad: te muestro la primera que tenga audio latino.') : tr('De a una, de mejor a peor calidad: te muestro la primera que traiga subtítulos en español adentro.')}</p>
				{:else if screen === 'match'}
					<!-- El resultado: solo los buenos matches; sin ninguno, las 3 de mejor calidad con el aviso. -->
					{#if error}<p class="status error" role="alert">{error}</p>{/if}
					{#if found.length}
						<h3 class="ask">{tr('Mejor opción')}</h3>
						<p class="match-why"><Icon name="check" size={15} />{wantLat ? tr('Audio latino confirmado') : tr('Trae subtítulos en español')}</p>
						{@render options(found.map((h) => all.find((t) => t.hash === h)).filter((t) => !!t), true)}
					{:else}
						<h3 class="ask">{!byBest.length ? tr('Ninguna entra en tu conexión') : wantLat ? tr('Sin latino confirmado') : tr('Sin subtítulos en español adentro')}</h3>
						<p class="muted latsum" role="status">{!byBest.length ? tr('Todas piden más de lo que da tu conexión: mirá "Ver todas" o cambiá la conexión.') : candidates.length ? tr('Búsqueda detenida: estas son las de mejor calidad.') : wantLat ? tr('No encontré latino confirmado.') : tr('Ninguna trae sub ES nativo: los subs se buscan afuera.')}</p>
						{@render options(byBest.slice(0, 3), false)}
					{/if}
					{@render more()}
					<button id="see-all" type="button" class="pill-btn" onclick={() => (showAll = true)}><Icon name="list" size={15} />{tr('Ver todas las opciones')}<span class="count">{everything.length}</span></button>
				{:else}
					<div class="bar">
						<div class="chips toggles" role="toolbar" aria-label={tr('Filtros de torrents')}>
							<button id="only-hdr" type="button" class="chip toggle" class:on={onlyHdr} aria-pressed={onlyHdr} onclick={() => (onlyHdr = !onlyHdr)}>HDR</button>
							<button id="only-es" type="button" class="chip toggle" class:on={onlyEs} aria-pressed={onlyEs} title={tr('Solo las verificadas que traen subtítulos en español')} onclick={() => (onlyEs = !onlyEs)}><Icon name="subs" size={14} />{tr('Subs ES')}</button>
						</div>
						<p class="summary" title={tr('TorBox es un servicio pago que baja torrents a sus servidores y te los pasa como video en línea. Estas opciones ya las tiene bajadas: el link se ve al instante en la tele, sin depender de los seeds.')}>{wantLat ? tr('{n} con latino o dudosas de {f} en TorBox', { n: list.length, f: all.length }) : tr('{n} de {f} en TorBox · de mejor a peor calidad', { n: list.length, f: all.length })}</p>
					</div>
					{#if error}<p class="status error" role="alert">{error}</p>{/if}
					{#if !list.length}<p class="status muted">{tr('No hay opciones con estos filtros.')}</p>{/if}
					{@render options(list, false)}
					{@render more()}
				{/if}
			</div>
		{/key}
	{/if}
</section>

<!-- Al pie del resultado y de "todas": la búsqueda en curso (Detener), "Seguir buscando" o que no quedan más. -->
{#snippet more()}
	{#if reading}
		<p class="status"><span class="spin"></span>{tr('Leyendo pistas · {a} de {n}', { a: Math.min(scan.done + 1, scan.total), n: scan.total })}<button id="more-stop" type="button" class="link-btn inline" onclick={stopSearch}>{tr('Detener')}</button></p>
	{:else if candidates.length || nextMatch}
		<button id="search-more" type="button" class="choice" onclick={findNext}>
			<strong>{wantLat ? tr('Seguir buscando latino') : tr('Seguir buscando sub ES')}</strong>
			{#if candidates.length}<span class="muted">{tr('{n} candidatas quedan · de a una', { n: candidates.length })}</span>{/if}
		</button>
	{:else if found.length}
		<p class="status muted">{tr('No hay más para buscar.')}</p>
	{/if}
{/snippet}

<!-- Opciones: `best` = buenos matches (destacados, con el botón de copiar lleno). -->
{#snippet options(/** @type {Torrent[]} */ items, /** @type {boolean} */ best)}
	<ul>
		{#each items as t (t.hash)}
			{@const q = t.source ? QUALITY[t.source] : null}
			{@const sb = subBadge(t)}
			{@const lb = latBadge(t, known(t))}
			<li class="opt" class:best>
				{#if best}<span class="best-tag">{tr('Mejor opción')}</span>{/if}
				<div class="info">
				<div class="top">
					<span class="size">{gb(t.size)}</span>
					{#if t.res}<span class="tag res">{t.res === '2160p' ? '4K' : t.res}</span>{/if}
					{#if !fits(t)}<span class="tag heavy" title={tr('Pide ~{m} Mbps: más de lo que da tu conexión', { m: Math.round(mbpsOf(t)) })}>{tr('Puede cortarse')}</span>{/if}
					{#if t.hdr.length}<span class="tag hdr">HDR</span>{/if}
					{#if lb?.kind === 'es'}
						<button id="audio-info-{t.hash}" type="button" class="tag act" title={tr(lb.title)} onclick={() => (tracksOf = t)}><Icon name="volume" size={13} />{tr(lb.text)}</button>
					{:else if lb?.kind === 'doubt' && info[t.hash] === 'busy'}
						<span class="tag act busy" role="status"><span class="spin"></span>{tr('Leyendo audios…')}</span>
					{:else if lb?.kind === 'doubt'}
						<button id="audio-check-{t.hash}" type="button" class="tag act" title={tr(lb.title)} onclick={() => probe(t)}><Icon name="volume" size={13} />{tr(lb.text)}</button>
					{:else if lb}<span class="tag audio {lb.kind}" title={tr(lb.title)}>{tr(lb.text)}</span>{/if}
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
				<!-- Como ▶ del desktop: un botón redondo; lleno en los buenos matches. -->
				<button
					id="copy-{t.hash}"
					type="button"
					class="copy"
					class:primary={best}
					class:ok={copy[t.hash] === 'ok'}
					class:err={copy[t.hash] === 'err'}
					aria-label={copy[t.hash] === 'err' ? tr('Reintentar copiar el link') : tr('Copiar link de TorBox')}
					disabled={copy[t.hash] === 'busy'}
					onclick={() => copyLink(t)}
				>
					{#if copy[t.hash] === 'busy'}<span class="spin" class:light={best}></span>
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
						askWhere(t, c.url);
					}}
				>
					{c.label}
				</button>
			{/each}
		</div>
	{/if}
</Sheet>

<!-- Antes de copiar un link de descarga: ¿Web Video Caster o un reproductor? (cada uno necesita otro link). -->
<Sheet id="where-sheet" title={tr('¿Dónde lo vas a ver?')} open={!!whereFor} onclose={() => (whereFor = null)}>
	<div class="where">
		<button id="where-wvc" type="button" class="spot" onclick={() => copyWhere('wvc')}>
			<!-- Celu que manda ondas a la tele. -->
			<svg class="art" viewBox="0 0 120 80" aria-hidden="true">
				<rect class="tv" x="38" y="10" width="74" height="46" rx="6" />
				<path class="tv" d="M64 66h22M75 56v10" />
				<path class="play" d="M70 25v16l14-8z" />
				<rect class="phone" x="8" y="34" width="22" height="38" rx="5" />
				<path class="wave w1" d="M30 36a8 8 0 0 1 8-8" />
				<path class="wave w2" d="M30 30a14 14 0 0 1 14-14" />
				<path class="wave w3" d="M30 24a20 20 0 0 1 20-20" />
			</svg>
			<b>{tr('En la tele')}</b>
			<small>Web Video Caster</small>
		</button>
		<button id="where-app" type="button" class="spot" onclick={() => copyWhere('app')}>
			<!-- Celu con el video adentro. -->
			<svg class="art" viewBox="0 0 120 80" aria-hidden="true">
				<rect class="phone big" x="42" y="4" width="36" height="72" rx="8" />
				<rect class="screen" x="47" y="14" width="26" height="46" rx="3" />
				<path class="play pop" d="M55 29v16l13-8z" />
				<path class="bar" d="M50 66h20" />
			</svg>
			<b>{tr('En otra app')}</b>
			<small>SenPlayer · VLC</small>
		</button>
	</div>
</Sheet>

<!-- Al copiar el link de un video: confirmación, si trae subs en español (de `info`) y, abajo, el tutorial. -->
<Sheet id="copied-sheet" title={tr('¡Link copiado!')} open={!!linkDone} onclose={() => (linkDone = null)}>
	{#if linkDone}
		{@const v = info[linkDone.hash]}
		{@const k = known(linkDone)}
		<div class="done-head">
			<svg class="toast-mark" viewBox="0 0 56 56" aria-hidden="true"><circle cx="28" cy="28" r="26" /><path d="M17 29l7.5 7.5L40 21" /></svg>
			<span>{doneWhere === 'wvc' ? tr('Pegalo en el navegador de Web Video Caster.') : tr('Pegalo en tu reproductor.')}</span>
		</div>
		{#if v === 'busy'}
			<p class="native"><span class="spin"></span>{tr('Viendo si trae subtítulos en español…')}</p>
		{:else if (k?.subs ?? 0) > 0 || linkDone.subFile}
			<p class="native yes"><Icon name="subs" size={18} />{k?.subs ? tr(k.subs > 1 ? 'Trae {n} subtítulos en español: elegilos con CC en el reproductor.' : 'Trae {n} subtítulo en español: elegilo con CC en el reproductor.', { n: k.subs }) : tr('El torrent trae un archivo de subtítulo en español')}</p>
		{:else}
			<p class="native"><Icon name="subs" size={18} />{k ? tr('No trae subtítulos en español.') : tr('No pude ver si trae subtítulos en español.')}</p>
			<button id="see-subs" type="button" class="btn primary see-subs" onclick={() => linkDone && showSubs(linkDone)}><Icon name="search" size={16} />{tr('Ver subtítulos disponibles')}</button>
		{/if}
		{#if net && net.key !== NET[0].key}
			<button id="lighter" type="button" class="link-btn" onclick={lighter}>{tr('¿Se cortó? Buscar una más liviana')}</button>
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
	.choice { display: flex; flex-direction: column; align-items: flex-start; gap: 3px; min-height: 64px; padding: 12px 14px; border: 1px solid var(--border); border-radius: 14px; background: var(--surface); text-align: left; transition: background 0.2s var(--ease), transform 0.15s var(--out); }
	.choice strong { display: inline-flex; align-items: center; gap: 8px; font-size: 15px; }
	.choice .muted { font-size: 12.5px; line-height: 1.35; }
	.choice:active { transform: scale(0.985); background: var(--surface-2); }
	.choice.primary { background: var(--accent); border-color: var(--accent); color: var(--accent-text); align-items: center; }
	.choice.off { opacity: 0.55; }
	.slow { padding: 1px 7px; border-radius: 999px; font-size: 10.5px; font-weight: 750; background: color-mix(in srgb, var(--green) 18%, transparent); color: var(--green); }
	.latsum { margin: 0 0 10px; font-size: 13.5px; color: var(--muted); }
	.match-why { display: flex; align-items: center; gap: 6px; margin: -4px 0 0; font-size: 13.5px; font-weight: 650; color: var(--green); }
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
	/* Los buenos matches, como la mejor opción del desktop: tinte verde y etiqueta arriba. */
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
	/* Acción secundaria al pie del resultado: botón, no link suelto. */
	.pill-btn { display: inline-flex; align-items: center; gap: 8px; align-self: center; min-height: 44px; margin: 10px auto 0; padding: 0 18px; border: 1px solid var(--border); border-radius: 999px; background: var(--surface-2); color: var(--text); font: inherit; font-size: 14px; font-weight: 600; }
	.pill-btn:active { transform: scale(0.98); }
	.pill-btn .count { padding: 1px 8px; border-radius: 999px; background: var(--surface-3, var(--border)); color: var(--muted); font-size: 12px; font-variant-numeric: tabular-nums; }
	.tag.heavy { color: var(--amber, #b7791f); border-color: currentColor; }
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
	/* "¿Dónde lo vas a ver?": dos tarjetas con dibujo animado y casi sin texto. */
	.where { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; padding: 4px 0 6px; }
	.spot {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 2px;
		padding: 14px 8px 14px;
		border: 1px solid var(--border);
		border-radius: 18px;
		background: var(--surface-2);
		color: var(--text);
		animation: spot-in 0.45s var(--out) both;
		transition: transform 0.15s var(--out), border-color 0.2s var(--ease);
	}
	.spot + .spot { animation-delay: 0.08s; }
	.spot:active { transform: scale(0.96); border-color: var(--accent-fg); }
	.spot b { font-size: 15.5px; margin-top: 6px; }
	.spot small { font-size: 12px; color: var(--muted); }
	@keyframes spot-in { from { opacity: 0; transform: translateY(14px) scale(0.97); } }
	.art { width: 100%; max-width: 132px; height: auto; fill: none; stroke-linecap: round; stroke-linejoin: round; }
	.art .tv, .art .phone { stroke: var(--muted); stroke-width: 3; }
	.art .phone.big { stroke: var(--text); }
	.art .screen { fill: color-mix(in srgb, var(--accent) 22%, transparent); }
	.art .play { fill: var(--accent); }
	.art .bar { stroke: var(--muted); stroke-width: 3; }
	.art .wave { stroke: var(--accent-fg); stroke-width: 3; opacity: 0; animation: wave 1.8s var(--ease) infinite; }
	.art .w2 { animation-delay: 0.25s; }
	.art .w3 { animation-delay: 0.5s; }
	@keyframes wave { 0% { opacity: 0; } 30% { opacity: 1; } 70%, 100% { opacity: 0; } }
	.art .pop { transform-box: fill-box; transform-origin: center; animation: pop 2s var(--out) infinite; }
	@keyframes pop { 0%, 60%, 100% { transform: scale(1); } 30% { transform: scale(1.18); } }
	@media (hover: hover) { .spot:hover { border-color: var(--accent-fg); } }
	@media (prefers-reduced-motion: reduce) { .spot, .art .wave, .art .pop { animation: none; } .art .wave { opacity: 1; } }
	.cast-line { display: flex; align-items: center; justify-content: center; gap: 6px; width: 100%; min-height: 44px; margin-top: 14px; border: 0; background: none; color: var(--muted); font-size: 13px; }
	.cast-line u { color: var(--accent-fg); text-underline-offset: 3px; }
	.link-btn { flex-basis: 100%; min-height: 36px; border: 0; background: none; color: var(--muted); font-size: 13px; text-decoration: underline; text-underline-offset: 3px; }
	.link-input { width: 100%; height: 44px; margin: 10px 0 0; padding: 0 10px; border-radius: var(--radius); border: 1px solid var(--border-strong); background: var(--surface-2); font-size: 16px; }
</style>
