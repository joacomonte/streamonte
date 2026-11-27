<script lang="ts">
	// Torrents de un video que TorBox tiene en caché, en pasos (la máquina compartida con el desktop, `$ui/flow/flow-model.ts`):
	// conexión → ¿audio latino? (mientras busca de fondo, fuente por fuente; 2026-11-24) → el PRIMER BUEN MATCH, leyendo pistas de a una de mejor a peor
	// calidad, con "Seguir buscando" y "Ver todas las opciones"; migas para volver. Por fila: peso, calidad de
	// imagen, audio y subs en español, y copiar el link https de TorBox. Los subtítulos son de cada torrent: aparecen
	// al copiar su link (nativos primero; si no trae, se buscan afuera; Premium plegado al final).
	import Icon from '$ui/components/Icon.svelte';
	import Sheet from '$ui/components/Sheet.svelte';
	import { toast } from '$ui/components/toast-queue.ts';
	import Tour from '$ui/components/Tour.svelte';
	import CastVideo from './CastVideo.svelte';
	import FlowChoice from '$ui/flow/FlowChoice.svelte';
	import FlowChoices from '$ui/flow/FlowChoices.svelte';
	import FlowCrumbs from '$ui/flow/FlowCrumbs.svelte';
	import FlowRadar from '$ui/flow/FlowRadar.svelte';
	import { stepIn } from '$ui/flow/step-in.ts';
	import MoreRow from '$ui/flow/MoreRow.svelte';
	import { fitsNet } from '$ui/flow/net.ts';
	import type { MatchFacts } from '$ui/flow/match-rules.ts';
	import { createFlow, newFlowState, type FlowCand, type FlowIds, type FlowList } from '$ui/flow/flow-model.ts';
	import type { ChoiceView, FlowButton, FlowStep, MoreRowView } from '$ui/flow/types.ts';
	import { humanBytes, sxe } from '$ui/format.ts';
	import { casterFor, castSteps, device } from '$ui/components/tours.ts';
	import * as saved from './saved.ts';
	import { t as tr } from './i18n.svelte.ts';
	import { untrack } from 'svelte';
	import { audioOf, latStatus, LAT_BADGE, type Tracks } from '$ui/audio.ts';
	import type { Snippet } from 'svelte';
	import { track } from './track.ts';
	import { byQuality as rankQuality, optionMbps } from '$ui/rank.ts';
	import { getApi } from '$ui/context.ts';
	import OptionsList from '$ui/options/OptionsList.svelte';
	import { emptyLoad, loadOptions, type OptionsLoad } from '$ui/options/options-load.ts';
	import { bestText, hdrText, heavyText, langTags, noMatches, qualityOf, readButton, resKey, resLabel, TipBook, type DockButton, type OptionRowView } from '$ui/options/row.ts';
	import NativeSubs from '$ui/subs/NativeSubs.svelte';
	import type { NativeTrack } from '$ui/subs/native-view.ts';
	import SubsPicker from '$ui/subs/SubsPicker.svelte';
	import type { SubsCtx } from '$ui/subs/subs-flow.ts';
	import { keyOf } from '$ui/subs/subs-logic.ts';
	import type { Kind, NativeSub, OptionRef, SubtitleOption, TorboxIds, TorrentOption } from '$ui/types.ts';

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
		/** De qué título es (ruta de la web + imágenes): al copiar un link entra en "Vistos recientemente". Sin esto no se marca. */
		seen?: { kind: Kind; id: string; poster: string | null; backdrop: string | null } | null;
	}
	let { imdb, s = null, e = null, name, orig = null, runtime = null, given = null, seen = null }: Props = $props();
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
	// Toast que se va solo; si se copia otro, vuelve a contar. `copied` solo dice qué se copió: lo dibuja `$ui/components/Toast.svelte` (montado en el layout).
	$effect(() => {
		if (!copied) return;
		toast({
			id: 'copied-toast',
			check: true,
			text: tr('Link copiado'),
			sub: copied.kind === 'sub' ? tr('Pegalo en Web Video Caster: CC → link') : tr('Pegalo en Web Video Caster'),
			action: { id: 'toast-tutorial', label: tr('Tutorial'), onclick: () => (videoOpen = true) },
		});
		copied = null;
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
			// Torrent pegado: ya se sabe qué torrent es, no hay conexión ni audio para elegir (directo a todas).
			flow = given ? { ...newFlowState('list', 'torbox'), all: true } : newFlowState('net', 'torbox');
			tips.reset();
			// Lista guardada 1 hora (saved.ts): se pinta en este mismo cuadro, sin pasar por la búsqueda.
			const ready = given ?? hit;
			load = ready ? { ...emptyLoad(), options: ready, done: true } : emptyLoad();
			if (!ready)
				loadOptions(api, r, (st) => {
					load = st;
					if (st.error) error = st.error;
					if (st.done && st.options) saved.store(key, st.options, saved.HOUR);
				}, () => live);
		});
		return () => {
			live = false;
			// Lo que se estuviera leyendo de este video (al cambiar de video, además, el estado nuevo ya lo corta).
			model.cancelWork();
		};
	});

	// ── Pasos ──────────────────────────────────────────────────────────────────────────────────────────────────────────────
	// La máquina es la compartida con el desktop (`$ui/flow/flow-model.ts`); acá quedan su estado (`$state`), cómo se leen las
	// pistas (`probe`, contra /api) y cómo se dibuja una fila.
	/** Pasos de este video: la conexión (se pregunta siempre, cambia según dónde se vea), el audio y el resultado. */
	let flow = $state(newFlowState('net', 'torbox'));
	/** La conexión que se acaba de tocar: su ícono se llena del color del nivel antes de pasar al audio. */
	let netPick = $state<string | null>(null);
	/** Ids estables (escenas y `scripts/bench-options.mjs`). */
	const IDS: FlowIds = {
		net: 'net-', latNo: 'audio-any', latYes: 'audio-lat', stop: 'search-stop',
		latAll: 'see-all', noticeAll: 'see-all-fit', toTorrent: 'see-torrent', matchAll: 'see-all-rest',
		spainOriginal: 'fallback-original-spain', spainAll: 'see-all-spain', lighter: 'lighter', crumb: 'crumb-'
	};
	/** Lo que mira el ranking compartido de una opción. */
	const mbpsOf = (t: Torrent) => optionMbps(t, runtime);
	/** ¿Entra en la conexión elegida? Sin peso no se sabe cuánto pide: no entra (no puede ser el buen match). */
	const fits = (t: Torrent) => fitsNet(t.sizeBytes, mbpsOf(t), flow.net);

	const all = $derived(load.options ?? []);
	const known = (t: Torrent) => {
		const v = info[t.hash];
		return v && typeof v === 'object' ? v : null;
	};
	/** Estado del audio latino (regla única en audio.ts). */
	const status = (t: Torrent) => latStatus(t, known(t));
	/** Lo que mira `$ui/flow/match-rules.ts` de una opción. */
	const factsOf = (t: Torrent): MatchFacts => {
		const k = known(t);
		return {
			latState: status(t),
			saysSpanish: !!(t.spanish || k?.audio === 'es'),
			subsEs: t.subFile || (k?.subs ?? 0) > 0 ? true : k ? false : null,
			audioRead: !!k?.audio
		};
	};
	const hasEs = (t: Torrent) => factsOf(t).subsEs === true;
	const byQuality = (a: Torrent, b: Torrent) => rankQuality(a, b, runtime);
	/** Una opción en la forma del modelo: todas están en TorBox; se puede leer si no se está leyendo ni falló. */
	const toCand = (t: Torrent): FlowCand<Torrent> => ({
		hash: t.hash, bytes: t.sizeBytes ?? null, mbps: mbpsOf(t), res: resKey(t.resolution), facts: factsOf(t),
		excluded: false, failed: false, readable: typeof info[t.hash] !== 'string', seeds: null, inTorbox: true, src: t
	});
	const model = createFlow<Torrent>({
		state: () => flow,
		cands: () => all.map(toCand),
		// La lista llega entera al final (después del chequeo de TorBox); mientras tanto, solo el avance de las fuentes.
		list: (): FlowList => load.options ? { kind: 'ready' } : error ? { kind: 'failed', error } : { kind: 'loading', done: load.progress?.done ?? 0, total: load.progress?.total ?? 0, checking: load.checking },
		episode: () => !!(s && e),
		sort: (cands) => [...cands].sort((a, b) => byQuality(a.src, b.src)),
		row: (c, best) => rowOf(c.src, best),
		read: async ([c]) => {
			if (c) await probe(c.src);
		},
		// Reactiva: la vista sale de `$derived`.
		changed: () => {},
		ids: IDS,
		allIgnoresLat: true,
		track
	});
	/** La pantalla del paso (null: "Ver todas las opciones"), las migas y la fila "Seguir buscando" / Detener. */
	const view = $derived(model.view());
	const crumbs = $derived(model.crumbs());
	const more = $derived(model.moreRow());
	/** Tocar una conexión: se llena su ícono (≤220 ms) y recién ahí pasa al audio; si en el medio cambió el video o el paso, no se pisa. */
	function tap(c: ChoiceView, step: FlowStep) {
		if (step !== 'net' || still()) return c.onclick();
		if (netPick) return;
		netPick = c.id;
		const f = flow;
		setTimeout(() => {
			netPick = null;
			if (flow === f && f.step === 'net') c.onclick();
		}, 220);
	}
	/** "Ver todas las opciones": todas, sin el filtro de audio, de mejor a peor (solo los chips HDR / Subs ES). */
	const list = $derived([...all].sort(byQuality).filter((t) => (!onlyHdr || t.hdr.length) && (!onlyEs || hasEs(t))));
	function clearFilters() {
		onlyHdr = false;
		onlyEs = false;
	}
	/** Qué pantalla se ve (para la entrada animada): cambia al cambiar de paso, no al redibujar la misma. */
	const screen = $derived(!view ? 'all' : view.kind === 'choices' ? view.step : view.kind);
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
		const { audio, subs } = langTags({ hash: t.hash, lat: status(t), want: !!flow.lat, spokenEs: orig === 'es', subs: hasEs(t) ? true : n === 0 ? false : null, best,
			fresh: fresh[t.hash], subsTitle, audioId: `audio-info-${t.hash}`, onTap: () => quickTip(t.hash) }, tips, tr);
		const analyze = () => {
			track('analizar', t.release);
			probe(t);
		};
		const scan = (title: string, busy: string | null, failed: boolean): DockButton =>
			readButton({ id: `scan-${t.hash}`, icon: 'search', text: tr('Analizar audio y subs'), busy, failed, title, onclick: busy ? () => {} : analyze }, tr);
		// Sin leer todavía: un botón chico para leerlo (audio latino y subs incluidos).
		const dock = v === 'busy' ? [scan(tr('Analizando…'), tr('Analizando…'), false)]
			: v === 'err' ? [scan(why[t.hash] ?? '', null, true)]
			: !k ? [scan(tr('Analizar torrent: audio latino y subtítulos incluidos'), null, false)] : [];
		const c = copy[t.hash];
		const label = c === 'err' ? tr('Reintentar copiar el link') : tr('Copiar link de TorBox');
		return {
			hash: t.hash, title: t.release, best, bestText: bestText(tr), idle: true, tooBig: false, skipped: false,
			size: humanBytes(t.sizeBytes),
			hdr: hdrText(t.hdr, tr),
			res: t.resolution ? resLabel(t.resolution, tr('Otras')) : null,
			heavy: t.sizeBytes && !fits(t) ? heavyText(mbpsOf(t), tr) : null,
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
		track('copiar link', `${name}${s ? ` T${s}E${e}` : ''} · ${t.resolution ?? ''} · ${flow.lat ? 'Latino' : 'Original'} · ${/play\.html/.test(url) ? 'TV' : 'Celu'}`);
		// "Vistos recientemente": se marca al copiar; si falla, no se entera nadie.
		if (seen && imdb) void api.recent.mark({ ...seen, imdb, title: name, season: s, episode: e }).catch(() => {});
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
	/** Los nativos para la regla de orden: TorBox no da flags (sdh/default ausentes = false); el nombre de la pista suma la heurística. */
	const nativeTracks = $derived<NativeTrack[]>((match?.natives ?? []).map((n) => ({
		key: `n${n.track}`,
		id: `sub-copy-native-${n.track}`,
		sub: { lang: n.label === 'Latinoamérica' ? 'es-419' : n.label === 'España' ? 'es-es' : 'spa', title: n.title || null, codec: null, forced: n.kind === 'forzados', sdh: n.sdh ?? false, default: n.default ?? false }
	})));
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

	const fileName = $derived(name + (s && e ? ` ${sxe(s, e)}` : ''));
</script>

<section class="torrents" aria-label={tr('Torrents en TorBox')} aria-busy={!load.options && !error}>
	<!-- 2026-11-24: sin pantalla de "buscando torrents": los pasos se ven enseguida y la búsqueda sigue de fondo (el radar la muestra). -->
	{#if crumbs}<FlowCrumbs aria={crumbs.aria} items={crumbs.items} />{/if}

	{#key screen}
		<div class="step" in:stepIn>
			{#if view?.kind === 'choices'}
				<!-- Si una fuente falla con el usuario en un paso, que se vea. -->
				{#if error}<p class="status error" role="alert">{error}</p>{/if}
				<h3 class="ask">{view.title}</h3>
				{#if view.note}<p class="none" role="status">{view.note}</p>{/if}
				{@render choices(view.choices, view.step)}
				{#if view.all}<div class="row-actions">{@render rowBtn(view.all)}</div>{/if}
			{:else if view?.kind === 'scan'}
				<!-- Buscando: un radar barre las opciones (puntos que se encienden al pasar); al primero que sirve, aparece el resultado. -->
				{#if error}<p class="status error" role="alert">{error}</p>{/if}
				<FlowRadar title={view.text} frac={view.frac} count={view.count} stopId={view.stop.id} stopText={view.stop.text} onstop={view.stop.onclick} />
			{:else if view?.kind === 'notice'}
				<!-- Sin nada para elegir (sin torrents, falló la búsqueda o ninguno entra en la conexión). -->
				<p class="none" role="status">{view.text}</p>
				{#if view.action || view.all}<div class="row-actions">{#if view.action}{@render rowBtn(view.action)}{/if}{#if view.all}{@render rowBtn(view.all)}{/if}</div>{/if}
			{:else if view?.kind === 'match'}
				<!-- El resultado: solo los buenos matches; sin ninguno, las 3 de mejor calidad con el aviso. -->
				{#if error}<p class="status error" role="alert">{error}</p>{/if}
				{#if view.title}<h3 class="ask">{view.title}</h3>{/if}
				{#if view.note}<p class="muted latsum" role="status">{view.note}</p>{/if}
				<OptionsList rows={view.rows} />
				<div class="row-actions">
					{@render moreRow(view.more)}
					{@render rowBtn(view.all)}
				</div>
			{:else if view?.kind === 'spain'}
				<h3 class="ask">{view.title}</h3>
				<p class="muted latsum">{view.note}</p>
				{#if error}<p class="status error" role="alert">{error}</p>{/if}
				<OptionsList rows={view.rows} />
				<div class="row-actions">{@render rowBtn(view.original)}{@render rowBtn(view.all)}</div>
			{:else}
				<div class="filters-bar">
					<div class="chips toggles" role="toolbar" aria-label={tr('Filtros de torrents')}>
						<button id="only-hdr" type="button" class="chip toggle" class:on={onlyHdr} aria-pressed={onlyHdr} onclick={() => (onlyHdr = !onlyHdr)}>HDR</button>
						<button id="only-es" type="button" class="chip toggle" class:on={onlyEs} aria-pressed={onlyEs} title={tr('Solo las verificadas que traen subtítulos en español')} onclick={() => (onlyEs = !onlyEs)}><Icon name="subs" size={14} />{tr('Subs ES')}</button>
					</div>
					<p class="summary" title={tr('TorBox es un servicio pago que baja torrents a sus servidores y te los pasa como video en línea. Estas opciones ya las tiene bajadas: el link se ve al instante en la tele, sin depender de los seeds.')}>{tr('{n} de {f} en TorBox · de mejor a peor calidad', { n: list.length, f: all.length })}</p>
				</div>
				{#if error}<p class="status error" role="alert">{error}</p>{/if}
				{#if !list.length}
					<!-- Mismo vacío que el desktop: qué pasó y "Quitar filtros". -->
					{@const empty = noMatches(all.length > 0, clearFilters, tr)}
					<p class="status muted" role="status">{empty.text}{#if empty.clear}<button id="filters-off" type="button" class="filters-off" onclick={empty.clear.onclick}>{empty.clear.text}</button>{/if}</p>
				{/if}
				<OptionsList rows={list.map((t) => rowOf(t, false))} />
				{@render moreRow(more)}
			{/if}
		</div>
	{/key}
</section>

<!-- Al pie del resultado y de "todas": la búsqueda en curso (Detener), "Seguir buscando" o que no quedan más (si hubo match). -->
{#snippet moreRow(m: MoreRowView | null)}
	{#if m && m.kind !== 'done'}
		<MoreRow more={m} look="row" />
	{:else if m?.kind === 'done' && m.found}
		<p class="status muted">{m.text}</p>
	{/if}
{/snippet}

<!-- Tarjetas de un paso; las de conexión pasan por `tap` (se llena el ícono antes de seguir). -->
{#snippet choices(list: ChoiceView[], step: FlowStep)}
	<FlowChoices even={list.length <= 3 && list.length > 1}>
		{#each list as c (c.id)}
			<FlowChoice id={c.id} title={c.title} sub={c.sub} tile={c.tile} tone={c.tone} i={c.i} badge={c.badge} note={c.note} chips={c.chips} primary={c.primary} picked={netPick === c.id} disabled={c.disabled} onclick={() => tap(c, step)} />
		{/each}
	</FlowChoices>
{/snippet}

<!-- Botón ancho al pie (todas del mismo ancho y alto, ícono a la izquierda). -->
{#snippet rowBtn(b: FlowButton)}
	<button id={b.id} type="button" class="row-btn" title={b.title} onclick={b.onclick}>
		<Icon name={b.icon} size={18} /><span class="row-text"><b>{b.text}</b>{#if b.small}<small>{b.small}</small>{/if}</span>{#if b.count != null}<span class="count">{b.count}</span>{/if}
	</button>
{/snippet}

<!-- Subtítulos que trae el video: copiar el video con ese subtítulo puesto. -->
{#snippet nativeRows(ctx: SubsCtx)}
	<li class="natives">
		<NativeSubs tracks={nativeTracks} picked={ctx.picked} tried={ctx.tried} useLabel={tr('Copiar')} onUse={(key) => {
			const n = match?.natives?.find((x) => `n${x.track}` === key);
			if (n) { track('subtítulo', 'incluido en el video'); copyNative(n, ctx); }
		}} />
	</li>
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
	.filters-off { margin-left: 6px; padding: 0; border: 0; background: none; color: var(--accent-fg); font: inherit; text-decoration: underline; text-underline-offset: 3px; }
	.link-btn.inline { flex-basis: auto; min-height: 32px; margin-left: auto; color: var(--accent-fg); }
	.toggle:not(.on) { border-style: dashed; background: transparent; color: var(--muted); }
	.summary { margin: 4px 0 0; font-size: 11.5px; color: color-mix(in srgb, var(--muted) 75%, transparent); font-variant-numeric: tabular-nums; }
	/* Acciones al pie del resultado (2026-11-18): todas del mismo ancho y alto, ícono a la izquierda. */
	.row-actions { display: flex; flex-direction: column; gap: 10px; margin-top: 14px; }
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
	/* El recomendado: primario sólido ámbar (carbón variante B; nunca azul de fondo). */
	.iconbtn.sa.rec { border-color: transparent; border-radius: var(--nu-solid-radius); background: var(--nu-solid-face), var(--nu-solid); box-shadow: var(--nu-solid-shadow); color: var(--nu-solid-fg); }
	.iconbtn.sa.rec:active { box-shadow: var(--nu-solid-press); }
	.iconbtn { display: grid; place-items: center; width: 40px; height: 40px; border: 0; border-radius: var(--r-md); background: none; color: var(--muted); }
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
