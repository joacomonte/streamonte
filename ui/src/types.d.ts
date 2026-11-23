// Tipos del núcleo (serde, snake_case; enums kebab-case; fechas ISO 8601; Option<T> = T|null). Generado de los @typedef de types.js (2026-11-22);
// ahora se edita acá. Uso: `import type { Meta } from './types.js'` o `import('./types.js').Meta` (resuelve a este archivo).
/**
 * 40 hex en minúsculas
 */
export type InfoHash = string;
/**
 * `<hex>` | `<hex>:s3e2` | `<hex>:f12`
 */
export type VideoKey = string;
export type PlaybackId = number;
export type IsoDate = string;
export type PlayerKind = "mpv" | "vlc";
export type Light = "green" | "yellow" | "red" | "unknown";
export type MediaKind = "movie" | "series";
export type Lang = "es" | "en";
export type SubtitleLanguage = "es" | "en" | "none";
export type StatusLevel = "info" | "warn" | "error";
/**
 * lo que rechaza `invoke`
 */
export type UiError = {
    message: string;
    detail: string;
};
export type Group = "pasted-now" | "previous";
/**
 * `reason` solo con `failed`.
 */
export type EntryStatus = {
    kind: "new" | "scraping" | "scraped" | "measuring" | "measured" | "failed";
    reason?: string;
};
export type ScrapeResult = {
    seeders: number;
    leechers: number;
    completed: number;
    trackers_ok: number;
    scraped_at: IsoDate;
};
export type AudioTrack = {
    lang: string | null;
    title: string | null;
    codec: string | null;
    channels: number | null;
    default: boolean;
};
export type NativeSub = {
    sid: number | null;
    file: string | null;
    lang: string | null;
    title: string | null;
    codec: string | null;
    forced: boolean;
};
export type NativeSpanish = {
    key: string;
    variant: "latino" | "spain" | "unknown";
    kind: string;
    place: string;
};
export type AudioLang = {
    code: string;
    short: string;
    label: string;
    confirmed: boolean;
    detail: string;
    aids: number[];
};
export type AudioOption = {
    code: string;
    label: string;
    aid: number | null;
    confirmed: boolean;
};
export type AudioPick = {
    code: string;
    aid?: number | null;
};
export type LiveMeasurement = {
    measured_at: IsoDate;
    torrent_name: string | null;
    file_index: number;
    file_name: string;
    file_size: number;
    peers: number;
    seeds: number;
    partial: boolean;
    measured_secs: number;
    avg_speed_bps: number;
    max_speed_bps: number;
    duration_secs: number | null;
    audio: AudioTrack[] | null;
    subs: NativeSub[] | null;
    fps: number | null;
};
export type CatalogOrigin = {
    video_id: string;
    imdb_id: string;
    title: string;
    year: string | null;
    season: number | null;
    episode: number | null;
    file_idx: number | null;
    addons: string[];
};
export type DurationInfo = {
    secs: number;
    estimated: boolean;
};
export type RankScore = {
    duration: DurationInfo | null;
    needed_bps: number | null;
    effective_speed_bps: number | null;
    speed_factor: number;
    margin: number | null;
    light: Light;
    capped_by_estimate: boolean;
    green_margin: number;
    yellow_margin: number;
};
export type ReleaseInfo = {
    title: string;
    year: number | null;
    season: number | null;
    episode: number | null;
    quality: string[];
};
/**
 * Fila de la biblioteca (`library_get`, evento `library-entry-updated`).
 */
export type LibraryRow = {
    key: VideoKey;
    info_hash: InfoHash;
    magnet: string;
    name: string;
    torrent_name: string | null;
    video_size: number | null;
    group: Group;
    status: EntryStatus;
    scrape: ScrapeResult | null;
    live: LiveMeasurement | null;
    added_at: IsoDate;
    last_copied_at: IsoDate;
    origin?: CatalogOrigin;
    score: RankScore;
    languages: AudioLang[];
    audio_options: AudioOption[];
    release: ReleaseInfo;
    native_subs: NativeSpanish[] | null;
    downloaded_bytes: number | null;
    sort_key: [number, number, number, number];
};
export type LibraryView = {
    pasted_now: LibraryRow[];
    previous: LibraryRow[];
};
export type CopiedMagnet = {
    raw: string;
    info_hash: InfoHash;
    name: string | null;
};
export type AnalyzeScope = {
    kind: "all";
} | {
    kind: "only-unmeasured";
} | {
    kind: "one";
    hash: InfoHash;
} | {
    kind: "selected";
    hashes: InfoHash[];
} | {
    kind: "quick";
    hash: InfoHash;
};
/**
 * Un solo objeto con los campos opcionales (el núcleo manda solo los de su `kind`): `preparing` → `fraction`, `paused` → `position_secs`, `failed` → `message`.
 */
export type PlaybackState = {
    kind: "fetching-metadata" | "preparing" | "playing" | "download-paused" | "stopping" | "ask-after-close" | "background" | "paused" | "failed";
    fraction?: number;
    position_secs?: number | null;
    message?: string;
};
export type PlaybackRow = {
    id: PlaybackId;
    key: VideoKey;
    info_hash: InfoHash;
    name: string;
    state: PlaybackState;
    player: PlayerKind;
    progress: number;
    speed_bps: number;
    peers: number;
    seeds: number;
    incoming_peers: number;
    started_at: IsoDate;
    metadata_secs: number | null;
    preload_secs: number | null;
    time_to_first_frame_secs: number | null;
    stream: boolean;
};
export type PlaybackAction = "pause-download" | "resume-download" | "stop" | "stop-and-delete" | "open-folder" | "keep-downloading";
export type CleanupReport = {
    dirs_removed: number;
    bytes_freed: number;
    processes_killed: number;
    failures: string[];
};
export type TempUsage = {
    bytes: number;
    folder: string;
};
export type LanguageConfig = {
    app: Lang;
    titles: Lang;
};
export type Equalizer = "cine" | "voices" | "flat";
export type SourceKind = "stremio" | "hacktorrent" | "elite-torrent" | "lat-team";
export type AddonEntry = {
    id: string;
    name: string;
    url: string | null;
    display_url: string;
    secret: boolean;
    enabled: boolean;
    timeout_ms: number | null;
    kind: SourceKind;
};
export type CatalogConfig = {
    addons: AddonEntry[];
    audio_order: string[];
    exclude_cam: boolean;
    exclude_japanese: boolean;
    timeout_ms: number;
    connect_timeout_ms: number;
};
export type EngineConfig = {
    kind: "webtorrent" | "rqbit";
    max_connections: number;
    metadata_timeout_secs: number;
    node_path: string | null;
    webtorrent_sidecar: string | null;
    incoming: boolean;
    listen_ports: [number, number];
    upnp: boolean;
    utp: boolean;
    announce_early: boolean;
};
export type PreloadConfig = {
    head_bytes: number;
    tail_bytes: number;
    fallback_open_secs: number;
};
export type AnalyzerConfig = {
    measure_secs: number;
    concurrency: number;
    retries: number;
    scrape_timeout_secs: number;
    auto_on_paste: boolean;
    speed_max_secs: number;
    quick_concurrency: number;
    quick_secs: number;
};
export type RankingConfig = {
    movie_minutes: number;
    episode_minutes: number;
    green_margin: number;
    yellow_margin: number;
};
export type PlayerConfig = {
    mpv_path: string | null;
    vlc_path: string | null;
    use_app_profile: boolean;
    modern_ui: boolean;
    equalizer: Equalizer;
};
/**
 * Respuesta de `config_get`.
 */
export type Config = {
    trackers: string[];
    engine: EngineConfig;
    preload: PreloadConfig;
    analyzer: AnalyzerConfig;
    ranking: RankingConfig;
    player: PlayerConfig;
    subtitles: {
        language: SubtitleLanguage;
        providers: string[];
    };
    clipboard: {
        read_history_on_start: boolean;
    };
    logging: {
        level: "error" | "warn" | "info" | "debug" | "trace";
        diagnostics: boolean;
    };
    catalog: CatalogConfig;
    language: LanguageConfig;
};
export type PlayersStatus = {
    mpv: "configured" | "bundled" | "installed" | null;
    vlc: boolean;
    can_install_mpv: boolean;
};
export type ApiKeyStatus = {
    service: string;
    configured: boolean;
};
export type SpeedResult = {
    mbps: number;
    measured_at: IsoDate;
    network: string;
};
export type SpeedState = {
    kind: "measuring";
    mbps: number;
} | {
    kind: "done";
    result: SpeedResult;
} | {
    kind: "failed";
    message: string;
};
export type IncomingCheck = {
    port: number;
    reachable: boolean | null;
    upnp_on: boolean;
    upnp: boolean | null;
    local_ip: string | null;
    problem: string | null;
};
/**
 * Resultado de búsqueda / tendencias / Explorar / "similares de persona" (`MetaPreview`).
 */
export type CatalogItem = {
    id: string;
    kind: MediaKind;
    name: string;
    year: string | null;
    imdb_rating: string | null;
    excluded: boolean;
    poster: string | null;
    released: string | null;
    popularity: number | null;
};
export type BrowsePage = {
    items: CatalogItem[];
    has_more: boolean;
};
export type Episode = {
    id: string;
    season: number;
    episode: number;
    title: string;
    released: string | null;
    overview: string | null;
    thumbnail: string | null;
    available: boolean;
};
/**
 * Ficha (`catalog_meta`).
 */
export type Meta = {
    id: string;
    kind: MediaKind;
    name: string;
    year: string | null;
    runtime_min: number | null;
    country: string | null;
    genres: string[];
    imdb_rating: string | null;
    description: string | null;
    poster: string | null;
    background: string | null;
    episodes: Episode[];
    excluded: boolean;
    status: string | null;
    cast: string[];
    awards: string | null;
    released: string | null;
    trailer: string | null;
    imdb_votes: number | null;
};
/**
 * Persona de las sugerencias del buscador (`catalog_people`).
 */
export type SearchPerson = {
    id: number;
    name: string;
    photo: string | null;
    known: string;
    role: "cast" | "director";
};
/**
 * Persona de la ficha (`Details.people`).
 */
export type Person = {
    id: number;
    name: string;
    photo: string | null;
    role: string;
    note: string | null;
};
export type Provider = {
    name: string;
    logo: string | null;
};
export type Details = {
    title: string | null;
    overview: string | null;
    genres: string[];
    providers: Provider[];
    original_language: string | null;
    networks: string[];
    trailer: string | null;
    people: Person[];
    companies: string[];
};
/**
 * `catalog_details`.
 */
export type DetailsView = {
    has_key: boolean;
    details: Details | null;
};
export type Similar = {
    id: string;
    name: string;
    year: string | null;
    poster: string | null;
    rating: number | null;
    tmdb_rating: number | null;
};
export type GenreName = {
    id: number;
    name: string;
};
export type EpisodeText = {
    episode: number;
    name: string | null;
    overview: string | null;
};
export type SeasonScore = {
    season: number;
    rating: number;
    episodes: number;
};
export type NextEpisode = {
    season: number;
    episode: number;
    date: string;
};
export type ShowStatus = {
    state: "returning" | "in-production" | "planned" | "ended" | "canceled";
    next: NextEpisode | null;
};
export type SeasonRatings = {
    seasons: SeasonScore[];
    status: ShowStatus | null;
};
export type AddonView = {
    id: string;
    name: string;
    display_url: string;
    enabled: boolean;
    secret: boolean;
    own: boolean;
};
export type SwarmCount = {
    seeds: number;
    peers: number;
    reached: boolean;
    known: number;
    incoming: number;
};
export type SavedTest = {
    count: SwarmCount;
    at: IsoDate;
};
/**
 * Opción (release) de un video (`StreamCandidate`, llega en `catalog-streams`).
 */
export type StreamCandidate = {
    info_hash: InfoHash;
    file_idx: number | null;
    file_name: string | null;
    release_name: string;
    size_bytes: number | null;
    seeders_declared: number | null;
    seeders: number | null;
    leechers: number | null;
    completed: number | null;
    resolution: string | null;
    hdr: string[];
    audio_format: string[];
    codec: string | null;
    source: string | null;
    audio: string[];
    subs: string[];
    lang_group: string;
    sites: string[];
    addons: string[];
    trackers: string[];
    binge_group: string | null;
    is_pack: boolean;
};
export type AddonStatus = {
    id: string;
    name: string;
    state: "pending" | "ok" | "needs-config" | "unsupported" | "error";
    count: number;
    ms: number | null;
    message: string | null;
};
export type StreamsUpdate = {
    video_id: string;
    addons: AddonStatus[];
    candidates: StreamCandidate[];
    done: boolean;
};
/**
 * `catalog_torbox`.
 */
export type TorboxCached = {
    hashes: InfoHash[];
    spanish_subs: InfoHash[];
    videos: {
        hash: InfoHash;
        name: string;
        resolution: string | null;
        source: string | null;
    }[];
};
export type MagnetStatus = {
    state: "cached" | "downloading" | "ready" | "missing";
    name: string | null;
    progress: number;
    speed: number;
    seeds: number;
    eta: number;
    files: {
        name: string;
        size: number;
    }[];
};
export type Identified = {
    kind: MediaKind;
    id: string;
    name: string;
    year: string | null;
    poster: string | null;
    rating: string | null;
    season: number | null;
    episode: number | null;
};
/**
 * `torbox_magnet`.
 */
export type TorboxMagnetView = {
    status: MagnetStatus;
    ident: Identified | null;
};
export type MatchKind = "exact" | "release" | "fps" | "none";
/**
 * Un subtítulo del dropdown (`path` vacío = resultado de Premium sin bajar).
 */
export type SubtitleFound = {
    key: string;
    provider: string;
    language: SubtitleLanguage;
    release_name: string;
    downloads: number;
    path: string;
    level: MatchKind;
    latino: boolean;
    head: string;
    spec: string;
};
export type SubtitlePicks = {
    chosen: string | null;
    tried: string[];
};
export type CatalogSubtitles = {
    found: SubtitleFound[];
    picks: SubtitlePicks;
    timing_known: boolean;
};
export type PremiumQuota = {
    has_key: boolean;
    has_login: boolean;
    login_error: string | null;
    remaining: number | null;
    per_day: number | null;
    resets_at: string | null;
};
export type PremiumPick = {
    id: number;
    release_name: string;
    latino: boolean;
    level: MatchKind;
};
export type AnalyzerState = {
    kind: "idle";
} | {
    kind: "scraping";
    total: number;
} | {
    kind: "quick-scan";
    total: number;
} | {
    kind: "measuring";
    done: number;
    total: number;
    current: InfoHash | null;
    live: SpeedProgress | null;
    provisional: {
        key: VideoKey;
        score: RankScore;
    }[];
} | {
    kind: "paused";
    done: number;
    total: number;
};
export type SpeedProgress = {
    speed_bps: number;
    secs: number;
    peers: number;
    seeds: number;
    stable: boolean;
    downloaded_bytes: number;
    phase: "connecting" | "metadata" | "preload" | "measuring" | "probing";
};
export type CoreEvent = {
    type: "library-entry-updated";
    entry: LibraryRow;
} | {
    type: "library-entry-removed";
    key: VideoKey;
} | {
    type: "clipboard-history-unavailable";
    reason: "history-disabled" | "not-supported-on-this-os";
} | {
    type: "analyzer-progress";
    state: AnalyzerState;
} | {
    type: "analyzer-queue";
    queued: InfoHash[];
    held: InfoHash[];
} | {
    type: "playback-updated";
    row: PlaybackRow;
} | {
    type: "playback-removed";
    id: PlaybackId;
} | {
    type: "playback-log";
    id: PlaybackId;
    line: string;
} | {
    type: "catalog-streams";
    update: StreamsUpdate;
} | {
    type: "catalog-excluded";
    id: string;
} | {
    type: "catalog-swarm-counted";
    hash: InfoHash;
    count: SwarmCount;
    deep: boolean;
} | {
    type: "catalog-swarm-progress";
    hash: InfoHash;
    count: SwarmCount;
    deep: boolean;
} | {
    type: "catalog-subtitles-progress";
    video_id: string;
    downloading: boolean;
    done: number;
    total: number;
} | {
    type: "activity";
    level: StatusLevel;
    area: string;
    message: string;
    at: IsoDate;
} | {
    type: "confirm-close";
    active: number;
} | {
    type: "speed-test";
    state: SpeedState;
} | {
    type: "status";
    level: StatusLevel;
    message: string;
};
/** Salud estimada: los tipos viven con sus cuentas en `packages/ui/src/options/health.ts`. */
export type { HealthBias, HealthBiasMap, HealthCalibration, HealthCalInput, HealthEvidence, HealthFidelity, HealthKind, HealthMeasurement, HealthRange, HealthSample, ShownLevel } from '../../packages/ui/src/options/health.ts';
