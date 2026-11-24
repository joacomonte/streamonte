// Pasos al elegir un video en el desktop: capa fina sobre la máquina compartida (`$ui/flow/flow-model.ts`, la misma de la web).
// Acá queda lo propio del desktop: el estado por video (`side().flow`, `newFlow`), la pantalla de "buscando torrents" (fuentes
// del núcleo + TorBox), cómo se leen las pistas (TorBox: `readTracks`; por torrent: el análisis rápido de a `SWARM_PARALLEL`),
// qué es CAM / ya falló / está en TorBox, y el modo "por torrent" con paso de calidad (`RES_ORDER`). La vista la dibuja
// `FlowScreen.svelte`.
import * as core from './core.ts';
import { t as tr } from './i18n.ts';
import { state, view } from './catalog-state.ts';
import { failedBefore, flatSorted, inTorbox, knownSeeds, factsOf, mbpsOf, openGroup, renderStreamsOnly, rowView, resKey } from './catalog-options.ts';
import { readTracks } from './catalog-subs.ts';
import { quickAnalyze, side, sideOf, startAnalysis, stopTests, unlikely } from './catalog-tests.ts';
import { scanSecs, SWARM_PARALLEL, SWARM_SECS } from './options-logic.ts';
import { fitsNet as fitsNetLevel, type NetChoice } from '$ui/flow/net.ts';
import { createFlow, newFlowState, type FlowCand, type FlowIds, type FlowState } from '$ui/flow/flow-model.ts';
import type { CrumbsView, FlowView, MoreRowView } from '$ui/flow/types.ts';
import type { StreamCandidate as Candidate } from './types.ts';

export type { NetChoice };
export type Flow = FlowState;
export const newFlow = (): Flow => newFlowState('mode');
const flow = (): Flow | undefined => sideOf()?.flow;

const IDS: FlowIds = {
	net: 'cat-flow-net-', latNo: 'cat-flow-lat-no', latYes: 'cat-flow-lat-yes', stop: 'cat-flow-stop',
	nolatOriginal: 'cat-match-original', nolatSpain: 'cat-match-spain', nolatAll: 'cat-match-all', matchAll: 'cat-match-all',
	spainOriginal: 'cat-spain-original', spainAll: 'cat-spain-all', lighter: 'cat-lighter', crumb: 'cat-crumb-',
};

/** Una candidata en la forma del modelo. Por TorBox se leen todas; por torrent, con seeds y no muerta. */
const toCand = (c: Candidate): FlowCand<Candidate> => ({
	hash: c.info_hash, bytes: c.size_bytes ?? null, mbps: mbpsOf(c), res: resKey(c), facts: factsOf(c),
	excluded: c.source === 'CAM' || failedBefore.has(c.info_hash), failed: failedBefore.has(c.info_hash),
	readable: flow()?.mode === 'torbox' || (!unlikely(c) && (knownSeeds(c) ?? 0) > 0),
	seeds: knownSeeds(c), inTorbox: inTorbox.has(c.info_hash), src: c,
});
/** Las candidatas convertidas, una vez por tanda de código sincrónico (un redibujo): la vista las pide varias veces y cada
 *  conversión lee pistas y salud. Se vacía en la próxima microtarea, antes de que llegue cualquier evento que las cambie. */
let candsNow: FlowCand<Candidate>[] | null = null;
function cands(): FlowCand<Candidate>[] {
	if (!candsNow) {
		candsNow = (state.update?.candidates ?? []).map(toCand);
		queueMicrotask(() => (candsNow = null));
	}
	return candsNow;
}
const tracksRead = (h: string): boolean => !!state.update?.candidates.find((c) => c.info_hash === h && factsOf(c).audioRead);

const model = createFlow<Candidate>({
	state: flow,
	cands,
	sort: (cands) => {
		const byHash = new Map(cands.map((c) => [c.hash, c]));
		return flatSorted(cands.map((c) => c.src)).map((c) => byHash.get(c.info_hash) as FlowCand<Candidate>);
	},
	row: (c, best) => rowView(c.src, best),
	// TorBox: un pedido; por torrent, el análisis rápido del núcleo, esperando hasta que se lean todas o se pase del tiempo.
	read: async (batch, alive) => {
		const hashes = batch.map((c) => c.hash);
		if (flow()?.mode === 'torbox') return void (await readTracks(hashes[0] as string, true));
		void quickAnalyze(hashes);
		const end = Date.now() + (SWARM_SECS + 30) * 1000;
		while (alive() && Date.now() < end && !hashes.every(tracksRead)) {
			await new Promise((r) => setTimeout(r, 1000));
			renderStreamsOnly();
		}
	},
	// Funciones (no la referencia): catalog-options importa este módulo y hay ciclo.
	changed: () => renderStreamsOnly(),
	onCancel: () => {
		if (sideOf()?.tests?.run) stopTests();
	},
	ids: IDS,
	allIgnoresLat: false,
	torrent: {
		hasTorbox: () => !!view.torboxKey && side().torbox === 'done',
		parallel: SWARM_PARALLEL,
		scanSecs: (n) => scanSecs(n, false),
		openRes: () => view.openRes ?? '',
		setOpenRes: (r) => void (view.openRes = r),
		open: (r) => openGroup(r),
		// Primera vez en esa calidad: la prueba de 30 s ordena por seeds reales; el análisis profundo se ofrece después.
		opened: async (r, still) => {
			const t = side().tests;
			if (t.first[r] || side().deep?.res === r) return;
			for (let i = 0; i < 20 && !t.ready; i++) await new Promise((res) => setTimeout(res, 250));
			if (still()) startAnalysis(r, false, true);
		},
		cancel: (hashes) => void core.analyzerCancel(hashes).catch(() => {}),
	},
});

/** ¿Entra en la conexión elegida? Sin peso no se sabe cuánto pide: no entra (no puede ser el buen match). */
export const fitsNet = (c: Candidate): boolean => fitsNetLevel(c.size_bytes, mbpsOf(c), flow()?.net ?? null);
/** ¿Se pregunta la resolución? Solo por torrent. */
export const hasResStep = (): boolean => model.hasResStep();
/** Única regla de "buen match" (`$ui/flow/match-rules.ts`), con CAM y las que ya fallaron afuera. */
export const isMatch = (c: Candidate): boolean => model.isMatch(toCand(c));
/** Filtro de la lista por el flujo (lo usa `passesFilters`): modo y, si pidió latino, solo las con potencial. */
export const flowFilter = (c: Candidate): boolean => model.flowFilter(toCand(c));
export const crumbs = (): CrumbsView | null => model.crumbs();
export const moreRow = (): MoreRowView | null => model.moreRow();
/** Al volver a un paso o dejar el video: corta todo lo que esté analizando. */
export const cancelFlowWork = (): void => model.cancelWork();

/** ¿Ya se puede elegir? La lista de todas las fuentes y, con key de TorBox, cuáles tiene listas. */
function ready(): boolean {
	const u = state.update;
	if (!u?.done || view.torboxKey === null) return false;
	return !view.torboxKey || side().torbox === 'done' || side().torbox === 'error';
}

/** El paso actual, o null en la lista (la arma `renderStreamsOnly`). */
export function flowStep(): FlowView | null {
	if (!flow()) return null;
	if (!ready()) return searchScreen();
	return model.view();
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
