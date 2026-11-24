// `Api` completa para tests de flujo (la comparten desktop y web). Cada dominio tiene su guion (lo que devuelve) y una lista
// de fallos inyectables: `fail: { 'subs.find': 'caído' }` hace que esa llamada rechace con ese mensaje. `calls` anota cada llamada.
import type { Api } from '../src/api.ts';
import type { MagnetView, OptionLink, OptionsUpdate, PremiumQuota, SubtitleOption } from '../src/types.ts';
import { link, magnetStatus, quota } from './fixtures/options.ts';

export type FakeScript = {
	updates?: OptionsUpdate[];
	link?: OptionLink;
	subs?: SubtitleOption[];
	premiumSubs?: SubtitleOption[];
	quota?: PremiumQuota;
	/** Cada `magnet.status` devuelve el siguiente; el último se repite. */
	magnet?: MagnetView[];
	/** Llamada ('options.load', 'options.link', 'subs.find', 'subs.get', 'premium.quota', 'premium.search', 'magnet.status', 'magnet.download') → mensaje de error. */
	fail?: Record<string, string>;
};

export function fakeApi(script: FakeScript = {}): { api: Api; calls: string[] } {
	const calls: string[] = [];
	let magnetIdx = 0;
	const hit = async (name: string, detail = ''): Promise<void> => {
		calls.push(detail ? `${name}:${detail}` : name);
		await Promise.resolve();
		const msg = script.fail?.[name];
		if (msg) throw new Error(msg);
	};
	const unused = async (): Promise<never> => {
		throw new Error('no usado en los tests de flujo');
	};
	const api: Api = {
		capabilities: { speedTests: false, premiumSubs: true, library: false, localPlayer: false },
		catalog: { browse: unused, search: unused, people: async () => [], personTitles: async () => [], examples: async () => ({}), poster: async () => null, readableImage: async (url) => url },
		title: { details: unused, similar: async () => [], episodes: async () => [], seasonRatings: unused, episodeRatings: async () => [], awards: unused },
		options: {
			async *load() {
				await hit('options.load');
				yield* script.updates ?? [];
			},
			link: async (_ref, option) => (await hit('options.link', option.hash), script.link ?? link()),
			tracks: async () => ({ subs: 0, audios: [] })
		},
		subs: {
			find: async (_r, _o, opts) => (await hit('subs.find', opts?.file?.hash ?? ''), script.subs ?? []),
			get: async (_r, _o, sub) => (await hit('subs.get', sub.id), { url: `/sub/${sub.id}` })
		},
		premium: {
			quota: async () => (await hit('premium.quota'), script.quota ?? quota()),
			search: async () => (await hit('premium.search'), script.premiumSubs ?? [])
		},
		magnet: {
			status: async (_h, _n, who) => {
				await hit('magnet.status', String(who));
				const views = script.magnet ?? [{ status: magnetStatus(), ident: null }];
				return views[Math.min(magnetIdx++, views.length - 1)];
			},
			download: async () => (await hit('magnet.download'), magnetStatus({ state: 'downloading', progress: 0.1 }))
		},
		recent: { list: async () => [], mark: async () => {}, restore: async () => {}, dismiss: async () => {} },
		events: { subscribe: () => () => {} }
	};
	return { api, calls };
}
