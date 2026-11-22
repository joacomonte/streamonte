// @ts-check
// Typedefs compartidos de la UI: SOLO `@typedef` (sin código). Formas = structs Rust serializados con serde
// (src-tauri/src/commands.rs y crates/core/src/**). Campos en snake_case; enums `kebab-case`; fechas = ISO 8601
// (string); `Option<T>` = `T|null` (los que tienen `#[serde(default)]` igual llegan, como null/[]).
// Uso: `/** @param {import('./types.js').Meta} m */`. Agregar al final (append-only).

// ---------- Básicos ----------
/** @typedef {string} InfoHash  40 hex en minúsculas */
/** @typedef {string} VideoKey  `<hex>` | `<hex>:s3e2` | `<hex>:f12` */
/** @typedef {number} PlaybackId */
/** @typedef {string} IsoDate */
/** @typedef {'mpv'|'vlc'} PlayerKind */
/** @typedef {'green'|'yellow'|'red'|'unknown'} Light */
/** @typedef {'movie'|'series'} MediaKind */
/** @typedef {'es'|'en'} Lang */
/** @typedef {'es'|'en'|'none'} SubtitleLanguage */
/** @typedef {'info'|'warn'|'error'} StatusLevel */
/** @typedef {{message:string, detail:string}} UiError  lo que rechaza `invoke` */

// ---------- Biblioteca ----------
/** @typedef {'pasted-now'|'previous'} Group */
/** `reason` solo con `failed`. @typedef {{kind:'new'|'scraping'|'scraped'|'measuring'|'measured'|'failed', reason?:string}} EntryStatus */
/** @typedef {{seeders:number, leechers:number, completed:number, trackers_ok:number, scraped_at:IsoDate}} ScrapeResult */
/** @typedef {{lang:string|null, title:string|null, codec:string|null, channels:number|null, default:boolean}} AudioTrack */
/** @typedef {{sid:number|null, file:string|null, lang:string|null, title:string|null, codec:string|null, forced:boolean}} NativeSub */
/** @typedef {{key:string, variant:'latino'|'spain'|'unknown', kind:string, place:string}} NativeSpanish */
/** @typedef {{code:string, short:string, label:string, confirmed:boolean, detail:string, aids:number[]}} AudioLang */
/** @typedef {{code:string, label:string, aid:number|null, confirmed:boolean}} AudioOption */
/** @typedef {{code:string, aid?:number|null}} AudioPick */
/** @typedef {{measured_at:IsoDate, torrent_name:string|null, file_index:number, file_name:string, file_size:number, peers:number, seeds:number, partial:boolean, measured_secs:number, avg_speed_bps:number, max_speed_bps:number, duration_secs:number|null, audio:AudioTrack[]|null, subs:NativeSub[]|null, fps:number|null}} LiveMeasurement */
/** @typedef {{video_id:string, imdb_id:string, title:string, year:string|null, season:number|null, episode:number|null, file_idx:number|null, addons:string[]}} CatalogOrigin */
/** @typedef {{secs:number, estimated:boolean}} DurationInfo */
/** @typedef {{duration:DurationInfo|null, needed_bps:number|null, effective_speed_bps:number|null, speed_factor:number, margin:number|null, light:Light, capped_by_estimate:boolean, green_margin:number, yellow_margin:number}} RankScore */
/** @typedef {{title:string, year:number|null, season:number|null, episode:number|null, quality:string[]}} ReleaseInfo */
/** Fila de la biblioteca (`library_get`, evento `library-entry-updated`).
 *  @typedef {{key:VideoKey, info_hash:InfoHash, magnet:string, name:string, torrent_name:string|null, video_size:number|null,
 *   group:Group, status:EntryStatus, scrape:ScrapeResult|null, live:LiveMeasurement|null, added_at:IsoDate, last_copied_at:IsoDate,
 *   origin?:CatalogOrigin, score:RankScore, languages:AudioLang[], audio_options:AudioOption[], release:ReleaseInfo,
 *   native_subs:NativeSpanish[]|null, downloaded_bytes:number|null, sort_key:[number,number,number,number]}} LibraryRow */
/** @typedef {{pasted_now:LibraryRow[], previous:LibraryRow[]}} LibraryView */
/** @typedef {{raw:string, info_hash:InfoHash, name:string|null}} CopiedMagnet */
/** @typedef {{kind:'all'}|{kind:'only-unmeasured'}|{kind:'one', hash:InfoHash}|{kind:'selected', hashes:InfoHash[]}|{kind:'quick', hash:InfoHash}} AnalyzeScope */

// ---------- Reproducción ----------
/** Un solo objeto con los campos opcionales (el núcleo manda solo los de su `kind`): `preparing` → `fraction`, `paused` → `position_secs`, `failed` → `message`.
 *  @typedef {{kind:'fetching-metadata'|'preparing'|'playing'|'download-paused'|'stopping'|'ask-after-close'|'background'|'paused'|'failed', fraction?:number, position_secs?:number|null, message?:string}} PlaybackState */
/** @typedef {{id:PlaybackId, key:VideoKey, info_hash:InfoHash, name:string, state:PlaybackState, player:PlayerKind, progress:number,
 *   speed_bps:number, peers:number, seeds:number, incoming_peers:number, started_at:IsoDate, metadata_secs:number|null,
 *   preload_secs:number|null, time_to_first_frame_secs:number|null, stream:boolean}} PlaybackRow */
/** @typedef {'pause-download'|'resume-download'|'stop'|'stop-and-delete'|'open-folder'|'keep-downloading'} PlaybackAction */
/** @typedef {{dirs_removed:number, bytes_freed:number, processes_killed:number, failures:string[]}} CleanupReport */
/** @typedef {{bytes:number, folder:string}} TempUsage */

// ---------- Configuración ----------
/** @typedef {{app:Lang, titles:Lang}} LanguageConfig */
/** @typedef {'cine'|'voices'|'flat'} Equalizer */
/** @typedef {'stremio'|'hacktorrent'|'elite-torrent'|'lat-team'} SourceKind */
/** @typedef {{id:string, name:string, url:string|null, display_url:string, secret:boolean, enabled:boolean, timeout_ms:number|null, kind:SourceKind}} AddonEntry */
/** @typedef {{addons:AddonEntry[], audio_order:string[], exclude_cam:boolean, exclude_japanese:boolean, timeout_ms:number, connect_timeout_ms:number, torbox_shared:boolean}} CatalogConfig */
/** @typedef {{kind:'webtorrent'|'rqbit', max_connections:number, metadata_timeout_secs:number, node_path:string|null, webtorrent_sidecar:string|null,
 *   incoming:boolean, listen_ports:[number,number], upnp:boolean, utp:boolean, announce_early:boolean}} EngineConfig */
/** @typedef {{head_bytes:number, tail_bytes:number, fallback_open_secs:number}} PreloadConfig */
/** @typedef {{measure_secs:number, concurrency:number, retries:number, scrape_timeout_secs:number, auto_on_paste:boolean, speed_max_secs:number, quick_concurrency:number, quick_secs:number}} AnalyzerConfig */
/** @typedef {{movie_minutes:number, episode_minutes:number, green_margin:number, yellow_margin:number}} RankingConfig */
/** @typedef {{mpv_path:string|null, vlc_path:string|null, use_app_profile:boolean, modern_ui:boolean, equalizer:Equalizer}} PlayerConfig */
/** Respuesta de `config_get`.
 *  @typedef {{trackers:string[], engine:EngineConfig, preload:PreloadConfig, analyzer:AnalyzerConfig, ranking:RankingConfig,
 *   player:PlayerConfig, subtitles:{language:SubtitleLanguage, providers:string[]}, clipboard:{read_history_on_start:boolean},
 *   logging:{level:'error'|'warn'|'info'|'debug'|'trace', diagnostics:boolean}, catalog:CatalogConfig, language:LanguageConfig}} Config */
/** @typedef {{mpv:'configured'|'bundled'|'installed'|null, vlc:boolean, can_install_mpv:boolean}} PlayersStatus */
/** @typedef {{service:string, configured:boolean}} ApiKeyStatus */
/** @typedef {{mbps:number, measured_at:IsoDate, network:string}} SpeedResult */
/** @typedef {{kind:'measuring', mbps:number}|{kind:'done', result:SpeedResult}|{kind:'failed', message:string}} SpeedState */
/** @typedef {{port:number, reachable:boolean|null, upnp_on:boolean, upnp:boolean|null, local_ip:string|null, problem:string|null}} IncomingCheck */

// ---------- Catálogo ----------
/** Resultado de búsqueda / tendencias / Explorar / "similares de persona" (`MetaPreview`).
 *  @typedef {{id:string, kind:MediaKind, name:string, year:string|null, imdb_rating:string|null, excluded:boolean,
 *   poster:string|null, released:string|null, popularity:number|null}} CatalogItem */
/** @typedef {{items:CatalogItem[], has_more:boolean}} BrowsePage */
/** @typedef {{id:string, season:number, episode:number, title:string, released:string|null, overview:string|null, thumbnail:string|null, available:boolean}} Episode */
/** Ficha (`catalog_meta`).
 *  @typedef {{id:string, kind:MediaKind, name:string, year:string|null, runtime_min:number|null, country:string|null, genres:string[],
 *   imdb_rating:string|null, description:string|null, poster:string|null, background:string|null, episodes:Episode[], excluded:boolean,
 *   status:string|null, cast:string[], awards:string|null, released:string|null, trailer:string|null, imdb_votes:number|null}} Meta */
/** Persona de las sugerencias del buscador (`catalog_people`).
 *  @typedef {{id:number, name:string, photo:string|null, known:string, role:'cast'|'director'}} SearchPerson */
/** Persona de la ficha (`Details.people`). @typedef {{id:number, name:string, photo:string|null, role:string, note:string|null}} Person */
/** @typedef {{name:string, logo:string|null}} Provider */
/** @typedef {{title:string|null, overview:string|null, genres:string[], providers:Provider[], original_language:string|null,
 *   networks:string[], trailer:string|null, people:Person[], companies:string[]}} Details */
/** `catalog_details`. @typedef {{has_key:boolean, details:Details|null}} DetailsView */
/** @typedef {{id:string, name:string, year:string|null, poster:string|null, rating:number|null, tmdb_rating:number|null}} Similar */
/** @typedef {{id:number, name:string}} GenreName */
/** @typedef {{episode:number, name:string|null, overview:string|null}} EpisodeText */
/** @typedef {{season:number, rating:number, episodes:number}} SeasonScore */
/** @typedef {{season:number, episode:number, date:string}} NextEpisode */
/** @typedef {{state:'returning'|'in-production'|'planned'|'ended'|'canceled', next:NextEpisode|null}} ShowStatus */
/** @typedef {{seasons:SeasonScore[], status:ShowStatus|null}} SeasonRatings */
/** @typedef {{id:string, name:string, display_url:string, enabled:boolean, secret:boolean, own:boolean}} AddonView */
/** @typedef {{seeds:number, peers:number, reached:boolean, known:number, incoming:number}} SwarmCount */
/** @typedef {{count:SwarmCount, at:IsoDate}} SavedTest */
/** Opción (release) de un video (`StreamCandidate`, llega en `catalog-streams`).
 *  @typedef {{info_hash:InfoHash, file_idx:number|null, file_name:string|null, release_name:string, size_bytes:number|null,
 *   seeders_declared:number|null, seeders:number|null, leechers:number|null, completed:number|null, resolution:string|null,
 *   hdr:string[], audio_format:string[], codec:string|null, source:string|null, audio:string[], subs:string[], lang_group:string,
 *   sites:string[], addons:string[], trackers:string[], binge_group:string|null, is_pack:boolean}} StreamCandidate */
/** @typedef {{id:string, name:string, state:'pending'|'ok'|'needs-config'|'unsupported'|'error', count:number, ms:number|null, message:string|null}} AddonStatus */
/** @typedef {{video_id:string, addons:AddonStatus[], candidates:StreamCandidate[], done:boolean}} StreamsUpdate */
/** `catalog_torbox`. @typedef {{hashes:InfoHash[], spanish_subs:InfoHash[], videos:{hash:InfoHash, name:string, resolution:string|null, source:string|null}[]}} TorboxCached */
/** @typedef {{state:'cached'|'downloading'|'ready'|'missing', name:string|null, progress:number, speed:number, seeds:number, eta:number, files:{name:string, size:number}[]}} MagnetStatus */
/** @typedef {{kind:MediaKind, id:string, name:string, year:string|null, poster:string|null, rating:string|null, season:number|null, episode:number|null}} Identified */
/** `torbox_magnet`. @typedef {{status:MagnetStatus, ident:Identified|null}} TorboxMagnetView */

// ---------- Subtítulos ----------
/** @typedef {'exact'|'release'|'fps'|'none'} MatchKind */
/** Un subtítulo del dropdown (`path` vacío = resultado de Premium sin bajar).
 *  @typedef {{key:string, provider:string, language:SubtitleLanguage, release_name:string, downloads:number, path:string,
 *   level:MatchKind, latino:boolean, head:string, spec:string}} SubtitleFound */
/** @typedef {{chosen:string|null, tried:string[]}} SubtitlePicks */
/** @typedef {{found:SubtitleFound[], picks:SubtitlePicks, timing_known:boolean}} CatalogSubtitles */
/** @typedef {{has_key:boolean, has_login:boolean, login_error:string|null, remaining:number|null, per_day:number|null, resets_at:string|null}} PremiumQuota */
/** @typedef {{id:number, release_name:string, latino:boolean, level:MatchKind}} PremiumPick */

// ---------- Eventos del núcleo (`core://event`, discriminante `type`) ----------
/** @typedef {{kind:'idle'} | {kind:'scraping', total:number} | {kind:'quick-scan', total:number} |
 *  {kind:'measuring', done:number, total:number, current:InfoHash|null, live:SpeedProgress|null, provisional:{key:VideoKey, score:RankScore}[]} |
 *  {kind:'paused', done:number, total:number}} AnalyzerState */
/** @typedef {{speed_bps:number, secs:number, peers:number, seeds:number, stable:boolean, downloaded_bytes:number,
 *   phase:'connecting'|'metadata'|'preload'|'measuring'|'probing'}} SpeedProgress */
/** @typedef {{type:'library-entry-updated', entry:LibraryRow}
 *  | {type:'library-entry-removed', key:VideoKey}
 *  | {type:'clipboard-history-unavailable', reason:'history-disabled'|'not-supported-on-this-os'}
 *  | {type:'analyzer-progress', state:AnalyzerState}
 *  | {type:'analyzer-queue', queued:InfoHash[], held:InfoHash[]}
 *  | {type:'playback-updated', row:PlaybackRow}
 *  | {type:'playback-removed', id:PlaybackId}
 *  | {type:'playback-log', id:PlaybackId, line:string}
 *  | {type:'catalog-streams', update:StreamsUpdate}
 *  | {type:'catalog-excluded', id:string}
 *  | {type:'catalog-swarm-counted', hash:InfoHash, count:SwarmCount, deep:boolean}
 *  | {type:'catalog-swarm-progress', hash:InfoHash, count:SwarmCount, deep:boolean}
 *  | {type:'catalog-subtitles-progress', video_id:string, downloading:boolean, done:number, total:number}
 *  | {type:'activity', level:StatusLevel, area:string, message:string, at:IsoDate}
 *  | {type:'confirm-close', active:number}
 *  | {type:'speed-test', state:SpeedState}
 *  | {type:'status', level:StatusLevel, message:string}} CoreEvent */

// ---------- Salud estimada (health-calib.js) ----------
/** Lo que sabía el análisis de una opción al predecir su velocidad (`evidenceOf` del catálogo).
 *  @typedef {{analysis_mbps?:number|null, tracker_seeds?:number|null, tracker_leechers?:number|null, counted_seeds?:number|null,
 *   counted_leech?:number|null, need_mbps?:number|null, known?:number|null, dht?:number|null}} HealthEvidence */
/** Medición guardada (localStorage `streamonte.health` → `bg`) o de la biblioteca; `ev`/`real_mbps` si ya es muestra.
 *  @typedef {{hash?:string, name?:string, source?:string, seeds?:number, avg_speed_bps:number, max_speed_bps:number,
 *   sustained_bps?:number, measured_secs:number, measured_at:string, network?:string|null, partial?:boolean,
 *   ev?:HealthEvidence, real_mbps?:number, short?:boolean, window_secs?:number, real_seeds?:number, real_peers?:number, real_incoming?:number,
 *   known_peers?:number|null, dht_peers?:number|null, weight?:number, tracker_seeds?:number|null, tracker_leechers?:number|null}} HealthMeasurement */
/** Muestra que enseña (`learnable`). @typedef {HealthMeasurement & {ev:HealthEvidence, real_mbps:number, weight?:number}} HealthSample */
/** @typedef {'measured'|'counted'|'tracker'} HealthKind */
/** @typedef {{bias:number, factor:number, n:number, nEff:number, lo:number, hi:number}} HealthBias */
/** @typedef {Partial<Record<HealthKind, HealthBias>>} HealthBiasMap */
/** Entrada de `predict`/`rangeOf`: `{bias, manual, capMbps}`. @typedef {{bias?:HealthBiasMap, manual?:number|null, capMbps?:number|null}} HealthCalInput */
/** Rango en Mbps de una predicción. @typedef {{kind:HealthKind, lo:number, p50:number, p75:number, hi:number, conf:'alta'|'media'|'baja'}} HealthRange */
/** @typedef {{level:number, shown:number, probable:boolean}} ShownLevel */
/** @typedef {{n:number, biasBefore:number, biasAfter:number, typBefore:number, typAfter:number, hits:number, pessimistic:number, optimistic:number, inBand:number}} HealthFidelity */
/** Resultado de `healthCalibration`. @typedef {{capMbps:number|null, capFrom:'test'|'measured'|null, samples:HealthMeasurement[],
 *   learnable:HealthSample[], bias:Record<HealthKind, HealthBias>, manual:number|null, n:number, trackerN:number, seedMbps:number,
 *   trackerSeedMbps:number, measuredFactor:number, source:'manual'|'measured'|'default'}} HealthCalibration */
