// `Api` de la web: `fetch` a /api/* (rutas en src/routes/api/) y adaptadores puros de `web-adapt.ts`.
import type { Api } from '../../../packages/ui/src/api.ts';
import type { RecentItem } from '../../../packages/ui/src/catalog/recent.ts';
import { newsFromWire, type NewsListWire } from '../../../packages/ui/src/catalog/news.ts';

/** Web sin apodo: cuándo se vio el diálogo de Novedades en este navegador. */
const NEWS_SEEN_KEY = 'novedades:visto';
function localSeen(): string | null {
	try { return localStorage.getItem(NEWS_SEEN_KEY); } catch { return null; }
}
import type { ApiEvent, BrowseFilters, Kind, OptionRef, EpisodeScore, SubtitleOption, TitleAwards, TorrentOption } from '../../../packages/ui/src/types.ts';
import * as adapt from './web-adapt.ts';
import type { ApiError, CatalogPageRaw, Episodes, Examples, LinkRaw, MagnetRaw, PeopleRaw, PremiumRaw, QuotaRaw, SeasonScore, Seen, Sub, Title, TracksRaw } from './types.ts';

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
	const post = async (body: unknown) => void (await json<{ ok: true }>('/api/vistos', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }));
	const seenOf = ({ id, ...item }: Omit<RecentItem, 'at'> & { at?: string }) => ({ ...item, tmdb: Number(id) });
	const browseQuery = (f: BrowseFilters, page: number) =>
		new URLSearchParams({ kind: f.kind, sort: f.sort, from: f.from, to: f.to, votes: String(f.minVotes), lang: f.languages.join(','), interests: f.interests.join(','), page: String(page) });

	return {
		capabilities: { speedTests: false, premiumSubs: true, library: false, localPlayer: false },
		catalog: {
			browse: async (f, page) => adapt.catalogPage(await json<CatalogPageRaw>(`/api/catalog?${browseQuery(f, page)}`)),
			search: async (q, page) => adapt.catalogPage(await json<CatalogPageRaw>(`/api/catalog?${new URLSearchParams({ q, page: String(page) })}`)),
			people: async (q) => adapt.people(await json<PeopleRaw>(`/api/people?${new URLSearchParams({ q })}`)),
			personTitles: async (id, role) => adapt.catalogPage(await json<CatalogPageRaw>(`/api/catalog?${new URLSearchParams({ person: String(id), role })}`)).items,
			examples: async (kind: Kind, ids: string[]) => await json<Examples>(`/api/examples?${new URLSearchParams({ kind, ids: ids.join(',') })}`),
			// Los pósters de la web ya son de TMDB: no hay otro para reintentar.
			poster: async () => null,
			readableImage: async (url) => url
		},
		title: {
			details: async (kind, id) => adapt.titleDetails(await json<Title>(`/api/title/${kind}/${id}`)),
			// La web no tiene "similares".
			similar: async () => [],
			episodes: async (id, season) => adapt.episodes(await json<Episodes>(`/api/season/${id}/${season}`), season),
			seasonRatings: async (imdb) => adapt.seasonRatings(await json<SeasonScore[]>(`/api/scores/${imdb}`)),
			episodeRatings: async (imdb, season) => await json<EpisodeScore[]>(`/api/epscores/${imdb}/${season}`),
			awards: async (imdb) => await json<TitleAwards>(`/api/awards/${imdb}`)
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
			tracks: async (ref, o: TorrentOption, opts) => {
				const ids: Record<string, string> = opts?.ids ? { tid: String(opts.ids.tid), fid: String(opts.ids.fid) } : {};
				return adapt.tracks(await json<TracksRaw>(`/api/tracks?${episodeQuery(ref)}&${new URLSearchParams({ hash: o.hash, name: o.release, file: o.file ?? '', ...ids })}`));
			}
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
		// Vistos: del servidor por apodo verificado (cookie firmada `apodo`), siempre frescos. `id` de la web = el de TMDB; el servidor lo guarda como `tmdb`.
		recent: {
			list: async () => (await json<Seen[]>('/api/vistos')).filter((v) => v.tmdb).map(({ tmdb, ...v }): RecentItem => ({ ...v, id: String(tmdb) })),
			mark: (item) => post({ action: 'mark', item: seenOf(item) }),
			restore: (item) => post({ action: 'restore', item: seenOf(item) }),
			dismiss: (kind, imdb, how) => post({ action: how, kind, imdb })
		},
		// Novedades: GET /api/novedades (lo guardado en Neon); POST { action: 'refresh' } recalcula (no se espera);
		// POST { action: 'seen' } marca el diálogo como visto; sin apodo el servidor no guarda nada y vale lo de este navegador.
		news: {
			list: async () => {
				const w = await json<NewsListWire>('/api/novedades');
				return newsFromWire({ ...w, seenAt: w.seenAt ?? localSeen() }, (i) => (i.tmdb ? String(i.tmdb) : null));
			},
			refresh: async () => void (await json<{ ok: true }>('/api/novedades', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'refresh' }) })),
			markSeen: async () => {
				try { localStorage.setItem(NEWS_SEEN_KEY, new Date().toISOString()); } catch { /* sin storage: el diálogo vuelve a abrirse */ }
				await json<{ ok: true }>('/api/novedades', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'seen' }) });
			}
		},
		// Apodo: el contrato de /api/nick (ver apodo.svelte.ts, que arma la pantalla de la web con los mismos pedidos). La sesión
		// es la cookie `apodo` del navegador; el código de acceso ya pasó el candado.
		nick: {
			ask: (nick) => json<{ nick: string; mode: 'nuevo' | 'login'; order: string[]; wait: number }>(`/api/nick?${new URLSearchParams({ nick })}`),
			async enter(nick, code, mode) {
				const r = await doFetch('/api/nick', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ nick, code, mode }) });
				const body = (await r.json().catch(() => null)) as { nick?: string; message?: string; wait?: number } | null;
				if (r.ok) return { ok: true, nick: body?.nick };
				return { ok: false, error: body?.message ?? `${r.status}`, wait: body?.wait, changed: r.status === 409 };
			},
			logout: async () => void (await json<{ ok: true }>('/api/nick', { method: 'DELETE' })),
			status: async () => {
				const r = await doFetch('/api/nick/animales', { cache: 'no-store' });
				return { codeSet: true, nick: r.ok ? (((await r.json().catch(() => null)) as { nick?: string } | null)?.nick ?? null) : null };
			},
			animals: async () => {
				const r = await doFetch('/api/nick/animales', { cache: 'no-store' });
				return r.ok ? (((await r.json().catch(() => null)) as { animals?: string[] | null } | null)?.animals ?? null) : null;
			}
		},
		// La web no recibe eventos en vivo.
		events: { subscribe: (_handler: (event: ApiEvent) => void) => () => {} }
	};
}

/** GET que el CDN de Vercel cachea por idioma: llevan `l=<títulos>.<app>` (ver web/src/lib/server/lang.ts). */
const PER_LANG = /^\/api\/(catalog|people|title|season)[/?]/;

/** Catálogo y ejemplos de subgéneros quedan guardados un día: al volver a entrar se ve al instante. */
const cachedFetch: Fetch = async (input, init) => {
	let url = String(input);
	if (!init?.method && PER_LANG.test(url)) url += `${url.includes('?') ? '&' : '?'}l=${(await import('./i18n.svelte.ts')).contentKey()}`;
	if (init?.method || !/^\/api\/(catalog|examples)\?/.test(url)) return fetch(url, init);
	// Import dinámico: `saved.ts` arrastra `i18n.svelte.ts`, que `node --test` (web-adapt.test.ts) no puede cargar.
	const { json, DAY } = await import('./saved.ts');
	const { ok, status, data } = await json(fetch, url, DAY);
	return new Response(JSON.stringify(data), { status: ok ? 200 : status });
};

/** El único `Api` de la web: se fija una vez en `routes/+layout.svelte` (`setApi`). */
export const webApi: Api = createWebApi(cachedFetch);
