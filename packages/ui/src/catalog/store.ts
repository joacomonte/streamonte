// Estado y acciones del catálogo (sin Svelte): `catalog.svelte.ts` le pasa un `$state`; los tests, un objeto común.
// Todo cambio pasa por `st.x = …`, así con el proxy de `$state` la pantalla se actualiza sola.
import type { Api } from '../api.ts';
import { t } from '../i18n/runtime.ts';
import type { CatalogItem, CatalogPage, Genre, Kind, PersonHit, PersonRole, Unsubscribe } from '../types.ts';
import { DEFAULTS, parseSaved, toBrowse, type Filters } from './filters.ts';

export type PickedPerson = { id: number; name: string; photo: string | null; role: PersonRole };
/** browse = catálogo con filtros · search = texto escrito · person = lo que actuó o dirigió alguien. */
export type Mode = 'browse' | 'search' | 'person';

export type CatalogState = {
	f: Filters;
	q: string;
	person: PickedPerson | null;
	items: CatalogItem[];
	page: number;
	done: boolean;
	loading: boolean;
	/** Esperando la pausa de tipeo o de filtros antes de pedir la lista. */
	pending: boolean;
	error: string | null;
	genreList: Partial<Record<Kind, Genre[]>>;
	people: PersonHit[];
	peopleLoading: boolean;
	/** false: la lista ignoró los filtros (desktop sin key de TMDB: solo tendencias). */
	filtered: boolean;
	/** Ids que el núcleo marcó como anime/japonés después de listarlos. */
	excluded: string[];
	/** Título abierto en un panel aparte (se resalta su tarjeta). */
	activeId: string | null;
	/** Una bienvenida tapa la portada: las tarjetas esperan para entrar. */
	covered: boolean;
};

export type CatalogOptions = {
	/** Dónde se guardan los filtros (localStorage). */
	storageKey: string;
	/** Pausa después de la última tecla antes de buscar. */
	searchWait?: number;
	/** Letras mínimas para buscar por texto. */
	minQuery?: number;
	/** Pausa después del último cambio de filtro antes de pedir la lista. */
	filterWait?: number;
	/** Avisos para una barra de estado (el desktop los muestra). */
	onstatus?: (text: string) => void;
	storage?: Pick<Storage, 'getItem' | 'setItem'> | null;
};

const PEOPLE_MIN = 3;
const PEOPLE_WAIT = 500;

export function initialState(storage: CatalogOptions['storage'], key: string): CatalogState {
	let raw: string | null = null;
	try {
		raw = storage?.getItem(key) ?? null;
	} catch {
		/* sin almacenamiento */
	}
	return {
		f: parseSaved(raw), q: '', person: null, items: [], page: 0, done: false, loading: false, pending: false, error: null,
		genreList: {}, people: [], peopleLoading: false, filtered: true, excluded: [], activeId: null, covered: false
	};
}

const keyOf = (i: CatalogItem) => `${i.kind}${i.id}`;
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function createCatalog(api: Api, st: CatalogState, opts: CatalogOptions) {
	const { searchWait = 600, minQuery = 2, filterWait = 0, onstatus, storage = null, storageKey } = opts;
	/** Cada lista nueva sube `gen`: lo que venga de una lista anterior se descarta. */
	let gen = 0;
	let timer: ReturnType<typeof setTimeout> | undefined;
	let peopleTimer: ReturnType<typeof setTimeout> | undefined;
	let peopleGen = 0;

	const mode = (): Mode => (st.person ? 'person' : st.q.trim().length >= minQuery ? 'search' : 'browse');
	const visible = (): CatalogItem[] => st.items.filter((i) => !i.excluded && !st.excluded.includes(i.id));

	async function loadMore(): Promise<void> {
		if (st.loading || st.done) return;
		const my = gen;
		const m = mode();
		const page = st.page + 1;
		const q = st.q.trim();
		const who = st.person;
		st.loading = true;
		if (page === 1 && m === 'search') onstatus?.(t('Buscando "{q}"…', { q }));
		if (page === 1 && who) onstatus?.(t('Buscando lo de {name}…', { name: who.name }));
		try {
			const res: CatalogPage = who
				? { items: await api.catalog.personTitles(who.id, who.role), hasMore: false }
				: m === 'search' ? await api.catalog.search(q, page) : await api.catalog.browse(toBrowse(st.f), page);
			if (my !== gen) return;
			const seen = new Set(st.items.map(keyOf));
			st.items.push(...res.items.filter((i) => !seen.has(keyOf(i))));
			st.page = page;
			st.done = !res.hasMore || res.items.length === 0;
			if (m === 'browse') st.filtered = res.filtered !== false;
			if (page === 1 && m === 'search') onstatus?.(res.items.length ? t('Elegí una película o serie.') : t('No encontré "{q}". Probá con el título en inglés.', { q }));
			if (page === 1 && who) onstatus?.(res.items.length ? t('Elegí una película o serie.') : t('No encontré títulos de {name}.', { name: who.name }));
		} catch (e) {
			if (my !== gen) return;
			st.error = message(e);
			st.done = true;
		} finally {
			if (my === gen) st.loading = false;
		}
	}

	/** Lista nueva desde cero (filtros, búsqueda o persona cambiaron), tras `wait` ms. */
	function restart(wait = 0): void {
		clearTimeout(timer);
		gen++;
		Object.assign(st, { items: [], page: 0, done: false, error: null, loading: false, pending: wait > 0 });
		if (wait <= 0) return void loadMore();
		timer = setTimeout(() => {
			st.pending = false;
			void loadMore();
		}, wait);
	}

	async function loadGenres(kind: Kind): Promise<void> {
		if (st.genreList[kind]) return;
		try {
			st.genreList[kind] = await api.catalog.genres(kind);
		} catch {
			/* sin géneros: la hoja queda con el esqueleto */
		}
	}

	function setFilters(changes: Partial<Filters>): void {
		const kindChanged = changes.kind !== undefined && changes.kind !== st.f.kind;
		Object.assign(st.f, changes);
		if (kindChanged) {
			st.f.genres = [];
			void loadGenres(st.f.kind);
		}
		try {
			storage?.setItem(storageKey, JSON.stringify(st.f));
		} catch {
			/* sin almacenamiento */
		}
		restart(filterWait);
	}
	const resetFilters = (): void => setFilters({ votes: DEFAULTS.votes, genres: [] });
	const toggleGenre = (id: string): void => setFilters({ genres: st.f.genres.includes(id) ? st.f.genres.filter((g) => g !== id) : [...st.f.genres, id] });

	function closePeople(): void {
		clearTimeout(peopleTimer);
		peopleGen++;
		st.people = [];
		st.peopleLoading = false;
	}
	/** Sugerencias de personas desde 3 letras, un rato después de la última tecla; una respuesta vieja no pisa a la nueva. */
	function findPeople(q: string): void {
		clearTimeout(peopleTimer);
		const my = ++peopleGen;
		st.peopleLoading = q.length >= PEOPLE_MIN;
		if (!st.peopleLoading) {
			st.people = [];
			return;
		}
		peopleTimer = setTimeout(async () => {
			const list = await api.catalog.people(q).catch((): PersonHit[] => []);
			if (my !== peopleGen) return;
			st.people = list;
			st.peopleLoading = false;
		}, PEOPLE_WAIT);
	}

	/** Se escribió en el buscador: escribir de nuevo deja a la persona elegida y vuelve a buscar por texto. */
	function setQuery(raw: string): void {
		const was = mode();
		st.q = raw;
		st.person = null;
		findPeople(raw.trim());
		if (mode() === 'browse') {
			if (was !== 'browse') restart(0);
			return;
		}
		restart(searchWait);
	}
	/** Vuelve al catálogo con los filtros. */
	function clearSearch(): void {
		const was = mode();
		closePeople();
		st.q = '';
		st.person = null;
		if (was !== 'browse') restart(0);
	}
	function pickPerson(p: PickedPerson): void {
		closePeople();
		st.q = '';
		st.person = { id: p.id, name: p.name, photo: p.photo, role: p.role };
		restart(0);
	}
	/** Cambió un idioma (app o títulos): géneros y lista se vuelven a pedir. */
	function relang(): void {
		st.genreList = {};
		void loadGenres(st.f.kind);
		restart(0);
	}
	/** Primera vez: la lista y los géneros (si ya hay lista, queda como estaba). */
	function start(): void {
		void loadGenres(st.f.kind);
		if (!st.items.length && !st.loading && !st.pending) void loadMore();
	}
	/** Eventos en vivo del Api; devuelve cómo soltarlos. */
	function connect(): Unsubscribe {
		return api.events.subscribe((e) => {
			if (e.type === 'excluded' && !st.excluded.includes(e.id)) st.excluded.push(e.id);
		});
	}

	return { st, mode, visible, loadMore, restart, loadGenres, setFilters, resetFilters, toggleGenre, setQuery, clearSearch, pickPerson, closePeople, relang, start, connect };
}

export type CatalogStore = ReturnType<typeof createCatalog>;
