// Modelo de vista escrito a mano (no deriva de ui/mock): lo que la UI compartida recibe ya adaptado.
import type { Identified, MagnetStatus, OptionLink, OptionsUpdate, PremiumQuota, SubtitleOption, TorrentOption } from '../../src/types.ts';

export const option = (hash: string, over: Partial<TorrentOption> = {}): TorrentOption => ({
	hash, release: `Peli.2024.1080p.WEB-DL-${hash.toUpperCase()}`, file: null, fileIdx: null, resolution: '1080p', hdr: [], source: 'WEB-DL', codec: 'x264',
	audioFormat: [], sizeBytes: 2 * 1024 ** 3, seeds: 10, leechers: 1, completed: null, audio: [], subs: [], hint: null, multi: false, spanish: false,
	subFile: false, sites: [], addons: [], isPack: false, ...over
});

export const update = (over: Partial<OptionsUpdate> = {}): OptionsUpdate => ({ options: [], sources: [], progress: null, checking: false, done: false, ...over });

export const link = (over: Partial<OptionLink> = {}): OptionLink => ({ url: 'https://stream.test/v.mkv', choices: [], video: { fps: 24, duration: 5400 }, ...over });

export const subtitle = (id: string, over: Partial<SubtitleOption> = {}): SubtitleOption => ({
	id, release: 'Peli.2024.1080p.WEB-DL-GRP', latino: false, format: 'srt', downloads: 1, level: 'none', premium: false, fps: null, last: null, group: null, ...over
});

export const quota = (over: Partial<PremiumQuota> = {}): PremiumQuota => ({ hasKey: true, remaining: 3, perDay: 5, resetsAt: null, loginError: null, ...over });

export const magnetStatus = (over: Partial<MagnetStatus> = {}): MagnetStatus => ({ state: 'missing', name: 'Torrent.X', progress: 0, speed: 0, seeds: 0, eta: 0, options: [], ...over });

export const identified: Identified = { kind: 'movie', id: '1', imdb: 'tt0000001', title: 'Peli', year: '2024', poster: null, rating: '7.0', season: null, episode: null };
