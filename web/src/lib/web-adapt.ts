// Adaptadores puros de la web: JSON de /api/* → modelo de vista de `packages/ui`. Sin `fetch` ni DOM (se prueban solos);
// `webApi.ts` hace los pedidos. Imports relativos: `node --test` no resuelve el alias `$ui`.
import type {
	CatalogItem, CatalogPage, Episode, Genre, Identified, MagnetStatus, MagnetView, OptionLink, OptionsUpdate, PersonHit, PremiumQuota,
	SeasonRatings, SubtitleOption, TitleDetails, TorrentOption, TorrentTracks
} from '../../../packages/ui/src/types.ts';
import type {
	CatalogPageRaw, Episodes, Genres, Ident, LinkRaw, MagnetRaw, PeopleRaw, QuotaRaw, PremiumRaw, SeasonScore, Sub, Title, Torrent, TracksRaw
} from './types.ts';

type CardRaw = CatalogPageRaw['items'][number];

export const catalogItem = (c: CardRaw): CatalogItem => ({
	id: String(c.id),
	kind: c.kind,
	title: c.title ?? '',
	year: c.year || null,
	poster: c.poster,
	rating: c.rating,
	released: c.released,
	excluded: false,
	// Respuestas guardadas antes de que existiera (`tests/fixtures/web-http`, cachés) no lo traen.
	documentary: c.documentary ?? false
});

export const catalogPage = (raw: Pick<CatalogPageRaw, 'items' | 'page' | 'pages'>): CatalogPage => ({ items: raw.items.map(catalogItem), hasMore: raw.page < raw.pages });

export const genres = (raw: Genres): Genre[] => raw.map((g) => ({ id: g.id, name: g.name }));
export const people = (raw: PeopleRaw): PersonHit[] => raw.map((p) => ({ ...p }));

export const titleDetails = (raw: Title): TitleDetails => ({
	id: String(raw.id),
	kind: raw.kind,
	title: raw.title ?? '',
	year: raw.year || null,
	poster: raw.poster,
	backdrop: raw.backdrop,
	rating: raw.rating,
	released: raw.released,
	overview: raw.overview ?? null,
	runtimeMin: raw.runtime,
	genres: raw.genres,
	country: null,
	originalLanguage: raw.origLang,
	languageName: raw.lang,
	providers: raw.providers.map((p) => ({ name: p.name, logo: p.logo })),
	people: raw.people.map((p) => ({ id: p.id, name: p.name, photo: p.photo, role: p.role, note: p.note })),
	companies: raw.companies,
	networks: [],
	trailer: raw.trailer,
	imdb: raw.imdb,
	status: showStatus(raw.status, raw.next),
	awards: null,
	seasons: raw.seasons.map((s) => ({ number: s.n, name: s.name || null, episodeCount: s.count, year: s.year })),
	excluded: false
});

const STATES = ['returning', 'in-production', 'planned', 'ended', 'canceled'] as const;
function showStatus(state: string | null, next: { season: number; episode: number; date: string } | null): TitleDetails['status'] {
	const s = STATES.find((x) => x === state);
	return s ? { state: s, next } : null;
}

export const episodes = (raw: Episodes, season: number): Episode[] => raw.map((e) => ({ season, number: e.n, title: e.name, date: e.date, overview: null, still: e.still }));

/** El puntaje por temporada de la web no trae estado de la serie (viene en la ficha). */
export const seasonRatings = (raw: SeasonScore[]): SeasonRatings => ({ seasons: raw, status: null });

/** Opción como la arma el servidor: el cliente tipa `hint` más angosto y no lista `codec`/`atmos`; las de un magnet pegado no traen `subFile`. */
export type TorrentRaw = Omit<Torrent, 'hint' | 'subFile'> & { hint: string | null; subFile?: boolean; codec?: string | null; atmos?: boolean };
const HINTS = ['lat', 'likely', 'spain'] as const;

export const option = (t: TorrentRaw): TorrentOption => ({
	hash: t.hash,
	release: t.release,
	file: t.file,
	fileIdx: null,
	resolution: t.res,
	hdr: t.hdr,
	source: t.source,
	codec: t.codec ?? null,
	audioFormat: t.atmos ? ['Atmos'] : [],
	sizeBytes: t.size,
	seeds: t.seeds,
	leechers: null,
	completed: null,
	audio: [],
	subs: [],
	hint: HINTS.find((h) => h === t.hint) ?? null,
	multi: t.multi,
	spanish: t.spa,
	subFile: t.subFile === true,
	sites: [],
	addons: t.addons,
	isPack: false
});

export const link = (raw: LinkRaw): OptionLink => ({ url: raw.url, choices: raw.choices ?? [], video: raw.video ?? null, file: raw.file ?? null, natives: raw.natives ?? [], subsEs: raw.subsEs ?? null, ids: raw.ids ?? null });
export const tracks = (raw: TracksRaw): TorrentTracks => ({ subs: raw.subs.length, audios: raw.audios });

export const subtitle = (s: Sub): SubtitleOption => ({
	id: s.id,
	release: s.release,
	latino: s.latino,
	format: s.format,
	downloads: s.downloads,
	level: s.exact ? 'exact' : 'none',
	premium: s.premium === true,
	fps: s.fps ?? null,
	last: s.last ?? null,
	group: s.group || null
});

/** Resultados de Premium: siempre `premium` (bajarlos gasta cuota). */
export const premiumResults = (raw: PremiumRaw): SubtitleOption[] => raw.results.map((s) => ({ ...subtitle(s), premium: true }));

export const quota = (raw: QuotaRaw): PremiumQuota => ({ hasKey: raw.hasKey, remaining: raw.remaining, perDay: raw.perDay, resetsAt: raw.resetsAt, loginError: raw.login });

const identified = (i: Ident): Identified => ({ kind: i.kind, id: String(i.id), imdb: i.imdb, title: i.title, year: i.year, poster: i.poster, rating: i.rating, season: i.s, episode: i.e, origLang: i.origLang, runtime: i.runtime });

const magnetStatus = (raw: MagnetRaw): MagnetStatus => ({
	state: raw.state,
	name: raw.name,
	progress: raw.progress ?? 0,
	speed: raw.speed ?? 0,
	seeds: raw.seeds ?? 0,
	eta: raw.eta ?? 0,
	options: raw.files.map(option)
});
export { magnetStatus };
export const magnetView = (raw: MagnetRaw): MagnetView => ({ status: magnetStatus(raw), ident: raw.ident ? identified(raw.ident) : null });

// ---------- /api/torrents (NDJSON) ----------
/** Junta los trozos de texto en líneas completas (la última sin `\n` también cuenta). */
export async function* readLines(chunks: AsyncIterable<string>): AsyncGenerator<string> {
	let buf = '';
	for await (const chunk of chunks) {
		buf += chunk;
		for (let nl = buf.indexOf('\n'); nl >= 0; nl = buf.indexOf('\n')) {
			const line = buf.slice(0, nl).trim();
			buf = buf.slice(nl + 1);
			if (line) yield line;
		}
	}
	if (buf.trim()) yield buf.trim();
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

/** Líneas `{stage:'sources',done,total}` · `{stage:'torbox'}` · `{result:{list,…}}` · `{error}` → actualizaciones de opciones.
 * `{error}` lanza; una línea que no es JSON también. */
export async function* optionsUpdates(lines: AsyncIterable<string>): AsyncGenerator<OptionsUpdate> {
	let progress: OptionsUpdate['progress'] = null;
	let checking = false;
	const base = { options: [], sources: [] };
	for await (const line of lines) {
		const msg: unknown = JSON.parse(line);
		if (!isRecord(msg)) continue;
		if (msg.stage === 'sources' && typeof msg.done === 'number' && typeof msg.total === 'number') {
			progress = { done: msg.done, total: msg.total };
			yield { ...base, progress, checking, done: false };
		} else if (msg.stage === 'torbox') {
			checking = true;
			yield { ...base, progress, checking, done: false };
		} else if (typeof msg.error === 'string') {
			throw new Error(msg.error);
		} else if (isRecord(msg.result) && Array.isArray(msg.result.list)) {
			// Lo que viene del servidor con la forma de `Torrent` (lib/server/torrents.ts); el borde no se vuelve a validar campo por campo.
			yield { options: (msg.result.list as TorrentRaw[]).map(option), sources: [], progress, checking: false, done: true };
		}
	}
}
