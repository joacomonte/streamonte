// Modelo de vista compartido por la web y el desktop. Cada app arma esto con su adaptador (`webApi.ts`, `tauriApi.ts`):
// ni el snake_case del núcleo Rust ni el camelCase de la web aparecen acá. Los ids son opacos: TMDB en la web, IMDb en el desktop.

export type Kind = 'movie' | 'tv';
export type Lang = 'es' | 'en';
/** Audio latino de una opción: 'lat' latino · 'likely' solo la web de origen es latina · 'spain' de España · 'check' no se sabe · 'none' leído y sin español. */
export type LatState = 'lat' | 'likely' | 'spain' | 'check' | 'none';
export type LatHint = 'lat' | 'likely' | 'spain';

// ---------- Catálogo ----------
export type CatalogItem = {
	id: string;
	kind: Kind;
	title: string;
	year: string | null;
	poster: string | null;
	/** Puntaje de IMDb ya formateado ("8.4"). */
	rating: string | null;
	/** Estreno AAAA-MM-DD (solo películas; null si no se sabe). */
	released: string | null;
	/** Género Documental: la tarjeta lo marca arriba del póster. */
	documentary: boolean;
};
/** `filtered: false` = la página ignoró los filtros (el desktop sin key de TMDB solo trae tendencias). */
export type CatalogPage = { items: CatalogItem[]; hasMore: boolean; filtered?: boolean };

export type BrowseFilters = {
	kind: Kind;
	sort: 'popular' | 'rating';
	/** AAAA-MM-DD ('' = sin tope). */
	from: string;
	to: string;
	minVotes: number;
	/** Idioma original ISO 639-1; [] = cualquiera. */
	languages: string[];
	/** Interests de IMDb (`in…`, alcanza con una; `catalog/subgenres.ts`). Con alguna, la lista sale de la búsqueda de IMDb. */
	interests: string[];
};
/** Película o serie de ejemplo de un subgénero (título como viene de IMDb). */
export type InterestExample = { title: string; poster: string | null };

export type PersonRole = 'cast' | 'director';
/** Sugerencia de persona del buscador. */
export type PersonHit = { id: number; name: string; photo: string | null; known: string; role: PersonRole };
/** Persona de la ficha; `note` = personaje (actores). */
export type Person = { id: number; name: string; photo: string | null; role: PersonRole; note: string | null };
export type Provider = { name: string; logo: string | null };

// ---------- Ficha ----------
export type ShowState = 'returning' | 'in-production' | 'planned' | 'ended' | 'canceled';
export type NextEpisode = { season: number; episode: number; date: string };
export type ShowStatus = { state: ShowState; next: NextEpisode | null };
export type SeasonScore = { season: number; rating: number; episodes: number };
/** Puntaje de IMDb de un capítulo. */
export type EpisodeScore = { episode: number; rating: number };
export type SeasonRatings = { seasons: SeasonScore[]; status: ShowStatus | null };

export type Season = { number: number; name: string | null; episodeCount: number; year: string | null };
export type Episode = {
	season: number;
	number: number;
	title: string;
	/** AAAA-MM-DD. */
	date: string | null;
	overview: string | null;
	still: string | null;
};

export type TitleDetails = {
	id: string;
	kind: Kind;
	title: string;
	year: string | null;
	poster: string | null;
	backdrop: string | null;
	rating: string | null;
	released: string | null;
	overview: string | null;
	/** Minutos (película) o por episodio (serie). */
	runtimeMin: number | null;
	genres: string[];
	country: string | null;
	/** Idioma original ISO 639-1 y su nombre para mostrar. */
	originalLanguage: string | null;
	languageName: string | null;
	providers: Provider[];
	people: Person[];
	companies: string[];
	networks: string[];
	/** Id de YouTube del tráiler. */
	imdb: string | null;
	status: ShowStatus | null;
	seasons: Season[];
};

/** Evento de premios que se detalla (IMDb): la UI lo nombra y ordena (`title/awards.ts`). */
export type AwardEvent = 'oscar' | 'globe' | 'bafta' | 'emmy' | 'sag' | 'goya' | 'cannes' | 'venice' | 'berlin';
/** Un premio o nominación de un evento grande, con los textos de IMDb (en inglés). */
export type AwardEntry = { event: AwardEvent; won: boolean; award: string; category: string | null; year: number | null };
/** Premios de un título (IMDb). `nominations`: las que no ganó. La misma forma sale del desktop (`catalog/awards.rs`) y
 * de la web (`server/awards.ts`). */
/** `interests`: subgéneros de IMDb del título (ids `in…`); `rating`: puntaje de IMDb, respaldo de la ficha. Los dos pueden
 * faltar en respuestas viejas guardadas. */
export type TitleAwards = { wins: number; nominations: number; entries: AwardEntry[]; interests?: string[]; rating?: number | null };

export type SimilarItem = { id: string; title: string; year: string | null; poster: string | null; rating: number | null };

// ---------- Opciones de torrents ----------
/** Una opción (release) de un video: unifica `Torrent` de la web y `StreamCandidate` del desktop. */
export type TorrentOption = {
	hash: string;
	release: string;
	file: string | null;
	fileIdx: number | null;
	resolution: string | null;
	hdr: string[];
	source: string | null;
	codec: string | null;
	audioFormat: string[];
	sizeBytes: number | null;
	seeds: number | null;
	leechers: number | null;
	completed: number | null;
	/** Idiomas de audio que dice el nombre ('lat', 'cast', 'es', 'multi', 'en'…). */
	audio: string[];
	/** Idiomas de subtítulos que dice el nombre. */
	subs: string[];
	/** Lo que sugiere el nombre o la web de origen sobre el audio latino. */
	hint: LatHint | null;
	/** MULTI / Dual. */
	multi: boolean;
	/** Dice o trae español sin aclarar cuál. */
	spanish: boolean;
	/** Trae un archivo de subtítulo en español (TorBox). */
	subFile: boolean;
	sites: string[];
	addons: string[];
	isPack: boolean;
};

export type SourceState = 'pending' | 'ok' | 'needs-config' | 'unsupported' | 'error';
export type SourceStatus = { id: string; name: string; state: SourceState; count: number; ms: number | null; message: string | null };

/** Una actualización de la búsqueda de opciones. La web emite progreso y una sola con `done: true`; el desktop, una por tanda de fuentes. */
export type OptionsUpdate = {
	options: TorrentOption[];
	sources: SourceStatus[];
	/** Fuentes consultadas hasta ahora / total (web). */
	progress: { done: number; total: number } | null;
	/** La web chequea la caché de TorBox. */
	checking: boolean;
	done: boolean;
};

export type OptionRef = { kind: Kind; videoId: string };
export type TorrentTracks = { subs: number; audios: { language: string; title: string }[] };
export type OptionLink = { url: string; choices: { key: string; label: string; url: string }[]; video: { fps: number | null; duration: number | null } | null;
	/** Web: el archivo concreto (para subtítulos exactos), los subs en español del video como links del stream, cuántos trae y los
	 * ids de TorBox (para leer sus pistas sin volver a agregar el torrent). */
	file?: { hash: string; size: string } | null; natives?: NativeSub[]; subsEs?: number | null; ids?: TorboxIds | null };
/** Ids de TorBox de un link ya pedido (torrent y archivo). */
export type TorboxIds = { tid: number; fid: number };
/** Subtítulo en español que trae el video (web: link del stream con ese subtítulo puesto). */
export type NativeSub = { label: string; kind: string; track: number; url: string };

// ---------- Subtítulos ----------
export type MatchLevel = 'exact' | 'release' | 'fps' | 'none';
export type SubtitleOption = {
	id: string;
	release: string;
	latino: boolean;
	format: string;
	downloads: number;
	level: MatchLevel;
	premium: boolean;
	/** Segundo del último diálogo / fps / grupo: para estimar si calza (web). */
	fps: number | null;
	last: number | null;
	group: string | null;
	/** Desktop: archivo ya bajado (para cargarlo en el reproductor en curso). */
	path?: string | null;
	/** Desktop: lo que el núcleo ya recuerda de este video (elegido / probado antes). */
	chosen?: boolean;
	tried?: boolean;
	/** Desktop: nombre del proveedor (Wyzie, Subdivx…) e idioma ('es' | 'en'). */
	provider?: string | null;
	language?: string | null;
	/** Desktop: el núcleo conoce fps y duración del archivo (si no, solo se reconoce el mismo release). */
	timingKnown?: boolean;
};
export type PremiumQuota = { hasKey: boolean; remaining: number | null; perDay: number | null; resetsAt: number | null; loginError: string | null };

// ---------- Magnet pegado ----------
export type MagnetState = 'cached' | 'downloading' | 'ready' | 'missing';
export type MagnetStatus = { state: MagnetState; name: string | null; progress: number; speed: number; seeds: number; eta: number; options: TorrentOption[] };
export type Identified = { kind: Kind; id: string; imdb: string | null; title: string; year: string | null; poster: string | null; rating: string | null; season: number | null; episode: number | null;
	/** Idioma original y duración (min), para la lista de opciones del torrent (web). */
	origLang?: string | null; runtime?: number | null };
export type MagnetView = { status: MagnetStatus; ident: Identified | null };

// ---------- Apodo de la web ----------
/** Lo que dice la web de un apodo: `login` si ya tiene código de animales, `nuevo` si el que entra lo crea. */
export type NickAsk = { nick: string; mode: 'nuevo' | 'login'; order: string[]; wait: number };
/** Lo guardado de la sesión: `codeSet` = código de acceso de la web cargado (en la web siempre, ya pasó el candado). */
export type NickStatus = { codeSet: boolean; nick: string | null };

// ---------- Capacidades y eventos ----------
export type Capabilities = {
	/** Pruebas de velocidad / swarm / calibración (motor local). */
	speedTests: boolean;
	/** Subtítulos Premium (OpenSubtitles.com) con cuota. */
	premiumSubs: boolean;
	/** Biblioteca de torrents medidos. */
	library: boolean;
	/** Reproductor local (mpv/VLC). */
	localPlayer: boolean;
};

/** Eventos en vivo que consume la UI compartida (la web no emite ninguno). */
export type ApiEvent =
	| { type: 'options'; videoId: string; update: OptionsUpdate }
	| { type: 'subtitles-progress'; videoId: string; downloading: boolean; done: number; total: number };
export type Unsubscribe = () => void;
