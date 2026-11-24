// Pruebas de conexión del catálogo (2026-11-17): estado por torrent (rápida y a fondo, etapas), el embudo prueba rápida →
// análisis profundo, el modo "Elegí la mejor" y dejar pruebas de fondo al cambiar de video. El estado vive acá (módulo), no en
// los componentes: sobrevive a cerrar la ficha. Reglas puras en `options-logic.ts`.
import * as core from './core.ts';
import { setStatus } from './dom.ts';
import { t as tr } from './i18n.ts';
import { currentNetwork } from './health-store.ts';
import { bgLoads, groupsOf, health, inScope, isSafeBest, knownSeeds, lowerRes, openGroup, renderStreamsOnly, RES_ORDER, resLabel, scheduleRender, sortOptions, startBg } from './catalog-options.ts';
import { cancelFlowWork, type Flow } from './catalog-flow.ts';
import { safeGet, safeSet, showError, state, type Side } from './catalog-state.ts';
import { etaSecs, isUnlikely, learned, quickGroupOf, seedsOf, topFinalists, type Count } from './options-logic.ts';
import type { CoreEvent, StreamCandidate as Candidate } from './types.ts';

export { QUICK_ENOUGH } from './options-logic.ts';
export type { Count } from './options-logic.ts';
/** Análisis en curso de una resolución. */
export type Run = { res: string; best: boolean; stage: 'quick' | 'deep'; at: number; prev?: string | null; quickOnly?: boolean };
/** Resultado de "bajar la mejor al terminar". */
export type AutoResult = { step: 'done' | 'none'; res: string | null; text: string };
/** Estado de las pruebas de un video (`state.side.tests`): `once` = lo que se hace una vez por video (censo, tests guardados,
 *  timers del panel); `ready` = ya se cargaron los tests guardados de la última hora; `first[res]` = la primera tanda de la
 *  prueba rápida; `run` = el análisis en curso (uno solo a la vez en toda la app); `auto` = cómo terminó "bajar la mejor";
 *  `stopping`, `tick` y `lastLine` los usa el panel (`groupPanel`). */
export type VideoTests = {
	once: Set<string>;
	ready: boolean;
	first: Record<string, { hashes: string[]; at: number }>;
	run: Run | null;
	auto: AutoResult | null;
	stopping?: { res: string } | null;
	tick?: ReturnType<typeof setTimeout> | null;
	lastLine?: string;
};
/** Análisis profundo de la resolución abierta (`state.side.deep`). `single`: se está contando un torrent suelto; `after`: el estado al que vuelve. */
export type Deep = {
	status: null | 'run' | 'done';
	hashes: string[];
	res?: string | null;
	single?: boolean;
	after?: null | 'run' | 'done';
	stopped?: boolean;
	lastDone?: number;
	lastAt?: number;
};
/** El panel con lo que le suma `loadStreams` por video (siempre presente con un video abierto). */
export type LoadedSide = Side & { videoId: string; tests: VideoTests; deep: Deep; flow: Flow; torbox: null | 'checking' | 'done' | 'error' };

/** `state.side` como `LoadedSide` (null sin panel abierto). */
export const sideOf = (): LoadedSide | null => state.side as LoadedSide | null;
/** Igual, sin null: para código que solo corre con un video abierto (si no, falla igual que antes). */
export const side = (): LoadedSide => state.side as LoadedSide;

export const newVideoTests = (): VideoTests => ({ once: new Set(), ready: false, first: {}, run: null, auto: null });
/** true la primera vez que se pide `key` en ese video. */
export function once(t: VideoTests, key: string): boolean {
	if (t.once.has(key)) return false;
	t.once.add(key);
	return true;
}
/** Los testeados en la última hora (datos guardados) no se repiten; recién con eso se prueba. */
export async function loadSavedTests(video: string, cands: Candidate[]): Promise<void> {
	const saved = await core.catalogSwarmSaved(cands.map((c) => c.info_hash)).catch(() => ({}));
	if (sideOf()?.videoId !== video) return;
	for (const [h, t] of Object.entries(saved)) {
		if (!counted.has(h) && !counting.has(h)) {
			counted.set(h, t.count);
			testedAt.set(h, t.at);
		}
	}
	side().tests.ready = true;
	renderStreamsOnly();
}

/** Arranca el análisis de una resolución. Nunca dos a la vez: corta el que haya en curso y empieza en esta. */
export function startAnalysis(res: string, best = false, quickOnly = false): void {
	stopTests();
	if (quickOnly) void quickList(res);
	else void analyze(res, best);
}
/** "Ver lista": solo la primera tanda de la prueba rápida (~30 s) y la lista ordenada por seeds reales. */
async function quickList(res: string): Promise<void> {
	const video = sideOf()?.videoId;
	const t = side().tests;
	const run: Run = (t.run = { res, best: false, quickOnly: true, stage: 'quick', at: Date.now() });
	openGroup(res);
	void runQuick(video, res);
	await waitUntil(() => t.run !== run || sideOf()?.videoId !== video || quickFirstDone(res));
	if (t.run === run) {
		t.run = null;
		renderStreamsOnly();
	}
}
/** "Bajar la mejor al terminar": se prende o apaga mientras corre el análisis. */
export function toggleBest(): void {
	const run = sideOf()?.tests?.run;
	if (!run) return;
	run.best = !run.best;
	renderStreamsOnly();
}

/** El análisis de una resolución: prueba rápida de todas → apenas termina su primera tanda, análisis profundo de las mejores.
 *  Con `best` además deja bajando de fondo la primera que ande sin cortes (`isSafeBest`); si en esa calidad no hay, sigue con
 *  la más baja siguiente (hasta 720p) y, si en ninguna hay, avisa. Se corta con `stopTests`. */
async function analyze(start: string, best: boolean): Promise<void> {
	const video = sideOf()?.videoId;
	const t = side().tests;
	const run: Run = (t.run = { res: start, best, stage: 'quick', prev: null, at: Date.now() });
	const alive = (): boolean => t.run === run && sideOf()?.videoId === video;
	t.auto = null;
	let res: string | null = start;
	while (res) {
		const r: string = res;
		Object.assign(run, { res: r, stage: 'quick', at: Date.now() });
		openGroup(r);
		void runQuick(video, r);
		await waitUntil(() => !alive() || quickFirstDone(r));
		if (!alive()) return;
		learnEta('quick', (Date.now() - run.at) / 1000);
		Object.assign(run, { stage: 'deep', at: Date.now() });
		renderStreamsOnly();
		await runDeep(video, r);
		if (!alive()) return;
		const batches = Math.ceil((side().deep.hashes?.length ?? 0) / DEEP_BATCH);
		if (batches) learnEta('deepBatch', (Date.now() - run.at) / 1000 / batches);
		if (!run.best) break;
		const pick = sortOptions(groupsOf().get(r) ?? []).list.find(isSafeBest);
		if (pick) {
			try {
				if (!bgLoads.has(pick.info_hash)) await startBg(pick.info_hash);
				t.auto = { step: 'done', res: r, text: tr('elegí una de {a} que anda sin cortes y ya la estoy descargando de fondo. Dale play cuando quieras.', { a: resLabel(r) }) };
			} catch (e) {
				showError(e);
				t.auto = { step: 'none', res: r, text: tr('encontré una buena pero no pude empezar a bajarla. Probá con ▶ en la primera de la lista.') };
			}
			break;
		}
		run.prev = r;
		const lower = lowerRes(r);
		res = lower && RES_ORDER.indexOf(lower) <= RES_ORDER.indexOf('720p') ? lower : null;
		if (!res) t.auto = { step: 'none', res: run.prev, text: tr('no encontré ninguna que ande sin cortes. Arriba de la lista quedó la mejor candidata: podés probarla igual o volver más tarde.') };
	}
	if (t.run === run) t.run = null;
	renderStreamsOnly();
}

/** Hashes cortados por "Detener": al volver sin resultado no cuentan como "nadie respondió". */
export const stopped = new Set<string>();
/** "Detener": corta todo lo que esté probando (rápida y profunda, de cualquier video); lo ya probado queda. */
export function stopTests(): void {
	const t = sideOf()?.tests;
	// "Deteniendo…" mientras el núcleo corta las conexiones (tarda unos segundos): ver `groupPanel`.
	if (t?.run) t.stopping = { res: t.run.res };
	if (t) t.run = null;
	const d = sideOf()?.deep;
	if (d?.status === 'run') d.stopped = true;
	counting.forEach((h) => stopped.add(h));
	quickRunning.clear();
	quickLive.clear();
	if (counting.size || t) core.catalogStopSwarm().catch(showError);
	renderStreamsOnly();
}
const waitUntil = async (ok: () => boolean): Promise<void> => {
	while (!ok()) await new Promise((r) => setTimeout(r, 500));
};

/** Al dejar un video: se corta todo lo que esté analizando (pruebas y búsqueda de latino); lo ya probado queda guardado. */
export function leaveTests(): void {
	if (!state.side) return;
	cancelFlowWork();
	if (counting.size || quickRunning.size) stopTests();
	if (side().tests) side().tests.auto = null;
	counting.clear();
}

/** Testeados (conectándose al enjambre): hash → conteo. Incluye los de la última hora que guarda el núcleo. */
export const counted = new Map<string, Count>();
/** Cuándo se testeó cada uno (ISO), para el tooltip. */
export const testedAt = new Map<string, string>();
/** Censo DHT sin conectarse (spec 07): hash → direcciones únicas. Solo informa y rescata a los 0/0 de "muerto". */
export const census = new Map<string, number>();
export const CENSUS_MAX = 40;
export async function runCensus(video: string, cands: Candidate[]): Promise<void> {
	const hashes = [...cands]
		.sort((a, b) => (seedsOf(b) ?? -1) - (seedsOf(a) ?? -1))
		.slice(0, CENSUS_MAX)
		.map((c) => c.info_hash);
	try {
		const res = await core.catalogCensus(hashes);
		// Mapa vacío = cortado o sin DHT: no se sabe nada (no es "0 en todos").
		if (sideOf()?.videoId !== video || !Object.keys(res).length) return;
		hashes.forEach((h) => census.set(h, res[h] ?? 0));
		renderStreamsOnly();
	} catch (e) {
		showError(e);
	}
}
/** Hashes con un recuento en curso: el spinner sobrevive a los redibujos (varios a la vez). */
export const counting = new Set<string>();
/** Conteo parcial de los que están contando (evento `catalog-swarm-progress`). */
export const liveCount = new Map<string, Count>();
/** Prueba rápida (embudo paso 1): ≤ 30 s por opción (`swarm::Depth::Quick`), hasta `QUICK_ENOUGH` seeds reales. */
export const quick = new Map<string, Count>();
export const quickRunning = new Set<string>();
/** En vivo mientras prueba (evento `catalog-swarm-progress` rápido). */
export const quickLive = new Map<string, Count>();
/** Etapa de cada prueba en curso y desde cuándo: cada etapa tiene su barra, que arranca de cero al pasar a la siguiente. */
export const phaseAt = new Map<string, { reached: boolean; t: number }>();
export function notePhase(hash: string, count: Count): void {
	const p = phaseAt.get(hash);
	if (!p || p.reached !== count.reached) phaseAt.set(hash, { reached: count.reached, t: Date.now() });
}
/** Primera tanda de la prueba rápida = las que el núcleo prueba a la vez (`Depth::Quick`). */
export const QUICK_BATCH = 30;
/** A `QUICK_LATE_MS` la primera tanda se da por terminada (las rezagadas siguen de fondo). */
export const QUICK_LATE_MS = 45_000;
/** ¿Terminó la primera tanda de ese grupo? Con eso ya se ofrece el test profundo. */
export function quickFirstDone(res: string): boolean {
	const first = sideOf()?.tests?.first[res];
	return !first || first.hashes.every((h) => quick.has(h) || counted.has(h) || !quickRunning.has(h)) || Date.now() - first.at > QUICK_LATE_MS;
}
/** Del grupo: probándose todavía, y ya probadas con gente real (3+) que el test profundo no vio. */
export function quickPending(res: string): { running: number; potential: number } {
	const inRes = (state.update?.candidates ?? []).filter((c) => inScope(c, res));
	return {
		running: inRes.filter((c) => quickRunning.has(c.info_hash) && !quick.has(c.info_hash)).length,
		potential: inRes.filter((c) => !counted.has(c.info_hash) && !counting.has(c.info_hash) && quickGroup(c) <= 1).length,
	};
}
/** Grupo por la prueba rápida (regla en `options-logic.ts`). Solo baja opciones: no las saca de la lista. */
export const quickGroup = (c: { info_hash: string }): number => quickGroupOf(counted.has(c.info_hash), quick.get(c.info_hash));
/** Mejores primero para el test profundo: prueba rápida y después seeds (reales si hay). */
export const byQuick = (a: Candidate, b: Candidate): number => quickGroup(a) - quickGroup(b) || (knownSeeds(b) ?? -1) - (knownSeeds(a) ?? -1);
/** Prueba rápida de las opciones de esa resolución sin dato real. Antes de `ready` no: repetiría los de la última hora. */
export async function runQuick(video: string | null | undefined, res: string): Promise<void> {
	const t = sideOf()?.tests;
	if (!t?.ready || !res || side().videoId !== video) return;
	// Las de mejor pinta según los trackers primero: el núcleo las prueba en ese orden (primera tanda).
	const hashes = (state.update?.candidates ?? [])
		.filter((c) => inScope(c, res))
		.filter((c) => !counted.has(c.info_hash) && !counting.has(c.info_hash) && !quick.has(c.info_hash) && !quickRunning.has(c.info_hash))
		.sort((a, b) => (seedsOf(b) ?? -1) - (seedsOf(a) ?? -1))
		.map((c) => c.info_hash);
	if (!hashes.length) return;
	// Solo una tanda, las de mejor pinta: nada sigue probándose de fondo después, así la lista queda quieta.
	hashes.splice(QUICK_BATCH);
	t.first[res] = { hashes, at: Date.now() };
	hashes.forEach((h) => quickRunning.add(h));
	renderStreamsOnly();
	try {
		await core.catalogSwarm(hashes, 'quick'); // cada resultado llega antes por `catalog-swarm-counted`
	} catch {
		/* sin prueba rápida queda el orden por trackers */
	} finally {
		hashes.forEach((h) => {
			quickRunning.delete(h);
			quickLive.delete(h);
			if (!counting.has(h)) phaseAt.delete(h);
		});
		if (sideOf()?.videoId === video) renderStreamsOnly();
	}
}
/** Análisis profundo de esas opciones: se conecta a cada enjambre y cuenta los seeders reales. */
export async function countSeeds(hashes: string[]): Promise<void> {
	const todo = hashes.filter((h) => !counting.has(h));
	if (!todo.length) return;
	todo.forEach((h) => counting.add(h)); // la barra arranca con su primer progreso (antes espera lugar)
	renderStreamsOnly();
	const video = sideOf()?.videoId;
	try {
		const found = await core.catalogSwarm(todo, 'deep');
		if (sideOf()?.videoId !== video) return; // se fue de ese video: el resultado no se usa
		// Sin resultado = nadie dio los metadatos a tiempo: "nadie respondió" (no el número inflado de los trackers).
		// Detenido por el usuario: lo que no llegó a contarse queda sin contar.
		for (const h of todo) {
			if (found[h] || !stopped.has(h)) {
				counted.set(h, found[h] ?? { seeds: 0, peers: 0, reached: false });
				testedAt.set(h, new Date().toISOString());
			}
			deepDone.add(h);
			stopped.delete(h);
		}
		logCensus(todo);
		if (todo.length === 1 && !found[todo[0]]) setStatus(tr('No se pudo contar ese torrent: nadie respondió a tiempo.'));
	} catch (e) {
		showError(e);
	} finally {
		todo.forEach((h) => {
			counting.delete(h);
			liveCount.delete(h);
			phaseAt.delete(h);
		});
		const d = sideOf()?.deep;
		if (d?.single && !counting.size) Object.assign(d, { status: d.after, single: false, hashes: [] });
		renderStreamsOnly();
	}
}

/** Log local para el experimento del spec 07 (`streamonte.census-log`, máx. 300 filas, la más nueva primero). */
export function logCensus(hashes: string[]): void {
	try {
		const rows = hashes.map((hash) => {
			const c = state.update?.candidates.find((x) => x.info_hash === hash);
			const n = counted.get(hash);
			return {
				at: new Date().toISOString(), network: currentNetwork(), hash, res: c?.resolution ?? null, trackerSeeds: c ? seedsOf(c) : null,
				trackerLeechers: c?.leechers ?? null, completed: c?.completed ?? null, census: census.get(hash) ?? null,
				seeds: n?.seeds ?? null, peers: n?.peers ?? null, known: n?.known ?? null, level: c ? (health(c)?.level ?? null) : null,
			};
		});
		const old: unknown = JSON.parse(safeGet('streamonte.census-log') ?? '[]');
		safeSet('streamonte.census-log', JSON.stringify([...rows, ...(Array.isArray(old) ? old : [])].slice(0, 300)));
	} catch {
		/* el log es opcional */
	}
}

/** Etapa 2 del embudo: cuántos se cuentan a fondo (el núcleo cuenta `DEEP_BATCH` a la vez: dos tandas). */
export const TOP = 15;
/** Cuánto tarda el análisis, aprendido de los anteriores en esta compu (promedio móvil). */
const ETA_KEY = 'streamonte.analysis-eta';
const DEEP_BATCH = 10;
function etaStats(): Record<string, number> {
	try {
		const v: unknown = JSON.parse(safeGet(ETA_KEY) ?? '{}');
		return v && typeof v === 'object' ? (v as Record<string, number>) : {};
	} catch {
		return {};
	}
}
function learnEta(field: 'quick' | 'deepBatch', secs: number): void {
	const s = etaStats();
	s[field] = learned(s[field], secs);
	safeSet(ETA_KEY, JSON.stringify(s));
}
/** "~3 min" para analizar `n` opciones (sin dato todavía, como si fueran muchas). */
export const analysisEta = (n = TOP): string => tr('~{a} min', { a: Math.max(1, Math.round(etaSecs(etaStats(), n, TOP, DEEP_BATCH) / 60)) });
/** Finalistas que además reciben el análisis rápido (metadatos, duración, idiomas). */
export const FINALISTS = 8;
export const finalists = (cands: Candidate[]): string[] => topFinalists(cands, counted, FINALISTS);
/** Hashes de la etapa en curso que ya respondieron (evento `catalog-swarm-counted`). */
export const deepDone = new Set<string>();
/** Salteados por el análisis, hash → por qué: 'dead' = casi seguro muerto; 'rest' = fuera de los `TOP`. */
export const skipped = new Map<string, 'dead' | 'rest'>();
export const unlikely = (c: Candidate): boolean => isUnlikely(c, census.get(c.info_hash));
/** Análisis profundo desde cero de esas opciones (borra lo contado antes). Una sola: se cuenta ya; varias: el embudo de `runDeep`. */
export function reanalyze(hashes: string[], res: string | null = null): void {
	const video = sideOf()?.videoId;
	if (hashes.length === 1) void quickAnalyze(hashes);
	hashes.forEach((h) => {
		counted.delete(h);
		if (hashes.length === 1) skipped.delete(h);
	});
	if (hashes.length === 1) {
		// Sin lote, el panel pasa a "Analizando N" y al terminar vuelve a lo que había; durante un lote suma a su "N de M".
		const d = sideOf()?.deep;
		if (d && d.status !== 'run') Object.assign(d, { status: 'run', single: true, after: d.status, hashes: [] });
		if (d && !d.hashes.includes(hashes[0])) {
			d.hashes.push(hashes[0]);
			deepDone.delete(hashes[0]);
		}
		void countSeeds(hashes);
	} else {
		void runDeep(video, res);
	}
}

/** Análisis profundo: se descartan los `unlikely` y se cuentan a fondo los `TOP` mejores. Progreso en `side().deep.hashes` /
 *  `deepDone`. */
export async function runDeep(video: string | null | undefined, res: string | null | undefined): Promise<void> {
	const d = side().deep;
	if (d.status === 'run') return;
	d.status = 'run';
	d.res = res;
	const all = (state.update?.candidates ?? []).filter((c) => inScope(c, res));
	const todo = all.filter((c) => !counted.has(c.info_hash) && !counting.has(c.info_hash));
	todo.forEach((c) => skipped.delete(c.info_hash)); // reanalizar decide de nuevo
	todo.filter((c) => unlikely(c) || quickGroup(c) === 4).forEach((c) => skipped.set(c.info_hash, 'dead'));
	const ranked = todo.filter((c) => !skipped.has(c.info_hash)).sort(byQuick);
	ranked.slice(TOP).forEach((c) => skipped.set(c.info_hash, 'rest'));
	d.hashes = ranked.slice(0, TOP).map((c) => c.info_hash);
	deepDone.clear();
	renderStreamsOnly();
	if (d.hashes.length) await countSeeds(d.hashes);
	// Detenido: vuelve a ofrecer el análisis en lote; si no, queda hecho para esa resolución.
	if (sideOf()?.deep === d) {
		d.status = d.stopped ? null : 'done';
		d.stopped = false;
		renderStreamsOnly();
	}
	// Los finalistas, además, con análisis rápido (metadatos, duración, idiomas reales).
	if (sideOf()?.videoId === video) void quickAnalyze(finalists(all));
}

/** Análisis rápido sin salir del catálogo: se agrega a la biblioteca y el resultado aparece en la fila. */
export async function quickAnalyze(hashes: string[]): Promise<void> {
	if (!hashes.length) return;
	try {
		await core.catalogAdd(side().kind, side().videoId, hashes);
		await Promise.all(hashes.map((hash) => core.analyze({ kind: 'quick', hash })));
	} catch (e) {
		showError(e);
	}
}

/** Eventos de las pruebas del núcleo: progreso en vivo y resultado, de la rápida (`deep = false`) o la profunda. Se redibuja
 *  como mucho cada 400 ms. */
export function onSwarmEvent(event: Extract<CoreEvent, { type: 'catalog-swarm-counted' | 'catalog-swarm-progress' }>): void {
	const { hash, count, deep } = event;
	if (event.type === 'catalog-swarm-progress') {
		if (!(deep ? counting : quickRunning).has(hash)) return;
		(deep ? liveCount : quickLive).set(hash, count);
		notePhase(hash, count);
		scheduleRender();
		return;
	}
	if (!deep) {
		quick.set(hash, count); // cada resultado reordena la lista al llegar
	} else {
		counted.set(hash, count);
		counting.delete(hash);
		liveCount.delete(hash);
		deepDone.add(hash);
	}
	if (state.update?.candidates.some((c) => c.info_hash === hash)) scheduleRender();
}
