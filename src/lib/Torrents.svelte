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
	import { audioOf, latStatus, LAT_BADGE } from './audio.js';
	import { track } from './track.js';
	import { QUALITY, byQuality as rankQuality, groupOf, mbpsOf as rankMbps, rank, sourceOf } from './torrent-rank.js';

	/** `orig`: idioma original (ISO 639-1 de TMDB): el audio que sale por defecto. `runtime`: duración en minutos (de la
	 * ficha), para el bitrate. `given`: las opciones ya armadas ("Pegar magnet": los videos de ese torrent); sin pasos
	 * ni búsqueda, directo a la lista. @type {{imdb: string, s?: number | null, e?: number | null, name: string, orig?: string | null, runtime?: number | null, given?: Torrent[] | null}} */
	let { imdb, s = null, e = null, name, orig = null, runtime = null, given = null } = $props();

	/** @typedef {import('./types.js').Torrent} Torrent */
	/** @typedef {import('./types.js').Sub} Sub */
	/** @typedef {{label: string, kind: string, track: number, url: string}} Native */
	/** @typedef {{hasKey: boolean, remaining: number | null, perDay: number | null, resetsAt: number | null, login?: string | null}} Quota */

	/** Resoluciones de mejor a peor; `other` junta lo que no es 4K/1080p/720p (o no lo dice). */
	const RES = ['2160p', '1080p', '720p', 'other'];
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
	/** A dónde se copió el último video (null = no se preguntó): con 'app' no hay hoja "¡Link copiado!", solo el festejo. */
	let doneWhere = $state(/** @type {'wvc' | 'app' | null} */ (null));
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
		linkDone = null;
		doneWhere = where;
		// `d`: el dispositivo, para que el panel sepa que se abrió en la tele (ese navegador no tiene la cookie).
		const dev = document.cookie.match(/(?:^|; )dev=([^;]+)/)?.[1] ?? '';
		copyUrl(t, where === 'wvc' ? `${location.origin}/play.html?d=${dev}#${encodeURIComponent(url)}` : url);
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
	/** Festejo grande de "¡Link copiado!" sobre todo (popover), antes de la hoja. @type {HTMLElement | undefined} */
	let burstEl = $state();
	let burstN = $state(0);
	/** @type {ReturnType<typeof setTimeout> | undefined} */
	let burstT;
	function burst() {
		if (!burstEl) return;
		burstN++;
		// Después de que se abra la hoja: en la capa de arriba gana el último en abrirse.
		requestAnimationFrame(() => {
			if (burstEl?.matches(':popover-open')) burstEl.hidePopover();
			burstEl?.showPopover();
		});
		clearTimeout(burstT);
		burstT = setTimeout(() => burstEl?.hidePopover(), 1500);
	}
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
			net = null;
			goStep('net');
			wantLat = false;
			found = [];
			showAll = false;
			progress = { done: 0, total: 0, torbox: false };
			// Lista guardada 1 hora (saved.js): se pinta en este mismo cuadro, sin pasar por la búsqueda.
			data = given ? { list: given, found: given.length, sources: 1 } : /** @type {typeof data} */ (hit);
			// Torrent pegado: ya se sabe qué torrent es, no hay conexión ni audio para elegir.
			if (given) { step = 'list'; showAll = true; }
		});
		if (!hit && !given) search(url, ctrl.signal);
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
	/** Conexión donde se va a ver (2026-11-18): la elige el usuario en cada video y pone el tope de bitrate
	 * del buen match; "¿Se cortó?" baja un nivel. `mbps`: lo más que se le pide al video (el piso del rango). */
	const NET = /** @type {const} */ ([
		{ key: 'terrible', label: 'Muy baja', range: 'Menos de 8 Mbps o señal que se corta: busco una muy liviana', mbps: 4, tone: 'red' },
		{ key: 'low', label: 'Baja', range: '8 a 25 Mbps, o la tele en wifi 2.4 GHz', mbps: 10, tone: 'amber' },
		{ key: 'normal', label: 'Normal', range: '25 a 100 Mbps', mbps: 25, tone: 'accent-fg' },
		{ key: 'high', label: 'Alta', range: 'Más de 100 Mbps, en wifi 5 GHz o por cable', mbps: Infinity, tone: 'green' }
	]);
	/** La conexión elegida para este video: se pregunta siempre (cambia según dónde se vea). */
	let net = $state(/** @type {(typeof NET)[number] | null} */ (null));
	/** La que se acaba de tocar: su ícono se llena del color del nivel antes de pasar al audio. */
	let netPick = $state(/** @type {string | null} */ (null));
	/** @param {(typeof NET)[number]} n */
	function chooseNet(n) {
		if (netPick) return;
		track('conexión', n.label);
		net = n;
		if (still()) return goStep('audio');
		netPick = n.key;
		const g = gen;
		// Confirmación breve (≤220 ms); si en el medio cambió el video o el paso, no se pisa.
		setTimeout(() => {
			netPick = null;
			if (g === gen) goStep('audio');
		}, 220);
	}
	/** @param {Torrent} t */
	const mbpsOf = (t) => rankMbps(t, runtime);
	/** ¿Entra en la conexión elegida? Sin peso no se sabe cuánto pide: no entra (no puede ser el buen match). @param {Torrent} t */
	const fits = (t) => !!t.size && (!net || mbpsOf(t) <= net.mbps);

	/** Paso actual: la conexión (si no se eligió nunca), el audio, o el resultado (buscando el primer buen match, ese
	 * match o, con `showAll`, todas). */
	let step = $state(/** @type {'net' | 'audio' | 'list'} */ ('audio'));
	let wantLat = $state(false);
	/** Buenos matches que se muestran, en el orden en que aparecieron (hashes). */
	let found = $state(/** @type {string[]} */ ([]));
	/** Pidió "Ver todas las opciones". */
	let showAll = $state(false);
	/** Pidió latino, no hubo y vio las de español (casi seguro de España). */
	let showSpain = $state(false);
	/** Cada cambio de paso (o de video) invalida lo que se estaba leyendo: los bucles miran este número. */
	let gen = 0;
	/** @param {'net' | 'audio' | 'list'} to */
	function goStep(to) {
		gen++;
		reading = false;
		showSpain = false;
		step = to;
	}

	const all = $derived(data?.list ?? []);
	/** @param {Torrent} t */
	const known = (t) => {
		const v = info[t.hash];
		return v && typeof v === 'object' ? v : null;
	};
	/** Estado del audio latino (regla única en audio.js). @param {Torrent} t */
	const status = (t) => latStatus(t, known(t));
	/** Con potencial de latino: latino o probable, o sin confirmar pero con español (dicho en el nombre o leído sin
	 * variante). Las que no dicen nada de idioma no cuentan. @param {Torrent} t */
	const potential = (t) => {
		const s = status(t);
		return s === 'lat' || s === 'likely' || (s === 'check' && (t.spa || known(t)?.audio === 'es'));
	};
	/** @param {Torrent} t */
	const hasEs = (t) => t.subFile || (known(t)?.subs ?? 0) > 0;
	/** Única regla de "buen match": pidiendo latino, LAT (pistas o nombre; los subs no importan); con audio original,
	 * sub ES nativo (dentro del video o .srt en el torrent). @param {Torrent} t */
	const isMatch = (t) => (wantLat ? status(t) === 'lat' : hasEs(t));
	/** Única regla de "candidata a leer": sin leer (ni leyéndose ni con error) y que pueda ser lo pedido. Latino: sin
	 * confirmar y con algo que lo sugiera (web latina, MULTI / Dual / español sin aclarar); las que no dicen nada de
	 * idioma no se leen. Audio original: sin saber si trae sub ES. @param {boolean} lat @param {Torrent} t */
	const unread = (lat, t) => typeof info[t.hash] !== 'string' && (lat ? !known(t)?.audio && (status(t) === 'likely' || (status(t) === 'check' && t.spa)) : !hasEs(t) && !known(t));
	/** @param {Torrent} a @param {Torrent} b */
	const byQuality = (a, b) => rankQuality(a, b, runtime);
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
		track('audio', lat ? 'Latino' : 'Cualquiera');
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
	/** Español de España (pistas, nombre o web de origen), de mejor a peor. */
	const spanish = $derived(all.filter((t) => status(t) === 'spain').sort(byQuality));
	/** "Ver todas las opciones": todas, sin el filtro de audio, de mejor a peor (solo los chips HDR / Subs ES). */
	const list = $derived([...all].sort(byQuality).filter((t) => (!onlyHdr || t.hdr.length) && (!onlyEs || hasEs(t))));
	/** "¿Se cortó?": baja un nivel de conexión y busca de nuevo con el tope nuevo. */
	function lighter() {
		track('se cortó', 'pide una más liviana');
		const i = NET.findIndex((n) => n.key === net?.key);
		if (i <= 0) return;
		net = NET[i - 1];
		linkDone = null;
		chooseAudio(wantLat);
	}
	/** Qué se ve en el paso de resultado: buscando el primer match, el resultado o todas. */
	const screen = $derived(step === 'net' || step === 'audio' ? step : showAll ? 'all' : showSpain ? 'spain' : reading && !found.length ? 'search' : 'match');
	const still = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
	/** Entrada de cada paso: sube un poco y aparece. @param {Element} _ */
	const stepIn = (_) => ({
		duration: still() ? 0 : 320,
		css: (/** @type {number} */ x) => `transform: translateY(${(1 - x) * 10}px); opacity: ${x};`
	});
	/** El video que copiaste: los subtítulos se ordenan por cuánto calzan con él. */
	let match = $state(/** @type {{hash: string, release: string, natives?: Native[], file?: {hash: string, size: string}, video?: {fps: number | null, duration: number | null}} | null} */ (null));
	const LEVEL = ['puede desfasar', 'probable', 'muy probable', 'perfecto'].map((x) => () => tr(x));
	const WHY = ['Otro release: puede ir adelantado o atrasado', 'Mismos fps y misma duración que el video', 'Mismo release: mismo grupo y fuente', 'Hecho para este mismo archivo'].map((x) => () => tr(x));
	const ranked = $derived(subs ? rank(subs, match) : []);
	const premRanked = $derived(rank(prem.results, match));
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
	/** Badges que ya se explicaron en este video: la primera vez que aparece cada tipo (el de más arriba), un globito
	 * cuenta qué significa; si aparecen varios tipos, de a uno. */
	const explained = new Set();
	/** @param {HTMLElement} node @param {string} kind */
	function explain(node, kind) {
		if (explained.has(kind) || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
		node.style.setProperty('--d', `${0.4 + explained.size * 2.2}s`);
		explained.add(kind);
		node.classList.add('explaining');
	}
	/** Recién leídos en esta pantalla: sus badges naranjas explican qué significan con un globito. @type {Record<string, boolean>} */
	let fresh = $state({});
	/** Por qué falló el análisis de cada torrent (lo dice el server). */
	let why = $state(/** @type {Record<string, string>} */ ({}));
	/** Globito rápido del badge ES ("Gallego") al tocarlo. */
	let tipFor = $state('');
	/** @type {ReturnType<typeof setTimeout> | undefined} */
	let tipT;
	/** @param {string} hash */
	function quickTip(hash) {
		tipFor = '';
		requestAnimationFrame(() => (tipFor = hash));
		clearTimeout(tipT);
		tipT = setTimeout(() => (tipFor = ''), 2400);
	}
	let audioFor = $state(/** @type {{t: Torrent, choices: {key: string, label: string, url: string}[]} | null} */ (null));

	/** Lo leído de cada torrent (subs en español y audio, ver audio.js), 'busy' mientras se lee o 'err' si falló.
	 * Es del torrent y no cambia: se guarda para siempre (saved.remember). */
	let info = $state(/** @type {Record<string, import('./audio.js').Tracks | 'busy' | 'err' | null>} */ ({}));
	$effect(() => {
		for (const t of data?.list ?? []) if (!(t.hash in info)) info[t.hash] = /** @type {import('./audio.js').Tracks | null} */ (saved.recall(`tracks:${t.hash}`));
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
		fresh[t.hash] = false;
		try {
			const r = await fetch(`/api/tracks?${qs}&${new URLSearchParams({ hash: t.hash, name: t.release, file: t.file ?? '', ...(ids ? { tid: String(ids.tid), fid: String(ids.fid) } : {}) })}`);
			if (!r.ok) throw new Error((await r.json().catch(() => null))?.message ?? tr('No se pudo analizar.'));
			const j = await r.json();
			know(t.hash, { subs: j.subs.length, audio: audioOf(j.audios), audios: j.audios });
			fresh[t.hash] = true;
			return true;
		} catch (err) {
			info[t.hash] = 'err';
			why[t.hash] = /** @type {Error} */ (err).message;
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
	/** Cuántos subs en español trae el video del panel (nativos con link o, si no, lo leído). */
	const esN = $derived(match?.natives?.length || (matchInfo && typeof matchInfo === 'object' ? matchInfo.subs : 0));
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
		// Título · calidad · audio elegido · dónde (el panel lo separa por ` · `).
		track('copiar link', `${name}${s ? ` T${s}E${e}` : ''} · ${t.res ?? ''} · ${wantLat ? 'Latino' : 'Original'} · ${/play\.html/.test(url) ? 'TV' : 'Celu'}`);
		if (copyNow(url)) return done(t, 'ok');
		try {
			await navigator.clipboard.writeText(url);
			done(t, 'ok');
		} catch {
			manual = { url, release: t.release, kind: 'video', t };
		}
	}
	/** Copiado un video que no trae subs en español (ya leído): en vez de la hoja de "copiado", la lista de subs con
	 * la explicación arriba. Si todavía se está leyendo, se decide cuando termina (efecto de abajo). @param {Torrent} t */
	function noSubsCheck(t) {
		const k = known(t);
		if (linkDone?.hash === t.hash && k && !k.subs && !t.subFile) showSubs(t);
	}
	$effect(() => {
		if (linkDone && typeof info[linkDone.hash] === 'object') untrack(() => linkDone && noSubsCheck(linkDone));
	});
	/** @param {Torrent} t @param {'ok' | 'err'} st */
	function done(t, st) {
		copy[t.hash] = st;
		if (st === 'ok') {
			linkDone = t;
			burst();
		}
		noSubsCheck(t);
		setTimeout(() => copy[t.hash] === st && delete copy[t.hash], 2500);
	}
	/** Botón Copiar de la hoja manual: dentro del toque, así iOS lo deja copiar. Si tampoco, queda el campo para mantener apretado. */
	function copyManual() {
		if (manual && copyNow(manual.url)) {
			if (manual.t) {
				linkDone = manual.t;
				burst();
			}
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
		track('subtítulo', `copiar link · ${sub.release}`);
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
		track('subtítulo', `premium · ${sub.release}`);
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
						{#each [...NET].reverse() as n, i (n.key)}
							{@const lit = NET.indexOf(n) + 1}
							<button id="net-{n.key}" type="button" class="choice net" class:primary={net?.key === n.key} class:picked={netPick === n.key} class:max={lit === 4} style="--lvl: var(--{n.tone}); --i: {i}" onclick={() => chooseNet(n)}>
								<span class="tile">
									<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true">
										{#each [16, 12.5, 9, 5.5] as y1, b (b)}
											<line class="bar" class:lit={b < lit} style="--b: {b}" x1={5 + b * 4.7} x2={5 + b * 4.7} y1={y1} y2="19" />
										{/each}
									</svg>
								</span>
								<span class="txt">
									<strong>{tr(n.label)}</strong>
									<span class="muted">{tr(n.range)}</span>
								</span>
							</button>
						{/each}
					</div>
				{:else if screen === 'audio'}
					{@const named = all.filter((t) => status(t) === 'lat').length}
					{@const toRead = all.filter((t) => unread(true, t)).length}
					{@const maybe = all.filter(potential).length}
					<h3 class="ask">{tr('¿Necesitás audio latino?')}</h3>
					<div class="choices even">
						<!-- Mismas tarjetas con ícono que la conexión: el parlante late, el latino entra con un saludo. -->
						<button id="audio-any" type="button" class="choice net" style="--lvl: var(--accent-fg); --i: 0" onclick={() => chooseAudio(false)}>
							<span class="tile wave" aria-hidden="true">
								<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
									<path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5H4Z" fill="currentColor" fill-opacity="0.25" />
									<path class="w1" d="M15.5 9.5a3.5 3.5 0 0 1 0 5" />
									<path class="w2" d="M18 7a7 7 0 0 1 0 10" />
								</svg>
							</span>
							<span class="txt">
								<strong>{tr('Audio original')}</strong>
								<span class="muted">{tr('{n} opciones · busco una con subtítulos en español', { n: all.length })}</span>
							</span>
						</button>
						<button id="audio-lat" type="button" class="choice net" class:off={!maybe} disabled={!maybe} style="--lvl: var(--green); --i: 1" onclick={() => chooseAudio(true)}>
							<span class="tile lat-tile" aria-hidden="true">
								<svg width="28" height="28" viewBox="0 0.75 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round">
									<path d="M4 5.5h16a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-9l-4.5 3.5v-3.5H4a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1Z" fill="currentColor" fill-opacity="0.18" />
									<text x="12" y="13.9" text-anchor="middle" font-size="7" font-weight="800" fill="currentColor" stroke="none" letter-spacing="0.3">LAT</text>
								</svg>
							</span>
							<span class="txt">
								<strong>{tr('Solo audio latino')}{#if toRead}<span class="slow">{tr('Demora más')}</span>{/if}</strong>
								<span class="muted">{!maybe
									? tr('No hay torrents con audio latino')
									: !toRead
										? tr(named === 1 ? '1 opción lo tiene seguro' : '{n} opciones lo tienen seguro', { n: named })
										: tr(maybe === 1 ? '1 opción podría tenerlo · la reviso por vos' : 'Hasta {n} opciones podrían tenerlo · las reviso por vos', { n: maybe })}</span>
							</span>
						</button>
					</div>
				{:else if screen === 'search'}
					<!-- Buscando: un radar barre las opciones (puntos que se encienden al pasar); al primero que sirve, aparece el resultado. -->
					<div class="hunt" role="status" aria-live="polite">
						<svg class="radar" viewBox="0 0 120 120" aria-hidden="true">
							<circle class="ring" cx="60" cy="60" r="52" />
							<circle class="ring inner" cx="60" cy="60" r="34" />
							<g class="sweep"><path d="M60 60L60 8A52 52 0 0 1 105 34Z" /></g>
							{#each [[60, 20, 0], [94, 46, 1], [88, 88, 2], [40, 96, 3], [24, 52, 4]] as [x, y, i] (i)}
								<circle class="blip" cx={x} cy={y} r="4" style="--i:{i}" />
							{/each}
							<circle class="core" cx="60" cy="60" r="16" />
							<path class="core-play" d="M55 52.5v15l12.5-7.5z" />
						</svg>
						<b class="hunt-title">{tr('Buscando el mejor torrent para vos')}</b>
						<span class="hunt-bar"><i style:width="{Math.max(4, (scan.done / Math.max(1, scan.total)) * 100)}%"></i></span>
						<span class="hunt-count">{tr('{a} de {n}', { a: Math.min(scan.done + 1, scan.total), n: scan.total })}</span>
						<button id="search-stop" type="button" class="row-btn ghost" onclick={stopSearch}><Icon name="stop" size={15} />{tr('Detener')}</button>
					</div>
				{:else if screen === 'match'}
					<!-- El resultado: solo los buenos matches; sin ninguno, las 3 de mejor calidad con el aviso. -->
					{#if error}<p class="status error" role="alert">{error}</p>{/if}
					{#if found.length}
						{@render options(found.map((h) => all.find((t) => t.hash === h)).filter((t) => !!t), true)}
					{:else if wantLat && byBest.length}
						<!-- Sin latino: cómo seguir, con las mismas tarjetas que el paso de audio (sin lista, los botones ya lo dicen). -->
						<p class="none" role="status">{tr('No se encontraron opciones con audio latino')}</p>
						<div class="choices even">
							<button id="fallback-original" type="button" class="choice net" style="--lvl: var(--accent-fg); --i: 0" onclick={() => chooseAudio(false)}>
								<span class="tile wave" aria-hidden="true">
									<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
										<path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5H4Z" fill="currentColor" fill-opacity="0.25" />
										<path class="w1" d="M15.5 9.5a3.5 3.5 0 0 1 0 5" />
										<path class="w2" d="M18 7a7 7 0 0 1 0 10" />
									</svg>
								</span>
								<span class="txt">
									<strong>{tr('Buscar con audio original')}</strong>
									<span class="muted">{tr('No encontré latino · busco una con subtítulos en español')}</span>
								</span>
							</button>
							<button id="see-spain" type="button" class="choice net" class:off={!spanish.length} disabled={!spanish.length} style="--lvl: var(--amber, #f5a524); --i: 1" onclick={() => (showSpain = true)}>
								<span class="tile lat-tile" aria-hidden="true">
									<svg width="28" height="28" viewBox="0 0.75 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round">
										<path d="M4 5.5h16a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-9l-4.5 3.5v-3.5H4a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1Z" fill="currentColor" fill-opacity="0.18" />
										<text x="12" y="13.9" text-anchor="middle" font-size="7" font-weight="800" fill="currentColor" stroke="none" letter-spacing="0.3">ES</text>
									</svg>
								</span>
								<span class="txt">
									<strong>{tr('Español de España')}</strong>
									<span class="muted">{spanish.length ? tr(spanish.length === 1 ? '1 opción con español que casi seguro no es latino' : '{n} opciones con español que casi seguro no es latino', { n: spanish.length }) : tr('Ninguna con español de España')}</span>
								</span>
							</button>
							<button id="see-all" type="button" class="choice net" style="--lvl: var(--muted); --i: 2" onclick={() => (showAll = true)}>
								<span class="tile list-tile" aria-hidden="true">
									<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
										<path class="l1" d="M9 6h11" /><path class="l2" d="M9 12h11" /><path class="l3" d="M9 18h11" />
										<path class="l1" d="M4 6h.01" /><path class="l2" d="M4 12h.01" /><path class="l3" d="M4 18h.01" />
									</svg>
								</span>
								<span class="txt">
									<strong>{tr('Ver todas las opciones')}</strong>
									<span class="muted">{tr('{n} opciones, sin filtros · de mejor a peor calidad', { n: all.length })}</span>
								</span>
							</button>
						</div>
						{#if candidates.length || reading}<div class="row-actions">{@render more()}</div>{/if}
					{:else}
						<h3 class="ask">{!byBest.length ? tr('Ninguna entra en tu conexión') : tr('Sin subtítulos en español adentro')}</h3>
						<p class="muted latsum" role="status">{!byBest.length ? tr('Todas piden más de lo que da tu conexión: mirá "Ver todas" o cambiá la conexión.') : candidates.length ? tr('Búsqueda detenida: estas son las de mejor calidad.') : tr('Ninguna trae sub ES nativo: los subs se buscan afuera.')}</p>
						{@render options(byBest.slice(0, 3), false)}
					{/if}
					{#if found.length || !wantLat || !byBest.length}
					<div class="row-actions">
						{@render more()}
						<button id="see-all-rest" type="button" class="row-btn" onclick={() => (showAll = true)}>
							<Icon name="list" size={18} /><span class="row-text"><b>{tr('Ver todas las opciones')}</b></span><span class="count">{all.length}</span>
						</button>
					</div>
					{/if}
				{:else if screen === 'spain'}
					<h3 class="ask">{tr('Probablemente español de España')}</h3>
					<p class="muted latsum">{tr('Traen audio en español sin decir que es latino (o marcado de España): casi seguro es castellano.')}</p>
					{#if error}<p class="status error" role="alert">{error}</p>{/if}
					{@render options(spanish, false)}
					<div class="row-actions">
						<button id="fallback-original-spain" type="button" class="row-btn" onclick={() => chooseAudio(false)}>
							<Icon name="volume" size={18} /><span class="row-text"><b>{tr('Buscar con audio original')}</b><small>{tr('Con subtítulos en español')}</small></span>
						</button>
						<button id="see-all-spain" type="button" class="row-btn" onclick={() => { showSpain = false; showAll = true; }}>
							<Icon name="list" size={18} /><span class="row-text"><b>{tr('Ver todas las opciones')}</b></span><span class="count">{all.length}</span>
						</button>
					</div>
				{:else}
					<div class="bar">
						<div class="chips toggles" role="toolbar" aria-label={tr('Filtros de torrents')}>
							<button id="only-hdr" type="button" class="chip toggle" class:on={onlyHdr} aria-pressed={onlyHdr} onclick={() => (onlyHdr = !onlyHdr)}>HDR</button>
							<button id="only-es" type="button" class="chip toggle" class:on={onlyEs} aria-pressed={onlyEs} title={tr('Solo las verificadas que traen subtítulos en español')} onclick={() => (onlyEs = !onlyEs)}><Icon name="subs" size={14} />{tr('Subs ES')}</button>
						</div>
						<p class="summary" title={tr('TorBox es un servicio pago que baja torrents a sus servidores y te los pasa como video en línea. Estas opciones ya las tiene bajadas: el link se ve al instante en la tele, sin depender de los seeds.')}>{tr('{n} de {f} en TorBox · de mejor a peor calidad', { n: list.length, f: all.length })}</p>
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
		<button id="more-stop" type="button" class="row-btn" onclick={stopSearch}>
			<span class="spin"></span><span class="row-text"><b>{tr('Buscando…')}</b><small>{tr('{a} de {n}', { a: Math.min(scan.done + 1, scan.total), n: scan.total })}</small></span><span class="row-end">{tr('Detener')}</span>
		</button>
	{:else if candidates.length || nextMatch}
		<button id="search-more" type="button" class="row-btn" onclick={findNext}>
			<Icon name="search" size={18} /><span class="row-text"><b>{wantLat ? tr('Seguir buscando latino') : tr('Seguir buscando sub ES')}</b>{#if candidates.length}<small>{tr('{n} sin revisar', { n: candidates.length })}</small>{/if}</span>
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
			{@const ls = status(t)}
			{@const lb = LAT_BADGE[ls]}
			<li class="opt" class:best>
				{#if best}<span class="best-tag">{tr('Mejor opción')}</span>{/if}
				<div class="info">
				<div class="top">
					<span class="size">{gb(t.size)}</span>
					{#if t.res}<span class="tag res">{t.res === '2160p' ? '4K' : t.res === '1440p' ? '2K' : t.res}</span>{/if}
					{#if t.size && !fits(t)}<span class="tag heavy" title={tr('Pide ~{m} Mbps: más de lo que da tu conexión', { m: Math.round(mbpsOf(t)) })}>{tr('Puede cortarse')}</span>{/if}
					{#if t.hdr.length}<span class="tag hdr">HDR</span>{/if}
					<!-- Gallego solo si la peli es hablada en español o se pide latino; LAT siempre; el resto solo pidiendo latino. -->
					{#if ls === 'spain' && (orig === 'es' || wantLat)}
						<button id="audio-info-{t.hash}" type="button" class="tag es-audio" title={tr(lb.title)} aria-label={tr(lb.title)} onclick={() => quickTip(t.hash)}><Icon name="volume" size={13} />{tr(lb.text)}<span class="tip" class:now={tipFor === t.hash} class:auto={best} aria-hidden="true">{tr(lb.tip)}</span></button>
					{:else if ls === 'lat'}<span class="tag audio lat" title={tr(lb.title)}>{lb.text}{#if best}<span class="tip" aria-hidden="true">{tr(lb.tip)}</span>{/if}</span>
					<!-- Leído y sin español: LAT tachado. -->
					{:else if wantLat && ls === 'none'}<span class="tag no-lat" title={tr(lb.title)} use:explain={'nolat'}><s>LAT</s><span class="tip explain" class:now={fresh[t.hash]} aria-hidden="true">{tr(lb.tip)}</span></span>
					<!-- Sin confirmar: al tocarlo explica que hay que abrirlo y probar el audio. -->
					{:else if wantLat && (ls === 'likely' || ls === 'check')}
						<button id="audio-info-{t.hash}" type="button" class="tag es-audio audio {ls}" title={tr(lb.title)} aria-label={tr(lb.title)} onclick={() => quickTip(t.hash)}>{tr(lb.text)}<span class="tip" class:now={tipFor === t.hash} aria-hidden="true">{tr(lb.tip)}</span></button>
					{/if}
					<!-- Pidiendo latino, los subs no importan: no se muestran. -->
					{#if !wantLat}
					{#if sb?.on}<span class="tag cc es" title={sb.title} aria-label={sb.title}><Icon name="subs" size={13} />ES{#if best}<span class="tip second" aria-hidden="true">{tr('Subtítulos en español incluidos')}</span>{/if}</span>
					<!-- Leído sin subs adentro: ES en gris = se pueden buscar y bajar aparte. Sin leer: ES? gris punteado. -->
					{:else if sb}<span class="tag cc es-dl" title={sb.title} aria-label={sb.title} use:explain={'esdl'}><Icon name="subs" size={13} />ES<span class="tip explain" class:now={fresh[t.hash]} aria-hidden="true">{tr('No vienen incluidos: se bajan aparte')}</span></span>
					{:else}<span class="tag cc unk" title={tr('Sin analizar: no se sabe si trae subtítulos en español')}><Icon name="subs" size={13} />ES?</span>{/if}{/if}
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
				</div>
				<div class="acts">
				<!-- Sin leer todavía: un botón chico para leerlo (audio latino y subs incluidos). -->
				{#if info[t.hash] === 'busy'}
					<span class="scan busy" role="status"><span class="spin"></span>{tr('Analizando…')}</span>
				{:else if info[t.hash] === 'err'}
					<button id="scan-{t.hash}" type="button" class="scan err" title={why[t.hash]} onclick={() => { track('analizar', t.release); probe(t); }}>{tr('No se pudo · reintentar')}</button>
				{:else if !known(t)}
					<button id="scan-{t.hash}" type="button" class="scan" title={tr('Analizar torrent: audio latino y subtítulos incluidos')} onclick={() => { track('analizar', t.release); probe(t); }}>{tr('Analizar audio y subs')}</button>
				{/if}
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
					{:else}<Icon name="play" size={18} />{/if}
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
			{#if it.lvl != null}<span class="fit l{it.lvl}" title={WHY[it.lvl]()}><span class="dots" aria-hidden="true">{#each [1, 2, 3] as n (n)}<i class:on={n <= it.lvl}></i>{/each}</span>{LEVEL[it.lvl]()}</span>{/if}
		</span>
		{@render actions()}
	</li>
{/snippet}

<Sheet id="subs-sheet" title={tr('Subtítulos')} open={subsOpen} onclose={() => (subsOpen = false)}>
	<!-- Una línea de estado con un dibujo chico (video + subtítulo que se le suma) y, abajo, solo la lista. -->
	<div class="subs-head">
		<svg class="art subs-art" viewBox="0 0 64 36" aria-hidden="true">
			<rect class="tv" x="2" y="4" width="34" height="26" rx="4" />
			<path class="play" d="M16 12v10l8-5z" />
			<g class="sfile"><rect x="42" y="2" width="20" height="26" rx="3" /><path d="M46 12h12M46 18h8" /></g>
		</svg>
		<p role="status">
			{#if !match}{tr('Copiá el link de un torrent.')}
			{:else if esN > 0}{tr(esN > 1 ? 'Trae {n} subtítulos en español: elegilos con CC en el reproductor.' : 'Trae {n} subtítulo en español: elegilo con CC en el reproductor.', { n: esN })}
			{:else if matchInfo === 'busy'}<span class="spin"></span>{tr('Viendo si trae subtítulos en español…')}
			{:else if matchInfo && typeof matchInfo === 'object'}{tr('El video no incluye subtítulos en español')}
			{:else}{tr('Elegí un subtítulo')}{/if}
		</p>
		<button id="subs-tutorial" type="button" class="iconbtn tut" aria-label={tr('Cómo funciona')} title={tr('Cómo funciona')} onclick={() => (tutorialOpen = true)}><Icon name="help" size={20} /></button>
	</div>
	<p class="paste-note"><Icon name="link" size={14} />{tr('SenPlayer y Web Video Caster aceptan pegar el link del subtítulo')}</p>
	<ul class="subs">
		{#if match?.natives?.length}
			<li class="grp">{tr('Vienen con el video')}</li>
			{#each match.natives as n (n.track)}
				{#snippet nativeActions()}
					<button id="sub-copy-native-{n.track}" type="button" class="iconbtn copy" aria-label={tr('Copiar el video con este subtítulo')} onclick={() => { track('subtítulo', 'incluido en el video'); copyNative(n); }}><Icon name="copy" size={18} /></button>
				{/snippet}
				{@render row({ key: `n${n.track}`, head: tr(n.label), spec: tr('{k} · pista {n}', { k: tr(n.kind), n: n.track }) }, nativeActions)}
			{/each}
		{/if}

		{#if match && !subs && !searching && !subsError}
			<li>
				<button id="subs-search-more" type="button" class="more" onclick={searchSubs}>
					<Icon name="search" size={16} /><span><b>{tr('Buscar más subtítulos')}</b><span>{tr('Por si los del video no te sirven')}</span></span>
				</button>
			</li>
		{:else if searching}
			<li class="msg"><span class="spin"></span>{tr('Buscando en OpenSubtitles.org…')}</li>
		{:else if subs || subsError}
			{#if match?.natives?.length}<li class="grp">{tr('Encontrados para vos')}</li>{/if}
			{#if subsError && !subs}<li class="msg err">{subsError}</li>{:else if !ranked.length}<li class="msg">{tr('No encontré en OpenSubtitles.org')}</li>{/if}
			{#each ranked as sub (sub.id)}
				{#snippet foundActions()}
					<!-- Dos íconos en la misma fila; lleno el que va con donde se ve (Web Video Caster: pegar el link). -->
					<button id="sub-copy-{sub.id}" type="button" class="iconbtn sa" class:rec={doneWhere === 'wvc'} aria-label={tr('Copiar link')} title={tr('Copiar link')} onclick={() => copySub(sub)}><Icon name="link" size={18} /></button>
					<a id="sub-{sub.id}" class="iconbtn sa" class:rec={doneWhere !== 'wvc'} aria-label={tr('Descargar')} title={tr('Descargar')} href="/api/subs/{sub.id}?{new URLSearchParams({ name: fileName, ext: sub.format })}" download onclick={() => track('subtítulo', `bajar · ${sub.release}`)}><Icon name="download" size={18} /></a>
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
			<b>{tr('En este dispositivo')}</b>
			<small>SenPlayer · VLC</small>
		</button>
	</div>
</Sheet>

<!-- Al copiar el link de un video: confirmación, si trae subs en español (de `info`) y, abajo, el tutorial. -->
<!-- "En este dispositivo" no la abre: alcanza con el festejo (y, sin subs, la lista de subs). -->
<Sheet id="copied-sheet" title={tr('¡Link copiado!')} open={!!linkDone && doneWhere !== 'app'} onclose={() => (linkDone = null)}>
	{#if linkDone}
		{@const v = info[linkDone.hash]}
		{@const k = known(linkDone)}
		{@const subsN = k?.subs ?? 0}
		<!-- Arriba, la idea en un dibujo: el link sale del celu y llega a donde se va a ver. -->
		<div class="done-hero">
			<svg class="art done-art" viewBox="0 0 160 84" aria-hidden="true">
				<rect class="phone" x="10" y="20" width="26" height="46" rx="6" />
				<path class="link-fly" d="M44 43h40" />
				<path class="chain" d="M58 37a6 6 0 0 1 0 12h-4a6 6 0 0 1 0-12M66 49a6 6 0 0 1 0-12h4a6 6 0 0 1 0 12" />
				{#if doneWhere === 'wvc'}
					<rect class="tv" x="94" y="16" width="58" height="38" rx="6" />
					<path class="tv" d="M114 64h18M123 54v10" />
					<path class="play pop" d="M118 28v14l12-7z" />
				{:else}
					<rect class="phone big" x="104" y="8" width="34" height="66" rx="7" />
					<path class="play pop" d="M115 32v16l13-8z" />
				{/if}
				<circle class="ok-dot" cx="146" cy="16" r="10" />
				<path class="ok-tick" d="M141 16l3.5 3.5L151 12" />
			</svg>
			<p class="done-where">{doneWhere === 'wvc' ? tr('Pegalo en Web Video Caster') : tr('Pegalo en tu reproductor')}</p>
		</div>

		<!-- Subtítulos: si el video los trae, solo esa confirmación; si no, se abre la lista de subs (noSubsCheck). -->
		{#if v === 'busy'}
			<p class="subs-line"><span class="spin"></span>{tr('Revisando subs…')}</p>
		{:else if (k?.subs ?? 0) > 0 || linkDone.subFile}
			<p class="subs-line yes"><Icon name="subs" size={16} />{tr('Con subtítulos incluidos')}</p>
		{:else if !k}
			<button id="see-subs" type="button" class="subs-line act" onclick={() => linkDone && showSubs(linkDone)}><Icon name="subs" size={16} />{tr('Ver subtítulos')}</button>
		{/if}

		<!-- Atajos: más liviana si se corta, y cómo mandarlo a la tele. -->
		<div class="done-tiles" class:single={!net || net.key === NET[0].key}>
			{#if net && net.key !== NET[0].key}
				<button id="lighter" type="button" class="tile" onclick={lighter}>
					<svg class="art tile-art" viewBox="0 0 48 32" aria-hidden="true"><path class="gauge" d="M8 26a16 16 0 0 1 32 0" /><path class="needle" d="M24 26l-8-9" /><circle class="hub" cx="24" cy="26" r="2.5" /></svg>
					<b>{tr('¿Se cortó?')}</b><small>{tr('Una más liviana')}</small>
				</button>
			{/if}
			<button id="cast-line" type="button" class="tile" onclick={() => { linkDone = null; tutorialOpen = true; }}>
				<svg class="art tile-art" viewBox="0 0 48 32" aria-hidden="true"><rect class="tv" x="14" y="4" width="30" height="20" rx="3" /><path class="wave w1" d="M4 22a4 4 0 0 1 4 4" /><path class="wave w2" d="M4 16a10 10 0 0 1 10 10" /></svg>
				<b>{tr('A la tele')}</b><small>{tr('Cómo mandarlo')}</small>
			</button>
		</div>
	{/if}
</Sheet>

<!-- Festejo: aro que se dibuja, la cadena del link que salta y papelitos que salen disparados. -->
<div id="copied-burst" class="burst" popover="manual" bind:this={burstEl} aria-hidden="true">
	{#key burstN}
		<div class="burst-in">
			<div class="burst-mark">
				{#each Array(12) as _, i (i)}<span class="conf" style="--a: {i * 30}deg; --d: {i % 3}"></span>{/each}
				<svg viewBox="0 0 120 120">
					<circle class="burst-ring" cx="60" cy="60" r="50" />
					<g class="burst-chain"><path d="M52 66a12 12 0 0 1 0-17l7-7a12 12 0 0 1 17 17l-3 3M68 54a12 12 0 0 1 0 17l-7 7a12 12 0 0 1-17-17l3-3" /></g>
				</svg>
			</div>
			<b>{tr('¡Link copiado!')}</b>
			{#if linkDone && ((known(linkDone)?.subs ?? 0) > 0 || linkDone.subFile)}<span class="burst-subs"><Icon name="subs" size={18} />{tr('Con subtítulos incluidos')}</span>{/if}
		</div>
	{/key}
</div>

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
	.crumbs { display: flex; flex-wrap: wrap; align-items: center; gap: 2px 6px; margin: 0 0 4px; font-size: 13.5px; font-weight: 650; color: var(--muted); }
	.crumbs button { min-height: 36px; padding: 0 2px; border: 0; background: none; color: var(--accent-fg); font: inherit; }
	.crumbs button:active { opacity: 0.6; }
	.ask { margin: 10px 0 10px; font-size: 16px; }
	.choices { display: flex; flex-direction: column; gap: 8px; }
	.choices.even { display: grid; grid-auto-rows: 1fr; }
	.choice { display: flex; flex-direction: column; align-items: flex-start; gap: 3px; min-height: 64px; padding: 12px 14px; border: 1px solid var(--border); border-radius: 14px; background: var(--surface); text-align: left; transition: background 0.2s var(--ease), transform 0.15s var(--out); }
	.choice strong { display: inline-flex; align-items: center; gap: 8px; font-size: 15px; }
	.choice .muted { font-size: 12.5px; line-height: 1.35; }
	.choice:active { transform: scale(0.985); background: var(--surface-2); }
	.choice.primary { background: var(--accent); border-color: var(--accent); color: var(--accent-text); align-items: center; }
	.choice.off { opacity: 0.55; }
	/* Conexión: ícono de señal con 4/3/2/1 barras en el color del nivel (`--lvl`), entrada escalonada (`--i`). */
	.net { flex-direction: row; align-items: center; gap: 12px; animation: net-rise 0.36s var(--out) both; animation-delay: calc(var(--i) * 50ms); }
	/* Parlante: las dos ondas se encienden una tras otra, en loop. Globo latino: entra con un saludo y cada tanto se mueve. */
	/* Centro óptico: el globo pesa abajo (la colita), por eso su viewBox va corrido. */
	.wave svg, .lat-tile svg { display: block; }
	.wave .w1, .wave .w2 { animation: wave 1.6s ease-in-out infinite; }
	.wave .w2 { animation-delay: 0.2s; }
	@keyframes wave { 0%, 100% { opacity: 0.25; } 40% { opacity: 1; } }
	.list-tile .l1, .list-tile .l2, .list-tile .l3 { animation: list-in 2.4s var(--out) infinite; }
	.list-tile .l2 { animation-delay: 0.15s; }
	.list-tile .l3 { animation-delay: 0.3s; }
	@keyframes list-in { 0%, 60%, 100% { opacity: 1; transform: none; } 10% { opacity: 0.2; transform: translateX(-3px); } }
	.lat-tile svg { transform-origin: 30% 90%; animation: lat-in 0.6s var(--out) 0.15s both, lat-talk 3.2s ease-in-out 1.2s infinite; }
	@keyframes lat-in { from { transform: scale(0.4) rotate(-16deg); opacity: 0; } 60% { transform: scale(1.12) rotate(5deg); opacity: 1; } }
	@keyframes lat-talk { 0%, 82%, 100% { transform: none; } 88% { transform: rotate(-7deg) scale(1.05); } 94% { transform: rotate(5deg); } }
	.net .txt { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
	/* padding/borde en 0: la regla `.tile` de la hoja de copiado también matchea este span y lo descentraba. */
	.net .tile { flex: none; display: grid; place-items: center; width: 42px; height: 42px; padding: 0; border: 0; border-radius: 12px; background: color-mix(in srgb, var(--lvl) 14%, transparent); color: var(--lvl); transition: background 0.18s var(--ease), color 0.18s var(--ease), transform 0.15s var(--out); }
	.net.primary .tile { background: color-mix(in srgb, var(--accent-text) 18%, transparent); color: var(--accent-text); }
	.net .bar { opacity: 0.25; transform-box: fill-box; transform-origin: bottom; }
	.net .bar.lit { opacity: 1; animation: bar-up 0.3s var(--out) both; animation-delay: calc(var(--i) * 50ms + 140ms + var(--b) * 70ms); }
	.net.max .bar.lit:nth-child(4) { animation: bar-up 0.3s var(--out) both, bar-pulse 2.4s ease-in-out infinite; animation-delay: calc(var(--i) * 50ms + 350ms), 1.2s; }
	.net:active { transform: scale(0.97); }
	.net:active .tile { transform: scale(0.92); background: color-mix(in srgb, var(--lvl) 26%, transparent); }
	.net.picked .tile { background: var(--lvl); color: var(--bg); transform: scale(1.06); }
	.net.picked .bar.lit { animation: bar-flash 0.22s var(--ease); }
	@keyframes net-rise { from { opacity: 0; transform: translateY(8px); } }
	@keyframes bar-up { from { transform: scaleY(0); } }
	@keyframes bar-pulse { 50% { opacity: 0.45; } }
	@keyframes bar-flash { 40% { transform: scaleY(0.55); } }
	@media (prefers-reduced-motion: reduce) { .lat-tile svg, .wave .w1, .wave .w2, .list-tile path, .net, .net .bar.lit, .net.max .bar.lit:nth-child(4), .net.picked .bar.lit { animation: none; } .net:active, .net .tile { transform: none; } }
	.slow { padding: 1px 7px; border-radius: 999px; font-size: 10.5px; font-weight: 750; background: color-mix(in srgb, var(--green) 18%, transparent); color: var(--green); }
	/* Mismo aire que arriba de las migas (~27 px contando el alto de sus botones). */
	.none { margin: 16px 0 16px; text-align: center; font-size: 13.5px; color: var(--muted); }
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
	/* Los buenos matches, como la mejor opción del desktop: tinte verde y etiqueta arriba. */
	.opt.best { margin-top: 18px; border-color: color-mix(in srgb, var(--green) 55%, var(--border)); background: color-mix(in srgb, var(--green) 6%, var(--bg)); }
	/* Encontrada: la tarjeta aparece desde el radar (escala, foco y un brillo que la cruza una vez); sin diálogos. */
	.opt.best { animation: best-in 0.7s cubic-bezier(0.16, 1, 0.3, 1) both; box-shadow: 0 10px 28px -12px color-mix(in srgb, var(--green) 55%, transparent); }
	.opt.best::after { content: ''; position: absolute; inset: 0; border-radius: inherit; pointer-events: none; background: linear-gradient(105deg, transparent 35%, color-mix(in srgb, var(--green) 28%, transparent) 50%, transparent 65%) no-repeat; background-size: 250% 100%; background-position: 130% 0; animation: best-shine 1.1s ease-out 0.35s both; }
	.opt.best .best-tag { animation: tag-pop 0.5s cubic-bezier(0.16, 1, 0.3, 1) 0.3s both; }
	.opt.best .copy.primary { animation: play-nudge 0.6s cubic-bezier(0.16, 1, 0.3, 1) 0.55s both; }
	@keyframes best-in { from { opacity: 0; transform: translateY(14px) scale(0.94); filter: blur(6px); } }
	@keyframes best-shine { to { background-position: -30% 0; } }
	@keyframes tag-pop { from { opacity: 0; transform: translateY(6px) scale(0.6); } }
	@keyframes play-nudge { from { transform: scale(0.5); opacity: 0; } }
	@media (prefers-reduced-motion: reduce) { .opt.best, .opt.best::after, .opt.best .best-tag, .opt.best .copy.primary { animation: none; } }
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
	/* En la mejor opción, un globito explica cada badge al aparecer: primero el audio, después los subs. */
	.tag { position: relative; }
	.tip {
		position: absolute;
		bottom: calc(100% + 8px);
		left: 50%;
		z-index: 3;
		padding: 5px 9px;
		border-radius: 8px;
		background: var(--text);
		color: var(--bg);
		font-size: 11.5px;
		font-weight: 650;
		letter-spacing: 0;
		white-space: nowrap;
		pointer-events: none;
		box-shadow: 0 6px 18px var(--shadow-lg);
		translate: -50% 0;
		opacity: 0;
		animation: tip 3s var(--out) 0.5s;
	}
	.tip::after { content: ''; position: absolute; top: 100%; left: 50%; margin-left: -5px; border: 5px solid transparent; border-top-color: var(--text); }
	.tip.second { animation-delay: 3.6s; }
	/* El del badge ES: solo en la mejor opción sale solo; en cualquiera, al tocarlo. */
	.tip.explain { animation: none; }
	.tip.explain.now { animation: tip 3s var(--out) 0.3s; }
	.tag:global(.explaining) > .tip.explain { animation: tip 3s var(--out) var(--d); }
	.es-audio .tip { animation: none; }
	.es-audio .tip.auto { animation: tip 3s var(--out) 0.5s; }
	.es-audio .tip.now { animation: tip 2.4s var(--out); }
	.tag.es-audio { display: inline-flex; align-items: center; gap: 3px; background: none; font-family: inherit; color: var(--text); cursor: pointer; }
	@keyframes tip {
		0% { opacity: 0; transform: translateY(6px) scale(0.7); }
		12% { opacity: 1; transform: translateY(-2px) scale(1.06); }
		20% { transform: none; }
		85% { opacity: 1; transform: none; }
		100% { opacity: 0; transform: translateY(-4px) scale(0.96); }
	}
	@media (prefers-reduced-motion: reduce) { .tip { display: none; } }
	.tag.res, .tag.hdr { color: var(--text); }
	.tag.lat, .tag.es { color: var(--green); }
	/* Acciones al pie del resultado (2026-11-18): todas del mismo ancho y alto, ícono a la izquierda. */
	.row-actions { display: flex; flex-direction: column; gap: 10px; margin-top: 14px; }
	.row-btn { display: flex; align-items: center; gap: 12px; width: 100%; min-height: 56px; padding: 0 16px; border: 1px solid var(--border); border-radius: 16px; background: var(--surface-2); color: var(--text); font: inherit; text-align: left; transition: transform 0.15s var(--out), border-color 0.2s var(--ease); }
	.row-btn:active { transform: scale(0.98); border-color: var(--accent-fg); }
	.row-btn :global(svg) { flex: none; color: var(--muted); }
	.row-text { display: flex; flex-direction: column; gap: 1px; flex: 1; min-width: 0; }
	.row-text b { font-size: 15px; font-weight: 650; }
	.row-text small { font-size: 12.5px; color: var(--muted); font-variant-numeric: tabular-nums; }
	.row-end { font-size: 13.5px; font-weight: 600; color: var(--accent-fg); }
	.row-btn .count { padding: 2px 9px; border-radius: 999px; background: var(--surface-3, var(--border)); color: var(--muted); font-size: 12.5px; font-variant-numeric: tabular-nums; }
	.row-btn.ghost { width: auto; min-height: 44px; padding: 0 18px; border-radius: 999px; background: none; justify-content: center; gap: 8px; font-size: 14px; font-weight: 600; }
	/* Buscando (2026-11-18): videos en fila, una lupa que los recorre y el avance real abajo. */
	.hunt { display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 18px 0 8px; text-align: center; }
	/* Radar: el barrido da una vuelta cada 2,4 s y cada punto se enciende cuando le pasa por encima. */
	.radar { width: 120px; height: 120px; margin-bottom: 10px; overflow: visible; }
	.radar .ring { fill: none; stroke: var(--border); stroke-width: 1.5; }
	.radar .ring.inner { stroke-dasharray: 3 5; }
	.radar .sweep { transform-origin: 60px 60px; animation: sweep 2.4s linear infinite; }
	.radar .sweep path { fill: color-mix(in srgb, var(--accent) 22%, transparent); }
	.radar .blip { fill: var(--muted); opacity: 0.25; transform-box: fill-box; transform-origin: center; animation: blip 2.4s var(--out) infinite; animation-delay: calc(var(--i) * 0.48s + 0.1s); }
	.radar .core { fill: var(--accent); filter: drop-shadow(0 4px 10px color-mix(in srgb, var(--accent) 45%, transparent)); animation: core 2.4s ease-in-out infinite; transform-box: fill-box; transform-origin: center; }
	.radar .core-play { fill: var(--accent-text, #fff); }
	@keyframes sweep { to { transform: rotate(360deg); } }
	@keyframes blip { 0% { opacity: 1; fill: var(--accent-fg); transform: scale(1.5); } 40%, 100% { opacity: 0.25; fill: var(--muted); transform: none; } }
	@keyframes core { 50% { transform: scale(1.08); } }
	.hunt-title { font-size: 17px; text-wrap: balance; }
	.hunt-bar { width: min(240px, 80%); height: 6px; margin-top: 10px; border-radius: 999px; background: var(--surface-2); overflow: hidden; }
	.hunt-bar i { display: block; height: 100%; border-radius: inherit; background: var(--accent); transition: width 0.4s var(--out); }
	.hunt-count { font-size: 12.5px; color: var(--muted); font-variant-numeric: tabular-nums; }
	.hunt .row-btn { margin-top: 10px; }
	@media (prefers-reduced-motion: reduce) { .radar .sweep, .radar .blip, .radar .core { animation: none; } }
	.tag.heavy { color: var(--amber, #b7791f); border-color: currentColor; }
	/* Audio: LAT confirmado (verde), según el nombre (gris punteado), sin aclarar (ámbar, como "sin sub ES"). */
	.tag.audio.lat { color: var(--green); }
	.tag.audio.likely { border-style: dashed; color: var(--green); }
	.tag.audio.check { border-style: dashed; color: var(--amber); }
	/* Badge de audio en español que se toca (ver pistas): gris, mismo tamaño que un badge. */
	.acts { display: flex; align-items: center; gap: 8px; }
	/* Analizar: texto chico en acento, en dos renglones si hace falta; se toca en 44 px sin agrandar la fila. */
	.scan { position: relative; display: inline-flex; align-items: center; gap: 5px; max-width: 84px; padding: 0; border: 0; background: none; color: var(--accent-fg); font: inherit; font-size: 12px; font-weight: 650; line-height: 1.2; text-align: right; }
	button.scan::after { content: ''; position: absolute; inset: -10px -6px; }
	button.scan:active { opacity: 0.6; }
	.scan.busy { color: var(--muted); }
	.scan.err { color: var(--muted); }
	.scan .spin { flex: none; width: 12px; height: 12px; border-width: 2px; }
	/* Estados: LAT tachado = leído y sin latino; ES gris = subs para bajar aparte; gris punteado = sin leer. */
	.tag.no-lat, .tag.es-dl { color: var(--muted); }
	.tag.no-lat s { text-decoration-thickness: 1.5px; }
	.tag.unk { border-style: dotted; color: color-mix(in srgb, var(--muted) 70%, transparent); }
	/* Badge de subs compacto (cc + ES): entra en la línea de los tags. (`.sub` ya es la fila de subtítulo.) */
	.tag.cc { display: inline-flex; align-items: center; gap: 3px; padding: 1px 5px 1px 4px; }
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
	/* Hoja de subtítulos (2026-11-19): una línea de estado con dibujo, una nota y la lista. */
	.subs-head { display: grid; grid-template-columns: 56px minmax(0, 1fr) auto; align-items: center; gap: 10px; }
	.subs-head p { display: flex; align-items: center; gap: 8px; margin: 0; font-size: 14.5px; font-weight: 600; text-wrap: balance; }
	.subs-art .sfile { stroke: var(--accent-fg); stroke-width: 2.5; fill: color-mix(in srgb, var(--accent) 14%, transparent); animation: sfile 2.6s var(--out) 3; }
	/* El subtítulo aparece y se mete en el video (3 vueltas; al terminar queda quieto al lado). */
	@keyframes sfile { 0% { opacity: 0; } 15%, 50% { transform: translateX(0); opacity: 1; } 85%, 100% { transform: translateX(-22px); opacity: 0; } }
	@media (prefers-reduced-motion: reduce) { .subs-art .sfile { animation: none; } }
	.paste-note { display: flex; align-items: center; gap: 6px; margin: 8px 0 0; font-size: 12.5px; color: var(--muted); }
	.paste-note :global(svg) { flex: none; color: var(--accent-fg); }
	/* Copiar link / Descargar de un subtítulo: íconos de 40 px en la fila; lleno el recomendado. */
	.iconbtn.sa { border: 1px solid var(--border-strong); color: var(--text); }
	.iconbtn.sa.rec { border-color: transparent; background: var(--accent); color: var(--accent-text); }
	.small-btn { min-height: 36px; padding: 0 12px; font-size: 13px; position: relative; }
	.small-btn::after { content: ''; position: absolute; inset: -4px 0; }
	.subs { margin-top: 4px; }
	.grp { padding: 14px 0 4px; font-size: 11px; font-weight: 800; letter-spacing: 0.06em; text-transform: uppercase; color: var(--dim, var(--muted)); }
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
	/* Solo el LAT de la lista de subs: sin acotarlo pisaba el badge `.tag.audio.lat` de las opciones. */
	.l1 .lat { align-self: center; padding: 0 4px; border: 1px solid var(--border-strong); border-radius: 4px; font-size: 10px; font-weight: 700; letter-spacing: 0.04em; color: var(--muted); }
	.l1 .why { font-size: 11px; color: var(--muted); }
	.sub.tried b, .sub.tried .spec { color: var(--muted); text-decoration: line-through; }
	/* Nivel de match (ELEGIDA): palabra con color; el ámbar queda para lo que cuesta cuota. */
	.fit { display: inline-flex; align-items: center; gap: 5px; font-size: 11px; font-weight: 500; color: var(--muted); }
	/* Medidor de 3 puntos: cuántos calzan (perfecto = 3, puede desfasar = 0). */
	.dots { display: inline-flex; gap: 2px; }
	.dots i { width: 6px; height: 6px; border-radius: 50%; background: currentColor; opacity: 0.25; }
	.dots i.on { opacity: 1; }
	.fit.l3 { color: light-dark(#12733a, #4ade80); font-weight: 600; }
	.fit.l2 { color: light-dark(#3d7a55, #b5d86a); }
	.fit.l1 { color: light-dark(#76681c, #d9a85b); }
	.iconbtn { display: grid; place-items: center; width: 40px; height: 40px; border: 0; border-radius: 10px; background: none; color: var(--muted); }
	.iconbtn.copy { color: var(--accent-fg); background: color-mix(in srgb, var(--accent) 12%, transparent); }
	.cost { color: light-dark(#9a5b00, #f5b041); font-weight: 700; }
	.cost-btn { grid-column: span 2; display: inline-flex; align-items: center; gap: 6px; }
	.cost-btn[aria-disabled='true'] { opacity: 0.45; }
	.more, .gate { display: grid; align-items: center; gap: 10px; width: 100%; padding: 10px 12px; border-radius: 12px; color: var(--text); text-align: left; }
	.more { grid-template-columns: 28px minmax(0, 1fr); margin-top: 6px; border: 1px dashed var(--border-strong); background: none; }
	.more :global(svg) { justify-self: center; color: var(--accent-fg); }
	.more b, .gate b { display: block; font-size: 14px; }
	.more span span, .gs { font-size: 12px; color: var(--muted); }
	/* Premium, último recurso: sin caja; solo se marca cuando ya probaste varios. */
	.gate { grid-template-columns: 30px minmax(0, 1fr) auto; border: 1px solid transparent; background: none; }
	.gate:not(.hot) b { font-weight: 600; color: var(--muted); }
	.gate.hot { border-color: color-mix(in srgb, light-dark(#9a5b00, #f5b041) 70%, var(--border)); background: color-mix(in srgb, light-dark(#9a5b00, #f5b041) 7%, var(--surface)); }
	.gi { display: grid; place-items: center; width: 30px; height: 30px; color: var(--muted); }
	.chev { display: inline-flex; color: var(--muted); transition: transform 0.2s var(--ease); }
	.chev.up { transform: rotate(180deg); }
	.tut { width: 44px; height: 44px; }
	/* Festejo "¡Link copiado!": tapa la pantalla 1,5 s y se va solo. */
	.burst { inset: 0; width: 100%; height: 100%; max-width: none; max-height: none; margin: 0; padding: 0; border: 0; background: rgb(0 0 0 / 0.7); display: none; place-items: center; pointer-events: none; }
	.burst:popover-open { display: grid; animation: burst-bg 1.5s ease both; }
	.burst-in { display: grid; justify-items: center; gap: 14px; color: #fff; }
	.burst-in b { font-size: 28px; font-weight: 800; letter-spacing: -0.02em; animation: burst-text 0.5s var(--out) 0.25s both; }
	.burst-mark { position: relative; width: 132px; height: 132px; }
	.burst-mark svg { position: relative; width: 100%; height: 100%; fill: none; stroke-linecap: round; }
	.burst-ring { fill: var(--green); transform-box: fill-box; transform-origin: center; animation: burst-pop 0.55s cubic-bezier(0.34, 1.56, 0.64, 1) both; }
	.burst-chain { stroke: #fff; stroke-width: 7; transform-box: fill-box; transform-origin: center; animation: burst-chain 0.6s cubic-bezier(0.34, 1.56, 0.64, 1) 0.18s both; }
	.conf { position: absolute; left: 50%; top: 50%; width: 10px; height: 10px; margin: -5px; border-radius: 3px; background: var(--accent); rotate: var(--a); animation: conf 0.9s var(--out) 0.12s both; }
	.conf[style*='--d: 1'] { background: var(--yellow); border-radius: 50%; }
	.conf[style*='--d: 2'] { background: var(--green); width: 6px; height: 14px; }
	.burst-subs { display: inline-flex; align-items: center; gap: 8px; font-size: 16px; font-weight: 650; color: var(--green); animation: burst-text 0.5s var(--out) 0.4s both; }
	@media (prefers-reduced-motion: reduce) { .burst:popover-open, .burst-in *, .burst-in b { animation: none; } .conf { display: none; } }
	@keyframes burst-bg { 0% { opacity: 0; } 12%, 80% { opacity: 1; } 100% { opacity: 0; } }
	@keyframes burst-pop { from { transform: scale(0); } }
	@keyframes burst-chain { from { transform: scale(0.2) rotate(-90deg); opacity: 0; } }
	@keyframes burst-text { from { transform: translateY(14px) scale(0.9); opacity: 0; } }
	@keyframes conf { from { transform: translateY(0) scale(0.3); opacity: 1; } 70% { opacity: 1; } to { transform: translateY(-110px) scale(1) rotate(200deg); opacity: 0; } }

	/* Hoja "¡Link copiado!" */
	/* "¿Dónde lo vas a ver?": dos tarjetas con dibujo animado y casi sin texto. */
	/* Hoja "¡Link copiado!" (2026-11-18): un dibujo en vez de párrafos, los subs de un vistazo y dos atajos. */
	.done-hero { display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 4px 0 2px; }
	.done-art { max-width: 200px; }
	.done-art .chain { stroke: var(--accent-fg); stroke-width: 3; }
	.done-art .link-fly { stroke: color-mix(in srgb, var(--accent-fg) 35%, transparent); stroke-width: 3; stroke-dasharray: 4 6; animation: fly 1.2s linear infinite; }
	@keyframes fly { to { stroke-dashoffset: -20; } }
	.done-art .ok-dot { fill: var(--green); transform-box: fill-box; transform-origin: center; animation: ring 0.45s 0.15s var(--out) both; }
	.done-art .ok-tick { stroke: #fff; stroke-width: 3; stroke-dasharray: 16; stroke-dashoffset: 16; animation: draw 0.3s 0.45s var(--out) forwards; }
	.done-where { margin: 0; font-size: 16px; font-weight: 650; text-align: center; text-wrap: balance; }
	.subs-line { display: flex; align-items: center; justify-content: center; gap: 8px; width: 100%; margin: 10px 0 0; min-height: 36px; border: 0; background: none; color: var(--muted); font: inherit; font-size: 14px; }
	.subs-line.yes { color: var(--green); font-weight: 600; }
	.subs-line.act { color: var(--accent-fg); font-weight: 600; }
	.done-tiles { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 12px; }
	.done-tiles.single { grid-template-columns: 1fr; }
	.tile { display: flex; flex-direction: column; align-items: center; gap: 1px; padding: 12px 8px; border: 1px solid var(--border); border-radius: 16px; background: none; color: var(--text); font: inherit; transition: transform 0.15s var(--out), border-color 0.2s var(--ease); }
	.tile:active { transform: scale(0.97); border-color: var(--accent-fg); }
	.tile b { font-size: 14px; margin-top: 4px; }
	.tile small { font-size: 12px; color: var(--muted); }
	.tile-art { max-width: 48px; }
	.tile-art .gauge { stroke: var(--muted); stroke-width: 3; }
	.tile-art .needle { stroke: var(--accent-fg); stroke-width: 3; transform-box: view-box; transform-origin: 24px 26px; animation: needle 2.4s var(--ease) infinite; }
	.tile-art .hub { fill: var(--accent-fg); }
	@keyframes needle { 0%, 100% { transform: rotate(40deg); } 50% { transform: rotate(0deg); } }
	@media (prefers-reduced-motion: reduce) { .done-art .link-fly, .tile-art .needle { animation: none; } .done-art .ok-tick { stroke-dashoffset: 0; } }
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
	.link-btn { flex-basis: 100%; min-height: 36px; border: 0; background: none; color: var(--muted); font-size: 13px; text-decoration: underline; text-underline-offset: 3px; }
	.link-input { width: 100%; height: 44px; margin: 10px 0 0; padding: 0 10px; border-radius: var(--radius); border: 1px solid var(--border-strong); background: var(--surface-2); font-size: 16px; }
</style>
