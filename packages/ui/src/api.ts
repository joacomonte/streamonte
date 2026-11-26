// Interfaz de datos que consume la UI compartida. La web la implementa con `fetch` a /api/* (`web/src/lib/webApi.ts`) y el
// desktop con `invoke` de Tauri (`ui/src/tauriApi.ts`). Métodos de dominio: devuelven el modelo de `types.ts`.
import type {
	ApiEvent, BrowseFilters, Capabilities, CatalogItem, CatalogPage, Episode, EpisodeScore, InterestExample, Kind, MagnetStatus, MagnetView, NickAsk, NickStatus, OptionLink, OptionRef,
	OptionsUpdate, PersonHit, PersonRole, PremiumQuota, SeasonRatings, SimilarItem, SubtitleOption, TitleAwards, TitleDetails, TorboxIds, TorrentOption, TorrentTracks, Unsubscribe
} from './types.ts';
import type { RecentItem } from './catalog/recent.ts';
import type { NewsList } from './catalog/news.ts';
import type { CodeResult } from './animals/animals.ts';

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
		/** Ejemplos populares de cada interest de IMDb (ids `in…`), para las tarjetas de géneros. */
		examples(kind: Kind, ids: string[]): Promise<Record<string, InterestExample[]>>;
		/** Póster alternativo cuando el de la tarjeta no carga (desktop: TMDB); null si no hay otro. */
		poster(id: string): Promise<string | null>;
		/** Una URL de la imagen cuyos píxeles se pueden leer en un canvas (color del póster). Web: la misma (TMDB manda
		 * CORS); desktop: la baja el núcleo (metahub no manda CORS) y devuelve un blob. */
		readableImage(url: string): Promise<string>;
	};
	title: {
		details(kind: Kind, id: string): Promise<TitleDetails>;
		similar(kind: Kind, imdb: string): Promise<SimilarItem[]>;
		episodes(id: string, season: number): Promise<Episode[]>;
		/** `quick`: sin ir a IMDb (rápido; para los detalles de la tarjeta). La web lo ignora. */
		seasonRatings(imdb: string, quick?: boolean): Promise<SeasonRatings>;
		/** Puntaje de IMDb de cada capítulo de la temporada (los sin puntaje no vienen). */
		episodeRatings(imdb: string, season: number): Promise<EpisodeScore[]>;
		/** Premios (IMDb): totales y el detalle de los grandes. */
		awards(imdb: string): Promise<TitleAwards>;
	};
	options: {
		/** La web emite una actualización final con `done: true` (más las de progreso); el desktop, una por tanda de fuentes. */
		load(ref: OptionRef): AsyncIterable<OptionsUpdate>;
		link(ref: OptionRef, option: TorrentOption, opts?: { orig?: string | null; latino?: boolean }): Promise<OptionLink>;
		/** `ids` (web): de un link ya pedido, un solo pedido a TorBox. */
		tracks(ref: OptionRef, option: TorrentOption, opts?: { ids?: TorboxIds | null }): Promise<TorrentTracks>;
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
	/** "Vistos recientemente" (fila del catálogo), guardado en la web por apodo. */
	recent: {
		list(): Promise<RecentItem[]>;
		/** Lo vio ahora (web: copió el link; desktop: lo reprodujo). */
		mark(item: Omit<RecentItem, 'at'>): Promise<void>;
		/** "Deshacer" de la X: vuelve con su fecha. */
		restore(item: RecentItem): Promise<void>;
		dismiss(kind: Kind, imdb: string, how: 'visto' | 'olvidar'): Promise<void>;
	};
	/** "Novedades" (`catalog/news.ts`): el diálogo de lo nuevo y la fila Tendencias. Desktop sin sesión de apodo: vacía. */
	news: {
		/** Lee lo guardado (rápido, no recalcula). */
		list(): Promise<NewsList>;
		/** Recalcula (puede tardar ~50 s): la UI no lo espera; el resultado se ve en el próximo `list`. */
		refresh(): Promise<void>;
		/** Abrió el diálogo: `seenAt` = ahora (por apodo; web sin apodo: en este navegador). */
		markSeen(): Promise<void>;
	};
	/** Apodo de la web (contrato de `/api/nick`): la bienvenida y Ajustes son compartidas. Los errores de red o del
	 * servidor lanzan con el mensaje; los de código de animales (no son esos, en espera, cambió) vuelven en `enter`. */
	nick: {
		/** ¿El apodo ya tiene código (`login`) o se crea (`nuevo`)? Con el orden de las cartas. */
		ask(nick: string): Promise<NickAsk>;
		/** Crea o prueba el código de 2 animales; si sale bien la sesión queda guardada. */
		enter(nick: string, code: string[], mode: NickAsk['mode']): Promise<CodeResult>;
		/** Cambiar de usuario. */
		logout(): Promise<void>;
		status(): Promise<NickStatus>;
		/** Los 2 animales (ids) de la sesión; null si todavía no se guardaron o no hay sesión. */
		animals(): Promise<string[] | null>;
		/** Solo desktop: guarda el código de acceso de 3 dígitos de la web (vacío = borrarlo). */
		setCode?(code: string): Promise<void>;
	};
	events: { subscribe(handler: (event: ApiEvent) => void): Unsubscribe };
}
