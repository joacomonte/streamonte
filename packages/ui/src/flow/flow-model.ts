// Máquina de pasos de "elegir video" (web ↔ desktop), pura: cada app le pasa sus candidatas en la forma común (`FlowCand`), su
// estado (`FlowState`, que la web guarda en `$state` y el desktop en `side().flow`), cómo leer pistas (`read`) y cómo dibujar
// una fila; sale la pantalla (`FlowView`) con sus acciones. Pasos (2026-11-18, mem #69): [modo] → conexión → ¿latino? →
// [calidad] → resultado. Por TorBox se busca el PRIMER BUEN MATCH (`isMatch`) leyendo pistas de a una, de mejor a peor calidad, y
// se muestra solo ese, con "Seguir buscando" y "Ver todas las opciones". Por torrent (solo desktop, `torrent`) hay paso de calidad
// y el latino se confirma de a `parallel` mientras se ve la lista. Migas vuelven a un paso; volver o cambiar de video corta la
// lectura (la búsqueda en curso mira si su `FlowState` y su `Scan` siguen siendo los actuales).
import { t } from '../i18n/runtime.ts';
import { RES_ORDER, resLabel, type OptionRowView } from '../options/row.ts';
import { latChips } from './lat-chips.ts';
import { isMatch as matchRule, latFirst as latFirstRule, latPotential, needsReading, type MatchFacts } from './match-rules.ts';
import { fitsNet, NET, type NetChoice } from './net.ts';
import type { ChoiceView, CrumbsView, FlowButton, FlowStep, FlowView, MoreRowView, TileSpec } from './types.ts';

/** Leer las pistas de un torrent por TorBox tarda ~8 s. */
export const TORBOX_SECS = 8;

/** Una opción en la forma que mira el modelo. `src`: la de la app (para dibujarla y ordenarla). */
export type FlowCand<T> = {
	hash: string;
	bytes: number | null;
	/** Lo que pide de conexión (`optionMbps`). */
	mbps: number;
	/** Resolución (`resKey`). */
	res: string;
	facts: MatchFacts;
	/** Nunca es buen match (desktop: de cine o ya falló al reproducirse). */
	excluded: boolean;
	/** Ya falló al reproducirse: al final. */
	failed: boolean;
	/** Se pueden leer sus pistas ahora (web: no se está leyendo ni falló; desktop por torrent: con seeds y no muerta). */
	readable: boolean;
	seeds: number | null;
	inTorbox: boolean;
	src: T;
};

/** La lista de torrents, que por TorBox se busca de fondo mientras elige (2026-11-24): buscando (fuentes que respondieron de
 *  `total`; `checking`: viendo cuáles tiene TorBox), lista o falló (`error`: el de la app; null = no se pudo consultar TorBox). */
export type FlowList = { kind: 'loading'; done: number; total: number; checking: boolean } | { kind: 'ready' } | { kind: 'failed'; error: string | null };

/** Búsqueda de pistas en curso. `batch`: lo que se está leyendo. */
export type Scan = { total: number; batch: string[]; done: number; running: boolean; stopped: boolean };
/** `lat`: null = no se preguntó; `latOff`: sacó el filtro de latino; `scanned`: hashes cuyas pistas ya se intentaron leer;
 *  `found`: los buenos matches mostrados (en orden); `all`: pidió "Ver todas las opciones"; `spain`: vio las de España;
 *  `noLat`: buscó latino y no había (TorBox). */
export type FlowState = {
	step: FlowStep;
	mode: 'torbox' | 'torrent' | null;
	net: NetChoice | null;
	lat: boolean | null;
	latOff: boolean;
	scan: Scan | null;
	scanned: string[];
	found: string[];
	all: boolean;
	spain: boolean;
	noLat: boolean;
};
/** Estado nuevo (uno por video). La web arranca en la conexión por TorBox; el desktop pregunta el modo. */
export const newFlowState = (step: FlowStep = 'mode', mode: FlowState['mode'] = null): FlowState => ({
	step, mode, net: null, lat: null, latOff: false, scan: null, scanned: [], found: [], all: false, spain: false, noLat: false,
});

/** Ids de cada app (los usan sus escenas y scripts). `net` y `crumb` son prefijos (+ clave del nivel / del paso). */
export type FlowIds = {
	net: string;
	latNo: string;
	latYes: string;
	stop: string;
	/** "Ver todas" del paso de audio (sin latino) y del aviso (ninguna entra en la conexión). */
	latAll: string;
	noticeAll: string;
	/** "Ver por torrent" (solo desktop) cuando TorBox no tiene ninguno o no respondió. */
	toTorrent: string;
	matchAll: string;
	spainOriginal: string;
	spainAll: string;
	lighter: string;
	crumb: string;
};

/** Modo "por torrent" (solo desktop): paso de modo y de calidad, lectura de a `parallel`. */
export type TorrentMode = {
	/** Hay key de TorBox (y no falló): se pregunta TorBox o torrent, sin esperar la búsqueda. */
	hasTorbox(): boolean;
	parallel: number;
	/** Segundos para leer `n` por el enjambre. */
	scanSecs(n: number): number;
	/** Calidad abierta ('' = ninguna). */
	openRes(): string;
	setOpenRes(r: string): void;
	/** Abre la calidad elegida. */
	open(r: string): void;
	/** Después de abrirla (y de arrancar la búsqueda de latino): su prueba de 30 s si hace falta; `still`: sigue en ese paso. */
	opened(r: string, still: () => boolean): void;
	/** Deja de leer estas (lo que no llegó a leerse). */
	cancel(hashes: string[]): void;
};

export type FlowDeps<T> = {
	/** El estado del video abierto (undefined: ninguno). Cambiar de video = otro objeto. */
	state(): FlowState | undefined;
	cands(): FlowCand<T>[];
	/** Cómo va la búsqueda de torrents (por TorBox se elige mientras tanto). */
	list(): FlowList;
	/** Es un capítulo (los avisos dicen "este capítulo" en vez de "esta película"). */
	episode(): boolean;
	/** De mejor a peor calidad (el orden de la lista de cada app). */
	sort(cands: FlowCand<T>[]): FlowCand<T>[];
	row(c: FlowCand<T>, best: boolean): OptionRowView;
	/** Lee las pistas de `batch` (por TorBox, una). `alive`: false si se cortó la búsqueda. */
	read(batch: FlowCand<T>[], alive: () => boolean): Promise<void>;
	/** Avisa que cambió algo (el desktop redibuja; la web es reactiva). */
	changed(): void;
	/** Al volver a un paso o cortar: lo propio de la app (el desktop corta el análisis de la calidad). */
	onCancel?(): void;
	ids: FlowIds;
	/** "Ver todas las opciones" muestra todas sin el filtro de latino (web): el número es el total y no apaga "Seguir buscando". */
	allIgnoresLat: boolean;
	track?(what: string, label: string): void;
	torrent?: TorrentMode;
};

export type FlowModel<T> = ReturnType<typeof createFlow<T>>;

const ACCENT = 'var(--accent-fg)';
const GREEN = 'var(--green)';
const MUTED = 'var(--muted)';
const WAVE: TileSpec = { kind: 'wave' };
const choice = (id: string, tile: TileSpec, tone: string, i: number, title: string, sub: string, onclick: () => void, more: Partial<ChoiceView> = {}): ChoiceView => ({
	id, tile, tone, i, title, sub, onclick, note: null, badge: null, chips: null, disabled: false, primary: false, ...more,
});
const button = (id: string, icon: FlowButton['icon'], text: string, onclick: () => void, more: Partial<FlowButton> = {}): FlowButton => ({
	id, icon, text, onclick, small: null, title: null, count: null, ...more,
});
const netLabel = (n: NetChoice): string => t(n.label);

export function createFlow<T>(deps: FlowDeps<T>) {
	const { ids, torrent } = deps;
	const flow = (): FlowState | undefined => deps.state();
	/** El flujo del video abierto (donde no puede faltar). */
	const now = (): FlowState => deps.state() as FlowState;
	const changed = (): void => deps.changed();

	/** ¿Se pregunta la calidad? Solo por torrent: en TorBox se busca el mejor match entre todas las calidades. */
	const hasResStep = (): boolean => !!torrent && flow()?.mode !== 'torbox';
	const openRes = (): string => torrent?.openRes() ?? '';
	/** ¿Entra en la conexión elegida? Sin peso no se sabe cuánto pide: no entra. */
	const fits = (c: FlowCand<T>): boolean => fitsNet(c.bytes, c.mbps, flow()?.net ?? null);
	const isLat = (c: FlowCand<T>): boolean => c.facts.latState === 'lat';
	/** Única regla de "buen match": pidiendo latino, latino confirmado; con audio original, subs en español nativos. */
	const isMatch = (c: FlowCand<T>): boolean => matchRule(!!flow()?.lat, c.facts, c.excluded);
	/** Filtro de la lista por el flujo: modo y, si pidió latino, solo las con potencial. */
	function flowFilter(c: FlowCand<T>): boolean {
		const f = flow();
		if (!f) return true;
		return (f.mode !== 'torbox' || c.inTorbox) && (!f.lat || f.latOff || latPotential(c.facts));
	}
	/** Lo que entra según el modo (TorBox: solo las que tiene listas); las que ya fallaron, al final (orden estable). */
	const pool = (): FlowCand<T>[] =>
		deps.cands()
			.filter((c) => flow()?.mode !== 'torbox' || c.inTorbox)
			.sort((a, b) => Number(a.failed) - Number(b.failed));
	/** Donde se busca: el modo y, con paso de calidad, la calidad abierta. */
	const scope = (): FlowCand<T>[] => pool().filter((c) => !hasResStep() || !openRes() || c.res === openRes());
	const latFirst = (cands: FlowCand<T>[]): FlowCand<T>[] => latFirstRule(cands, !!now().lat, (c) => c.facts.latState);
	const byPotential = (a: FlowCand<T>, b: FlowCand<T>): number => (b.seeds ?? -1) - (a.seeds ?? -1) || (b.bytes ?? 0) - (a.bytes ?? 0);
	/** Grupo de candidata a latino: 0 web latina, 1 español sin aclarar. */
	const latTier = (c: FlowCand<T>): number => (c.facts.latState === 'likely' ? 0 : 1);
	/** Candidatas a leer (única regla): sin leer, legibles y que puedan ser lo pedido. TorBox: las que entran en la conexión, de
	 *  mejor a peor (pidiendo latino, antes por señal). Torrent: por grupo, mejor calidad y seeds (la primera confirmada es la mejor). */
	function toConfirm(cands: FlowCand<T>[], lat: boolean | null = now().lat): FlowCand<T>[] {
		const f = now();
		const pending = cands.filter((c) => !f.scanned.includes(c.hash) && !c.facts.audioRead && c.readable && needsReading(!!lat, c.facts));
		if (f.mode === 'torbox') return latFirst(deps.sort(pending.filter(fits)));
		return pending.sort(byPotential).sort((a, b) => latTier(a) - latTier(b) || RES_ORDER.indexOf(a.res) - RES_ORDER.indexOf(b.res));
	}
	/** De donde sale el buen match en TorBox: las que entran en la conexión, de mejor a peor. */
	const ranked = (): FlowCand<T>[] => latFirst(deps.sort(pool().filter((c) => flowFilter(c) && fits(c))));
	/** TorBox: el próximo buen match no mostrado, si viene antes (en calidad) que la próxima candidata sin leer; si no, null. */
	function nextMatch(): FlowCand<T> | null {
		const f = now();
		const pending = new Set(toConfirm(pool()).map((c) => c.hash));
		const first = ranked().find((c) => pending.has(c.hash) || (isMatch(c) && !f.found.includes(c.hash)));
		return first && !pending.has(first.hash) ? first : null;
	}
	/** "~40 s" / "~3 min" para leer las pistas de `n`. */
	function eta(n: number): string {
		const secs = flow()?.mode === 'torbox' || !torrent ? n * TORBOX_SECS : torrent.scanSecs(n);
		return secs < 60 ? `~${Math.max(10, Math.round(secs / 10) * 10)} s` : t('~{a} min', { a: Math.round(secs / 60) });
	}
	const audioRead = (h: string): boolean => !!deps.cands().find((c) => c.hash === h)?.facts.audioRead;

	/** Lee las candidatas de `scope`, en orden, hasta el próximo buen match. TorBox: de a una, y para en el primer match nuevo.
	 *  Torrent (latino): de a `parallel`, y para en la primera tanda con latino confirmado. También para al agotarlas o al cortarla. */
	async function runScan(): Promise<void> {
		const f = now();
		const tb = f.mode === 'torbox';
		// 2026-11-24: por TorBox se elige mientras busca; si la lista no llegó, el radar muestra la búsqueda y espera a la lista
		// entera (leer pistas antes daría un resultado falso).
		if (tb && deps.list().kind === 'loading') {
			f.scan = { total: 0, batch: [], done: 0, running: true, stopped: false };
			const wait = f.scan;
			changed();
			let seen = '';
			while (flow() === f && f.scan === wait && !wait.stopped && deps.list().kind === 'loading') {
				const l = JSON.stringify(deps.list());
				if (l !== seen) changed();
				seen = l;
				await new Promise((r) => setTimeout(r, 250));
			}
			if (flow() !== f || f.scan !== wait || wait.stopped) return;
			wait.running = false;
			if (deps.list().kind === 'failed') return changed();
		}
		// Ninguna entra en la conexión elegida: el aviso (`noticeScreen`). Bajar de nivel no sirve: cada nivel pide menos que el
		// anterior (2026-11-24).
		if (tb && !pool().some(fits)) return changed();
		const total = toConfirm(scope()).length;
		if (!total && !(tb && nextMatch())) {
			if (tb) settleLat(f);
			return changed();
		}
		f.scan = { total, batch: [], done: 0, running: true, stopped: false };
		// Releído: en la web `f` es un proxy de `$state` y guarda su propia copia.
		const scan = f.scan;
		changed();
		const alive = (): boolean => flow() === f && f.scan === scan && !scan.stopped;
		while (alive()) {
			const match = tb && nextMatch();
			if (match) {
				f.found.push(match.hash);
				break;
			}
			const batch = toConfirm(scope()).slice(0, tb ? 1 : (torrent?.parallel ?? 1));
			scan.batch = batch.map((c) => c.hash);
			if (!batch.length) break;
			f.scanned.push(...scan.batch);
			await deps.read(batch, alive);
			scan.done += batch.length;
			if (flow() === f) changed();
			if (!tb && deps.cands().some((c) => scan.batch.includes(c.hash) && isLat(c))) break;
		}
		if (f.scan === scan) scan.running = false;
		if (tb && flow() === f && f.scan === scan && !scan.stopped) settleLat(f);
		if (flow() === f) changed();
	}
	/** 2026-11-24 (TorBox): pidió latino, se leyó todo y no hubo: las de España si hay; si no, vuelve al paso de audio con el aviso
	 *  (reemplaza la pantalla "sin latino"). */
	function settleLat(f: FlowState): void {
		if (!f.lat || f.found.length) return;
		if (pool().some(spanishNotLat)) f.spain = true;
		else Object.assign(f, { step: 'lat', lat: null, noLat: true, scan: null });
	}
	/** Pidiendo latino, al llegar a la lista (por torrent): busca salvo que ya haya una confirmada. */
	function autoScan(): void {
		if (now().lat && !scope().some(isLat)) void runScan();
		else changed();
	}
	/** Corta la búsqueda en curso (lo ya leído queda; lo que no llegó a leerse vuelve a ser candidata). */
	function stopScan(): void {
		const f = flow();
		const s = f?.scan;
		if (!f || !s?.running) return;
		s.stopped = true;
		s.running = false;
		const pending = s.batch.filter((h) => !audioRead(h));
		f.scanned = f.scanned.filter((h) => !pending.includes(h));
		if (f.mode !== 'torbox') torrent?.cancel(pending);
	}
	/** Al volver a un paso, cambiar la búsqueda o dejar el video: corta todo lo que esté leyendo. */
	function cancelWork(): void {
		stopScan();
		deps.onCancel?.();
	}
	function goTo(step: FlowStep): void {
		const f = now();
		cancelWork();
		if (step === 'mode') Object.assign(f, { mode: null, lat: null });
		if (step === 'mode' || step === 'lat' || step === 'net') Object.assign(f, { lat: null, scan: null, found: [], all: false });
		if (step === 'mode' || step === 'net') f.noLat = false;
		f.latOff = false;
		f.spain = false;
		f.step = step;
		torrent?.setOpenRes('');
		changed();
	}
	function setNet(n: NetChoice): void {
		Object.assign(now(), { net: n, found: [], all: false, scanned: [], noLat: false });
	}
	function pickNet(n: NetChoice): void {
		deps.track?.('conexión', n.label);
		setNet(n);
		now().step = 'lat';
		changed();
	}
	function pickLat(lat: boolean): void {
		const f = now();
		deps.track?.('audio', lat ? 'Latino' : 'Cualquiera');
		Object.assign(f, { lat, step: hasResStep() ? 'res' : 'list' });
		torrent?.setOpenRes('');
		if (hasResStep()) changed();
		else void runScan();
	}
	function pickRes(r: string): void {
		const f = now();
		f.step = 'list';
		torrent?.open(r);
		autoScan();
		torrent?.opened(r, () => flow() === f && f.step === 'list' && openRes() === r);
	}
	/** Pidió latino y no hubo: busca de nuevo con audio original (el primer match con subs en español adentro). */
	function toOriginal(): void {
		const f = now();
		deps.track?.('audio', 'Cualquiera');
		cancelWork();
		Object.assign(f, { lat: false, found: [], all: false, spain: false, scan: null });
		void runScan();
	}
	/** "Ver todas las opciones"; `clearLat`: sin el filtro de latino (si la app lo aplica a la lista). */
	function showAll(clearLat: boolean): void {
		// `step`: también desde el paso de audio (sin latino, 2026-11-24).
		Object.assign(now(), { all: true, spain: false, step: 'list' }, clearLat && !deps.allIgnoresLat ? { latOff: true } : {});
		changed();
	}
	/** TorBox no tiene ninguno o no respondió (solo desktop): sigue por torrent desde el audio. */
	function toTorrentMode(): void {
		cancelWork();
		Object.assign(now(), { mode: 'torrent', step: 'lat', lat: null, latOff: false, scan: null, scanned: [], found: [], all: false, spain: false, noLat: false });
		torrent?.setOpenRes('');
		changed();
	}
	function stopAndShow(): void {
		stopScan();
		changed();
	}

	// ---------- vista ----------
	/** Migas: lo elegido hasta ahora; tocar una vuelve a ese paso. */
	function crumbs(): CrumbsView | null {
		const f = flow();
		if (!f?.mode) return null;
		const n = f.net;
		const items: [FlowStep | null, string][] = [];
		if (torrent) items.push(torrent.hasTorbox() || f.mode === 'torbox' ? ['mode', f.mode === 'torbox' ? 'TorBox' : 'Torrent'] : [null, 'Torrent']);
		if (f.mode === 'torbox' && n && f.step !== 'net') items.push(['net', t('Conexión {a}', { a: netLabel(n).toLowerCase() })]);
		if (f.lat != null) items.push(['lat', f.lat ? t('Audio latino') : t('Audio original')]);
		if (f.step === 'list' && openRes()) items.push(['res', resLabel(openRes(), t('Otras'))]);
		if (!items.length) return null;
		return {
			aria: t('Pasos elegidos'),
			items: items.map(([step, label]) => (step && step !== f.step ? { id: `${ids.crumb}${step}`, label, title: t('Volver a este paso'), onclick: () => goTo(step) } : { id: null, label, onclick: null })),
		};
	}
	const screenOf = (title: string | null): { crumbs: CrumbsView | null; title: string | null } => ({ crumbs: crumbs(), title });

	/** El paso actual, o null en la lista (la arma cada app). La pantalla de "buscando torrents" también es de cada app. */
	function view(): FlowView | null {
		const f = flow();
		if (!f) return null;
		// Sin TorBox (sin key o no respondió) no se pregunta: torrent.
		if (f.step === 'mode' && !torrent?.hasTorbox()) Object.assign(f, { mode: 'torrent', step: 'lat' });
		if (f.step === 'mode') return modeScreen();
		if (f.mode === 'torbox' && !f.all) {
			const notice = noticeScreen();
			if (notice) return notice;
		}
		if (f.step === 'net') return netScreen();
		if (f.step === 'lat') return latScreen();
		if (f.step === 'res') return resScreen();
		// TorBox: buscando el primer match, solo la búsqueda; después, el resultado (o la lista entera si la pidió).
		if (f.mode === 'torbox' && !f.all && f.spain) return spainScreen();
		if (f.mode === 'torbox' && !f.all) return f.scan?.running && !f.found.length ? scanScreen() : matchScreen();
		return null;
	}

	/** TorBox: mientras no aparezca el primer buen match, solo la búsqueda (radar). */
	function scanScreen(): FlowView {
		const s = now().scan as Scan;
		const l = deps.list();
		// Todavía sin la lista (2026-11-24): el avance de la búsqueda; Detener vuelve al audio.
		if (l.kind === 'loading') {
			return {
				kind: 'scan', ...screenOf(null), text: t('Buscando el mejor torrent para vos'),
				frac: l.checking ? 1 : l.total ? (l.done / l.total) * 0.9 : 0,
				count: l.checking ? t('Viendo cuáles tiene TorBox') : l.total ? t('Buscando torrents · {a} de {n} fuentes', { a: l.done, n: l.total }) : t('Buscando torrents…'),
				stop: button(ids.stop, 'stop', t('Detener'), () => goTo('lat')),
			};
		}
		return {
			kind: 'scan', ...screenOf(null),
			text: t('Buscando el mejor torrent para vos'),
			frac: s.done / Math.max(1, s.total),
			count: t('{a} de {n}', { a: Math.min(s.done + 1, s.total), n: s.total }),
			stop: button(ids.stop, 'stop', t('Detener'), stopAndShow, { title: t('Detener: muestro las de mejor calidad con lo leído hasta ahora') }),
		};
	}

	const allCount = (clearLat: boolean): number => (deps.allIgnoresLat || clearLat ? pool().length : pool().filter(flowFilter).length);
	const allButton = (id: string, clearLat: boolean): FlowButton => button(id, 'list', t('Ver todas las opciones'), () => showAll(clearLat), { count: String(allCount(clearLat)) });
	const spanishNotLat = (c: FlowCand<T>): boolean => c.facts.latState === 'spain';
	/** 2026-11-24 (TorBox): sin nada para elegir, un aviso en vez del paso: no respondió TorBox, no hay ninguno o ninguno entra en la
	 *  conexión elegida (ahí con "Ver todas"). Por torrent (desktop) se puede seguir con "Ver por torrent". null: hay. */
	function noticeScreen(): FlowView | null {
		const f = now();
		const l = deps.list();
		if (l.kind === 'loading') return null;
		const ep = deps.episode();
		const byTorrent = torrent && deps.cands().length ? button(ids.toTorrent, 'peers', t('Ver por torrent'), toTorrentMode) : null;
		const notice = (text: string, action: FlowButton | null, all: FlowButton | null): FlowView => ({ kind: 'notice', ...screenOf(null), text, action, all });
		if (l.kind === 'failed') return notice(l.error ?? t('No pude consultar TorBox'), byTorrent, null);
		const none = ep ? t('No hay torrents para este capítulo') : t('No hay torrents para esta película');
		if (!pool().length) return byTorrent ? notice(ep ? t('TorBox no tiene torrents para este capítulo') : t('TorBox no tiene torrents para esta película'), byTorrent, null) : notice(none, null, null);
		if (f.step === 'list' && !f.scan?.running && f.net && !pool().some(fits)) return notice(t('Todas piden más de lo que da tu conexión'), null, allButton(ids.noticeAll, true));
		return null;
	}

	/** TorBox, el resultado: solo los buenos matches encontrados. Sin ninguno, las 3 de mejor calidad con el aviso. (Sin latino y
	 *  sin conexión que alcance ya no llegan acá: `settleLat` y `noticeScreen`, 2026-11-24.) */
	function matchScreen(): FlowView {
		const f = now();
		const list = ranked();
		const found = f.found.map((h) => list.find((c) => c.hash === h)).filter((c): c is FlowCand<T> => !!c);
		const searched = !toConfirm(pool()).length;
		const title = found.length || f.lat ? null : t('Sin subtítulos en español adentro');
		return {
			kind: 'match', ...screenOf(title),
			note: found.length ? null : searched ? t('Ninguna trae sub ES nativo: los subs se buscan afuera') : t('Búsqueda detenida: estas son las de mejor calidad'),
			rows: (found.length ? found : list.slice(0, 3)).map((c) => deps.row(c, !!found.length)),
			lighter: lighterButton(),
			more: moreRow(),
			all: allButton(ids.matchAll, false),
		};
	}
	/** Sin latino: las que traen español que no es latino (casi seguro de España), de mejor a peor. */
	function spainScreen(): FlowView {
		return {
			kind: 'spain', ...screenOf(t('Probablemente español de España')),
			note: t('Traen audio en español sin decir que es latino (o marcado de España): casi seguro es castellano.'),
			rows: deps.sort(pool().filter(spanishNotLat)).map((c) => deps.row(c, false)),
			original: button(ids.spainOriginal, 'speaker', t('Buscar con audio original'), toOriginal, { small: t('Con subtítulos en español'), title: t('Busco de nuevo la primera que traiga subtítulos en español adentro') }),
			all: allButton(ids.spainAll, true),
		};
	}
	/** "¿Se cortó?": baja un nivel de conexión y busca de nuevo con el tope nuevo (en la más baja no aparece). */
	function lighterButton(): FlowButton | null {
		const n = flow()?.net;
		const i = n ? NET.findIndex((x) => x.key === n.key) : -1;
		if (i <= 0) return null;
		const lower = NET[i - 1] as NetChoice;
		return button(ids.lighter, 'gauge', t('¿Se cortó? Una más liviana'), () => { cancelWork(); setNet(lower); void runScan(); }, {
			title: t('Paso a conexión {a} ({range}) y busco de nuevo', { a: netLabel(lower).toLowerCase(), range: t(lower.range) }),
		});
	}

	/** TorBox: cómo es la conexión donde se va a ver (cada vez; se cambia desde la miga). La más rápida arriba. */
	function netScreen(): FlowView {
		const cur = flow()?.net;
		return {
			kind: 'choices', step: 'net', ...screenOf(t('¿Cómo es tu internet donde lo vas a ver?')), note: null, all: null,
			choices: [...NET].reverse().map((n, i) => choice(`${ids.net}${n.key}`, { kind: 'net', level: (NET.indexOf(n) + 1) as 1 | 2 | 3 | 4 }, `var(--${n.tone})`, i, netLabel(n), t(n.range), () => pickNet(n), { primary: cur?.key === n.key })),
		};
	}

	/** Solo desktop: TorBox o torrent. */
	function modeScreen(): FlowView {
		const f = now();
		const cands = deps.cands();
		const all = cands.length;
		// Buscando todavía (2026-11-24): se elige sin esperar, con textos sin conteo.
		const loading = deps.list().kind === 'loading';
		const tb = loading ? 1 : cands.filter((c) => c.inTorbox).length;
		const go = (mode: 'torbox' | 'torrent') => (): void => { Object.assign(f, { mode, step: mode === 'torbox' ? 'net' : 'lat' }); changed(); };
		const tbSub = loading ? t('Los que tiene en sus servidores arrancan al instante y no dependen de los seeds')
			: tb ? t('{tb} {a} en sus servidores: arranca al instante y no depende de los seeds', { tb, a: tb === 1 ? t('lista') : t('listas') }) : t('No hay torrents en TorBox para esto');
		const allSub = loading ? t('Torrents de otras personas (P2P): la velocidad depende de cuántos lo comparten') : t('{all} torrents de otras personas (P2P): la velocidad depende de cuántos lo comparten', { all });
		return {
			kind: 'choices', step: 'mode', ...screenOf(t('¿Cómo lo querés ver?')), note: null, all: null,
			choices: [
				choice('cat-flow-torbox', { kind: 'icon', icon: 'play' }, ACCENT, 0, t('Por TorBox'), tbSub, go('torbox'), { badge: tb ? t('Al instante') : null, disabled: !tb, primary: !!tb }),
				choice('cat-flow-torrent', { kind: 'icon', icon: 'peers' }, MUTED, 1, t('Por torrent'), allSub, go('torrent')),
			],
		};
	}

	function latScreen(): FlowView {
		const f = now();
		const p = pool();
		const potential = p.filter((c) => latPotential(c.facts));
		const none = !potential.length;
		const named = potential.filter(isLat).length;
		const doubtful = potential.length - named;
		const origSub = f.mode === 'torbox' ? t('Con subtítulos en español') : t('El idioma en que se filmó');
		const orig = choice(ids.latNo, WAVE, ACCENT, 0, t('Audio original'), origSub, () => pickLat(false));
		const ask = screenOf(t('¿Necesitás audio latino?'));
		// TorBox (2026-11-24, igual en las dos apps): sin chips, se puede pedir mientras busca; si ya se buscó y no hubo, deshabilitada
		// con el aviso y "Ver todas".
		if (f.mode === 'torbox' || !torrent) {
			const off = f.noLat || (none && deps.list().kind === 'ready');
			const yesSub = off ? t('No hay torrents con audio latino') : t('Hay menos con latino: puede tardar más en encontrar uno');
			return {
				kind: 'choices', step: 'lat', ...ask,
				note: f.noLat ? t('No encontré torrents con audio latino') : null,
				all: f.noLat && p.length ? allButton(ids.latAll, true) : null,
				choices: [orig, choice(ids.latYes, { kind: 'bubble', text: 'LAT' }, GREEN, 1, t('Audio latino'), yesSub, () => pickLat(true), { disabled: off })],
			};
		}
		const left = toConfirm(p, true).length;
		// Variante A (docs/mockups/audio-latino): chips en vez de texto; el detalle queda en el `title` de cada uno.
		const how = t('de a {SWARM_PARALLEL}, en la calidad que elijas', { SWARM_PARALLEL: torrent.parallel });
		const yesChips = latChips(named, doubtful, left > 0, t('Las reviso {how} hasta encontrar latino', { how }));
		const yesSub = none ? t('No hay torrents con audio latino') : yesChips.map((c) => c.title ?? c.text).join(' · ');
		return {
			kind: 'choices', step: 'lat', ...ask, note: null, all: null,
			choices: [
				orig,
				// El latino suele venir en releases más livianos: que no sorprenda no encontrarlo en 4K.
				choice(ids.latYes, { kind: 'bubble', text: 'LAT' }, GREEN, 1, t('Audio latino'), yesSub, () => pickLat(true), { chips: none ? null : yesChips, disabled: none }),
			],
		};
	}

	/** Al pie de lo que se ve (por TorBox siempre; por torrent, pidiendo latino): la búsqueda en curso (con Detener), "Seguir
	 *  buscando" la próxima o, revisadas todas, que no hay más para buscar. */
	function moreRow(): MoreRowView | null {
		const f = flow();
		const tb = f?.mode === 'torbox';
		if (!f || (!tb && !f.lat) || f.latOff) return null;
		const what = f.lat ? t('latino') : t('sub ES');
		const s = f.scan;
		if (s?.running) {
			return { kind: 'running', text: t('Leyendo pistas para encontrar {what} · {done} de {total}', { what, done: s.done, total: s.total }), stop: t('Detener'), onstop: stopAndShow };
		}
		const left = toConfirm(scope()).length;
		const step = tb ? 1 : (torrent?.parallel ?? 1);
		// TorBox: también hay "más" si queda un match ya sabido (p. ej. un .srt en español) sin mostrar.
		if (!left && !(tb && nextMatch())) {
			if (!f.scanned.length) return null;
			const found = tb ? f.found.length > 0 : scope().some(isLat);
			return {
				kind: 'done', found,
				text: tb ? t('No hay más para buscar.') : found ? t('Revisé todas: no hay más para buscar.') : t('No encontré latino confirmado en sus pistas: quedan las que lo dicen en el nombre.'),
			};
		}
		return {
			kind: 'more',
			title: t('Seguir buscando {what}', { what }),
			small: left ? t('{left} {a} · {b} cada {c}', { left, a: left === 1 ? t('candidata queda') : t('candidatas quedan'), b: eta(step), c: step === 1 ? t('una') : step }) : null,
			onclick: () => void runScan(),
		};
	}

	/** Solo desktop (por torrent): la calidad, con cuántas tienen latino. */
	function resScreen(): FlowView {
		const f = now();
		const p = pool();
		const choices: ChoiceView[] = [];
		for (const r of RES_ORDER) {
			const all = p.filter((c) => c.res === r);
			if (!all.length) continue;
			const n = all.length;
			const lat = all.filter((c) => latPotential(c.facts)).length;
			const real = all.filter(isLat).length;
			const named = all.filter((c) => c.facts.latState === 'likely').length;
			const doubtful = lat - real - named;
			const unit = n === 1 ? 'torrent' : 'torrents';
			// Lo dudoso (MULTI / Dual / español sin aclarar) no se cuenta como latino.
			const sub = !f.lat
				? `${n} ${unit}`
				: lat
					? [real && t('{real} con latino confirmado', { real }), named && t(named === 1 ? '{n} probablemente latina' : '{n} probablemente latinas', { n: named }), doubtful && t(doubtful === 1 ? '{n} dudosa' : '{n} dudosas', { n: doubtful })]
							.filter((x): x is string => typeof x === 'string')
							.join(' · ') + t(' de {n}', { n })
					: t('Ninguna con latino de {n}', { n });
			// Pidiendo latino, la calidad sin ninguno va en gris.
			choices.push(choice(`cat-flow-res-${r}`, { kind: 'icon', icon: 'monitor' }, f.lat && !lat ? MUTED : ACCENT, choices.length, resLabel(r, t('Otras')), sub, () => pickRes(r)));
		}
		return { kind: 'choices', step: 'res', ...screenOf(t('Elegí la calidad')), note: null, all: null, choices };
	}

	return { view, crumbs, moreRow, isMatch, flowFilter, fits, hasResStep, cancelWork, runScan, nextMatch, toConfirm };
}
