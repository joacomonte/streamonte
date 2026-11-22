// Interfaz de datos que consume la UI compartida. La web la implementa con `fetch` a /api/* (`web/src/lib/webApi.ts`) y el
// desktop con `invoke` de Tauri (`ui/src/tauriApi.ts`). Métodos de dominio: devuelven el modelo de `types.ts`.
import type {
	ApiEvent, BrowseFilters, Capabilities, CatalogItem, CatalogPage, Episode, Genre, Kind, MagnetStatus, MagnetView, OptionLink, OptionRef,
	OptionsUpdate, PersonHit, PersonRole, PremiumQuota, SeasonRatings, SimilarItem, SubtitleOption, TitleDetails, TorrentOption, TorrentTracks, Unsubscribe
} from './types.ts';

/** `url`: de dónde bajar el subtítulo (web); null si la app ya lo aplicó (desktop). */
export type SubtitleFile = { url: string | null; /** Desktop: archivo bajado (Premium) para cargarlo en el reproductor. */ path?: string | null };
/** Lo mínimo de una opción que piden los subtítulos. */
export type SubsOption = Pick<TorrentOption, 'hash' | 'release' | 'file'>;
/** El archivo concreto que se va a ver (la web lo trae del link): suma los subtítulos hechos para ese archivo exacto. */
export type SubsFileId = { hash: string; size: string };

export interface Api {
	capabilities: Capabilities;
	catalog: {
		browse(filters: BrowseFilters, page: number): Promise<CatalogPage>;
		search(query: string, page: number): Promise<CatalogPage>;
		people(query: string): Promise<PersonHit[]>;
		personTitles(id: number, role: PersonRole): Promise<CatalogItem[]>;
		genres(kind: Kind): Promise<Genre[]>;
	};
	title: {
		details(kind: Kind, id: string): Promise<TitleDetails>;
		similar(kind: Kind, imdb: string): Promise<SimilarItem[]>;
		episodes(id: string, season: number): Promise<Episode[]>;
		seasonRatings(imdb: string): Promise<SeasonRatings>;
	};
	options: {
		/** La web emite una actualización final con `done: true` (más las de progreso); el desktop, una por tanda de fuentes. */
		load(ref: OptionRef): AsyncIterable<OptionsUpdate>;
		link(ref: OptionRef, option: TorrentOption, opts?: { orig?: string | null; latino?: boolean }): Promise<OptionLink>;
		tracks(ref: OptionRef, option: TorrentOption): Promise<TorrentTracks>;
	};
	subs: {
		find(ref: OptionRef, option: SubsOption, opts?: { file?: SubsFileId | null }): Promise<SubtitleOption[]>;
		get(ref: OptionRef, option: SubsOption, sub: SubtitleOption): Promise<SubtitleFile>;
	};
	/** Solo con `capabilities.premiumSubs`. */
	premium?: {
		quota(): Promise<PremiumQuota>;
		/** Buscar es gratis (no gasta cuota); bajar uno sí (`subs.get`). */
		search(ref: OptionRef, option: SubsOption): Promise<SubtitleOption[]>;
	};
	magnet: {
		status(hash: string, name: string, identify: boolean): Promise<MagnetView>;
		download(hash: string, name: string): Promise<MagnetStatus>;
	};
	events: { subscribe(handler: (event: ApiEvent) => void): Unsubscribe };
}
