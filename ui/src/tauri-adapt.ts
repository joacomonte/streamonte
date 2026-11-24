// Adaptadores puros del desktop: JSON serde del núcleo (snake_case, ver `types.js`) → modelo de vista de `packages/ui`.
// Sin `invoke` ni DOM (se prueban con las fixtures grabadas en `ui/mock/`); `tauriApi.ts` hace las llamadas.
import { hintOf } from '../../packages/ui/src/rank.ts';
import type { Lang } from '../../packages/ui/src/i18n/translate.ts';
import type {
	ApiEvent, CatalogItem, CatalogPage, Episode, Identified, Kind, MagnetStatus, MagnetView, OptionsUpdate, PersonHit, PersonRole, PremiumQuota, SeasonRatings,
	ShowStatus, SimilarItem, SourceStatus, SubtitleOption, TitleDetails, TorrentOption, TorrentTracks
} from '../../packages/ui/src/types.ts';
import type * as Raw from './types.js';

export const kindOf = (k: Raw.MediaKind): Kind => (k === 'series' ? 'tv' : 'movie');
export const rawKind = (k: Kind): Raw.MediaKind => (k === 'tv' ? 'series' : 'movie');

export const catalogItem = (c: Raw.CatalogItem): CatalogItem => ({
	id: c.id,
	kind: kindOf(c.kind),
	title: c.name,
	year: c.year,
	poster: c.poster,
	rating: c.imdb_rating,
	released: c.released,
	excluded: c.excluded,
	// Las fixtures de `ui/mock/` se grabaron antes de que existiera.
	documentary: c.documentary ?? false
});

export const catalogItems = (raw: Raw.CatalogItem[]): CatalogItem[] => raw.map(catalogItem);
export const catalogPage = (raw: Raw.BrowsePage): CatalogPage => ({ items: catalogItems(raw.items), hasMore: raw.has_more });

const roleOf = (r: string): PersonRole => (r === 'director' ? 'director' : 'cast');
export const personHits = (raw: Raw.SearchPerson[]): PersonHit[] => raw.map((p) => ({ id: p.id, name: p.name, photo: p.photo, known: p.known, role: p.role }));

const STATES: Record<string, ShowStatus['state']> = {
	Ended: 'ended', Canceled: 'canceled', Cancelled: 'canceled', 'Returning Series': 'returning', 'In Production': 'in-production', Planned: 'planned',
	returning: 'returning', 'in-production': 'in-production', planned: 'planned', ended: 'ended', canceled: 'canceled'
};

/** Temporadas armadas con los episodios de la ficha (el núcleo no manda la lista de temporadas). */
function seasonsOf(episodes: Raw.Episode[]): TitleDetails['seasons'] {
	const bySeason = new Map<number, Raw.Episode[]>();
	for (const e of episodes) if (e.season > 0) bySeason.set(e.season, [...(bySeason.get(e.season) ?? []), e]);
	return [...bySeason.entries()]
		.sort(([a], [b]) => a - b)
		.map(([number, eps]) => ({ number, name: null, episodeCount: eps.length, year: eps.find((e) => e.released)?.released?.slice(0, 4) ?? null }));
}

/** Ficha: lo básico viene de `catalog_meta` (Cinemeta) y lo de TMDB de `catalog_details` (sinopsis, reparto, plataformas), que puede faltar (sin key). */
export function titleDetails(meta: Raw.Meta, view: Raw.DetailsView | null, lang: Lang = 'es'): TitleDetails {
	const d = view?.details ?? null;
	const code = d?.original_language ?? null;
	const state = meta.status ? STATES[meta.status] : undefined;
	return {
		id: meta.id,
		kind: kindOf(meta.kind),
		title: d?.title ?? meta.name,
		year: meta.year,
		poster: meta.poster,
		backdrop: meta.background,
		rating: meta.imdb_rating,
		released: meta.released,
		overview: d?.overview ?? meta.description,
		runtimeMin: meta.runtime_min,
		genres: d?.genres.length ? d.genres : meta.genres,
		country: meta.country,
		originalLanguage: code,
		languageName: code ? (new Intl.DisplayNames([lang], { type: 'language' }).of(code) ?? null) : null,
		providers: d?.providers ?? [],
		people: (d?.people ?? []).map((p) => ({ id: p.id, name: p.name, photo: p.photo, role: roleOf(p.role), note: p.note })),
		companies: d?.companies ?? [],
		networks: d?.networks ?? [],
		imdb: meta.id,
		status: state ? { state, next: null } : null,
		seasons: seasonsOf(meta.episodes),
		excluded: meta.excluded
	};
}

export const similar = (raw: Raw.Similar[]): SimilarItem[] => raw.map((s) => ({ id: s.id, title: s.name, year: s.year, poster: s.poster, rating: s.rating }));

/** Episodios de una temporada: los de la ficha, con nombre y sinopsis en el idioma elegido si `catalog_episodes` los trajo. */
export function episodes(meta: Raw.Episode[], texts: Raw.EpisodeText[], season: number): Episode[] {
	return meta
		.filter((e) => e.season === season)
		.map((e) => {
			const text = texts.find((x) => x.episode === e.episode);
			return { season, number: e.episode, title: text?.name ?? e.title, date: e.released?.slice(0, 10) ?? null, overview: text?.overview ?? e.overview, still: e.thumbnail };
		});
}

export const seasonRatings = (raw: Raw.SeasonRatings): SeasonRatings => ({
	seasons: raw.seasons.map((s) => ({ season: s.season, rating: s.rating, episodes: s.episodes })),
	status: raw.status ? { state: raw.status.state, next: raw.status.next ? { ...raw.status.next } : null } : null
});

/** `spanishSubs`: hashes de TorBox con un .srt en español adentro (`catalog_torbox`). */
export function option(c: Raw.StreamCandidate, spanishSubs: ReadonlySet<string> = new Set()): TorrentOption {
	return {
		hash: c.info_hash,
		release: c.release_name,
		file: c.file_name,
		fileIdx: c.file_idx,
		resolution: c.resolution,
		hdr: c.hdr,
		source: c.source,
		codec: c.codec,
		audioFormat: c.audio_format,
		sizeBytes: c.size_bytes,
		seeds: c.seeders ?? c.seeders_declared,
		leechers: c.leechers,
		completed: c.completed,
		audio: c.audio,
		subs: c.subs,
		hint: hintOf({ release: c.release_name, file: c.file_name, audio: c.audio }),
		multi: c.audio.includes('multi'),
		spanish: c.audio.includes('multi') || c.audio.includes('es'),
		subFile: spanishSubs.has(c.info_hash),
		sites: c.sites,
		addons: c.addons,
		isPack: c.is_pack
	};
}

const source = (a: Raw.AddonStatus): SourceStatus => ({ id: a.id, name: a.name, state: a.state, count: a.count, ms: a.ms, message: a.message });

export function optionsUpdate(u: Raw.StreamsUpdate, spanishSubs?: ReadonlySet<string>): OptionsUpdate {
	const sources = u.addons.map(source);
	return {
		options: u.candidates.map((c) => option(c, spanishSubs)),
		sources,
		progress: { done: sources.filter((s) => s.state !== 'pending').length, total: sources.length },
		checking: false,
		done: u.done
	};
}

export const subtitle = (s: Raw.SubtitleFound, premium = false, picks?: Raw.SubtitlePicks, timingKnown?: boolean): SubtitleOption => ({
	id: s.key,
	release: s.release_name,
	latino: s.latino,
	format: '',
	downloads: s.downloads,
	level: s.level,
	premium,
	fps: null,
	last: null,
	group: null,
	path: s.path || null,
	chosen: picks?.chosen === s.key,
	tried: picks?.tried.includes(s.key) ?? false,
	provider: s.provider || null,
	language: s.language,
	timingKnown
});

export const quota = (q: Raw.PremiumQuota): PremiumQuota => ({
	hasKey: q.has_key,
	remaining: q.remaining,
	perDay: q.per_day,
	resetsAt: q.resets_at ? Date.parse(q.resets_at) || null : null,
	loginError: q.login_error
});

export const magnetStatus = (s: Raw.MagnetStatus, hash: string): MagnetStatus => ({
	state: s.state,
	name: s.name,
	progress: s.progress,
	speed: s.speed,
	seeds: s.seeds,
	eta: s.eta,
	// El núcleo manda los archivos; la opción que se arma solo sabe su hash, nombre y peso.
	options: s.files.map((f) => ({
		hash, release: f.name, file: f.name, fileIdx: null, resolution: null, hdr: [], source: null, codec: null, audioFormat: [], sizeBytes: f.size || null, seeds: null,
		leechers: null, completed: null, audio: [], subs: [], hint: null, multi: false, spanish: false, subFile: false, sites: [], addons: [], isPack: false
	}))
});

const identified = (i: Raw.Identified): Identified => ({ kind: kindOf(i.kind), id: i.id, imdb: i.id, title: i.name, year: i.year, poster: i.poster, rating: i.rating, season: i.season, episode: i.episode });
export const magnetView = (v: Raw.TorboxMagnetView, hash: string): MagnetView => ({ status: magnetStatus(v.status, hash), ident: v.ident ? identified(v.ident) : null });

/** Pistas leídas de una opción (quedan en su fila de la biblioteca tras `catalog_torbox_tracks`). */
export function tracksOf(rows: Raw.LibraryRow[], hash: string): TorrentTracks {
	const row = rows.find((r) => r.info_hash === hash && r.live?.audio);
	return {
		subs: row?.native_subs?.length ?? 0,
		audios: (row?.live?.audio ?? []).map((a) => ({ language: a.lang ?? '', title: a.title ?? '' }))
	};
}

/** Evento del núcleo → evento de vista (los que la UI compartida consume); el resto, null. */
export function apiEvent(e: Raw.CoreEvent, spanishSubs?: ReadonlySet<string>): ApiEvent | null {
	switch (e.type) {
		case 'catalog-streams': return { type: 'options', videoId: e.update.video_id, update: optionsUpdate(e.update, spanishSubs) };
		case 'catalog-excluded': return { type: 'excluded', id: e.id };
		case 'catalog-subtitles-progress': return { type: 'subtitles-progress', videoId: e.video_id, downloading: e.downloading, done: e.done, total: e.total };
		default: return null;
	}
}
