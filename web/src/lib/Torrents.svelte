<script lang="ts">
	// Torrents de un video que TorBox tiene en caché, en pasos (como el desktop): buscando (fuente por fuente) →
	// ¿audio latino? → el PRIMER BUEN MATCH (`isMatch`), leyendo pistas de a una de mejor a peor calidad, con "Seguir
	// buscando" y "Ver todas las opciones"; migas para volver. Por fila: peso, calidad de
	// imagen, audio y subs en español, y copiar el link https de TorBox. Los subtítulos son de cada torrent: aparecen
	// al copiar su link (nativos primero; si no trae, se buscan afuera; Premium plegado al final).
	import Icon from '$ui/components/Icon.svelte';
	import Sheet from '$ui/components/Sheet.svelte';
	import Tour from '$ui/components/Tour.svelte';
	import CastVideo from './CastVideo.svelte';
	import FlowChoice from '$ui/flow/FlowChoice.svelte';
	import FlowChoices from '$ui/flow/FlowChoices.svelte';
	import FlowCrumbs from '$ui/flow/FlowCrumbs.svelte';
	import FlowRadar from '$ui/flow/FlowRadar.svelte';
	import FlowSearching from '$ui/flow/FlowSearching.svelte';
	import { stepIn } from '$ui/flow/step-in.ts';
	import { casterFor, castSteps, device } from '$ui/components/tours.ts';
	import * as saved from './saved.ts';
	import { loc, t as tr } from './i18n.svelte.ts';
	import { untrack } from 'svelte';
	import { audioOf, latRank, latStatus, LAT_BADGE, type Tracks } from '$ui/audio.ts';
	import type { Snippet } from 'svelte';
	import { track } from './track.ts';
	import { byQuality as rankQuality, optionMbps } from '$ui/rank.ts';
	import { getApi } from '$ui/context.ts';
	import OptionsList from '$ui/options/OptionsList.svelte';
	import { emptyLoad, loadOptions, type OptionsLoad } from '$ui/options/options-load.ts';
	import { HDR_TIP, langTags, qualityOf, resLabel, sizeText, TipBook, type DockButton, type OptionRowView } from '$ui/options/row.ts';
	import SubRow from '$ui/subs/SubRow.svelte';
	import SubsPicker from '$ui/subs/SubsPicker.svelte';
	import type { SubsCtx } from '$ui/subs/subs-flow.ts';
	import { keyOf } from '$ui/subs/subs-logic.ts';
	import type { NativeSub, OptionRef, SubtitleOption, TorboxIds, TorrentOption } from '$ui/types.ts';

	interface Props {
		imdb: string;
		s?: number | null;
		e?: number | null;
		name: string;
		/** Idioma original (ISO 639-1 de TMDB): el audio que sale por defecto. */
		orig?: string | null;
		/** Duración en minutos (de la ficha), para el bitrate. */
		runtime?: number | null;
		/** Las opciones ya armadas ("Pegar magnet": los videos de ese torrent); sin pasos ni búsqueda, directo a la lista. */
		given?: TorrentOption[] | null;
	}
	let { imdb, s = null, e = null, name, orig = null, runtime = null, given = null }: Props = $props();
	const api = getApi();

	type Torrent = TorrentOption;
	type Native = NativeSub;
	type Choice = { key: string; label: string; url: string };
	type Video = { fps: number | null; duration: number | null };
	type FileId = { hash: string; size: string };

	/** Resoluciones de mejor a peor; `other` junta lo que no es 4K/1080p/720p (o no lo dice). */
	const RES = ['2160p', '1080p', '720p', 'other'];
	/** El video (y episodio): opciones, links, pistas y subtítulos van por `getApi()` con esto. */
	const ref: OptionRef = $derived(s && e ? { kind: 'tv', videoId: `${imdb}:${s}:${e}` } : { kind: 'movie', videoId: imdb });

	/** La búsqueda de opciones (`options.load`): progreso fuente por fuente, chequeo de TorBox y la lista. */
	let load = $state<OptionsLoad>(emptyLoad());
	let error = $state('');
	let onlyHdr = $state(false);
	/** Solo las que ya se sabe que traen subs en español (verificadas o con .srt en el torrent). */
	let onlyEs = $state(false);
	/** Estado del botón copiar por hash. */
	let copy = $state<Record<string, 'busy' | 'ok' | 'err'>>({});
	/** Link que el navegador no dejó copiar solo (http en la LAN): se muestra para copiarlo a mano. */
	let manual = $state<{ url: string; release: string; kind: 'video' | 'sub'; t?: Torrent } | null>(null);
	/** Hoja "¡Link copiado!" del video recién copiado: si trae subs en español y, si no, ver los disponibles. */
	let linkDone = $state<Torrent | null>(null);
	/** "¿Dónde lo vas a ver?": el link de descarga sirve directo en los reproductores, pero Web Video Caster lo
	 * muestra como texto; para él va dentro de /play.html (un <video> que detecta; el link después del #). El toque en
	 * la opción es el que copia (iOS). */
	let whereFor = $state<{ t: Torrent; url: string } | null>(null);
	/** A dónde se copió el último video (null = no se preguntó): con 'app' no hay hoja "¡Link copiado!", solo el festejo. */
	let doneWhere = $state<'wvc' | 'app' | null>(null);
	/** El stream (.m3u8) anda igual en todos: se copia directo; el de descarga pregunta. */
	function askWhere(t: Torrent, url: string) {
		if (/\.tb-cdn\./.test(url) && !/\.m3u8/.test(url)) whereFor = { t, url };
		else copyUrl(t, url);
	}
	function copyWhere(where: 'wvc' | 'app') {
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
	let copied = $state<{ kind: 'video' | 'sub'; name: string } | null>(null);
	let toastEl = $state<HTMLElement>();
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
	/** Festejo grande de "¡Link copiado!" sobre todo (popover), antes de la hoja. */
	let burstEl = $state<HTMLElement>();
	let burstN = $state(0);
	let burstT: ReturnType<typeof setTimeout> | undefined;
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
	/** Tutorial animado de Web Video Caster (CastVideo), tras copiar el link. */
	let videoOpen = $state(false);
	/** Hoja "¡Link copiado!": 1 = dibujo + "Ver tutorial"; 2 = bajar Web Video Caster antes del video (2026-11-23). */
	let castStep = $state<1 | 2>(1);
	$effect(() => {
		if (linkDone) castStep = 1;
	});
	/** Buscar subtítulos afuera sin tocar "Buscar más" (se abrió la lista sin que el video traiga en español). */
	let subsAuto = $state(false);

	// Solo depende del video (`ref`): lo demás va en `untrack`, así nada que llegue
	// después (subs, cuota, copias) vuelve a disparar el pedido ni vacía la lista que ya se ve.
	$effect(() => {
		const r = ref;
		const key = `options:${r.videoId}`;
		const hit = saved.peek(key) as TorrentOption[] | null;
		let live = true;
		untrack(() => {
			error = '';
			copy = {};
			match = null;
			net = null;
			goStep('net');
			wantLat = false;
			found = [];
			showAll = false;
			tips.reset();
			// Lista guardada 1 hora (saved.ts): se pinta en este mismo cuadro, sin pasar por la búsqueda.
			const ready = given ?? hit;
			load = ready ? { ...emptyLoad(), options: ready, done: true } : emptyLoad();
			// Torrent pegado: ya se sabe qué torrent es, no hay conexión ni audio para elegir.
			if (given) {
				step = 'list';
				showAll = true;
			}
			if (!ready)
				loadOptions(api, r, (st) => {
					load = st;
					if (st.error) error = st.error;
					if (st.done && st.options) saved.store(key, st.options, saved.HOUR);
				}, () => live);
		});
		return () => {
			live = false;
			gen++;
		};
	});

	// ── Pasos ────────────────────────────────────────────────────────────────────────────────────────────────
	/** Conexión donde se va a ver (2026-11-18): la elige el usuario en cada video y pone el tope de bitrate
	 * del buen match; "¿Se cortó?" baja un nivel. `mbps`: lo más que se le pide al video (el piso del rango). */
	const NET = [
		{ key: 'terrible', label: 'Muy baja', range: 'Menos de 8 Mbps o señal que se corta: busco una muy liviana', mbps: 4, tone: 'red' },
		{ key: 'low', label: 'Baja', range: '8 a 25 Mbps, o la tele en wifi 2.4 GHz', mbps: 10, tone: 'amber' },
		{ key: 'normal', label: 'Normal', range: '25 a 100 Mbps', mbps: 25, tone: 'accent-fg' },
		{ key: 'high', label: 'Alta', range: 'Más de 100 Mbps, en wifi 5 GHz o por cable', mbps: Infinity, tone: 'green' }
	] as const;
	/** La conexión elegida para este video: se pregunta siempre (cambia según dónde se vea). */
	let net = $state<(typeof NET)[number] | null>(null);
	/** La que se acaba de tocar: su ícono se llena del color del nivel antes de pasar al audio. */
	let netPick = $state<string | null>(null);
	function chooseNet(n: (typeof NET)[number]) {
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
	/** Lo que mira el ranking compartido de una opción. */
	const mbpsOf = (t: Torrent) => optionMbps(t, runtime);
	/** ¿Entra en la conexión elegida? Sin peso no se sabe cuánto pide: no entra (no puede ser el buen match). */
	const fits = (t: Torrent) => !!t.sizeBytes && (!net || mbpsOf(t) <= net.mbps);

	/** Paso actual: la conexión (si no se eligió nunca), el audio, o el resultado (buscando el primer buen match, ese
	 * match o, con `showAll`, todas). */
	let step = $state<'net' | 'audio' | 'list'>('audio');
	let wantLat = $state(false);
	/** Buenos matches que se muestran, en el orden en que aparecieron (hashes). */
	let found = $state<string[]>([]);
	/** Pidió "Ver todas las opciones". */
	let showAll = $state(false);
	/** Pidió latino, no hubo y vio las de español (casi seguro de España). */
	let showSpain = $state(false);
	/** Cada cambio de paso (o de video) invalida lo que se estaba leyendo: los bucles miran este número. */
	let gen = 0;
	function goStep(to: 'net' | 'audio' | 'list') {
		gen++;
		reading = false;
		showSpain = false;
		step = to;
	}

	const all = $derived(load.options ?? []);
	const known = (t: Torrent) => {
		const v = info[t.hash];
		return v && typeof v === 'object' ? v : null;
	};
	/** Estado del audio latino (regla única en audio.ts). */
	const status = (t: Torrent) => latStatus(t, known(t));
	/** Con potencial de latino: latino o probable, o sin confirmar pero con español (dicho en el nombre o leído sin
	 * variante). Las que no dicen nada de idioma no cuentan. */
	const potential = (t: Torrent) => {
		const s = status(t);
		return s === 'lat' || s === 'likely' || (s === 'check' && (t.spanish || known(t)?.audio === 'es'));
	};
	const hasEs = (t: Torrent) => t.subFile || (known(t)?.subs ?? 0) > 0;
	/** Única regla de "buen match": pidiendo latino, LAT (pistas o nombre; los subs no importan); con audio original,
	 * sub ES nativo (dentro del video o .srt en el torrent). */
	const isMatch = (t: Torrent) => (wantLat ? status(t) === 'lat' : hasEs(t));
	/** Única regla de "candidata a leer": sin leer (ni leyéndose ni con error) y que pueda ser lo pedido. Latino: sin
	 * confirmar y con algo que lo sugiera (web latina, MULTI / Dual / español sin aclarar); las que no dicen nada de
	 * idioma no se leen. Audio original: sin saber si trae sub ES. */
	const unread = (lat: boolean, t: Torrent) => typeof info[t.hash] !== 'string' && (lat ? !known(t)?.audio && (status(t) === 'likely' || (status(t) === 'check' && t.spanish)) : !hasEs(t) && !known(t));
	const byQuality = (a: Torrent, b: Torrent) => rankQuality(a, b, runtime);
	/** Lo que entra con el audio elegido (latino: solo las con potencial, primero por señal de latino: `latRank`), de mejor a peor. `byBest`: solo las que entran
	 * en la conexión (de ahí sale el buen match); `everything`: todas, para "Ver todas". */
	const everything = $derived(wantLat ? all.filter(potential).sort(byQuality).sort((a, b) => latRank(status(a)) - latRank(status(b))) : [...all].sort(byQuality));
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

	function chooseAudio(lat: boolean) {
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
	/** Qué se ve en el paso de resultado: buscando el primer match, el resultado o todas. */
	const screen = $derived(step === 'net' || step === 'audio' ? step : showAll ? 'all' : showSpain ? 'spain' : reading && !found.length ? 'search' : 'match');
	const still = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
	/** El video que copiaste: los subtítulos se ordenan por cuánto calzan con él. */
	let match = $state<{ hash: string; release: string; natives?: Native[]; file?: FileId; video?: Video } | null>(null);

	/** Link de TorBox recién pedido (uno nuevo en cada copia); `choices` si hay audio en inglés y en latino. */
	const linkOf = (t: Torrent) => api.options.link(ref, t, { orig });
	/** Elegir audio: el toque en la opción es el que copia (por http hace falta un toque para copiar). */
	/** Globitos de los badges (los mismos que el desktop, `TipBook`): el primero de cada tipo explica qué significa; el
	 * badge tocado (Gallego, LAT?) muestra el suyo al toque. */
	const tips = new TipBook();
	/** Sube con cada toque de un badge: vuelve a armar las filas (los globitos no son estado de Svelte). */
	let tapped = $state(0);
	function quickTip(hash: string) {
		tips.tap(hash);
		tapped++;
	}
	/** Recién leídos en esta pantalla: sus badges naranjas explican qué significan con un globito. */
	let fresh = $state<Record<string, boolean>>({});
	/** Por qué falló el análisis de cada torrent (lo dice el server). */
	let why = $state<Record<string, string>>({});
	let audioFor = $state<{ t: Torrent; choices: Choice[] } | null>(null);

	/** Lo leído de cada torrent (subs en español y audio, ver audio.ts), 'busy' mientras se lee o 'err' si falló.
	 * Es del torrent y no cambia: se guarda para siempre (saved.remember). */
	let info = $state<Record<string, Tracks | 'busy' | 'err' | null>>({});
	$effect(() => {
		for (const t of load.options ?? []) if (!(t.hash in info)) info[t.hash] = saved.recall(`tracks:${t.hash}`) as Tracks | null;
	});
	function know(hash: string, v: Tracks) {
		info[hash] = v;
		saved.remember(`tracks:${hash}`, v);
	}
	/** Lee el encabezado del video (subs y audios). Con `ids` (del link recién copiado) es un pedido a TorBox; sin
	 * ellos, también agrega el torrent. false si falló. */
	async function probe(t: Torrent, ids?: TorboxIds | null) {
		info[t.hash] = 'busy';
		fresh[t.hash] = false;
		try {
			const j = await api.options.tracks(ref, t, { ids });
			know(t.hash, { subs: j.subs, audio: audioOf(j.audios), audios: j.audios });
			fresh[t.hash] = true;
			return true;
		} catch (err) {
			info[t.hash] = 'err';
			why[t.hash] = (err as Error).message || tr('No se pudo analizar.');
			return false;
		}
	}
	/** La fila de la lista compartida (`$ui/options/OptionRow.svelte`): peso, badges, calidad, analizar y copiar. */
	function rowOf(t: Torrent, best: boolean): OptionRowView {
		void tapped;
		const k = known(t);
		const v = info[t.hash];
		const n = k?.subs ?? null;
		const subsTitle = n != null && n > 0 ? tr(n > 1 ? 'El video trae {n} subtítulos en español adentro' : 'El video trae {n} subtítulo en español adentro', { n })
			: t.subFile ? tr('El torrent trae un archivo de subtítulo en español') : undefined;
		const { audio, subs } = langTags({ hash: t.hash, lat: status(t), want: wantLat, spokenEs: orig === 'es', subs: hasEs(t) ? true : n === 0 ? false : null, best,
			fresh: fresh[t.hash], subsTitle, audioId: `audio-info-${t.hash}`, onTap: () => quickTip(t.hash) }, tips, tr);
		const analyze = () => {
			track('analizar', t.release);
			probe(t);
		};
		const scan = (text: string, title: string, busy: string | null = null): DockButton =>
			({ id: `scan-${t.hash}`, icon: 'search', text, busy, cancel: '', title, aria: busy ?? text, onclick: busy ? () => {} : analyze });
		// Sin leer todavía: un botón chico para leerlo (audio latino y subs incluidos).
		const dock = v === 'busy' ? [scan('', tr('Analizando…'), tr('Analizando…'))]
			: v === 'err' ? [scan(tr('No se pudo · reintentar'), why[t.hash] ?? '')]
			: !k ? [scan(tr('Analizar audio y subs'), tr('Analizar torrent: audio latino y subtítulos incluidos'))] : [];
		const c = copy[t.hash];
		const label = c === 'err' ? tr('Reintentar copiar el link') : tr('Copiar link de TorBox');
		return {
			hash: t.hash, title: t.release, best, bestText: tr('Mejor opción'), idle: true, tooBig: false, skipped: false,
			size: sizeText(t.sizeBytes, loc()),
			hdr: t.hdr.length ? t.hdr.map((x) => HDR_TIP[x]).filter((x): x is string => !!x).map((x) => tr(x)).join('\n') || 'HDR' : null,
			res: t.resolution ? resLabel(t.resolution, tr('Otras')) : null,
			heavy: t.sizeBytes && !fits(t) ? tr('Pide ~{m} Mbps: más de lo que da tu conexión', { m: Math.round(mbpsOf(t)) }) : null,
			failedBefore: null, torbox: null, audio, subs, nofit: null, mid: null,
			quality: qualityOf(t.source, t.release, `qinfo-${t.hash}`, tr),
			// Como ▶ del desktop: un botón redondo; lleno en los buenos matches.
			action: { kind: 'play', id: `copy-${t.hash}`, tone: best ? 'accent' : 'ghost', state: c ?? 'idle', label, title: label, onclick: () => copyLink(t), bg: null, dock }
		};
	}
	/** Pide el link en el toque; si hay inglés y latino, pregunta antes de copiar. */
	async function copyLink(t: Torrent) {
		copy[t.hash] = 'busy';
		let got;
		try {
			got = await linkOf(t);
		} catch (err) {
			error = (err as Error).message;
			return done(t, 'err');
		}
		delete copy[t.hash];
		// Link de descarga (plan sin streaming): de paso se leen sus pistas, sin volver a agregar el torrent.
		if (got.ids && !known(t)) probe(t, got.ids);
		else if (got.subsEs != null && !known(t)) know(t.hash, { subs: got.subsEs, audio: null });
		subsFor(t, got.file ?? undefined, got.natives, got.video ?? undefined);
		if (got.choices?.length) audioFor = { t, choices: got.choices };
		else askWhere(t, got.url);
	}
	/** Subtítulos de un torrent, con lo que ya trajo su link (sin volver a TorBox). Si el video trae en español lo dice
	 * `info` (una sola fuente para la opción y este panel); `natives` son esos mismos subs como links del stream (solo
	 * con streaming en el plan). Buscar afuera es a pedido ("Ver subtítulos disponibles"). */
	function subsFor(t: Torrent, file?: FileId, natives?: Native[], video?: Video) {
		subsAuto = false;
		match = { hash: t.hash, release: t.release, natives, file, video };
	}
	/** Abre los subtítulos de `t` y busca afuera. */
	function showSubs(t: Torrent) {
		if (match?.hash !== t.hash) subsFor(t);
		linkDone = null;
		subsOpen = true;
		subsAuto = true;
	}
	/** Subs en español del video que tiene abierto el panel (de `info`). */
	const matchInfo = $derived(match ? info[match.hash] : null);
	/** Cuántos subs en español trae el video del panel (nativos con link o, si no, lo leído). */
	const esN = $derived(match?.natives?.length || (matchInfo && typeof matchInfo === 'object' ? matchInfo.subs : 0));
	/** Copia ya (Chrome deja unos segundos después del toque); si el navegador no deja, un toque más en la hoja. */
	async function copyUrl(t: Torrent, url: string) {
		// Título · calidad · audio elegido · dónde (el panel lo separa por ` · `).
		track('copiar link', `${name}${s ? ` T${s}E${e}` : ''} · ${t.resolution ?? ''} · ${wantLat ? 'Latino' : 'Original'} · ${/play\.html/.test(url) ? 'TV' : 'Celu'}`);
		if (copyNow(url)) return done(t, 'ok');
		try {
			await navigator.clipboard.writeText(url);
			done(t, 'ok');
		} catch {
			manual = { url, release: t.release, kind: 'video', t };
		}
	}
	/** Copiado un video que no trae subs en español (ya leído): en vez de la hoja de "copiado", la lista de subs con
	 * la explicación arriba. Si todavía se está leyendo, se decide cuando termina (efecto de abajo). */
	function noSubsCheck(t: Torrent) {
		const k = known(t);
		if (linkDone?.hash === t.hash && k && !k.subs && !t.subFile) showSubs(t);
	}
	$effect(() => {
		if (linkDone && typeof info[linkDone.hash] === 'object') untrack(() => linkDone && noSubsCheck(linkDone));
	});
	function done(t: Torrent, st: 'ok' | 'err') {
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
	/** Link absoluto del .srt (en la LAN, el de la Mac): termina en la extensión para Web Video Caster. */
	const subUrl = (sub: SubtitleOption) =>
		`${location.origin}/api/subs/${sub.id}/${encodeURIComponent(fileName.replace(/[^\p{L}\p{N}]+/gu, '.'))}.es.${sub.format === 'ass' ? 'ass' : 'srt'}`;
	/** Copia en el mismo toque con un textarea oculto: anda por http, donde no hay `navigator.clipboard`.
	 * iOS no selecciona texto de un campo de solo lectura (y `execCommand` igual dice que copió): por eso editable,
	 * con rango explícito, y se verifica que lo seleccionado sea el texto. */
	function copyNow(text: string) {
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
	async function copySub(sub: SubtitleOption, ctx: SubsCtx) {
		track('subtítulo', `copiar link · ${sub.release}`);
		ctx.pick(keyOf(sub));
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
	/** Copia un nativo: el video con ese subtítulo puesto. */
	function copyNative(n: Native, ctx: SubsCtx) {
		ctx.pick(`n${n.track}`);
		if (copyNow(n.url)) copied = { kind: 'video', name: tr('Subtítulos del video') };
		else manual = { url: n.url, release: tr('Subtítulos del video'), kind: 'video' };
	}

	/** Premium ya bajado (gastó 1, solo con el toque): copia el link del .srt servido por la Mac. */
	function copyPremium(sub: SubtitleOption) {
		track('subtítulo', `premium · ${sub.release}`);
		const url = `${location.origin}/api/premium/${sub.id}/${encodeURIComponent(fileName.replace(/[^\p{L}\p{N}]+/gu, '.'))}.es.srt`;
		const name = sub.release || tr('Subtítulo');
		if (copyNow(url)) copied = { kind: 'sub', name };
		else manual = { url, release: name, kind: 'sub' };
	}

	const fileName = $derived(name + (s && e ? ` S${String(s).padStart(2, '0')}E${String(e).padStart(2, '0')}` : ''));
</script>

<section class="torrents" aria-label={tr('Torrents en TorBox')} aria-busy={!load.options && !error}>
	{#if !load.options && !error}
		<!-- Paso 1: hasta que terminan TODAS las fuentes y el chequeo de TorBox. -->
		<FlowSearching title={tr('Buscando torrents…')} sub={load.checking ? tr('Viendo cuáles tiene TorBox') : load.progress?.total ? tr('{n} de {d} fuentes', { n: load.progress.done, d: load.progress.total }) : ''} frac={load.progress?.total ? (load.checking ? 1 : (load.progress.done / load.progress.total) * 0.9) : null} />
	{:else if error && !load.options}
		<p class="status error" role="alert">{error}</p>
	{:else if load.options && !all.length}
		<p class="status muted">{tr('No hay torrents en TorBox para esto.')}</p>
	{:else if load.options}
		{#if step !== 'net' && net}
			<FlowCrumbs aria={tr('Ruta')} items={[
				{ id: 'crumb-net', label: tr('Conexión {c}', { c: tr(net.label).toLowerCase() }), title: tr('Cambiar la conexión'), onclick: () => goStep('net') },
				...(step === 'list' ? [{ id: 'crumb-audio', label: wantLat ? tr('Audio latino') : tr('Audio original'), onclick: () => goStep('audio') }] : [])
			]} />
		{/if}

		{#key screen}
			<div class="step" in:stepIn>
				{#if screen === 'net'}
					<h3 class="ask">{tr('¿Cómo es tu internet donde lo vas a ver?')}</h3>
					<FlowChoices>
						<!-- La más rápida arriba; NET queda de menor a mayor para que "¿Se cortó?" baje un nivel. -->
						{#each [...NET].reverse() as n, i (n.key)}
							<FlowChoice id="net-{n.key}" title={tr(n.label)} sub={tr(n.range)} tile={{ kind: 'net', level: (NET.indexOf(n) + 1) as 1 | 2 | 3 | 4 }} tone="var(--{n.tone})" {i} primary={net?.key === n.key} picked={netPick === n.key} onclick={() => chooseNet(n)} />
						{/each}
					</FlowChoices>
				{:else if screen === 'audio'}
					{@const named = all.filter((t) => status(t) === 'lat').length}
					{@const toRead = all.filter((t) => unread(true, t)).length}
					{@const maybe = all.filter(potential).length}
					<h3 class="ask">{tr('¿Necesitás audio latino?')}</h3>
					<FlowChoices even>
						<!-- Mismas tarjetas con ícono que la conexión: el parlante late, el latino entra con un saludo. -->
						<FlowChoice id="audio-any" title={tr('Audio original')} sub={tr('{n} opciones · busco una con subtítulos en español', { n: all.length })} tile={{ kind: 'wave' }} tone="var(--accent-fg)" i={0} onclick={() => chooseAudio(false)} />
						<FlowChoice
							id="audio-lat"
							title={tr('Solo audio latino')}
							badge={toRead ? tr('Demora más') : null}
							sub={!maybe
								? tr('No hay torrents con audio latino')
								: !toRead
									? tr(named === 1 ? '1 opción lo tiene seguro' : '{n} opciones lo tienen seguro', { n: named })
									: tr(maybe === 1 ? '1 opción podría tenerlo · la reviso por vos' : 'Hasta {n} opciones podrían tenerlo · las reviso por vos', { n: maybe })}
							tile={{ kind: 'bubble', text: 'LAT' }}
							tone="var(--green)"
							i={1}
							disabled={!maybe}
							onclick={() => chooseAudio(true)} />
					</FlowChoices>
				{:else if screen === 'search'}
					<!-- Buscando: un radar barre las opciones (puntos que se encienden al pasar); al primero que sirve, aparece el resultado. -->
					<FlowRadar title={tr('Buscando el mejor torrent para vos')} frac={scan.done / Math.max(1, scan.total)} count={tr('{a} de {n}', { a: Math.min(scan.done + 1, scan.total), n: scan.total })} stopId="search-stop" stopText={tr('Detener')} onstop={stopSearch} />
				{:else if screen === 'match'}
					<!-- El resultado: solo los buenos matches; sin ninguno, las 3 de mejor calidad con el aviso. -->
					{#if error}<p class="status error" role="alert">{error}</p>{/if}
					{#if found.length}
						{@render options(found.map((h) => all.find((t) => t.hash === h)).filter((t) => !!t), true)}
					{:else if wantLat && byBest.length}
						<!-- Sin latino: cómo seguir, con las mismas tarjetas que el paso de audio (sin lista, los botones ya lo dicen). -->
						<p class="none" role="status">{tr('No se encontraron opciones con audio latino')}</p>
						<FlowChoices even>
							<FlowChoice id="fallback-original" title={tr('Buscar con audio original')} sub={tr('No encontré latino · busco una con subtítulos en español')} tile={{ kind: 'wave' }} tone="var(--accent-fg)" i={0} onclick={() => chooseAudio(false)} />
							<FlowChoice id="see-spain" title={tr('Español de España')} sub={spanish.length ? tr(spanish.length === 1 ? '1 opción con español que casi seguro no es latino' : '{n} opciones con español que casi seguro no es latino', { n: spanish.length }) : tr('Ninguna con español de España')} tile={{ kind: 'bubble', text: 'ES' }} tone="var(--amber, #f5a524)" i={1} disabled={!spanish.length} onclick={() => (showSpain = true)} />
							<FlowChoice id="see-all" title={tr('Ver todas las opciones')} sub={tr('{n} opciones, sin filtros · de mejor a peor calidad', { n: all.length })} tile={{ kind: 'list' }} tone="var(--muted)" i={2} onclick={() => (showAll = true)} />
						</FlowChoices>
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
					<div class="filters-bar">
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

<!-- Opciones: `best` = buenos matches (destacados, con el botón de copiar lleno). La lista es la compartida con el desktop. -->
{#snippet options(items: Torrent[], best: boolean)}
	<OptionsList rows={items.map((t) => rowOf(t, best))} />
{/snippet}

<!-- Subtítulos que trae el video: copiar el video con ese subtítulo puesto. -->
{#snippet nativeRows(ctx: SubsCtx)}
	{#each match?.natives ?? [] as n (n.track)}
		<SubRow head={tr(n.label)} spec={tr('{k} · pista {n}', { k: tr(n.kind), n: n.track })} on={ctx.picked === `n${n.track}`} tried={ctx.picked !== `n${n.track}` && ctx.tried.includes(`n${n.track}`)}>
			{#snippet actions()}
				<button id="sub-copy-native-{n.track}" type="button" class="iconbtn copy" aria-label={tr('Copiar el video con este subtítulo')} onclick={() => { track('subtítulo', 'incluido en el video'); copyNative(n, ctx); }}><Icon name="copy" size={18} /></button>
			{/snippet}
		</SubRow>
	{/each}
{/snippet}
<!-- Dos íconos en la misma fila; lleno el que va con donde se ve (Web Video Caster: pegar el link). -->
{#snippet foundActions(sub: SubtitleOption, ctx: SubsCtx)}
	<button id="sub-copy-{sub.id}" type="button" class="iconbtn sa" class:rec={doneWhere === 'wvc'} aria-label={tr('Copiar link')} title={tr('Copiar link')} onclick={() => copySub(sub, ctx)}><Icon name="link" size={18} /></button>
	<a id="sub-{sub.id}" class="iconbtn sa" class:rec={doneWhere !== 'wvc'} aria-label={tr('Descargar')} title={tr('Descargar')} href="/api/subs/{sub.id}?{new URLSearchParams({ name: fileName, ext: sub.format })}" download onclick={() => track('subtítulo', `bajar · ${sub.release}`)}><Icon name="download" size={18} /></a>
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
	{#if match}
		{#key match}
			<SubsPicker {ref} option={{ hash: match.hash, release: match.release, file: null }} file={match.file ?? null} match={{ release: match.release, video: match.video }} autoSearch={subsAuto} settingsHref="/ajustes"
				lead={match.natives?.length ? nativeRows : undefined} actions={foundActions} onUse={copyPremium} useLabel={tr('Copiar')} useIcon="copy" />
		{/key}
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
						const t = audioFor?.t as Torrent;
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

<!-- Al copiar el link de un video: solo el dibujo (celu → tele) y el tutorial; "¡Link copiado!" ya lo dijo el festejo. -->
<!-- "En este dispositivo" no la abre: alcanza con el festejo (y, sin subs, la lista de subs). -->
<Sheet id="copied-sheet" title={tr('¡Link copiado!')} open={!!linkDone && doneWhere !== 'app'} onclose={() => (linkDone = null)}>
	{#if linkDone}
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
		</div>
		{#if castStep === 1}
			<button id="watch-tutorial" type="button" class="watch" onclick={() => (castStep = 2)}>
				<span class="watch-play"><Icon name="play" size={22} /></span>
				<span class="watch-text"><b>{tr('Ver tutorial')}</b><small>{tr('Cómo verlo en la tele · 15 s')}</small></span>
			</button>
		{:else}
			<!-- Paso 2: bajar la app con el botón de la tienda del celu; "Ya la tengo" sigue al video. -->
			<div class="get-app">
				<div class="get-art" aria-hidden="true">
					<div class="get-phone"><span class="get-halo"></span><span class="get-icon" style:background-image="url('{casterFor(device())[0].icon}')"></span></div>
					<svg class="get-arrow" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v14M6 12l6 6 6-6" /></svg>
					<span class="get-free">{tr('Gratis')}</span>
				</div>
				<p class="get-title">{tr('Bajá Web Video Caster')}</p>
				<p class="get-desc">{tr('Es la app que manda el video del celu a la tele.')}</p>
				{#each casterFor(device()) as l (l.href)}
					{@const ios = l.store === 'App Store'}
					<a id={ios ? 'get-app-ios' : 'get-app-android'} class="get-store" href={l.href} target="_blank" rel="noopener">
						{#if ios}
							<svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M16.4 12.6c0-2.4 2-3.6 2.1-3.7-1.1-1.7-2.9-1.9-3.5-1.9-1.5-.2-2.9.9-3.7.9-.8 0-1.9-.9-3.2-.8-1.6 0-3.2 1-4 2.4-1.7 3-.4 7.4 1.2 9.8.8 1.2 1.8 2.5 3 2.4 1.2 0 1.7-.8 3.1-.8 1.5 0 1.9.8 3.2.8 1.3 0 2.1-1.2 2.9-2.4.9-1.4 1.3-2.7 1.3-2.8 0 0-2.4-1-2.4-3.9zM14 5.5c.7-.8 1.1-1.9 1-3-1 0-2.1.7-2.8 1.5-.6.7-1.2 1.8-1 2.9 1.1.1 2.1-.6 2.8-1.4z" /></svg>
						{:else}
							<svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 2.6 13.3 12 4 21.4c-.3-.2-.5-.6-.5-1V3.6c0-.4.2-.8.5-1z" fill="#34a853" /><path d="m16.5 8.8-3.2 3.2L4 2.6c.2-.1.6-.1.9.1z" fill="#4285f4" /><path d="M16.5 15.2 4.9 21.3c-.3.2-.7.2-.9.1l9.3-9.4z" fill="#ea4335" /><path d="m20 10.9-3.5-2.1-3.2 3.2 3.2 3.2 3.5-2c.7-.5.7-1.8 0-2.3z" fill="#fbbc04" /></svg>
						{/if}
						<span><small>{ios ? tr('Bajala en el') : tr('Bajala en')}</small>{l.store}</span>
					</a>
				{/each}
				<button id="get-app-skip" type="button" class="get-skip" onclick={() => { linkDone = null; videoOpen = true; }}>{tr('Ya la tengo, ver tutorial')}<Icon name="chev" size={16} /></button>
			</div>
		{/if}
		<div class="get-dots" aria-hidden="true"><i class:on={castStep === 1}></i><i class:on={castStep === 2}></i></div>
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
	<button id="toast-tutorial" type="button" class="toast-btn" onclick={() => { copied = null; videoOpen = true; }}>{tr('Tutorial')}</button>
</div>

{#if videoOpen}
	<CastVideo onclose={() => (videoOpen = false)} />
{/if}
{#if tutorialOpen}
	<Tour id="cast-tour" label={tr('Cómo verlo en la tele')} open steps={castSteps(device())} onclose={() => (tutorialOpen = false)} />
{/if}

<Sheet id="link-sheet" title={tr('Link listo')} open={!!manual} onclose={() => (manual = null)}>
	{#if manual}
		<p class="muted small">{tr('Tocá Copiar para llevarlo al portapapeles.')}</p>
		<input id="link-input" class="link-input" readonly value={manual.url} onfocus={(ev) => ev.currentTarget.select()} />
		<div class="actions">
			<button id="link-copy" type="button" class="btn btn-primary" onclick={copyManual}>
				<Icon name="copy" size={16} />{tr('Copiar')}
			</button>
			{#if manual.kind === 'video'}<a id="link-open" class="btn" href={manual.url} target="_blank" rel="noreferrer">{tr('Abrir')}</a>{/if}
		</div>
	{/if}
</Sheet>

<style>
	.torrents { margin-top: 8px; }
	/* Aire para la etiqueta "Mejor opción" (sale arriba de la fila). */
	.torrents :global(.cat-options) { padding-top: 10px; }
	.status { display: flex; align-items: center; gap: 10px; padding: 14px 0; margin: 0; font-size: 14px; }


	.filters-bar { position: sticky; top: calc(var(--safe-top) + 64px); z-index: 5; background: var(--bg); padding: 8px 0 6px; }
	.chips { display: flex; gap: 8px; overflow-x: auto; scrollbar-width: none; margin: 0 -16px; padding: 5px 16px; }
	.chips::-webkit-scrollbar { display: none; }
	.toggles { margin-top: 0; }
	/* Pasos */
	.ask { margin: 10px 0 10px; font-size: 16px; }
	/* Mismo aire que arriba de las migas (~27 px contando el alto de sus botones). */
	.none { margin: 16px 0 16px; text-align: center; font-size: 13.5px; color: var(--muted); }
	.latsum { margin: 0 0 10px; font-size: 13.5px; color: var(--muted); }
	.link-btn.inline { flex-basis: auto; min-height: 32px; margin-left: auto; color: var(--accent-fg); }
	.toggle:not(.on) { border-style: dashed; background: transparent; color: var(--muted); }
	.summary { margin: 4px 0 0; font-size: 11.5px; color: color-mix(in srgb, var(--muted) 75%, transparent); font-variant-numeric: tabular-nums; }
	/* Acciones al pie del resultado (2026-11-18): todas del mismo ancho y alto, ícono a la izquierda. */
	.row-actions { display: flex; flex-direction: column; gap: 10px; margin-top: 14px; }
	.row-btn { display: flex; align-items: center; gap: 12px; width: 100%; min-height: 56px; padding: 0 16px; border: 1px solid var(--border); border-radius: var(--r-lg); background: var(--surface-2); color: var(--text); font: inherit; text-align: left; transition: transform 0.15s var(--out), border-color 0.2s var(--ease); }
	.row-btn:active { transform: scale(0.98); border-color: var(--accent-fg); }
	.row-btn :global(svg) { flex: none; color: var(--muted); }
	.row-text { display: flex; flex-direction: column; gap: 1px; flex: 1; min-width: 0; }
	.row-text b { font-size: 15px; font-weight: 650; }
	.row-text small { font-size: 12.5px; color: var(--muted); font-variant-numeric: tabular-nums; }
	.row-end { font-size: 13.5px; font-weight: 600; color: var(--accent-fg); }
	.row-btn .count { padding: 2px 9px; border-radius: var(--r-pill); background: var(--surface-3, var(--border)); color: var(--muted); font-size: 12.5px; font-variant-numeric: tabular-nums; }
	.audio-hint { margin: 0 0 14px; font-size: 14px; }
	.audio-opts { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
	.audio-opt {
		min-height: 64px;
		border-radius: var(--r-card);
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
		border-radius: var(--r-lg);
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
	.toast-btn { flex: none; min-height: 36px; padding: 0 12px; border: 0; border-radius: var(--r-pill); background: var(--surface-3); color: var(--text); font-size: 13px; font-weight: 650; position: relative; }
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
	.iconbtn { display: grid; place-items: center; width: 40px; height: 40px; border: 0; border-radius: var(--r-md); background: none; color: var(--muted); }
	.iconbtn.copy { color: var(--accent-fg); background: color-mix(in srgb, var(--accent) 12%, transparent); }
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
	:global(#copied-sheet > header) { position: absolute; top: 4px; right: 4px; z-index: 1; padding: 0; border: 0; }
	:global(#copied-sheet > header h2) { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
	.done-hero { display: flex; justify-content: center; padding: 28px 0 6px; }
	.art.done-art { max-width: 240px; }
	.done-art .chain { stroke: var(--accent-fg); stroke-width: 3; }
	.done-art .link-fly { stroke: color-mix(in srgb, var(--accent-fg) var(--tint-3), transparent); stroke-width: 3; stroke-dasharray: 4 6; animation: fly 1.2s linear infinite; }
	@keyframes fly { to { stroke-dashoffset: -20; } }
	.done-art .ok-dot { fill: var(--green); transform-box: fill-box; transform-origin: center; animation: ring 0.45s 0.15s var(--out) both; }
	.done-art .ok-tick { stroke: #fff; stroke-width: 3; stroke-dasharray: 16; stroke-dashoffset: 16; animation: draw 0.3s 0.45s var(--out) forwards; }
	/* "Ver tutorial": grande, con un brillo que la recorre y el play que late. */
	.watch { position: relative; display: flex; align-items: center; gap: 14px; width: 100%; margin-top: 14px; padding: 14px 18px; border: 1px solid color-mix(in srgb, var(--accent-fg) 45%, transparent); border-radius: 20px; background: color-mix(in srgb, var(--accent-fg) 12%, var(--surface, transparent)); color: var(--text); font: inherit; text-align: left; overflow: hidden; animation: watch-in 0.5s 0.25s var(--out) both; transition: transform 0.15s var(--out); }
	.watch::after { content: ''; position: absolute; inset: 0; background: linear-gradient(105deg, transparent 35%, color-mix(in srgb, var(--accent-fg) 30%, transparent) 50%, transparent 65%); transform: translateX(-100%); animation: shine 2.6s 0.9s var(--ease) infinite; pointer-events: none; }
	.watch:active { transform: scale(0.98); }
	.watch-play { flex: none; display: grid; place-items: center; width: 52px; height: 52px; border-radius: 16px; background: var(--accent-fg); color: var(--bg); animation: beat 1.6s var(--ease) infinite; }
	.watch-text { display: flex; flex-direction: column; gap: 2px; }
	.watch-text b { font-size: 18px; }
	.watch-text small { font-size: 13px; color: var(--muted); }
	@keyframes watch-in { from { opacity: 0; transform: translateY(14px); filter: blur(6px); } }
	@keyframes shine { 60%, 100% { transform: translateX(100%); } }
	@keyframes beat { 0%, 70%, 100% { transform: scale(1); } 80% { transform: scale(1.1); } 90% { transform: scale(0.96); } }
	@media (prefers-reduced-motion: reduce) { .watch::after, .watch-play { animation: none; } }
	@media (prefers-reduced-motion: reduce) { .done-art .link-fly { animation: none; } .done-art .ok-tick { stroke-dashoffset: 0; } }
	/* Paso 2 de la hoja: el ícono de la app cae dentro del celu, con aro que late, flecha y "Gratis". */
	.get-app { display: flex; flex-direction: column; animation: get-in 0.5s var(--out); }
	.get-art { position: relative; display: grid; place-items: center; height: 200px; }
	.get-phone { position: relative; display: grid; place-items: center; width: 100px; height: 180px; border-radius: 22px; box-shadow: inset 0 0 0 4px var(--muted); }
	.get-phone::before { content: ''; position: absolute; top: 9px; width: 30px; height: 5px; border-radius: 3px; background: var(--muted); opacity: 0.6; }
	.get-icon { width: 58px; height: 58px; border-radius: 15px; background: center / cover; box-shadow: 0 10px 24px rgb(0 0 0 / 0.45); animation: get-drop 1s cubic-bezier(0.34, 1.56, 0.64, 1) 0.35s both; }
	.get-halo { position: absolute; width: 58px; height: 58px; border-radius: 15px; box-shadow: 0 0 0 2px var(--accent-fg); animation: get-halo 1.8s var(--out) 1.2s infinite; }
	.get-arrow { position: absolute; top: 4px; left: 50%; translate: -50% 0; color: var(--accent-fg); animation: get-fall 1.6s ease-in-out infinite; }
	.get-free { position: absolute; left: calc(50% + 62px); bottom: 36px; padding: 3px 9px; border-radius: 999px; background: color-mix(in srgb, var(--green) 20%, transparent); color: var(--green); font-size: 11.5px; font-weight: 750; animation: get-pop 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) 1.1s both; }
	.get-title { margin: 6px 0 0; font-size: 22px; font-weight: 800; letter-spacing: -0.02em; text-align: center; }
	.get-desc { margin: 6px auto 0; max-width: 28ch; font-size: 14.5px; line-height: 1.45; color: var(--muted); text-align: center; }
	.get-store { display: flex; align-items: center; justify-content: center; gap: 10px; height: 56px; margin-top: 20px; border-radius: 16px; background: #fff; color: #000; font-size: 16.5px; font-weight: 750; text-decoration: none; box-shadow: 0 10px 30px rgb(0 0 0 / 0.12), inset 0 0 0 1px rgb(0 0 0 / 0.08); transition: transform 0.2s var(--out); }
	.get-store + .get-store { margin-top: 10px; }
	.get-store:active { transform: scale(0.97); }
	.get-store span { line-height: 1.15; text-align: left; }
	.get-store small { display: block; font-size: 11px; font-weight: 600; line-height: 1; opacity: 0.65; }
	.get-skip { display: flex; align-items: center; justify-content: center; gap: 4px; height: 46px; margin-top: 10px; border: 0; background: none; color: var(--accent-fg); font: inherit; font-size: 15px; font-weight: 650; }
	.get-dots { display: flex; justify-content: center; gap: 6px; margin-top: 16px; }
	.get-dots i { width: 6px; height: 6px; border-radius: 3px; background: var(--surface-3); transition: width 0.4s var(--out), background 0.4s; }
	.get-dots i.on { width: 20px; background: var(--accent-fg); }
	@keyframes get-in { from { opacity: 0; transform: translateX(24px); } }
	@keyframes get-drop { 0% { transform: translateY(-70px) scale(0.6); opacity: 0; } 60% { opacity: 1; } }
	@keyframes get-halo { from { transform: scale(1); opacity: 0.8; } to { transform: scale(1.5); opacity: 0; } }
	@keyframes get-fall { 0%, 100% { transform: translateY(-4px); opacity: 0; } 30% { opacity: 1; } 70% { transform: translateY(10px); opacity: 0; } }
	@keyframes get-pop { from { transform: scale(0); } }
	@media (prefers-reduced-motion: reduce) { .get-app, .get-icon, .get-halo, .get-arrow, .get-free { animation: none; } }
	.where { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; padding: 4px 0 6px; }
	.spot {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 2px;
		padding: 14px 8px 14px;
		border: 1px solid var(--border);
		border-radius: var(--r-lg);
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
	.link-input { width: 100%; height: 44px; margin: 10px 0 0; padding: 0 10px; border-radius: var(--r-sm); border: 1px solid var(--border-strong); background: var(--surface-2); font-size: 16px; }
</style>
