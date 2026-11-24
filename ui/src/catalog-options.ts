// Opciones de un video (2026-11-17): grupos por resolución, orden, fila de cada torrent, panel de pruebas, reproducir y bajar
// de fondo. Arma el modelo de vista (`streams-view.ts`) que dibuja `StreamsPanel.svelte` en `#cat-streams`
// (`streams-panel.svelte.ts`); las filas son `$ui/options/OptionRow.svelte`. Las pruebas: `catalog-tests.ts`; los pasos:
// `catalog-flow.ts`; reglas puras: `options-logic.ts`.
import * as core from './core.ts';
import { closeWizard, originalAudio, play } from './audio-picker.ts';
import { setStatus } from './dom.ts';
import { t as tr } from './i18n.ts';
import { ago, humanBytes, mbps, nf, nf1 } from '$ui/format.ts';
import { playbackText } from './format.ts';
import { healthCalibration, notePrediction, speedOf, TRACKER_MIN, trackPlayback } from './health-store.ts';
import { live } from './live.svelte.ts';
import { renderSide } from './catalog-side.ts';
import { safeGet, safeSet, showError, state, view } from './catalog-state.ts';
import { isReading, openSubs, readError, readSubsNow, readTracks, readUntil, stopReading, subsScan, subsStep, toggleSubsScan } from './catalog-subs.ts';
import {
	analysisEta, census, counted, counting, deepDone, liveCount, loadSavedTests, newVideoTests, once, phaseAt, quick, QUICK_ENOUGH, QUICK_LATE_MS, quickGroup, quickLive,
	quickPending, quickRunning, reanalyze, runCensus, runDeep, side, sideOf, skipped, startAnalysis, stopTests, testedAt, toggleBest, TOP, unlikely,
	type Count, type Deep, type Run,
} from './catalog-tests.ts';
import { crumbs, fitsNet, flowFilter, flowStep, hasResStep, isMatch, moreRow, newFlow } from './catalog-flow.ts';
import { healthOf, type HealthEvidence } from '$ui/options/health.ts';
import { HDR_TIP, langTags as langTagsOf, qualityOf, QUALITY_TEXT, RES_ORDER as RES, resKey as resKeyOf, resLabel as resLabelOf, TipBook } from '$ui/options/row.ts';
import type { Action, DockButton, Mid, OptionRowView, People, Verdict } from '$ui/options/row.ts';
import { latOf as latOfRows, mbpsOf as mbpsFor, neededBps as neededBpsFor, rankOptions, tierOf as tierOfCount, toMbps, typicalMbps } from '$ui/rank.ts';
import type { LatState } from '$ui/types.ts';
import { BG_GREEN, BG_YELLOW, bgTone, fileBytesOf, leechersFrom, pickLine, pinActive, playbackFor, PB_LIVE, PB_STARTING, seedsOf, trackersWin } from './options-logic.ts';
import { flushStreams, mountCtxMenu, openCtxMenu, showStreams } from './streams-panel.svelte.ts';
import { latPotential as latPotentialRule, latToCheck as latToCheckRule, type MatchFacts } from '$ui/flow/match-rules.ts';
import type { CtxItem, ListView, MoreRowView, PanelView, SortView, StreamsView } from './streams-view.ts';
import type { LibraryRow, NativeSpanish, PlaybackRow, PlayerKind, StreamCandidate as Candidate, StreamsUpdate } from './types.ts';

export { BG_GREEN, BG_YELLOW, PB_LIVE, PB_STARTING, seedsOf, trackersWin };

/** Estado del audio latino de una opción ('lat' | 'likely' | 'spain' | 'check' | 'none'): la regla está en `packages/ui/src/rank.ts`. */
export const latOf = (c: Candidate): LatState =>
	latOfRows(
		{ release: c.release_name, file: c.file_name, audio: c.audio },
		rowsOf(c.info_hash).map((e) => ({ audioRead: !!e.live?.audio?.length, languages: (e.languages ?? []).map((l) => l.code) })),
	);
/** Dice o trae español sin aclarar cuál (MULTI / Dual / español en el nombre, o una pista en español). */
const saysSpanish = (c: Candidate): boolean =>
	c.audio.includes('multi') || c.audio.includes('es') || !!rowsOf(c.info_hash).find((e) => e.live?.audio?.length)?.languages?.some((l) => l.code === 'es');
/** Lo que mira `$ui/flow/match-rules.ts` de una candidata. */
export const factsOf = (c: Candidate): MatchFacts => ({
	latState: latOf(c),
	saysSpanish: saysSpanish(c),
	subsEs: hasSpanishSubs(c.info_hash),
	audioRead: rowsOf(c.info_hash).some((e) => !!e.live?.audio?.length),
});
/** Sin confirmar pero vale la pena leer sus pistas: web latina, o español sin aclarar. */
export const latToCheck = (c: Candidate): boolean => latToCheckRule(factsOf(c));
/** Con potencial de latino (única regla): latino o vale la pena revisarla. */
export const latPotential = (c: Candidate): boolean => latPotentialRule(factsOf(c));
/** ¿Pidió ver en latino? Afuera de ese modo, el latino solo se muestra confirmado. */
const wantsLatino = (): boolean => sideOf()?.flow?.lat === true;
/** ¿Trae subs en español? `true` / `false` según las pistas ya leídas o un .srt en español en TorBox (solo dice sí); `null` = no se sabe. */
export function hasSpanishSubs(hash: string): boolean | null {
	const subs = rowsOf(hash).find((e) => e.native_subs)?.native_subs;
	// Como la web (`hasEs`): el .srt en español de TorBox cuenta aunque las pistas leídas no traigan.
	if (subs?.length || torboxSpanishSubs.has(hash)) return true;
	return subs ? false : null;
}
/** Globitos de los badges (como la web): uno por video (`loadStreams` lo reinicia). */
export const tips = new TipBook();
/** Tooltip del ES verde, mismo texto que la web (`Torrents.svelte` `rowOf`): adentro del video (pistas `embedded:`) o un
 *  archivo suelto en el torrent (`torrent:` o el .srt de TorBox); abajo, de dónde sale cada uno. */
function subsTitle(hash: string, native: NativeSpanish[]): string | undefined {
	const n = native.filter((x) => x.key.startsWith('embedded:')).length;
	const head = n > 0 ? tr(n > 1 ? 'El video trae {n} subtítulos en español adentro' : 'El video trae {n} subtítulo en español adentro', { n })
		: native.length || torboxSpanishSubs.has(hash) ? tr('El torrent trae un archivo de subtítulo en español') : undefined;
	return head && native.length ? `${head}\n${native.map((x) => `· ${x.place} · ${x.kind}`).join('\n')}` : head;
}
/** Idioma ya sabido, como badges junto al peso (regla `langTags` de `$ui/options/row.ts`, igual que la web). */
function langTags(c: Candidate, best: boolean): Pick<OptionRowView, 'audio' | 'subs'> {
	const hash = c.info_hash;
	const native = rowsOf(hash).find((e) => e.native_subs)?.native_subs ?? [];
	return langTagsOf(
		{
			hash, lat: latOf(c), want: wantsLatino(), spokenEs: sideOf()?.details?.details?.original_language === 'es', subs: hasSpanishSubs(hash), best,
			subsTitle: subsTitle(hash, native),
			audioId: `cat-audio-${hash}`,
			onTap: (e) => {
				e.stopPropagation();
				tips.tap(hash);
				renderStreamsOnly();
			},
		},
		tips,
		tr,
	);
}
/** Lo que falta saber del idioma, como botones de la cápsula del ▶: "¿Trae subs?" y, pidiendo latino, "¿Audio latino?"; "Elegir
 *  subs" si se sabe que no trae. */
function langActions(c: Candidate): DockButton[] {
	const hash = c.info_hash;
	const subs = hasSpanishSubs(hash);
	const out: DockButton[] = [];
	if (subs == null && !wantsLatino()) out.push(checkButton(hash, 'subs'));
	if (wantsLatino() && latToCheck(c) && !rowsOf(hash).some((e) => e.live?.audio?.length)) out.push(checkButton(hash, 'lat'));
	if (subs === false) {
		out.push({
			id: `cat-subfind-${hash}`, icon: 'search', text: tr('Elegir subs'), busy: null, cancel: '', aria: tr('Elegir subs'),
			title: tr('No trae subtítulos en español: elegí de afuera (muestra cuáles calzan con este archivo)'),
			onclick: (e) => {
				e.stopPropagation();
				openSubs(hash, !!view.torboxKey && inTorbox.has(hash), e.currentTarget);
			},
		});
	}
	return out;
}
/** Leer las pistas (TorBox: un pedido, segundos; torrent: la prueba rápida, necesita seeds). Leyendo, el mismo botón queda
 *  cargando y otro clic corta la espera (lo leído hasta ahí no se pierde). */
function checkButton(hash: string, kind: 'subs' | 'lat'): DockButton {
	const reading = isReading(hash);
	const error = readError(hash);
	const [ic, text0, busy, tip0] = kind === 'subs'
		? (['subs', tr('¿Trae subs?'), tr('Leyendo subs…'), tr('Mira adentro del video si trae subtítulos en español (no baja nada)')] as const)
		: (['speaker', tr('¿Audio latino?'), tr('Leyendo audio…'), tr('Lee sus pistas de audio para confirmar si es latino')] as const);
	// No se pudo leer: dice por qué (antes volvía al botón de siempre y parecía que no hizo nada).
	const text = error ? tr('No se pudo · reintentar') : text0;
	const tip = error ? tr('No se pudo leer: {error}. Tocá para reintentar', { error }) : tip0;
	return {
		id: `cat-${kind}check-${hash}`, icon: ic, text, busy: reading ? busy : null, cancel: tr('Cancelar'),
		title: reading ? tr('Tocá para cancelar') : `${tip} (${inTorbox.has(hash) ? tr('un pedido a TorBox, unos segundos') : tr('por torrent: necesita seeds')})`,
		aria: reading ? tr('{busy} Tocá para cancelar', { busy }) : text,
		onclick: (e) => {
			e.stopPropagation();
			if (reading) stopReading(hash);
			else readSubsNow(hash, inTorbox.has(hash));
		},
	};
}
// ---------- opciones (FR-42–49) ----------
export async function loadStreams(videoId: string): Promise<void> {
	side().videoId = videoId;
	// Análisis profundo de la resolución elegida.
	side().deep = { status: null, hashes: [] };
	side().tests = newVideoTests();
	side().torbox = null;
	census.clear();
	// Pasos: torrent o TorBox → ¿latino? → resolución → lista (`catalog-flow.ts`).
	side().flow = newFlow();
	view.openRes = '';
	view.shownRows = PAGE_ROWS;
	view.onlyHdr = false;
	view.onlyEs = false;
	tips.reset();
	core.downloadsFreeBytes().then((b) => { view.freeBytes = b; renderStreamsOnly(); }).catch(() => {});
	state.update = null;
	renderSide();
	setStatus(tr('Pidiendo torrents a todas las fuentes…'));
	try {
		await core.catalogStreams(side().kind, videoId);
	} catch (e) {
		showError(e);
	}
}

// Lectura de subs en curso o terminada: el chip "¿Sub ES?" de la fila cambia.
document.addEventListener('subs-changed', () => { if (sideOf()?.videoId) renderStreamsOnly(); });

export function onStreams(update: StreamsUpdate): void {
	if (update.video_id !== sideOf()?.videoId) return;
	state.update = update;
	const t = side().tests;
	if (update.done && update.candidates.length) {
		// Censo DHT apenas están las fuentes y los trackers: una vez por video, en paralelo.
		if (once(t, 'census')) void runCensus(update.video_id, update.candidates);
		if (once(t, 'saved')) void loadSavedTests(update.video_id, update.candidates);
		if (once(t, 'torbox')) void loadTorbox(update.video_id, update.candidates);
	}
	const ok = update.addons.filter((a) => a.state !== 'pending').length;
	setStatus(update.done
		? tr('{n} opción(es) de {ok} fuente(s). Analizá o reproducí una.', { n: update.candidates.length, ok })
		: tr('{ok} de {n} fuentes respondieron…', { ok, n: update.addons.length }));
	renderStreamsOnly();
}

/** Filas de la biblioteca de ese torrent (una por episodio de un pack; el análisis es del torrent). */
export function rowsOf(hash: string): LibraryRow[] {
	if (view.libByHash) return view.libByHash.get(hash) ?? [];
	return [...state.library.values()].filter((e) => e.info_hash === hash);
}

/** Por seeders, leechers y peso (lo usan los subtítulos y el desempate de `sortOptions`). */
export const bySeeds = (a: Candidate, b: Candidate): number =>
	tierOf(b) - tierOf(a) || (knownSeeds(b) ?? -1) - (knownSeeds(a) ?? -1) || (leechersOf(b) ?? -1) - (leechersOf(a) ?? -1) || (b.size_bytes ?? 0) - (a.size_bytes ?? 0);

/** ¿Ya se testeó a fondo la resolución abierta? Hasta entonces se ordena solo por conexión y el selector de orden es una etiqueta. */
export const deepTested = (): boolean => sideOf()?.deep?.status === 'done' && side().deep.res === view.openRes;
/** Orden de las opciones: la regla está en `rankOptions` (`packages/ui/src/rank.ts`); acá se le pasa el estado. */
export function sortOptions(cands: Candidate[]): { list: Candidate[]; best: Candidate | null } {
	return rankOptions(cands, {
		torbox: sideOf()?.flow?.mode === 'torbox',
		mode: deepTested() ? view.optSort : 'fast',
		health, fits, tierOf, knownSeeds, leechersOf, quickGroup, mbpsOf, isMatch,
		pinPlaying: (list) => pinActive(list, live.v.playbacks.values()),
		sizeOf: (c) => c.size_bytes,
		sourceOf: (c) => c.source,
		reached: (c) => counted.get(c.info_hash)?.reached,
		// Prueba en curso que ya pasó a contar seeds reales (etapa 2/2).
		advancing: (c) => {
			const h = c.info_hash;
			const live = counting.has(h) ? liveCount.get(h) : quickRunning.has(h) && !quick.has(h) ? quickLive.get(h) : null;
			return live?.reached ? live : null;
		},
	});
}

/** Grupo para ordenar (2 analizado a fondo … 0 nadie lo comparte): la regla está en `packages/ui/src/rank.ts`. */
export const tierOf = (c: Candidate): number => tierOfCount(counted.get(c.info_hash));
/** Seeders que se saben de una opción, de lo más confiable a lo menos: contados, medidos, trackers y, por último, la fuente. */
export function knownSeeds(c: Candidate): number | null {
	const q = quick.get(c.info_hash);
	return seedsCounted(c) ?? (q?.reached ? q.seeds : null) ?? seedsOf(c);
}
/** Seeders contados o medidos de una opción (sin los de trackers); null si no hay ninguno. */
export function seedsCounted(c: Candidate): number | null {
	const partial = liveCount.get(c.info_hash);
	return counted.get(c.info_hash)?.seeds ?? (partial?.reached ? partial.seeds : null)
		?? rowsOf(c.info_hash).find((e) => (e.live?.seeds ?? 0) > 0)?.live?.seeds ?? null; // un 0 viejo (serde default) no es "0 contados"
}
/** Leechers (desempate): conectados sin el archivo completo al contar, o los del scrape automático. */
export function leechersOf(c: Candidate): number | null {
	const partial = liveCount.get(c.info_hash);
	return leechersFrom(counted.get(c.info_hash) ?? (partial?.reached ? partial : null) ?? rowsOf(c.info_hash).find((e) => e.live)?.live, c.leechers ?? null);
}

/** Opciones que están en la caché de TorBox (vacío sin key). */
export const inTorbox = new Set<string>();
/** De esas, las que traen un subtítulo en español como archivo suelto (sale del mismo pedido). */
const torboxSpanishSubs = new Set<string>();
/** Opciones que fallaron al reproducirse: quedan recordadas en esta compu, van al final y nunca son "buen match". Las últimas 500. */
const FAILED = 'streamonte.failed';
export const failedBefore = new Set<string>((() => {
	try {
		const v: unknown = JSON.parse(safeGet(FAILED) ?? '[]');
		return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
	} catch {
		return [];
	}
})());
export function markFailed(hash: string): void {
	failedBefore.delete(hash);
	failedBefore.add(hash);
	safeSet(FAILED, JSON.stringify([...failedBefore].slice(-500)));
}
/** Una vez por video, apenas está la lista: cuáles están en TorBox. Sin key no pregunta nada. */
export async function loadTorbox(video: string, cands: Candidate[]): Promise<void> {
	if (!view.torboxKey) return;
	side().torbox = 'checking';
	const found = await core.catalogTorbox(video, cands.map((c) => c.info_hash)).catch(() => null);
	if (sideOf()?.videoId !== video) return;
	// null = TorBox no respondió (la key ya se sabe que está).
	side().torbox = found ? 'done' : 'error';
	found?.hashes.forEach((h) => inTorbox.add(h));
	found?.spanish_subs.forEach((h) => torboxSpanishSubs.add(h));
	// Calidad del archivo de video cuando el nombre del torrent no la dice (sale del mismo pedido).
	for (const v of found?.videos ?? []) {
		const c = cands.find((x) => x.info_hash === v.hash);
		if (!c) continue;
		c.resolution ??= v.resolution;
		c.source ??= v.source;
	}
	renderStreamsOnly();
}
core.apiKeys().then((ks) => {
	view.torboxKey = ks.some((k) => k.service === 'torbox' && k.configured);
	renderStreamsOnly();
}).catch(() => {});
// Key de TorBox recién cargada en Ajustes: se marca enseguida lo del video abierto.
document.addEventListener('streamonte:torbox-key', async () => {
	const ks = await core.apiKeys().catch(() => []);
	view.torboxKey = ks.some((k) => k.service === 'torbox' && k.configured);
	if (view.torboxKey && state.update?.done) void loadTorbox(side().videoId, state.update.candidates);
	else renderStreamsOnly();
});
// ---------- clic derecho en una opción: copiar su magnet o su link de TorBox (menú `CtxMenu.svelte`) ----------
mountCtxMenu();
/** Copia el link que todavía se está pidiendo: con `ClipboardItem` + promesa el permiso del clic sigue valiendo después de
 *  esperar al núcleo (WebKit lo pierde con un `await` antes de copiar). */
function copyLink(hash: string, torbox: boolean): void {
	const f = sideOf()?.flow;
	const link = core.catalogLink(hash, torbox, sideOf()?.details?.details?.original_language ?? null, !!(f?.lat && !f.latOff));
	const done = typeof ClipboardItem === 'function'
		? navigator.clipboard.write([new ClipboardItem({ 'text/plain': link.then((t) => new Blob([t], { type: 'text/plain' })) })])
		: link.then((t) => navigator.clipboard.writeText(t));
	if (torbox) setStatus(tr('Pidiéndole el link a TorBox…'));
	done.then(() => setStatus(torbox ? tr('Link para castear copiado (stream de TorBox): pegalo en Web Video Caster. Vence en unas horas.') : tr('Magnet copiado.'))).catch(showError);
}
document.addEventListener('contextmenu', (ev) => {
	const row = ev.target instanceof Element ? ev.target.closest<HTMLElement>('.cat-opt[data-hash]') : null;
	const hash = row?.dataset.hash;
	if (!row || !hash) return;
	ev.preventDefault();
	const items: CtxItem[] = [];
	if (view.torboxKey && inTorbox.has(hash)) items.push({ id: 'cat-ctx-torbox', icon: 'external', text: tr('Copiar link para castear (TorBox)'), onclick: () => copyLink(hash, true) });
	items.push({ id: 'cat-ctx-magnet', icon: 'copy', text: tr('Copiar magnet'), onclick: () => copyLink(hash, false) });
	items.push({ id: 'cat-ctx-subs', icon: 'subs', text: tr('Subtítulos…'),
		onclick: () => openSubs(hash, !!view.torboxKey && inTorbox.has(hash), document.getElementById(`cat-play-${hash}`) ?? row) });
	openCtxMenu(items, ev.clientX, ev.clientY);
});

/** Filtros de la lista (lo elegido en los pasos, "Solo HDR" y "Subs ES"): una regla para grupos y filas. */
const passesFilters = (c: Candidate): boolean => flowFilter(c) && (!view.onlyHdr || c.hdr.length > 0) && (!view.onlyEs || hasSpanishSubs(c.info_hash) === true);
export const inScope = (c: Candidate, res: string | null | undefined): boolean => (!res || resKey(c) === res) && passesFilters(c);

/** Cómo terminó "bajar la mejor al terminar": la elegida ya bajando, o que no hubo. */
function autoBar(): ListView['auto'] {
	const t = side().tests, a = t.auto;
	if (!a || !state.update?.done) return null;
	return { step: a.step, lead: tr('La mejor · '), text: a.text, close: tr('Cerrar'), onclose: () => { t.auto = null; renderStreamsOnly(); } };
}

/** Orden de la lista, arriba de las opciones del grupo abierto, con los filtros a la derecha. Antes del test profundo es solo
 *  información. */
function sortRow(subscan: SortView['subscan'] = null): SortView {
	const torbox = sideOf()?.flow?.mode === 'torbox';
	const order: SortView['order'] = torbox
		? { kind: 'fixed', label: tr('Ordenado por'), icon: 'monitor', title: tr('En TorBox se ven al instante desde sus servidores: los seeds no importan, manda la calidad'), text: tr('Mejor calidad') }
		: !deepTested()
			? { kind: 'fixed', label: tr('Ordenado por'), icon: 'gauge', title: tr('Hasta testearlas, se ordenan por mejor conexión: más seeds. Después del test podés ordenar por mejor imagen.'), text: tr('Mejor conexión') }
			: {
					kind: 'choose', label: tr('Ordenar por'),
					buttons: ([['quality', tr('Mejor imagen'), tr('Arriba las testeadas que andan fluidas, de mejor a peor calidad de imagen; después el resto por conexión')], ['fast', tr('Arranca más rápido'), tr('Primero las de mejor conexión: las más fluidas y con más seeds')]] as const).map(([k, text, title]) => ({
						id: `cat-sort-${k}`, pressed: view.optSort === k, title, text,
						onclick: () => { view.optSort = k; safeSet('streamonte.catalog.sort', k); renderStreamsOnly(); },
					})),
				};
	return {
		order,
		subscan,
		filters: [
			{
				id: 'cat-only-hdr', pressed: view.onlyHdr, icon: view.onlyHdr ? 'check' : null, text: tr('Solo HDR'),
				title: view.onlyHdr ? tr('Mostrando solo HDR / Dolby Vision: tocá para ver todas') : tr('Mostrar solo las opciones con HDR / Dolby Vision (más rango de luz y color)'),
				onclick: () => { view.onlyHdr = !view.onlyHdr; renderStreamsOnly(); },
			},
			// Subs ES (como la web): solo las que se sabe que traen subtítulos en español.
			{
				id: 'cat-only-es', pressed: view.onlyEs, icon: view.onlyEs ? 'check' : 'subs', text: tr('Subs ES'), title: tr('Solo las verificadas que traen subtítulos en español'),
				onclick: () => { view.onlyEs = !view.onlyEs; renderStreamsOnly(); },
			},
		],
	};
}
/** "Buscar sub ES": lee de a una, en el orden de la lista, hasta encontrar una con subtítulos en español dentro del video; el
 *  mismo botón pausa y sigue. Sin pendientes ni resultado, no aparece. */
function subsScanChip(list: Candidate[]): SortView['subscan'] {
	const st = subsScan();
	if (st === 'found' || list.some((c) => hasSpanishSubs(c.info_hash) === true)) return null;
	const left = list.filter((c) => hasSpanishSubs(c.info_hash) == null).length;
	if (st === 'none' || !left) return { kind: 'done', text: tr('Ninguna trae sub ES') };
	const running = st === 'running';
	return {
		kind: 'button', running,
		title: running ? tr('Pausar la búsqueda (lo leído queda)') : tr('Lee de a una ({left} sin leer) hasta encontrar una que traiga subtítulos en español dentro del video', { left }),
		text: running ? tr('Buscando sub ES… · Pausar') : st === 'paused' ? tr('Seguir buscando sub ES') : tr('Buscar sub ES'),
		onclick: toggleSubsScan,
	};
}

/** Cada cuánto cambia la línea de avance aunque no lleguen resultados. */
const TICK_MS = 3200;
/** Lo que va pasando, en una línea que cambia cada `TICK_MS`: para que se vea que avanza. Sale de los datos que van llegando;
 *  sin datos, una frase de lo que hace. */
function progressLine(res: string, stage: 'quick' | 'deep', run: Run | null): string {
	const t = side().tests;
	const now = Date.now();
	if (stage === 'quick') {
		const first = t.first[res]?.hashes ?? [];
		const results = first.map((h) => quick.get(h) ?? counted.get(h)).filter((q): q is Count => !!q);
		const alive = results.filter((q) => q.reached && q.seeds > 0).length;
		const deadN = results.length - alive;
		const live = first.filter((h) => quickLive.has(h)).length;
		const asking = first.filter((h) => quickRunning.has(h) && !quick.has(h) && !quickLive.has(h)).length;
		const seeds = results.reduce((s, q) => s + (q.seeds || 0), 0) + first.reduce((s, h) => { const q = quickLive.get(h); return s + (q?.reached ? q.seeds : 0); }, 0);
		const left = first.length - results.length;
		return pickLine([
			run?.prev && tr('En {a} ninguna anda sin cortes: sigo con {b}', { a: resLabel(run.prev), b: resLabel(res) }),
			!results.length && !live && tr('Preguntándole a la red quién tiene cada torrent…'),
			live && tr('Conectando con {live} {a} a la vez', { live, a: live === 1 ? 'torrent' : 'torrents' }),
			asking && tr('Esperando que respondan {asking} más', { asking }),
			results.length && tr('Ya respondieron {n} de {n2}', { n: results.length, n2: first.length }),
			alive && tr('Encontré {alive} con seeds reales', { alive }),
			seeds && tr('{seeds} seeds reales contados hasta ahora', { seeds }),
			deadN && tr('Descarté {deadN} que no tienen a nadie', { deadN }),
			left && results.length && tr(left === 1 ? 'Me falta 1 para pasar a la etapa 2' : 'Me faltan {n} para pasar a la etapa 2', { n: left }),
		], now, TICK_MS) ?? tr('Buscando seeds reales…');
	}
	const d = side().deep;
	const hashes = d.hashes ?? [];
	const doneN = hashes.filter((h) => deepDone.has(h)).length;
	const lives = hashes.map((h) => liveCount.get(h)).filter((l): l is Count => !!l);
	const peers = lives.reduce((s, l) => s + (l.peers || 0), 0);
	const countingN = lives.filter((l) => l.reached).length;
	const cands = (state.update?.candidates ?? []).filter((c) => hashes.includes(c.info_hash));
	const fluid = cands.filter((c) => counted.has(c.info_hash) && health(c)?.level === 0).length;
	const left = hashes.length - doneN;
	return pickLine([
		tr('Verificando la salud de las mejores'),
		peers && tr('Midiendo la velocidad con {peers} conexiones', { peers }),
		countingN && tr('Contando seeds reales en {counting} a la vez', { counting: countingN }),
		doneN && tr('{doneN} de {n} verificados', { doneN, n: hashes.length }),
		fluid && tr(fluid === 1 ? '{n} ya anda sin cortes' : '{n} ya andan sin cortes', { n: fluid }),
		left && doneN && tr(left === 1 ? 'Me falta 1' : 'Me faltan {n}', { n: left }),
		run?.best && tr('Al terminar dejo bajando la mejor'),
	], now, TICK_MS) ?? '';
}

/** Panel de la resolución abierta: el análisis en curso (1 de 2 prueba rápida, 2 de 2 análisis profundo) con "Detener", o el
 *  resultado con "Testear más". */
export function groupPanel(res: string): PanelView | null {
	const u = state.update as StreamsUpdate, d = side().deep, t = side().tests;
	const resText = res === 'other' ? tr('las otras resoluciones') : resLabel(res);
	// Deteniendo: hasta que el núcleo cortó todo, para que se vea que el clic hizo algo.
	if (t.stopping?.res === res) {
		if (counting.size || d.status === 'run') return { kind: 'stopping', title: tr('Deteniendo…'), sub: tr('Cortando las conexiones. Lo ya probado queda.') };
		t.stopping = null;
	}
	// Analizando: título fijo, debajo en gris lo que va pasando y dos botones: bajar la mejor al terminar y detener.
	const run = t.run?.res === res ? t.run : null;
	const single = !run && d.status === 'run' && !!d.single;
	if (run || single) {
		const deepNow = single || run?.stage === 'deep';
		const { done, n, frac } = deepNow ? deepStatus(d) : { done: 0, n: 0, frac: 0 };
		const first = t.first[res];
		const elapsed = first ? Date.now() - first.at : 0;
		// Sin resultados nuevos igual cambia el texto: un redibujo cada `TICK_MS` mientras analiza.
		if (!t.tick) t.tick = setTimeout(() => { t.tick = null; scheduleRender(); }, TICK_MS);
		if (first && once(t, `timers-${res}`) && elapsed < QUICK_LATE_MS) setTimeout(scheduleRender, QUICK_LATE_MS + 100 - elapsed);
		const title = single ? tr('Verificando {a} · {done} de {n}', { a: n === 1 ? '1 torrent' : `${n} torrents`, done, n })
			: run?.quickOnly ? tr('Armando la lista de {resText} · estimado ~30 s', { resText })
				: tr('Analizando {resText} · {a}', { resText, a: deepNow ? tr('fase 2 de 2') : tr('fase 1 de 2') });
		// La línea entra animada solo cuando cambia (la lista se redibuja cada 400 ms).
		const line = progressLine(res, deepNow ? 'deep' : 'quick', run);
		const fresh = t.lastLine !== line;
		t.lastLine = line;
		const total = first?.hashes.length ?? 0;
		const readyN = first ? first.hashes.filter((h) => quick.has(h) || counted.has(h)).length : 0;
		return {
			kind: 'running', title, line, fresh,
			// Texto sutil que es botón: se prende o apaga mientras analiza.
			best: run && !run.quickOnly ? {
				on: run.best, onclick: toggleBest,
				title: run.best ? tr('Al terminar la dejo bajando de fondo (tocá para no hacerlo)') : tr('Al terminar dejo bajando de fondo la que ande sin cortes; si en esta calidad no hay, pruebo la siguiente más baja'),
				text: run.best ? tr('La dejo bajando') : tr('Dejar bajando el mejor'),
			} : null,
			stop: { aria: tr('Detener'), title: tr('Detener: lo ya probado queda y se muestra la lista'), onclick: (ev) => { ev.currentTarget.disabled = true; stopTests(); } },
			// Avance real: cuántas de la tanda ya respondieron (y en la fase 2, cuántas se verificaron).
			bar: deepNow ? deepBar(d, frac, n) : { kind: 'quick', now: readyN, max: total, fill: `width:${total ? Math.max(4, (readyN / total) * 100) : 4}%` },
		};
	}
	// Lista armada con la prueba rápida ("Ver lista") y todavía sin análisis a fondo: se ofrece.
	if (d.status !== 'done' || d.res !== res) {
		if (!t.first[res] || d.status === 'run') return null;
		return {
			kind: 'offer', title: tr('Análisis profundo: buscar el mejor torrent'), onclick: () => startAnalysis(res),
			sub: tr('Verifico a fondo las {TOP} mejores y leo sus audios y subtítulos internos (sub ES, latino) · {a}', { TOP, a: analysisEta(u.candidates.filter((c) => inScope(c, res)).length) }),
		};
	}
	const inRes = u.candidates.filter((c) => inScope(c, res));
	const checkedN = inRes.filter((c) => counted.has(c.info_hash)).length;
	const alive = inRes.filter((c) => (counted.get(c.info_hash)?.seeds ?? 0) > 0).length;
	// Quedan sin contar (y no muertos): otra tanda, solo si el usuario quiere; primero las que la prueba rápida encontró con seeds.
	const { potential } = quickPending(res);
	const more = Math.min(TOP, potential || inRes.filter((c) => !counted.has(c.info_hash) && !unlikely(c)).length);
	return {
		kind: 'done', title: tr('Análisis completo'),
		sub: tr('{resText}: {alive} de {checkedN} con seeds reales{a}', { resText, alive, checkedN, a: potential ? tr(' · {potential} más con seeds reales para testear', { potential }) : '' }),
		next: more ? { id: 'cat-deep-more', text: tr('Testear {more} más', { more }), onclick: () => void runDeep(side().videoId, res) }
			: { id: 'cat-deep-go', text: tr('Repetir'), onclick: () => startAnalysis(res) },
	};
}

/** Avance del análisis profundo en curso (`runDeep`): cuántos respondieron y fracción 0–1. */
export function deepStatus(d: Deep): { done: number; n: number; frac: number } {
	const n = d.hashes.length;
	const done = d.hashes.filter((h) => deepDone.has(h)).length;
	// Desde cuándo no termina ninguno: la barra avanza sola dentro del tramo siguiente (ver `deepBar`).
	if (d.lastDone !== done || !d.lastAt) Object.assign(d, { lastDone: done, lastAt: Date.now() });
	return { done, n, frac: n ? done / n : 0 };
}

/** Barra del análisis: lo terminado, y delante un tramo que avanza solo y despacio hacia el próximo torrent (hasta el 90 % de su
 *  parte). El avance sale del reloj (`animation-delay` negativo): redibujar no lo reinicia. */
function deepBar(d: Deep, frac: number, n: number): { kind: 'deep'; fill: string; creep: string | null } {
	return {
		kind: 'deep', fill: `width:${frac * 100}%`,
		creep: frac < 1 ? `left:${frac * 100}%;--slice:${(100 / Math.max(1, n)) * 0.9}%;animation-delay:-${Date.now() - (d.lastAt ?? Date.now())}ms` : null,
	};
}

/** Línea de tooltip: direcciones que conoce la red (`known` del conteo manda sobre el censo). */
export function knownLine(hash: string): string | null {
	const n = counted.get(hash)?.known || census.get(hash);
	return (n ?? 0) > 0 ? tr('La red conoce ~{n} direcciones (DHT/trackers/PEX); no todas aceptan conexión.', { n }) : null;
}
/** Un solo redibujo cada 400 ms como mucho para lo que llega de las pruebas: con 30 a la vez, redibujar la lista entera por
 *  cada uno trababa la compu. */
export function scheduleRender(): void {
	// Ventana oculta o minimizada: no se dibuja nada; al volver, un solo redibujo.
	if (document.hidden) { view.renderOnShow = true; return; }
	if (!view.liveRender) view.liveRender = setTimeout(() => { view.liveRender = null; if (state.update) renderStreamsOnly(); }, 400);
}
document.addEventListener('visibilitychange', () => {
	if (!document.hidden && view.renderOnShow) { view.renderOnShow = false; if (state.update) renderStreamsOnly(); }
});
/** Filas dibujadas del grupo abierto (de a `PAGE_ROWS`, "Mostrar más"). */
export const PAGE_ROWS = 25;
/** Desde cuándo se ve una prueba sin fase anotada (la barra arranca ahí y no se reinicia al redibujar). */
const seenTesting = new Map<string, number>();
/** Indicador de una prueba en curso: etapa 1 = conseguir los datos del torrent, etapa 2 = contar los seeds reales. */
export function testingPill(hash: string, live: Count, quickMode: boolean): Mid {
	const countingNow = live.reached;
	const label = countingNow ? tr('Contando seeds reales · {seeds}', { seeds: live.seeds })
		: live.peers ? tr('Pidiendo datos a {peers} conexiones…', { peers: live.peers }) : tr('Buscando seeds…');
	const key = `${hash}|${countingNow}`;
	if (!seenTesting.has(key)) seenTesting.set(key, Date.now());
	return { kind: 'testing', quick: quickMode, counting: countingNow, step: countingNow ? '2/2' : '1/2', label, since: phaseAt.get(hash)?.t ?? seenTesting.get(key) ?? Date.now() };
}
/** ▶ tocado: info_hash → `key` del video (null mientras se agrega). Spinner hasta que la reproducción arranca o falla. */
export const starting = new Map<string, string | null>();

/** Bytes del archivo que se ve (en un pack, el del episodio: regla en `options-logic.ts`). */
export function fileBytes(c: Candidate): number | null {
	const [, season, episode] = (sideOf()?.videoId ?? '').split(':');
	const e = c.is_pack && episode ? state.library.get(`${c.info_hash}:s${season}e${episode}`) : undefined;
	const eps = c.is_pack ? (sideOf()?.meta?.episodes ?? []).filter((x) => String(x.season) === season).length : 0;
	return fileBytesOf(c, e?.live?.file_size || e?.video_size, eps);
}
/** Bytes/s que hay que bajar sostenidos para verlo sin cortes = archivo ÷ duración (la real si se analizó, si no la de la ficha). */
export function neededBps(c: Candidate): number | null {
	const [, season, episode] = (sideOf()?.videoId ?? '').split(':');
	const e = c.is_pack && episode ? state.library.get(`${c.info_hash}:s${season}e${episode}`) : rowsOf(c.info_hash)[0];
	return neededBpsFor(fileBytes(c), e?.live?.duration_secs, sideOf()?.runtime);
}
/** Mbps que pide una opción para verse sin cortes: peso ÷ duración; sin dato, lo típico de su resolución. */
export const mbpsOf = (c: Candidate): number => mbpsFor(c.resolution, neededBps(c));
/** Salud del stream: la cuenta está en `healthOf`; acá se juntan los datos. Null sin seeders conocidos o si nadie respondió. */
export function health(c: Candidate): ReturnType<typeof healthOf> | null {
	if (knownSeeds(c) == null || counted.get(c.info_hash)?.reached === false) return null;
	const cal = view.renderCal ?? healthCalibration(state.library.values());
	const ev = evidenceOf(c.info_hash, c);
	const pb = playbackOf(c.info_hash);
	return healthOf({ resolution: c.resolution, bps: neededBps(c), cal, ev, now: pb && speedOf(pb.key), trackerMin: TRACKER_MIN });
}

/** Veredicto en palabras: lo que el usuario quiere saber, sin Mbps. */
export const HEALTH_WORD = [tr('Fluida'), tr('Puede cortarse'), tr('Se va a trabar')];
export const mbpsN = (v: number): string => nf(v >= 10 ? Math.round(v) : v);
/** Veredicto de salud: ícono de señal + palabra (lo dibuja la fila); rango, de dónde sale y cuándo se testeó van en el tooltip.
 *  Tocarlo testea de nuevo. `compact` (reproduciendo): solo el ícono. */
export function verdict(c: Candidate, compact = false): Verdict | null {
	const h = health(c);
	if (!h) return null;
	const { shown, probable, range: r, conf, basis, need, exact, cal, ev } = h;
	const word = HEALTH_WORD[shown];
	const asks = exact ? tr('pide ~{a}', { a: Math.round(need) }) : tr('un {a} suele pedir ~{b} (el real se sabe al testearlo)', { a: resLabel(resKey(c)), b: Math.round(need) });
	const k = basis === 'now' ? 1 : (cal.bias?.[basis]?.factor ?? 1);
	const learnedTxt = Math.abs(k - 1) > 0.05 ? tr(' Corregido ×{a} con lo que anduvieron tus reproducciones en esta red.', { a: nf1(k) }) : '';
	const why = basis === 'now' ? tr('Es lo que está bajando ahora.')
		: basis === 'measured' ? tr('Medido al analizarlo: {a} Mbps.{learned}', { a: mbpsN(ev?.analysis_mbps ?? 0), learned: learnedTxt })
			: basis === 'counted' ? tr('{counted_seeds} seeders contados y {a} leechers.{learned}', { counted_seeds: ev?.counted_seeds, a: ev?.counted_leech ?? 0, learned: learnedTxt })
				: tr('{tracker_seeds} seeders y {a} leechers según los trackers (sin testear).{learned}', { tracker_seeds: ev?.tracker_seeds, a: ev?.tracker_leechers ?? 0, learned: learnedTxt });
	const internet = cal.capMbps && r.hi >= cal.capMbps ? tr(' Tope: tu internet, {a} Mbps.', { a: Math.round(cal.capMbps) }) : '';
	const at = testedAt.get(c.info_hash);
	const known = knownLine(c.info_hash);
	const tip = tr('{word}{a}: bajaría entre {b} y {c} Mbps, lo más probable ~{d}; {asks} ({e}×).\n{why}{internet}\nConfianza: {conf}.{f}\nTocá para testear de nuevo.{g}', {
		word, a: probable ? tr(' (probable)') : '', b: mbpsN(r.lo), c: mbpsN(r.hi), d: mbpsN(r.p50), asks, e: nf1(h.ratio), why, internet, conf: tr(conf),
		f: at ? tr(' Testeado {a}.', { a: ago(at) }) : '', g: known ? `\n${known}` : '',
	});
	return {
		id: `cat-health-${c.info_hash}`, level: shown as Verdict['level'], probable, word, tip, compact,
		aria: tr('{word}, confianza {conf}: testear de nuevo', { word, conf: tr(conf) }), onclick: () => reanalyze([c.info_hash]),
	};
}

/** "Cargar en background": info_hash → {key, row}; `row` = última fila. La velocidad la mide `health-store.ts`. */
export const bgLoads = new Map<string, { key: string; row: PlaybackRow | null }>();
/** Lo que el análisis sabe de una opción (salud fiel): de los candidatos del panel si está; si no, de la fila de la biblioteca.
 *  Entrada de `predict` y foto que se guarda al tocar ▶/⤓ (`notePrediction`). Null si no hay nada que prediga. */
export function evidenceOf(hash: string, c: Candidate | undefined = state.update?.candidates.find((x) => x.info_hash === hash)): (HealthEvidence & { res: string | null }) | null {
	const live = rowsOf(hash).find((x) => x.live && !x.live.partial)?.live ?? null;
	const scrape = rowsOf(hash).find((x) => x.scrape)?.scrape ?? null;
	// Un 0 parcial (recién llegan los metadatos) no es "0 contados": taparía a los trackers.
	const sc0 = c ? seedsCounted(c) : live && live.seeds > 0 ? live.seeds : null;
	const sc = sc0 === 0 && counted.get(hash)?.seeds !== 0 ? null : sc0;
	const tracker = c ? seedsOf(c) : (scrape?.seeders ?? null);
	const analysis = live && live.avg_speed_bps > 0 ? toMbps(live.avg_speed_bps) : null;
	if (tracker == null && sc == null && analysis == null) return null;
	const bps = c && neededBps(c);
	const knownN = counted.get(hash)?.known ?? 0;
	return {
		tracker_seeds: tracker,
		tracker_leechers: c ? (c.leechers ?? null) : (scrape?.leechers ?? null),
		counted_seeds: sc,
		counted_leech: sc == null ? null : c ? (leechersOf(c) ?? 0) : live ? Math.max(0, live.peers - live.seeds) : 0,
		analysis_mbps: analysis,
		need_mbps: bps ? toMbps(bps) : c ? typicalMbps(c.resolution) : live?.duration_secs ? toMbps(live.file_size / live.duration_secs) : null,
		res: c?.resolution ?? null,
		known: knownN > 0 ? knownN : null,
		dht: census.get(hash) ?? null,
	};
}
/** Fila de una reproducción: la mide (calibra la salud) y, si es de una carga en background, la guarda para su texto. */
export function measurePlayback(row: PlaybackRow): void {
	const hash = row.key.split(':')[0];
	trackPlayback(row, evidenceOf(hash) ?? undefined);
	const b = [...bgLoads.values()].find((x) => x.key === row.key);
	if (b) b.row = row;
}
/** Texto de la card: "2,3× · alcanza" = promedio ÷ bitrate (tamaño ÷ duración). Sin duración (o pack) solo la velocidad. */
export function bgText(c: Candidate): { cls: string; text: string; tip: string } | null {
	const b = bgLoads.get(c.info_hash);
	if (!b) return null;
	if (b.row?.state.kind === 'failed') return { cls: 'red', text: tr('falló'), tip: b.row.state.message ?? '' };
	const speed = speedOf(b.key);
	if (!speed?.n) return { cls: 'measuring', text: tr('cargando…'), tip: tr('Buscando metadatos y precargando el principio; después mide la velocidad.') };
	const avg = speed.avg;
	// Cuánto va: que se vea que está bajando, no solo si la velocidad alcanza.
	const pct = Math.floor((playbackOf(c.info_hash)?.progress ?? 0) * 100);
	const done = speed.done ? tr('completo · ') : tr('bajando {pct} % · ', { pct });
	const need = neededBps(c);
	if (!need) return { cls: 'none', text: `${done}${mbps(avg)}`, tip: tr('{a} de promedio bajando de fondo (sin duración conocida no se calcula si alcanza).', { a: mbps(avg) }) };
	const x = avg / need;
	const cls = bgTone(x);
	const word = cls === 'green' ? tr('alcanza') : cls === 'yellow' ? tr('justo') : tr('no alcanza');
	return { cls, text: `${done}${nf1(x)}× · ${word}`, tip: tr('{a} de promedio ÷ {b} que consume el video.', { a: mbps(avg), b: mbps(need) }) };
}
/** Deja bajando de fondo esa opción del video abierto (botón de la fila y "Elegí la mejor"). false si no se pudo agregar. */
export async function startBg(hash: string): Promise<boolean> {
	notePrediction(hash, evidenceOf(hash));
	const [row] = await core.catalogAdd(side().kind, side().videoId, [hash]);
	if (!row) return false;
	bgLoads.set(hash, { key: row.key, row: null });
	try {
		await core.playBackground(row.key);
	} catch (e) {
		bgLoads.delete(hash);
		throw e;
	}
	return true;
}
/** Arranca o cancela la carga en background. Cancelar = Detener: lo bajado queda guardado y Reproducir lo retoma. */
export async function toggleBg(hash: string, btn: HTMLButtonElement): Promise<void> {
	btn.disabled = true;
	const b = bgLoads.get(hash);
	try {
		if (b) {
			bgLoads.delete(hash);
			// Si ya se está viendo (Reproducir la retomó), cancelar no cierra el reproductor.
			if (b.row && ['fetching-metadata', 'preparing', 'background'].includes(b.row.state.kind)) await core.playbackAction(b.row.id, 'stop');
			setStatus(tr('Carga en background cancelada: lo bajado queda guardado.'));
		} else if (await startBg(hash)) {
			setStatus(tr('Cargando en background: la velocidad promedio aparece en la opción.'));
		}
	} catch (e) {
		if (!b) bgLoads.delete(hash);
		showError(e);
	} finally {
		btn.disabled = false;
		if (state.update) renderStreamsOnly();
	}
}

/** La reproducción de ese torrent que importa ahora (regla en `options-logic.ts`). */
export const playbackOf = (hash: string): PlaybackRow | undefined => playbackFor(live.v.playbacks.values(), hash);

/** ¿Entra en el disco de descargas? Sin dato del espacio libre, sí. */
export const fits = (c: Candidate): boolean => view.freeBytes == null || !((fileBytes(c) ?? 0) > view.freeBytes);

/** Una opción (diseño de design/opciones-final.html): a la izquierda peso, calidad de imagen y si no entra; al medio el
 *  veredicto (o testear / testeando / nadie respondió / lo que hace la reproducción) con la gente debajo; a la derecha bajar de
 *  fondo y ▶. Devuelve la vista que dibuja `$ui/options/OptionRow.svelte`. */
export function rowView(c: Candidate, best = false): OptionRowView {
	const hash = c.info_hash;
	const bg = bgText(c);
	// Al dar ▶, los estados de la reproducción. La de "bajar de fondo" la cuenta `bgText`.
	const pb = playbackOf(hash);
	const pbStatus = starting.has(hash) && !pb ? tr('cargando…') : pb && !(pb.state.kind === 'background' && bgLoads.has(hash)) ? playbackText(pb) : null;
	const live = rowsOf(hash).find((e) => e.live)?.live ?? null;
	const scraped = counted.get(hash);
	const busy = counting.has(hash);
	const qName = c.source ? QUALITY_TEXT[c.source]?.[0] : undefined;
	const tip = [
		`${c.release_name}: ${[c.resolution, qName && tr(qName)].filter(Boolean).join(' · ')}`,
		c.file_name && tr('Archivo: {file_name}', { file_name: c.file_name }),
		c.is_pack && tr('Pack: varios episodios en un torrent'),
		tr('Fuentes: {a}{b}', { a: c.addons.join(' + '), b: c.sites.length ? ` (${c.sites.join(', ')})` : '' }),
	].filter(Boolean).join('\n');
	const hdrTip = c.hdr.map((x) => HDR_TIP[x]).filter(Boolean).map((x) => tr(x)).join('\n');
	const checked = checkedBy(c);
	const partial = busy ? liveCount.get(hash) : undefined; // en vivo mientras testea
	// Prueba rápida en curso: igual que el test, con los seeds reales llegando en vivo.
	const quickBusy = !busy && quickRunning.has(hash) && !quick.has(hash);
	const qLive = quickBusy ? quickLive.get(hash) : undefined;
	const seedsNow = partial?.reached ? partial.seeds : knownSeeds(c);
	// Prueba rápida sin test profundo: "8+" es su techo (cuenta hasta 8 y corta).
	const qk = !scraped && !partial?.reached && seedsCounted(c) == null ? quick.get(hash) : undefined;
	const seedsLabel = quickBusy && qLive ? (qLive.reached ? qLive.seeds : 0) : qk?.reached && qk.seeds >= QUICK_ENOUGH ? `${qk.seeds}+` : (seedsNow ?? '—');
	const quickTip = qk && (qk.reached
		? tr('Prueba rápida: {seeds}{a} seeds (con el archivo completo) respondieron en menos de 30 s', { seeds: qk.seeds, a: qk.seeds >= QUICK_ENOUGH ? tr(' o más') : '' })
		: qk.peers ? tr('Prueba rápida: la red conoce {peers} direcciones, pero nadie respondió en 30 s', { peers: qk.peers }) : tr('Prueba rápida: nadie lo comparte'))
		+ `${c.seeders != null ? tr(' (los trackers anuncian {seeders}, sin verificar)', { seeders: c.seeders }) : ''}.`;
	const dead = scraped?.reached === false;
	const big = !fits(c);
	const seedsTip = skipped.has(hash) && !scraped
		? (skipped.get(hash) === 'dead'
			? tr('Sin testear: los trackers y la fuente dan 0 seeders y 0 leechers (casi seguro muerto).')
			: tr('Sin testear a fondo: quedó fuera de las {TOP} mejores según la prueba rápida y los trackers.', { TOP }))
		: scraped && !dead ? tr('Testeado: {seeds} seeders (archivo completo) de {peers} conectados{a}. Al reproducir suelen aparecer algunos más.{b}', {
			seeds: scraped.seeds, peers: scraped.peers, a: c.seeders != null ? tr(' (los trackers anuncian {seeders}, sin verificar)', { seeders: c.seeders }) : '',
			b: (scraped.incoming ?? 0) > 0 ? tr(' {incoming} se conectaron solos (entrantes).', { incoming: scraped.incoming }) : '',
		})
			: quickTip ? quickTip
				: live ? tr('Seeders vistos al analizarlo: {seeds} ({peers} conectados).', { seeds: live.seeds, peers: live.peers })
					: checked === 'trackers' ? tr('{TRACKERS_TIP} {seeders} seeders, {a} leechers.', { TRACKERS_TIP, seeders: c.seeders, a: c.leechers ?? 0 })
						: tr('Según la fuente (los trackers no lo conocen o no respondieron).');
	// Todavía sin respuesta del tracker (la lista ya se ve mientras se escanea): el número es de la fuente.
	const people: People = {
		verdict: pbStatus ? verdict(c, true) : null, seeds: String(seedsLabel), tip: [seedsTip, knownLine(hash)].filter(Boolean).join('\n'),
		text: `${qk?.reached || (quickBusy && qLive) ? tr(' seeds reales') : ' seeds'}${quickBusy && qLive ? tr(' encontrados') : tr(' · {a} leechers', { a: leechersOf(c) ?? 0 })}`,
	};
	const failedTip = scraped?.peers
		? tr('Nadie respondió: la red conoce {peers} direcciones de peers con este torrent, pero ninguna contestó. Pueden estar apagadas o llenas, o tu router y el de ellos tienen el puerto cerrado. No quiere decir que esté muerto: probá de nuevo en un rato o elegí otra.', { peers: scraped.peers })
		: tr('Nadie lo comparte: no apareció nadie con este torrent. Casi seguro está muerto.');
	// "Mejor opción": testeada, fluida segura (lo probable no se recomienda), que entre en el disco y no sea de cine.
	const confirmed = best && (side().flow?.mode === 'torbox' || (side().deep?.status === 'done' && isSafeBest(c)));
	const v = pbStatus || bg || busy || quickBusy || dead ? null : verdict(c);
	const main: Mid = pbStatus ? statusPill(pb, pbStatus)
		: bg ? { kind: 'bg', cls: bg.cls, text: bg.text, tip: bg.tip }
			// El núcleo prueba de a tandas: los que todavía no arrancaron esperan su lugar.
			: (busy && !partial) || (quickBusy && !qLive) ? { kind: 'waiting', text: tr('En espera…') }
				: busy && partial ? testingPill(hash, partial, false)
					: quickBusy && qLive ? testingPill(hash, qLive, true)
						: dead ? { kind: 'failed', id: `cat-retry-${hash}`, text: scraped.peers ? tr('Nadie respondió') : tr('Nadie lo comparte'), tip: failedTip, retry: tr('Reintentar'), onclick: () => reanalyze([hash]) }
							: v ? { kind: 'verdict', verdict: v }
								: {
									kind: 'check', id: `cat-check-${hash}`, text: tr('Verificar salud'), onclick: () => reanalyze([hash]),
									title: tr('Verificar salud: se conecta unos segundos con los seeds de este torrent y estima si va a andar fluido. No baja el video, pero deja guardados sus metadatos: si después lo elegís, arranca más rápido.'),
								};
	// En TorBox sin reproducirse, el medio queda vacío: peso y badges usan ese ancho (no bajan de renglón).
	const tbIdle = inTorbox.has(hash) && !pbStatus;
	const acts = pbStatus || bg ? [] : langActions(c);
	const { audio, subs } = langTags(c, confirmed);
	return {
		hash, title: tip, best: confirmed, bestText: tr('Mejor opción'), idle: tbIdle, tooBig: big, skipped: skipped.has(hash),
		size: humanBytes(c.size_bytes), hdr: hdrTip || null,
		res: hasResStep() ? null : resLabel(resKey(c)),
		heavy: hasResStep() || fitsNet(c) || c.size_bytes == null ? null : tr('Pide ~{a} Mbps: más de lo que da tu conexión', { a: Math.round(mbpsOf(c)) }),
		failedBefore: failedBefore.has(hash) && !pbStatus ? tr('Esta opción ya falló al reproducirse en esta compu (sin video, archivo roto o el reproductor no la abrió). Va al final de la lista.') : null,
		// Por TorBox ya se eligió en los pasos: el badge solo informa por torrent.
		torbox: inTorbox.has(hash) && sideOf()?.flow?.mode !== 'torbox' ? tr('TorBox es un servicio pago que baja torrents a sus servidores y te los pasa como video en línea. Este ya lo tiene bajado: se ve al instante y sin depender de los seeds, sin bajar nada a tu Mac.') : null,
		audio, subs,
		quality: qualityOf(c.source, c.release_name, `cat-qinfo-${hash}`, tr),
		nofit: big ? { text: tr('No entra: te quedan {a}', { a: humanBytes(view.freeBytes) }), title: tr('No entra en el disco: pesa {a} y en el disco de descargas quedan {b} libres. Se cortaría a mitad: liberá espacio o elegí una más liviana.', { a: humanBytes(fileBytes(c)), b: humanBytes(view.freeBytes) }) } : null,
		// En TorBox se ve desde sus servidores: salud, seeds y bajar de fondo no aplican. Viéndose por TorBox: solo su estado.
		mid: tbIdle ? null : { main, people: inTorbox.has(hash) && !(pbStatus && !pb?.stream && pb) ? null : people },
		action: playButtons(c, acts),
	};
}

/** Bajar de fondo (círculo chico) y ▶. Con `acts` (lo que falta saber del idioma), van en una cápsula junto al ▶.
 *  Reproduciéndose o bajando: Detener. */
export function playButtons(c: Candidate, acts: DockButton[] = []): Action {
	const hash = c.info_hash, loading = bgLoads.has(hash), busy = starting.has(hash);
	const pb = playbackOf(hash);
	// Cargando (pasos de Reproducir, metadatos o precarga): Cancelar. Lo bajado queda guardado en Mis magnets.
	if ((busy && (!pb || !PB_LIVE.has(pb.state.kind))) || (pb && PB_STARTING.has(pb.state.kind) && !loading)) {
		return {
			kind: 'cancel', id: `cat-cancel-${hash}`, text: tr('Cancelar'), title: tr('Cancelar: no se reproduce; lo que ya bajó queda guardado'),
			onclick: (ev) => { ev.currentTarget.disabled = true; cancelPlay(hash, pb); },
		};
	}
	if (pb && PB_LIVE.has(pb.state.kind) && !loading) {
		return {
			kind: 'stop', id: `cat-stop-${hash}`, text: tr('Detener'),
			title: pb.stream ? tr('Detener: cierra el reproductor') : tr('Detener: cierra el reproductor y la descarga queda pausada y guardada'),
			onclick: (ev) => { ev.currentTarget.disabled = true; core.playbackAction(pb.id, 'stop').catch(showError); },
			// Mientras se ve: otro subtítulo, cargado en el mpv abierto (VLC no se puede manejar desde acá).
			subchange: pb.player === 'mpv' && pb.state.kind !== 'ask-after-close'
				? { id: `cat-subchange-${hash}`, title: tr('Cambiar subtítulo: elegí otro y se carga en el reproductor sin cortar'), onclick: (ev) => openSubs(hash, pb.stream, ev.currentTarget, pb.id) }
				: null,
		};
	}
	const tb = inTorbox.has(hash);
	return {
		kind: 'play', id: `cat-play-${hash}`, tone: tb ? 'torbox' : 'accent', state: 'idle',
		// En TorBox: ▶ verde que late, y reproduce desde sus servidores (al instante, sin P2P).
		label: tb ? tr('Ver ahora desde TorBox') : tr('Ver ahora'),
		title: tb ? tr('Ver ahora desde TorBox: arranca al instante desde sus servidores, sin depender de los seeds') : fits(c) ? tr('Ver ahora') : tr('No entra en el disco: se cortaría a mitad'),
		onclick: (ev) => void playOption(hash, ev.currentTarget, tb),
		bg: tb && !loading ? null : {
			id: `cat-bg-${hash}`, on: loading,
			title: loading ? tr('Cancelar la descarga de fondo: lo bajado queda guardado') : tr('Bajar de fondo: baja sin abrir el reproductor y dice si la velocidad alcanza'),
			onclick: (ev) => void toggleBg(hash, ev.currentTarget),
		},
		dock: acts,
	};
}

/** Cancelar mientras carga: corta los pasos y, si el núcleo ya arrancó, lo detiene conservando lo bajado. */
function cancelPlay(hash: string, pb: PlaybackRow | undefined): void {
	starting.delete(hash);
	closeWizard();
	if (pb && PB_STARTING.has(pb.state.kind)) core.playbackAction(pb.id, 'stop').catch(showError);
	setStatus('Cancelado.');
	renderStreamsOnly();
}

/** Estado de la reproducción de una opción, en grande: ícono (o barras si se está viendo), el texto y la barra de lo bajado. */
export function statusPill(pb: PlaybackRow | undefined, text: string): Mid {
	const k = pb?.state.kind ?? 'preparing';
	const progress = pb && !pb.stream && ['playing', 'background', 'paused', 'download-paused'].includes(k) ? (pb.progress ?? 0) : null;
	return { kind: 'status', state: k, text: text.charAt(0).toUpperCase() + text.slice(1), progress, progressTip: progress == null ? '' : tr('{a} % bajado', { a: Math.floor(progress * 100) }) };
}

/** Qué se sabe de los seeders de una opción (leyenda de la fila): 'deep' = contados al conectarse; 'trackers' = chequeados en
 *  los trackers al cargar las opciones; null = solo lo que dice la fuente. */
export const TRACKERS_TIP = tr('Chequeado recién en los trackers al cargar las opciones: más fiel que lo que dice la fuente.');
export const checkedBy = (c: Candidate): 'deep' | 'trackers' | null => (counted.has(c.info_hash) ? 'deep' : trackersWin(c) ? 'trackers' : null);

/** Qué filas ya se mostraron y en qué orden, por video y grupo abierto. Vive acá y no en el DOM: `renderSide` rearma el panel
 *  cuando llegan la ficha o los puntajes, y con eso todas parecían nuevas y volvían a entrar animadas. */
const shown = { at: '', order: new Map<string, number>() };
/** Redibuja y anima lo que cambió: una fila entra deslizándose solo la primera vez que se ve; se desliza a su lugar (FLIP) solo
 *  si su posición cambió de verdad; el número de seeders que cambió destella y la "Mejor opción" nueva entra con un pulso. */
export function renderStreamsOnly(): void {
	const box = document.getElementById('cat-streams');
	if (!box) return;
	const rows = (): HTMLElement[] => [...box.querySelectorAll<HTMLElement>('.cat-opt[data-hash]')];
	const before = new Map(rows().map((n) => [n.dataset.hash, { top: n.getBoundingClientRect().top, seeds: n.querySelector('.cat-people')?.textContent, testing: !!n.querySelector('.cat-testing:not(.quick)') }]));
	const prevBest = box.querySelector<HTMLElement>('.cat-opt.best')?.dataset.hash;
	view.libByHash = new Map();
	for (const e of state.library.values()) {
		const list = view.libByHash.get(e.info_hash);
		if (list) list.push(e);
		else view.libByHash.set(e.info_hash, [e]);
	}
	view.renderCal = healthCalibration(state.library.values());
	let next: StreamsView | null;
	try {
		next = streamsView();
	} finally {
		view.libByHash = view.renderCal = null;
	}
	showStreams(box, next);
	// Se aplica ya, así lo de abajo mide la lista nueva.
	flushStreams();
	const at = `${sideOf()?.videoId}|${view.openRes}`;
	if (shown.at !== at) { shown.at = at; shown.order.clear(); }
	const order = new Map(rows().map((n, i) => [n.dataset.hash, i]));
	const prevOrder = new Map(shown.order);
	for (const [h, i] of order) if (h) shown.order.set(h, i);
	if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
	const now = performance.now();
	let freshN = 0;
	for (const n of rows()) {
		const hash = n.dataset.hash ?? '', old = before.get(hash);
		// Primera vez que se ve: entra deslizándose, escalonada. La mejor recién encontrada entra con su propia animación.
		const firstBest = !prevOrder.has(hash) && n.classList.contains('best');
		if (firstBest) fx.set(`best|${hash}`, now);
		else if (!prevOrder.has(hash)) n.animate([{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'none' }], { duration: 380, delay: Math.min(freshN++, 10) * 35, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'backwards' });
		if (old) {
			const dy = old.top - n.getBoundingClientRect().top;
			if (prevOrder.get(hash) !== order.get(hash) && Math.abs(dy) > 1) n.animate([{ transform: `translateY(${dy}px)` }, { transform: 'none' }], { duration: 450, easing: 'cubic-bezier(.2,.8,.2,1)' });
			if (old.seeds !== undefined && n.querySelector('.cat-people')?.textContent !== old.seeds) fx.set(`flash|${hash}`, now);
			// Terminó el test: las barras suben, entra la palabra y, si anda fluida, festeja.
			if (old.testing && n.querySelector('.cat-verdict')) {
				fx.set(`reveal|${hash}`, now);
				if (n.querySelector('.cat-verdict.cat-health-good')) celebrate(n);
			}
			if (n.classList.contains('best') && prevBest && prevBest !== hash) fx.set(`best|${hash}`, now);
		}
		// Las filas quedan entre redibujos (lista con clave): la clase del efecto se pone una vez (si el nodo es nuevo, con el
		// corrimiento de lo que ya pasó) y se saca al terminar.
		const effects: [string, HTMLElement | null, string, number][] = [['flash', n.querySelector<HTMLElement>('.cat-people'), 'flash', 900], ['best', n, 'new-best', 1500], ['reveal', n.querySelector<HTMLElement>('.cat-verdict'), 'reveal', 1000]];
		for (const [kind, target, cls, ms] of effects) {
			const t = fx.get(`${kind}|${hash}`);
			if (t === undefined || !target) continue;
			if (now - t > ms) { fx.delete(`${kind}|${hash}`); target.classList.remove(cls); target.style.animationDelay = ''; continue; }
			if (target.classList.contains(cls)) continue;
			target.classList.add(cls);
			target.style.animationDelay = `${-(now - t)}ms`;
			// El brillo, la etiqueta y el ▶ arrancan después de la tarjeta: el CSS suma su demora a este corrimiento.
			if (cls === 'new-best') target.style.setProperty('--fx-d', `${-(now - t)}ms`);
		}
	}
}
/** Festejo de un test que dio "Fluida": un brillo verde y papelitos que saltan del ícono. Van en el panel. */
export function celebrate(row: HTMLElement): void {
	const list = document.getElementById('cat-side');
	const ic = row.querySelector('.cat-verdict .cat-health-ic');
	if (!list || !ic) return;
	row.animate([{ boxShadow: '0 0 0 0 color-mix(in srgb, var(--green) 45%, transparent)' }, { boxShadow: '0 0 0 14px transparent' }], { duration: 1300, delay: 450, easing: 'cubic-bezier(.16,1,.3,1)' });
	const a = ic.getBoundingClientRect(), box = list.getBoundingClientRect();
	for (let i = 0; i < 10; i++) {
		const ang = (Math.PI * 2 * i) / 10;
		const p = document.createElement('span');
		p.className = 'cat-confetti';
		p.setAttribute('aria-hidden', 'true');
		p.style.cssText = `left:${a.left - box.left + a.width / 2}px;top:${a.top - box.top + list.scrollTop + a.height / 2}px;background:${['var(--green)', 'var(--accent-fg)', '#e8c26a'][i % 3]}`;
		list.append(p);
		p.animate([{ transform: 'translate(0,0) rotate(0)', opacity: 1 }, { transform: `translate(${Math.cos(ang) * 36}px,${Math.sin(ang) * 26 - 10}px) rotate(${i * 40}deg)`, opacity: 0 }],
			{ duration: 900, delay: 420, easing: 'cubic-bezier(.16,1,.3,1)', fill: 'backwards' }).finished.then(() => p.remove(), () => p.remove());
	}
}
/** Último texto de reproducción mostrado por opción (hash → firma): evita redibujos iguales. */
export const cardSig = new Map<string, string | null>();
/** Efectos en curso: `flash|hash` / `best|hash` → cuándo empezaron (ms). */
export const fx = new Map<string, number>();

/** Opciones del video por resolución (respetan los filtros), en el orden de `RES_ORDER`. */
export function groupsOf(u: StreamsUpdate | null = state.update): Map<string, Candidate[]> {
	const groups = new Map<string, Candidate[]>(RES_ORDER.map((r) => [r, []]));
	for (const c of (u?.candidates ?? []).filter(passesFilters)) groups.get(resKey(c))?.push(c);
	return groups;
}
/** La resolución más baja siguiente que tenga opciones ("Otras" no cuenta: SD o sin dato), o null. */
export function lowerRes(res: string, groups: Map<string, Candidate[]> = groupsOf()): string | null {
	return RES_ORDER.slice(RES_ORDER.indexOf(res) + 1).find((r) => r !== 'other' && groups.get(r)?.length) ?? null;
}
/** Abre un grupo de resolución (uno a la vez; '' = todos cerrados), sin scroll. */
export function openGroup(r: string): void {
	view.openRes = r;
	view.shownRows = PAGE_ROWS;
	renderStreamsOnly();
}
/** Todas las opciones sin separar por calidad (TorBox): de 4K a "Otras" y, dentro de cada una, el orden de `sortOptions`. */
export const flatSorted = (cands: Candidate[]): Candidate[] => sortOptions(cands).list;
/** La única que se recomienda ("Mejor opción") o se elige sola ("Elegí la mejor"): testeada a fondo, fluida segura (lo
 *  probable no), que entre en el disco y no sea de cine. */
export function isSafeBest(c: Candidate): boolean {
	const h = health(c);
	return counted.get(c.info_hash)?.reached === true && h?.level === 0 && !h.probable && fits(c) && c.source !== 'CAM';
}

/** El panel entero: sin opciones, un paso del flujo, o la lista del grupo abierto. */
function streamsView(): StreamsView | null {
	const u = state.update;
	if (u?.done && !u.candidates.length) {
		const anyOk = u.addons.some((a) => a.state === 'ok');
		return { kind: 'empty', text: anyOk ? tr('Ninguna fuente tiene torrents para esto.') : tr('Ninguna fuente respondió. Cerrá y volvé a abrirlo para reintentar.') };
	}
	// Pasos antes de la lista: buscando → torrent/TorBox → ¿latino? → calidad.
	const step = flowStep();
	if (step) return { kind: 'flow', flow: step };
	if (!u) return null;
	const r = view.openRes ?? '';
	const groups = groupsOf(u);
	// Sin paso de calidad (TorBox, "Ver todas las opciones"): una sola lista con todas las calidades, cada fila con la suya.
	const flat = !hasResStep();
	const cands = flat ? [...groups.values()].flat() : (groups.get(r) ?? []);
	const n = cands.length;
	const f = side().flow;
	// Mientras corre el análisis profundo, el borde de la lista gira.
	const analyzing = side().deep?.status === 'run';
	const base: ListView = {
		kind: 'list', crumbs: crumbs(), auto: autoBar(),
		group: { id: `cat-group-${flat ? 'all' : r}`, analyzing, phase: analyzing ? `--group-phase:-${Date.now() % 4000}ms` : null, headId: `cat-res-${r}`, name: flat ? tr('Todas las calidades') : resLabel(r), count: `${n} ${n === 1 ? tr('opción') : tr('opciones')}` },
		latOff: f.latOff ? tr('Sin filtro de latino: se muestran todas.') : null,
		panel: flat ? null : groupPanel(r), panelOnly: false,
		sort: sortRow(), rows: [], empty: null, moreRows: null, probing: null, more: null, lower: null,
	};
	// Analizando: solo el panel con su avance y "Detener"; sin filas (eran decenas de animaciones a la vez).
	if (!flat && (side().tests.run?.res === r || side().tests.stopping?.res === r)) return { ...base, panelOnly: true };
	// Las que todavía se están probando de fondo no se muestran hasta terminar: aparecen ya ordenadas con su resultado.
	const probing = cands.filter((c) => quickRunning.has(c.info_hash) && !quick.has(c.info_hash) && !counting.has(c.info_hash));
	const { list: sortedAll, best } = flat ? (() => { const list = flatSorted(cands); return { list, best: list.find(isMatch) ?? null }; })() : sortOptions(cands);
	const sorted = probing.length ? sortedAll.filter((c) => !probing.includes(c)) : sortedAll;
	// "Buscar sub ES" de la barra (por torrent): lee de a una solo hasta encontrar una que sirva (sub ES y, si pidió latino, latino).
	const wantLat = f.lat && !f.latOff;
	const byHash = new Map(sorted.map((c) => [c.info_hash, c]));
	if (!flat) readUntil(sorted.map((c) => c.info_hash), (h) => { const c = byHash.get(h); return hasSpanishSubs(h) === true && (!wantLat || (!!c && latOf(c) === 'lat')); });
	const more: MoreRowView | null = moreRow();
	if (!n) return { ...base, empty: noMatches(u.candidates.some((c) => flat || resKey(c) === r)), more };
	// Solo las primeras: con 150+ filas redibujar todas trababa la compu; las de abajo casi nunca se eligen.
	const rest = sorted.length - view.shownRows;
	return {
		...base,
		sort: sortRow(flat ? null : subsScanChip(sorted)),
		rows: sorted.slice(0, view.shownRows).map((c) => rowView(c, c === best)),
		moreRows: rest > 0 ? { text: tr('Mostrar {a} más · quedan {rest}', { a: Math.min(PAGE_ROWS, rest), rest }), onclick: () => { view.shownRows += PAGE_ROWS; renderStreamsOnly(); } } : null,
		probing: probing.length ? tr('Probando {n} más de fondo: aparecen acá cuando terminan', { n: probing.length }) : null,
		more,
		lower: flat ? null : lowerSuggestion(r, groups),
	};
}

/** Lista vacía: si la resolución tiene torrents que los filtros esconden, lo dice y ofrece sacarlos. */
function noMatches(hasCandidates: boolean): ListView['empty'] {
	if (!hasCandidates) return { text: tr('No se encontraron torrents.'), clear: null };
	return { text: tr('No hay opciones con estos filtros. '), clear: { text: tr('Quitar filtros'), onclick: clearFilters } };
}
/** Quita todos los filtros que limitan la lista: HDR, Subs ES, latino y TorBox (pasa a torrent, sin filtro). */
function clearFilters(): void {
	view.onlyHdr = false;
	view.onlyEs = false;
	const f = side().flow;
	if (f?.lat) f.latOff = true;
	if (f?.mode === 'torbox') f.mode = 'torrent';
	renderStreamsOnly();
}

/** Al final de la lista: con el test de esa resolución terminado y ninguna fluida, ofrece la siguiente más baja con opciones. */
function lowerSuggestion(res: string, groups: Map<string, Candidate[]>): ListView['lower'] {
	const d = side().deep;
	if (d?.status !== 'done' || d.res !== res) return null;
	if ((groups.get(res) ?? []).some((c) => counted.get(c.info_hash)?.reached && health(c)?.level === 0)) return null;
	const lower = lowerRes(res, groups);
	if (!lower) return null;
	const lowerList = groups.get(lower) ?? [];
	const fluid = lowerList.filter((c) => health(c)?.shown === 0).length;
	return {
		title: tr('Ninguna en {a} va a andar fluida', { a: resLabel(res) }),
		sub: fluid ? tr('En {a} hay {fluid} que sí: se ven un poco menos nítidas, pero sin cortes.', { a: resLabel(lower), fluid }) : tr('En {a} hay más chances: se ven un poco menos nítidas, pero sin cortes.', { a: resLabel(lower) }),
		go: tr('Ver {a} →', { a: resLabel(lower) }),
		onclick: () => {
			openGroup(lower);
			reanalyze(lowerList.map((c) => c.info_hash), lower);
		},
	};
}

/** Grupos de resolución: 4K, 2K, 1080p, 720p y "Otras" (SD y sin dato); la regla está en `$ui/options/row.ts`. */
export const RES_ORDER = RES;
export const resKey = (c: Candidate): string => resKeyOf(c.resolution);
export const resLabel = (r: string): string => resLabelOf(r, tr('Otras'));
/** Reproducir: lo agrega a la biblioteca y lo prepara con el flujo de siempre (audio → subtítulos → reproductor). Se queda en el
 *  catálogo. `torbox`: se abre con el link de TorBox en vez del motor. */
export async function playOption(hash: string, btn: HTMLButtonElement, torbox = false): Promise<void> {
	btn.disabled = true;
	starting.set(hash, null);
	let started: boolean | undefined = false;
	try {
		notePrediction(hash, evidenceOf(hash));
		const [row] = await core.catalogAdd(side().kind, side().videoId, [hash]);
		if (row && starting.has(hash)) {
			starting.set(hash, row.key);
			// TorBox: video en línea, sin motor ni fila de reproducción. Sus pistas se leen de TorBox antes de preguntar el audio.
			if (torbox) {
				setStatus('Leyendo audios y subtítulos en TorBox…');
				await readTracks(hash, true);
			}
			const fresh = rowsOf(hash).find((e) => e.key === row.key) ?? row;
			// El último paso: por TorBox (en línea) o por el motor. Si se canceló mientras tanto, no arranca.
			const start = async (player: PlayerKind | null, audio: { code: string; aid: number | null } | null): Promise<boolean> => {
				if (!starting.has(hash)) return false;
				if (torbox) {
					setStatus('Pidiéndole el video a TorBox…');
					await core.playTorbox(side().videoId, hash, player, audio);
				} else await core.play(row.key, player, null, audio);
				setStatus('Cargando…');
				return true;
			};
			if (starting.has(hash)) {
				// El audio ya se eligió en los pasos del video: original o latino (si está confirmado en las pistas).
				const lat = side().flow?.lat;
				started = await play(row.key, btn, fresh, originalAudio(side().meta?.country, side().details?.details?.original_language), subsStep(hash, torbox), start,
					lat === true ? 'lat' : lat === false ? 'original' : null);
			}
		}
	} catch (e) {
		showError(e);
	}
	// Cancelado, error, o ya se estaba viendo (el núcleo no manda evento): se suelta ya.
	const pb = started && [...live.v.playbacks.values()].find((r) => r.key === starting.get(hash) && r.state.kind !== 'paused');
	if (!started || (pb && !PB_STARTING.has(pb.state.kind))) starting.delete(hash);
	btn.disabled = false;
	if (state.update) renderStreamsOnly();
}

/** Suelta el spinner de ▶ cuando esa reproducción arrancó, falló o se cerró. */
export function onPlaybackRow(row: PlaybackRow): void {
	if (PB_STARTING.has(row.state.kind)) return;
	for (const [hash, key] of starting) if (key === row.key) starting.delete(hash);
}

