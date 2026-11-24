// `Api` del desktop: llamadas del núcleo por `api.js` (invoke de Tauri, sigue siendo la única puerta) + `core://event`, y los
// adaptadores puros de `tauri-adapt.ts`. `createTauriApi` recibe sus dependencias para probarse sin Tauri.
import type { Api } from '../../packages/ui/src/api.ts';
import type { Lang } from '../../packages/ui/src/i18n/translate.ts';
import type { ApiEvent, OptionsUpdate, TitleDetails } from '../../packages/ui/src/types.ts';
import * as adapt from './tauri-adapt.ts';
import type * as Raw from './types.js';

/** Lo que usa el adaptador de `api.js`. */
export type CoreApi = Pick<typeof import('./api.js').api,
	| 'apiKeys' | 'catalogBrowseTop' | 'catalogTrending' | 'catalogSearch' | 'catalogPeople' | 'catalogPersonTitles' | 'catalogInterestExamples' | 'catalogBrowseInterests' | 'catalogMeta' | 'catalogDetails' | 'catalogPoster'
	| 'catalogSimilar' | 'catalogEpisodes' | 'catalogSeasonRatings' | 'catalogAwards' | 'catalogStreams' | 'catalogLink' | 'catalogTorboxTracks' | 'library' | 'catalogSubtitles'
	| 'catalogSubtitleUse' | 'catalogPremiumUse' | 'catalogPremiumSearch' | 'premiumQuota' | 'torboxMagnet' | 'torboxMagnetDownload'>;
export type Core = { api: CoreApi; listen: (handler: (e: Raw.CoreEvent) => void) => Promise<() => void>; lang: () => Lang };

/** El desktop trae 50 por página en tendencias. */
const TRENDING_PAGE = 50;
const EMPTY = { items: [], hasMore: false };

export function createTauriApi(core: Core): Api {
	const { api } = core;
	const handlers = new Set<(e: Raw.CoreEvent) => void>();
	/** Una sola suscripción a `core://event` para toda la UI compartida; se reparte acá. */
	let listening: Promise<() => void> | null = null;
	const listen = async (): Promise<void> => {
		listening ??= core.listen((e) => handlers.forEach((h) => h(e)));
		await listening;
	};
	const subscribe = (h: (e: Raw.CoreEvent) => void): (() => void) => {
		handlers.add(h);
		return () => void handlers.delete(h);
	};
	/** Fichas ya pedidas: `episodes` las reusa (la lista de episodios viene en `catalog_meta`). */
	const metas = new Map<string, Raw.Meta>();
	const meta = async (kind: Raw.MediaKind, id: string): Promise<Raw.Meta> => {
		const hit = metas.get(id);
		if (hit) return hit;
		const m = await api.catalogMeta(kind, id);
		metas.set(id, m);
		return m;
	};

	return {
		capabilities: { speedTests: true, premiumSubs: true, library: true, localPlayer: true },
		catalog: {
			async browse(f, page) {
				const hasTmdb = (await api.apiKeys()).some((k) => k.service === 'tmdb' && k.configured);
				const kind = adapt.rawKind(f.kind);
				// Con género: subgéneros de IMDb (sin key de TMDB). Sin key de TMDB solo hay tendencias (sin filtros); Explorar con
				// filtros devuelve todo en una página.
				if (f.interests.length) return page > 1 ? EMPTY : adapt.catalogPage(await api.catalogBrowseInterests(kind, f.sort, f.from, f.to || null, f.minVotes, f.languages, f.interests));
				if (!hasTmdb) return { ...adapt.catalogPage(await api.catalogTrending(kind, (page - 1) * TRENDING_PAGE)), filtered: false };
				if (page > 1) return EMPTY;
				return adapt.catalogPage(await api.catalogBrowseTop(kind, f.sort, f.from, f.to || null, f.minVotes, f.languages));
			},
			search: async (q, page) => (page > 1 ? EMPTY : { items: adapt.catalogItems(await api.catalogSearch(q)), hasMore: false }),
			people: async (q) => adapt.personHits(await api.catalogPeople(q)),
			personTitles: async (id, role) => adapt.catalogItems(await api.catalogPersonTitles(id, role)),
			examples: (kind, ids) => api.catalogInterestExamples(adapt.rawKind(kind), ids),
			poster: async (id) => (await api.catalogPoster(id).catch(() => null)) ?? null
		},
		title: {
			async details(kind, id): Promise<TitleDetails> {
				const raw = adapt.rawKind(kind);
				// Sin key de TMDB la ficha sale solo con lo de Cinemeta.
				const [m, view] = await Promise.all([meta(raw, id), api.catalogDetails(raw, id).catch(() => null)]);
				return adapt.titleDetails(m, view, core.lang());
			},
			similar: async (kind, imdb) => adapt.similar(await api.catalogSimilar(adapt.rawKind(kind), imdb)),
			async episodes(id, season) {
				const [m, texts] = await Promise.all([meta('series', id), api.catalogEpisodes(id, season).catch((): Raw.EpisodeText[] => [])]);
				return adapt.episodes(m.episodes, texts, season);
			},
			seasonRatings: async (imdb, quick) => adapt.seasonRatings(await api.catalogSeasonRatings(imdb, quick)),
			awards: (imdb) => api.catalogAwards(imdb)
		},
		options: {
			async *load(ref): AsyncGenerator<OptionsUpdate> {
				const queue: OptionsUpdate[] = [];
				let wake: (() => void) | null = null;
				const off = subscribe((e) => {
					if (e.type !== 'catalog-streams' || e.update.video_id !== ref.videoId) return;
					queue.push(adapt.optionsUpdate(e.update));
					wake?.();
				});
				try {
					await listen();
					await api.catalogStreams(adapt.rawKind(ref.kind), ref.videoId);
					for (;;) {
						const next = queue.shift();
						if (!next) {
							await new Promise<void>((resolve) => (wake = resolve));
							continue;
						}
						yield next;
						if (next.done) return;
					}
				} finally {
					off();
				}
			},
			// `torbox: true`: el link https para castear, que es lo que pide la UI compartida (la web hace lo mismo).
			link: async (_ref, o, opts) => ({ url: await api.catalogLink(o.hash, true, opts?.orig ?? null, opts?.latino ?? false), choices: [], video: null }),
			async tracks(ref, o) {
				await api.catalogTorboxTracks(adapt.rawKind(ref.kind), ref.videoId, o.hash);
				const view = await api.library();
				return adapt.tracksOf([...view.pasted_now, ...view.previous], o.hash);
			}
		},
		subs: {
			find: async (ref, o) => {
				const r = await api.catalogSubtitles(ref.videoId, o.hash, 'es');
				return r.found.map((s) => adapt.subtitle(s, false, r.picks, r.timing_known));
			},
			async get(ref, o, sub) {
				if (!sub.premium) {
					await api.catalogSubtitleUse(ref.videoId, o.hash, sub.id);
					return { url: null, path: sub.path ?? null };
				}
				const r = await api.catalogPremiumUse(ref.videoId, o.hash, { id: Number(sub.id.split(':')[1]), release_name: sub.release, latino: sub.latino, level: sub.level });
				return { url: null, path: r.found.find((f) => f.key === sub.id)?.path || null };
			}
		},
		premium: {
			quota: async () => adapt.quota(await api.premiumQuota()),
			search: async (ref, o) => (await api.catalogPremiumSearch(ref.videoId, o.hash)).map((s) => adapt.subtitle(s, true))
		},
		magnet: {
			status: async (hash, name, who) => adapt.magnetView(await api.torboxMagnet(hash, name, who), hash),
			download: async (hash, name) => adapt.magnetStatus(await api.torboxMagnetDownload(hash, name), hash)
		},
		// TODO vistos desktop (otro agente)
		recent: { list: () => Promise.resolve([]), mark: () => Promise.resolve(), restore: () => Promise.resolve(), dismiss: () => Promise.resolve() },
		events: {
			subscribe(handler: (event: ApiEvent) => void) {
				void listen();
				return subscribe((e) => {
					const out = adapt.apiEvent(e);
					if (out) handler(out);
				});
			}
		}
	};
}

/** `Api` del desktop sobre el núcleo real. `api.js` se importa acá (no arriba) porque lee `window.__TAURI__` al cargar: tiene que
 * correr después del mock del navegador (`mock-tauri.ts`) y no en los tests. */
export async function createDesktopApi(lang: () => Lang): Promise<Api> {
	const { api, onCoreEvent } = await import('./api.js');
	return createTauriApi({ api, listen: onCoreEvent, lang });
}
