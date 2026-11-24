import type { TorrentOption } from './types.ts';

/** Una opción de torrent vacía; cada adaptador pisa lo que sabe. */
export const blankOption = (overrides: Partial<TorrentOption> & Pick<TorrentOption, 'hash' | 'release'>): TorrentOption => ({
	file: null, fileIdx: null, resolution: null, hdr: [], source: null, codec: null, audioFormat: [], sizeBytes: null, seeds: null,
	leechers: null, completed: null, audio: [], subs: [], hint: null, multi: false, spanish: false, subFile: false, sites: [], addons: [], isPack: false,
	...overrides
});
