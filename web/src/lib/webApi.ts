// `Api` de la web: `fetch` a /api/* (rutas en src/routes/api/) y adaptadores puros de `web-adapt.ts`.
import type { Api } from '../../../packages/ui/src/api.ts';
import type { ApiEvent, BrowseFilters, Kind, OptionRef, SubtitleOption, TorrentOption } from '../../../packages/ui/src/types.ts';
import * as adapt from './web-adapt.ts';
import type { ApiError, CatalogPageRaw, Episodes, Genres, LinkRaw, MagnetRaw, PeopleRaw, PremiumRaw, QuotaRaw, SeasonScore, Sub, Title, TracksRaw } from './types.ts';

type Fetch = typeof fetch;

/** `imdb`, `s`, `e` de la query a partir de `tt…` o `tt…:S:E`. */
function episodeQuery(ref: OptionRef): URLSearchParams {
	const [imdb = '', s, e] = ref.videoId.split(':');
	const q = new URLSearchParams({ imdb });
	if (s && e) q.set('s', s), q.set('e', e);
	return q;
}

export function createWebApi(doFetch: Fetch = fetch): Api {
	/** El cuerpo ya viene tipado por la ruta del servidor (lib/types.ts): acá solo se lee. */
	async function json<T>(path: string, init?: RequestInit): Promise<T> {
		const r = await doFetch(path, init);
		const body: unknown = await r.json().catch(() => null);
		if (!r.ok) throw new Error((body as ApiError | null)?.message ?? `${r.status}`);
		return body as T;
	}
	const browseQuery = (f: BrowseFilters, page: number) =>
		new URLSearchParams({ kind: f.kind, sort: f.sort, from: f.from, to: f.to, votes: String(f.minVotes), lang: f.languages.join(','), genres: f.genres.join(','), page: String(page) });

	return {
		capabilities: { speedTests: false, premiumSubs: true, library: false, localPlayer: false },
		catalog: {
			browse: async (f, page) => adapt.catalogPage(await json<CatalogPageRaw>(`/api/catalog?${browseQuery(f, page)}`)),
			search: async (q, page) => adapt.catalogPage(await json<CatalogPageRaw>(`/api/catalog?${new URLSearchParams({ q, page: String(page) })}`)),
			people: async (q) => adapt.people(await json<PeopleRaw>(`/api/people?${new URLSearchParams({ q })}`)),
			personTitles: async (id, role) => adapt.catalogPage(await json<CatalogPageRaw>(`/api/catalog?${new URLSearchParams({ person: String(id), role })}`)).items,
			genres: async (kind: Kind) => adapt.genres(await json<Genres>(`/api/genres?kind=${kind}`)),
			// Los pósters de la web ya son de TMDB: no hay otro para reintentar.
			poster: async () => null
		},
		title: {
			details: async (kind, id) => adapt.titleDetails(await json<Title>(`/api/title/${kind}/${id}`)),
			// La web no tiene "similares".
			similar: async () => [],
			episodes: async (id, season) => adapt.episodes(await json<Episodes>(`/api/season/${id}/${season}`), season),
			seasonRatings: async (imdb) => adapt.seasonRatings(await json<SeasonScore[]>(`/api/scores/${imdb}`))
		},
		options: {
			async *load(ref: OptionRef) {
				const r = await doFetch(`/api/torrents?${episodeQuery(ref)}`);
				if (!r.body) throw new Error('No se pudieron buscar');
				const text = r.body.pipeThrough(new TextDecoderStream());
				yield* adapt.optionsUpdates(adapt.readLines(text));
			},
			link: async (ref, o: TorrentOption, opts) =>
				adapt.link(await json<LinkRaw>(`/api/link?${episodeQuery(ref)}&${new URLSearchParams({ hash: o.hash, name: o.release, file: o.file ?? '', orig: opts?.orig ?? '' })}`)),
			tracks: async (ref, o: TorrentOption) =>
				adapt.tracks(await json<TracksRaw>(`/api/tracks?${episodeQuery(ref)}&${new URLSearchParams({ hash: o.hash, name: o.release, file: o.file ?? '' })}`))
		},
		subs: {
			find: async (ref, _o, opts) => {
				const q = episodeQuery(ref);
				if (opts?.file) q.set('hash', opts.file.hash), q.set('size', opts.file.size);
				return (await json<Sub[]>(`/api/subs?${q}`)).map(adapt.subtitle);
			},
			get: async (_ref, _o, sub: SubtitleOption) => {
				// Premium gasta 1 de la cuota: solo se baja con el toque del usuario (acá lo es: llamó a `get`).
				if (sub.premium) await json<QuotaRaw>(`/api/premium/${sub.id}`, { method: 'POST' });
				return { url: sub.premium ? `/api/premium/${sub.id}` : `/api/subs/${sub.id}` };
			}
		},
		premium: {
			quota: async () => adapt.quota(await json<QuotaRaw>('/api/premium/quota')),
			search: async (ref) => adapt.premiumResults(await json<PremiumRaw>(`/api/premium?${episodeQuery(ref)}`))
		},
		magnet: {
			status: async (hash, name, who) => adapt.magnetView(await json<MagnetRaw>(`/api/magnet?${new URLSearchParams({ hash, dn: name, ...(who ? { who: '1' } : {}) })}`)),
			download: async (hash, name) =>
				adapt.magnetStatus(await json<MagnetRaw>('/api/magnet', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ hash, dn: name }) }))
		},
		// La web no recibe eventos en vivo.
		events: { subscribe: (_handler: (event: ApiEvent) => void) => () => {} }
	};
}

/** Catálogo y géneros quedan guardados un día: al volver a entrar se ve al instante. */
const cachedFetch: Fetch = async (input, init) => {
	const url = String(input);
	if (init?.method || !/^\/api\/(catalog|genres)\?/.test(url)) return fetch(input, init);
	// Import dinámico: `saved.ts` arrastra `i18n.svelte.ts`, que `node --test` (web-adapt.test.ts) no puede cargar.
	const { json, DAY } = await import('./saved.ts');
	const { ok, status, data } = await json(fetch, url, DAY);
	return new Response(JSON.stringify(data), { status: ok ? 200 : status });
};

/** El único `Api` de la web: se fija una vez en `routes/+layout.svelte` (`setApi`). */
export const webApi: Api = createWebApi(cachedFetch);
