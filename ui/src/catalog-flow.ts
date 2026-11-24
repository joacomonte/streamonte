// Pasos al elegir un video (2026-11-18): buscando torrents → torrent o TorBox (sin key, directo a torrent) → ¿audio latino? →
// (por torrent) resolución → lista. Por torrent, con latino se confirma leyendo los audios reales mientras se ve la lista: de a
// `SWARM_PARALLEL`, de la mejor candidata a la peor (`toConfirm`), hasta la primera con latino confirmado; "Seguir buscando"
// sigue. Por TorBox no hay paso de calidad: se busca el PRIMER BUEN MATCH (`isMatch`) leyendo pistas de a una, de mejor a peor
// calidad, y se muestra solo ese, con "Seguir buscando" el próximo y "Ver todas las opciones". Las migas vuelven a un paso;
// volver o cambiar de video corta lo que esté analizando. Estado en `side().flow` (uno por video, `newFlow`); la vista la
// dibuja `FlowScreen.svelte` (modelo en `streams-view.ts`).
import { api } from './api.js';
import { t as tr } from './i18n.js';
import { state, view } from './catalog-state.js';
import { failedBefore, flatSorted, hasSpanishSubs, inTorbox, knownSeeds, latOf, latPotential, latToCheck, mbpsOf, openGroup, renderStreamsOnly, rowView, resKey, resLabel, RES_ORDER, rowsOf } from './catalog-options.ts';
import { readTracks } from './catalog-subs.js';
import { quickAnalyze, side, sideOf, startAnalysis, stopTests, unlikely } from './catalog-tests.ts';
import { scanSecs, SWARM_PARALLEL, SWARM_SECS } from './options-logic.ts';
import { latRank } from '$ui/audio.ts';
import type { TileSpec } from '$ui/flow/types.ts';
import { latChips } from '$ui/flow/lat-chips.ts';
import type { ChoiceView, CrumbsView, FlowButton, FlowView, MoreRowView } from './streams-view.ts';
import type { StreamCandidate as Candidate, StreamsUpdate } from './types.js';

export type NetChoice = { key: string; label: string; range: string; mbps: number; tone: string };
/** Búsqueda de pistas en curso (`runScan`). */
export type Scan = { total: number; batch: string[]; done: number; running: boolean; stopped: boolean };
type Step = 'mode' | 'net' | 'lat' | 'res' | 'list';
/** `lat`: null = no se preguntó; `latOff`: sacó el filtro de latino ("Quitar filtros"); `scanned`: hashes cuyas pistas ya se
 *  intentaron leer. TorBox: `found`, los buenos matches mostrados (en orden); `all`: pidió "Ver todas las opciones". */
export type Flow = {
	step: Step;
	mode: 'torbox' | 'torrent' | null;
	net: NetChoice | null;
	lat: boolean | null;
	latOff: boolean;
	scan: Scan | null;
	scanned: Set<string>;
	found: string[];
	all: boolean;
	spain: boolean;
};
export const newFlow = (): Flow => ({ step: 'mode', mode: null, net: null, lat: null, latOff: false, scan: null, scanned: new Set(), found: [], all: false, spain: false });
const flow = (): Flow | undefined => sideOf()?.flow;
/** El flujo del video abierto (donde no puede faltar). */
const flowNow = (): Flow => side().flow;
/** La última lista de torrents del video abierto (donde no puede faltar). */
const update = (): StreamsUpdate => state.update as StreamsUpdate;

/** Conexión donde se va a ver por TorBox: la elige el usuario en cada video y pone el tope de bitrate del buen match; "¿Se
 *  cortó?" baja un nivel. `mbps`: lo más que se le pide al video. */
const NET: NetChoice[] = [
	{ key: 'terrible', label: tr('Muy baja'), range: tr('Menos de 8 Mbps o señal que se corta: busco una muy liviana'), mbps: 4, tone: 'red' },
	{ key: 'low', label: tr('Baja'), range: tr('8 a 25 Mbps, o la tele en wifi 2.4 GHz'), mbps: 10, tone: 'amber' },
	{ key: 'normal', label: tr('Normal'), range: tr('25 a 100 Mbps'), mbps: 25, tone: 'accent-fg' },
	{ key: 'high', label: tr('Alta'), range: tr('Más de 100 Mbps, en wifi 5 GHz o por cable'), mbps: Infinity, tone: 'green' },
];
const net = (): NetChoice | null => flow()?.net ?? null;
/** ¿Entra en la conexión elegida? Sin peso no se sabe cuánto pide: no entra (no puede ser el buen match). */
export const fitsNet = (c: Candidate): boolean => c.size_bytes != null && mbpsOf(c) <= (net()?.mbps ?? Infinity);
function setNet(n: NetChoice): void {
	const f = flowNow();
	Object.assign(f, { net: n, found: [], all: false });
	f.scanned.clear();
}
/** ¿Se pregunta la resolución? Solo por torrent: en TorBox se busca el mejor match entre todas las calidades. */
export const hasResStep = (): boolean => flow()?.mode !== 'torbox';

/** ¿Ya se puede elegir? La lista de todas las fuentes y, con key de TorBox, cuáles tiene listas. */
function ready(): boolean {
	const u = state.update;
	if (!u?.done || view.torboxKey === null) return false;
	return !view.torboxKey || side().torbox === 'done' || side().torbox === 'error';
}
/** Lo que entra según el modo (TorBox: solo las que tiene listas); las que ya fallaron, al final (orden estable). */
const pool = (): Candidate[] =>
	(state.update?.candidates ?? [])
		.filter((c) => flow()?.mode !== 'torbox' || inTorbox.has(c.info_hash))
		.sort((a, b) => Number(failedBefore.has(a.info_hash)) - Number(failedBefore.has(b.info_hash)));
/** Donde se busca latino: el modo y, con paso de resolución, la calidad abierta. */
const scope = (): Candidate[] => pool().filter((c) => !hasResStep() || !view.openRes || resKey(c) === view.openRes);
/** Potencial de latino: la regla vive en catalog-options.ts (función: `= latPotential` falla en dev por el ciclo de imports). */
const hasPotential = (c: Candidate): boolean => latPotential(c);
/** Única regla de "buen match" en TorBox: pidiendo latino, latino confirmado en sus pistas; con audio original, subtítulos en
 *  español nativos. De cine, nunca. */
export const isMatch = (c: Candidate): boolean =>
	c.source !== 'CAM' && !failedBefore.has(c.info_hash) && (flow()?.lat ? latOf(c) === 'lat' : hasSpanishSubs(c.info_hash) === true);
/** Filtro de la lista por el flujo (lo usa `passesFilters`): modo y, si pidió latino, solo las con potencial. */
export function flowFilter(c: Candidate): boolean {
	const f = flow();
	if (!f) return true;
	return (f.mode !== 'torbox' || inTorbox.has(c.info_hash)) && (!f.lat || f.latOff || hasPotential(c));
}

const tracksRead = (h: string): boolean => rowsOf(h).some((e) => !!e.live?.audio?.length);
/** Con salud para leer sus pistas: por TorBox todas; por torrent, con seeds y no muerta. */
const healthy = (c: Candidate): boolean => flow()?.mode === 'torbox' || (!unlikely(c) && (knownSeeds(c) ?? 0) > 0);
const byPotential = (a: Candidate, b: Candidate): number => (knownSeeds(b) ?? -1) - (knownSeeds(a) ?? -1) || (b.size_bytes ?? 0) - (a.size_bytes ?? 0);
/** Grupo de candidata a latino: 0 web latina, 1 español sin aclarar (MULTI / Dual / español). */
const latTier = (c: Candidate): number => (latOf(c) === 'likely' ? 0 : 1);
/** Candidatas a leer (única regla): sin leer, con salud y que puedan ser lo pedido. TorBox: de mejor a peor calidad, como la lista (pidiendo latino, antes por señal: `latFirst`).
 *  Torrent: por grupo (`latTier`), mejor resolución y seeds, así la primera confirmada es la mejor. */
function toConfirm(cands: Candidate[], lat: boolean | null = flowNow().lat): Candidate[] {
	const f = flowNow();
	const pending = cands.filter(
		(c) => !f.scanned.has(c.info_hash) && !tracksRead(c.info_hash) && healthy(c) && (lat ? latToCheck(c) : hasSpanishSubs(c.info_hash) == null),
	);
	if (f.mode === 'torbox') return latFirst(flatSorted(pending.filter(fitsNet)));
	return pending.sort(byPotential).sort((a, b) => latTier(a) - latTier(b) || RES_ORDER.indexOf(resKey(a)) - RES_ORDER.indexOf(resKey(b)));
}
/** De donde sale el buen match en TorBox: las que entran en la conexión, de mejor a peor (con latino, solo las con potencial). */
const ranked = (): Candidate[] => latFirst(flatSorted(pool().filter((c) => flowFilter(c) && fitsNet(c))));
/** TorBox pidiendo latino: por señal de latino (regla `latRank`) y, dentro de cada grupo, el orden de calidad que trae. */
function latFirst(cands: Candidate[]): Candidate[] {
	return flowNow().lat ? [...cands].sort((a, b) => latRank(latOf(a)) - latRank(latOf(b))) : cands;
}
/** TorBox: el próximo buen match no mostrado, si viene antes (en calidad) que la próxima candidata sin leer; si no, null. */
function nextMatch(): Candidate | null {
	const f = flowNow();
	const pending = new Set(toConfirm(pool()).map((c) => c.info_hash));
	const first = ranked().find((c) => pending.has(c.info_hash) || (isMatch(c) && !f.found.includes(c.info_hash)));
	return first && !pending.has(first.info_hash) ? first : null;
}
/** "~40 s" / "~3 min" para leer las pistas de `n`. */
function eta(n: number): string {
	const secs = scanSecs(n, flow()?.mode === 'torbox');
	return secs < 60 ? `~${Math.max(10, Math.round(secs / 10) * 10)} s` : tr('~{a} min', { a: Math.round(secs / 60) });
}

/** Lee las candidatas de `scope`, en orden, hasta el próximo buen match. TorBox: de a una, y para en el primer match nuevo.
 *  Torrent (latino): con el análisis rápido del núcleo, de a `SWARM_PARALLEL`, y para en la primera tanda con latino confirmado.
 *  También para al agotarlas o al cortarla; las que se pasan del tiempo quedan como revisadas. */
async function runScan(): Promise<void> {
	const f = flowNow();
	const tb = f.mode === 'torbox';
	const total = toConfirm(scope()).length;
	if (!total && !(tb && nextMatch())) return renderStreamsOnly();
	const scan: Scan = (f.scan = { total, batch: [], done: 0, running: true, stopped: false });
	renderStreamsOnly();
	const alive = (): boolean => flow() === f && f.scan === scan && !scan.stopped;
	while (alive()) {
		const match = tb && nextMatch();
		if (match) {
			f.found.push(match.info_hash);
			break;
		}
		const batch = (scan.batch = toConfirm(scope())
			.slice(0, tb ? 1 : SWARM_PARALLEL)
			.map((c) => c.info_hash));
		if (!batch.length) break;
		batch.forEach((h) => f.scanned.add(h));
		if (tb) await readTracks(batch[0], true);
		else {
			void quickAnalyze(batch);
			const end = Date.now() + (SWARM_SECS + 30) * 1000;
			while (alive() && Date.now() < end && !batch.every(tracksRead)) {
				await new Promise((r) => setTimeout(r, 1000));
				renderStreamsOnly();
			}
		}
		scan.done += batch.length;
		if (flow() === f) renderStreamsOnly();
		if (!tb && batch.some((h) => { const c = update().candidates.find((x) => x.info_hash === h); return !!c && latOf(c) === 'lat'; })) break;
	}
	if (f.scan === scan) scan.running = false;
	if (flow() === f) renderStreamsOnly();
}
/** Pidiendo latino, al llegar a la lista: busca salvo que ya haya una confirmada (de una lectura anterior). */
function autoScan(): void {
	if (flowNow().lat && !scope().some((c) => latOf(c) === 'lat')) void runScan();
	else renderStreamsOnly();
}
/** Corta la búsqueda en curso (lo ya leído queda; lo que no llegó a leerse vuelve a ser candidata). */
function stopScan(): void {
	const f = flow();
	const s = f?.scan;
	if (!f || !s?.running) return;
	s.stopped = true;
	s.running = false;
	const pending = s.batch.filter((h) => !tracksRead(h));
	pending.forEach((h) => f.scanned.delete(h));
	if (f.mode !== 'torbox') api.analyzerCancel(pending).catch(() => {});
}
/** Al volver a un paso o dejar el video: corta todo lo que esté analizando. */
export function cancelFlowWork(): void {
	stopScan();
	if (sideOf()?.tests?.run) stopTests();
}

function goTo(step: Step): void {
	const f = flowNow();
	cancelFlowWork();
	if (step === 'mode') Object.assign(f, { mode: null, lat: null });
	if (step === 'mode' || step === 'lat' || step === 'net') Object.assign(f, { lat: null, scan: null, found: [], all: false });
	f.latOff = false;
	f.spain = false;
	f.step = step;
	view.openRes = '';
	renderStreamsOnly();
}
async function pickRes(r: string): Promise<void> {
	const f = flowNow();
	f.step = 'list';
	openGroup(r);
	autoScan();
	// Primera vez en esa calidad: la prueba de 30 s ordena por seeds reales; el análisis profundo se ofrece después.
	const t = side().tests;
	if (t.first[r] || side().deep?.res === r) return;
	for (let i = 0; i < 20 && !t.ready; i++) await new Promise((res) => setTimeout(res, 250));
	if (flow() === f && f.step === 'list' && view.openRes === r) startAnalysis(r, false, true);
}

// ---------- vista ----------
const choice = (id: string, tile: TileSpec, tone: string, i: number, title: string, sub: string, onclick: () => void, more: Partial<ChoiceView> = {}): ChoiceView => ({
	id, tile, tone, i, title, sub, onclick, note: null, badge: null, chips: null, disabled: false, primary: false, ...more,
});
const button = (id: string, icon: FlowButton['icon'], text: string, onclick: () => void, more: Partial<FlowButton> = {}): FlowButton => ({
	id, icon, text, onclick, small: null, title: null, count: null, ...more,
});
const ACCENT = 'var(--accent-fg)';
const GREEN = 'var(--green)';
const AMBER = 'var(--amber, #f5a524)';
const MUTED = 'var(--muted)';
const WAVE: TileSpec = { kind: 'wave' };
const screenOf = (title: string | null): { crumbs: CrumbsView | null; title: string | null } => ({ crumbs: crumbs(), title });

/** Migas: lo elegido hasta ahora; tocar una vuelve a ese paso. */
export function crumbs(): CrumbsView | null {
	const f = flow();
	if (!f?.mode) return null;
	const n = net();
	const items: [Step | null, string][] = [];
	if (view.torboxKey && side().torbox === 'done') items.push(['mode', f.mode === 'torbox' ? 'TorBox' : 'Torrent']);
	else items.push([null, 'Torrent']);
	if (f.mode === 'torbox' && n && f.step !== 'net') items.push(['net', tr('Conexión {a}', { a: n.label.toLowerCase() })]);
	if (f.lat != null) items.push(['lat', f.lat ? tr('Audio latino') : tr('Audio original')]);
	if (f.step === 'list' && view.openRes) items.push(['res', resLabel(view.openRes)]);
	return {
		aria: tr('Pasos elegidos'),
		items: items.map(([step, label]) => (step && step !== f.step ? { id: `cat-crumb-${step}`, label, title: tr('Volver a este paso'), onclick: () => goTo(step) } : { id: null, label, onclick: null })),
	};
}

/** El paso actual, o null en la lista (la arma `renderStreamsOnly`). */
export function flowStep(): FlowView | null {
	const f = flow();
	if (!f) return null;
	if (!ready()) return searchScreen();
	// Sin TorBox (sin key o no respondió) no se pregunta: torrent.
	if (f.step === 'mode' && (!view.torboxKey || side().torbox !== 'done')) Object.assign(f, { mode: 'torrent', step: 'lat' });
	if (f.step === 'mode') return modeScreen();
	if (f.step === 'net') return netScreen();
	if (f.step === 'lat') return latScreen();
	if (f.step === 'res') return resScreen();
	// TorBox: buscando el primer match, solo la búsqueda; después, el resultado (o la lista entera si la pidió).
	if (f.mode === 'torbox' && !f.all && f.spain) return spainScreen();
	if (f.mode === 'torbox' && !f.all) return f.scan?.running && !f.found.length ? scanScreen() : matchScreen();
	return null;
}

/** TorBox: mientras no aparezca el primer buen match, solo la búsqueda (el radar lo dibuja `FlowScreen.svelte`). */
function scanScreen(): FlowView {
	const s = flowNow().scan as Scan;
	return {
		kind: 'scan', ...screenOf(null),
		text: tr('Buscando el mejor torrent para vos'),
		frac: s.done / Math.max(1, s.total),
		count: tr('{a} de {n}', { a: Math.min(s.done + 1, s.total), n: s.total }),
		stop: button('cat-flow-stop', 'stop', tr('Detener'), () => { stopScan(); renderStreamsOnly(); }, { title: tr('Detener: muestro las de mejor calidad con lo leído hasta ahora') }),
	};
}

const allButton = (id: string, onclick: () => void): FlowButton => button(id, 'list', tr('Ver todas las opciones'), onclick, { count: String(pool().filter(flowFilter).length) });

/** TorBox, el resultado: solo los buenos matches encontrados. Sin ninguno, las 3 de mejor calidad con el aviso. Al pie, "¿Se
 *  cortó?", "Seguir buscando" y "Ver todas las opciones". */
function matchScreen(): FlowView {
	const f = flowNow();
	const list = ranked();
	const found = f.found.map((h) => list.find((c) => c.info_hash === h)).filter((c): c is Candidate => !!c);
	const searched = !toConfirm(pool()).length;
	const spanish = pool().filter(spanishNotLat);
	// Ninguna entra en la conexión elegida: las 3 mejores igual (marcadas "Puede cortarse"), con el aviso.
	const fitsNone = !list.length;
	const none = fitsNone ? tr('Todas piden más de lo que da tu conexión: mirá "Ver todas" o cambiá la conexión') : tr('Ninguna trae sub ES nativo: los subs se buscan afuera');
	// Sin latino: sin lista ni título; cómo seguir, en tarjetas iguales a las del paso de audio.
	if (f.lat && !found.length && !fitsNone) {
		return {
			kind: 'nolat', ...screenOf(null),
			none: tr('No se encontraron opciones con audio latino'),
			choices: [
				choice('cat-match-original', WAVE, ACCENT, 0, tr('Buscar con audio original'), tr('No encontré latino · busco una con subtítulos en español'), toOriginal),
				choice('cat-match-spain', { kind: 'bubble', text: 'ES' }, AMBER, 1, tr('Español de España'), spanish.length
					? tr(spanish.length === 1 ? '1 opción con español que casi seguro no es latino' : '{n} opciones con español que casi seguro no es latino', { n: spanish.length })
					: tr('Ninguna con español de España'), () => { f.spain = true; renderStreamsOnly(); }, { disabled: !spanish.length }),
				choice('cat-match-all', { kind: 'list' }, MUTED, 2, tr('Ver todas las opciones'), tr('{n} opciones, sin filtros · de mejor a peor calidad', { n: pool().length }),
					() => { Object.assign(f, { all: true, latOff: true }); renderStreamsOnly(); }),
			],
			more: moreRow(),
		};
	}
	const title = found.length ? null : fitsNone ? tr('Ninguna entra en tu conexión') : tr('Sin subtítulos en español adentro');
	const rows = found.length ? found.map((c) => rowView(c, true)) : (fitsNone ? flatSorted(pool().filter(flowFilter)) : list).slice(0, 3).map((c) => rowView(c, false));
	return {
		kind: 'match', ...screenOf(title),
		note: found.length ? null : searched || fitsNone ? none : tr('Búsqueda detenida: estas son las de mejor calidad'),
		rows,
		lighter: lighterButton(),
		more: moreRow(),
		all: allButton('cat-match-all', () => { f.all = true; renderStreamsOnly(); }),
	};
}
/** Español de España (pistas, nombre o web de origen). */
const spanishNotLat = (c: Candidate): boolean => latOf(c) === 'spain';
/** Pidió latino y no hubo: busca de nuevo con audio original (el primer match con subs en español adentro). */
function toOriginal(): void {
	const f = flowNow();
	cancelFlowWork();
	Object.assign(f, { lat: false, found: [], all: false, spain: false, scan: null });
	void runScan();
}
/** Sin latino: las que traen español que no es latino (casi seguro de España), de mejor a peor. */
function spainScreen(): FlowView {
	const f = flowNow();
	return {
		kind: 'spain', ...screenOf(tr('Probablemente español de España')),
		note: tr('Traen audio en español sin decir que es latino (o marcado de España): casi seguro es castellano.'),
		rows: flatSorted(pool().filter(spanishNotLat)).map((c) => rowView(c, false)),
		original: button('cat-spain-original', 'speaker', tr('Buscar con audio original'), toOriginal, { small: tr('Con subtítulos en español'), title: tr('Busco de nuevo la primera que traiga subtítulos en español adentro') }),
		all: allButton('cat-spain-all', () => { Object.assign(f, { spain: false, all: true, latOff: true }); renderStreamsOnly(); }),
	};
}
/** "¿Se cortó?": baja un nivel de conexión y busca de nuevo con el tope nuevo (en la más baja no aparece). */
function lighterButton(): FlowButton | null {
	const n = net();
	const i = n ? NET.indexOf(n) : -1;
	if (i <= 0) return null;
	const lower = NET[i - 1];
	return button('cat-lighter', 'gauge', tr('¿Se cortó? Una más liviana'), () => { cancelFlowWork(); setNet(lower); void runScan(); }, {
		title: tr('Paso a conexión {a} ({range}) y busco de nuevo', { a: lower.label.toLowerCase(), range: lower.range }),
	});
}

/** TorBox: cómo es la conexión donde se va a ver (cada vez; se cambia desde la miga). La más rápida arriba. */
function netScreen(): FlowView {
	const f = flowNow();
	const cur = net();
	return {
		kind: 'choices', ...screenOf(tr('¿Cómo es tu internet donde lo vas a ver?')),
		choices: [...NET].reverse().map((n, i) => choice(`cat-flow-net-${n.key}`, { kind: 'net', level: (NET.indexOf(n) + 1) as 1 | 2 | 3 | 4 }, `var(--${n.tone})`, i, n.label, n.range, () => { setNet(n); f.step = 'lat'; renderStreamsOnly(); }, { primary: cur?.key === n.key })),
	};
}

function searchScreen(): FlowView {
	const u = state.update;
	const ok = u ? u.addons.filter((a) => a.state !== 'pending').length : 0;
	const sub = !u?.done
		? tr('{ok} de {a} fuentes respondieron{b}', { ok, a: u?.addons.length ?? '…', b: u?.candidates.length ? tr(' · {n} torrents hasta ahora', { n: u.candidates.length }) : '' })
		: tr('{n} torrents · viendo cuáles están listos en TorBox…', { n: u.candidates.length });
	// Respondieron / total mientras busca; 1 al ver TorBox (ya respondieron todas); null si no se sabe el total.
	const frac = !u?.addons.length ? null : u.done ? 1 : ok / u.addons.length;
	return { kind: 'search', title: tr('Buscando torrents…'), sub, frac };
}

function modeScreen(): FlowView {
	const f = flowNow();
	const all = update().candidates.length;
	const tb = update().candidates.filter((c) => inTorbox.has(c.info_hash)).length;
	const go = (mode: 'torbox' | 'torrent') => (): void => { Object.assign(f, { mode, step: mode === 'torbox' ? 'net' : 'lat' }); renderStreamsOnly(); };
	return {
		kind: 'choices', ...screenOf(tr('¿Cómo lo querés ver?')),
		choices: [
			choice('cat-flow-torbox', { kind: 'icon', icon: 'play' }, ACCENT, 0, tr('Por TorBox'), tb ? tr('{tb} {a} en sus servidores: arranca al instante y no depende de los seeds', { tb, a: tb === 1 ? tr('lista') : tr('listas') }) : tr('No hay torrents en TorBox para esto'),
				go('torbox'), { badge: tb ? tr('Al instante') : null, disabled: !tb, primary: !!tb }),
			choice('cat-flow-torrent', { kind: 'icon', icon: 'peers' }, MUTED, 1, tr('Por torrent'), tr('{all} torrents de otras personas (P2P): la velocidad depende de cuántos lo comparten', { all }), go('torrent')),
		],
	};
}

function latScreen(): FlowView {
	const f = flowNow();
	const p = pool();
	const potential = p.filter(hasPotential);
	const none = !potential.length;
	const named = potential.filter((c) => latOf(c) === 'lat').length;
	const doubtful = potential.length - named;
	const left = toConfirm(p, true).length;
	// Variante A (docs/mockups/audio-latino): chips en vez de texto; el detalle queda en el `title` de cada uno.
	const how = f.mode === 'torbox' ? tr('de a una, de mejor a peor calidad') : tr('de a {SWARM_PARALLEL}, en la calidad que elijas', { SWARM_PARALLEL });
	const yesChips = latChips(named, doubtful, left > 0, tr('Las reviso {how} hasta encontrar latino', { how }));
	const yesSub = none ? tr('No hay torrents con audio latino') : yesChips.map((c) => c.title ?? c.text).join(' · ');
	// Por torrent se elige la calidad (y la búsqueda de latino arranca ahí, `pickRes`); por TorBox se busca ya el mejor match.
	const pick = (lat: boolean) => (): void => {
		Object.assign(f, { lat, step: hasResStep() ? 'res' : 'list' });
		view.openRes = '';
		if (hasResStep()) renderStreamsOnly();
		else void runScan();
	};
	const origSub = f.mode === 'torbox' ? tr('Con subtítulos en español') : tr('El idioma en que se filmó');
	return {
		kind: 'choices', ...screenOf(tr('¿Necesitás audio latino?')),
		choices: [
			choice('cat-flow-lat-no', WAVE, ACCENT, 0, tr('Audio original'), origSub, pick(false)),
			// El latino suele venir en releases más livianos: que no sorprenda no encontrarlo en 4K.
			choice('cat-flow-lat-yes', { kind: 'bubble', text: 'LAT' }, GREEN, 1, tr('Audio latino'), yesSub, pick(true), { chips: none ? null : yesChips, disabled: none }),
		],
	};
}

/** Al pie de lo que se ve (por TorBox siempre; por torrent, pidiendo latino): la búsqueda en curso (con Detener), "Seguir
 *  buscando" la próxima o, revisadas todas, que no hay más para buscar. */
export function moreRow(): MoreRowView | null {
	const f = flow();
	const tb = f?.mode === 'torbox';
	if (!f || (!tb && !f.lat) || f.latOff) return null;
	const what = f.lat ? tr('latino') : tr('sub ES');
	const s = f.scan;
	if (s?.running) {
		return { kind: 'running', text: tr('Leyendo pistas para encontrar {what} · {done} de {total}', { what, done: s.done, total: s.total }), stop: tr('Detener'), onstop: () => { stopScan(); renderStreamsOnly(); } };
	}
	const left = toConfirm(scope()).length;
	const step = tb ? 1 : SWARM_PARALLEL;
	// TorBox: también hay "más" si queda un match ya sabido (p. ej. un .srt en español) sin mostrar.
	if (!left && !(tb && nextMatch())) {
		if (!f.scanned.size) return null;
		const found = tb ? f.found.length > 0 : scope().some((c) => latOf(c) === 'lat');
		return {
			kind: 'done', found,
			text: tb ? tr('No hay más para buscar.') : found ? tr('Revisé todas: no hay más para buscar.') : tr('No encontré latino confirmado en sus pistas: quedan las que lo dicen en el nombre.'),
		};
	}
	return {
		kind: 'more',
		title: tr('Seguir buscando {what}', { what }),
		small: left ? tr('{left} {a} · {b} cada {c}', { left, a: left === 1 ? tr('candidata queda') : tr('candidatas quedan'), b: eta(step), c: step === 1 ? tr('una') : step }) : null,
		onclick: () => void runScan(),
	};
}

function resScreen(): FlowView {
	const f = flowNow();
	const p = pool();
	const choices: ChoiceView[] = [];
	for (const r of RES_ORDER) {
		const all = p.filter((c) => resKey(c) === r);
		if (!all.length) continue;
		const n = all.length;
		const lat = all.filter(hasPotential).length;
		const real = all.filter((c) => latOf(c) === 'lat').length;
		const named = all.filter((c) => latOf(c) === 'likely').length;
		const doubtful = lat - real - named;
		const unit = n === 1 ? 'torrent' : 'torrents';
		// Lo dudoso (MULTI / Dual / español sin aclarar) no se cuenta como latino.
		const sub = !f.lat
			? `${n} ${unit}`
			: lat
				? [real && tr('{real} con latino confirmado', { real }), named && tr(named === 1 ? '{n} probablemente latina' : '{n} probablemente latinas', { n: named }), doubtful && tr(doubtful === 1 ? '{n} dudosa' : '{n} dudosas', { n: doubtful })]
						.filter((x): x is string => typeof x === 'string')
						.join(' · ') + tr(' de {n}', { n })
				: tr('Ninguna con latino de {n}', { n });
		// Pidiendo latino, la calidad sin ninguno va en gris.
		choices.push(choice(`cat-flow-res-${r}`, { kind: 'icon', icon: 'monitor' }, f.lat && !lat ? MUTED : ACCENT, choices.length, resLabel(r), sub, () => void pickRes(r)));
	}
	return { kind: 'choices', ...screenOf(tr('Elegí la calidad')), choices };
}
