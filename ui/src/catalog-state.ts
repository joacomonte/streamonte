// Estado compartido del catálogo (2026-11-17, root-fix): lo que leen y cambian la búsqueda, el panel,
// las opciones y las pruebas. Sin importar otros módulos del catálogo (evita ciclos al cargar).

// Ojo: `reportError` también existe como función global del navegador; sin este import se usaría esa.

import { showError as reportError } from './dom.ts';
import type { healthCalibration } from './health-store.ts';
import type { Deep, VideoTests } from './catalog-tests.ts';
import type { Flow } from './catalog-flow.ts';
import type { DetailsView, EpisodeText, LibraryRow, MediaKind, Meta, SeasonRatings, Similar, StreamsUpdate } from './types.ts';

/** Errores del catálogo: solo en la barra de estado (no en la burbuja) y sin los "Cancelado." de
 *  pedidos pisados por otro más nuevo. */
export const showError = (e: unknown): void => reportError(e, { activity: false, ignoreCancelled: true });

// ---------- estado ----------
/** localStorage puede fallar (vista previa, almacenamiento bloqueado): nunca rompe la UI. */
export const safeGet = (k: string): string | null => { try { return localStorage.getItem(k); } catch { return null; } };
export const safeSet = (k: string, v: string): void => { try { localStorage.setItem(k, v); } catch { /* sin almacenamiento */ } };

/** Lo que se eligió en el panel lateral. Los campos opcionales se van llenando al abrir la ficha, las temporadas, etc.
 *  `similar`: undefined = sin pedir, null = cargando. */
export type Side = {
  kind: MediaKind; id: string; name: string; meta: Meta | null; season: number | null; episode: number | null;
  videoId: string | null; details?: DetailsView; runtime?: number | null; seasonRatings?: SeasonRatings | null;
  epTexts?: Record<number, Map<number, EpisodeText>>; similar?: Similar[] | null; similarOpen?: boolean; aboutOpen?: boolean;
  providersOpen?: boolean;
  tests?: VideoTests; deep?: Deep; flow?: Flow;
  torbox?: null | 'checking' | 'done' | 'error';
};
/** Actor o director elegido en las sugerencias (lo guarda el catálogo compartido). */
export type PickedPerson = { id: number; name: string; photo: string | null; role: 'cast' | 'director' };

/** Gancho de `catalog-mount.ts`: avisa al catálogo compartido qué título tiene el panel abierto (para resaltar su tarjeta). */
export const hooks: { side: ((side: Side | null) => void) | null } = { side: null };
let currentSide: Side | null = null;

export const state = {
  // Panel lateral: lo que se eligió. Serie: `meta` (episodios) → `season` → `episode`/`videoId`.
  get side(): Side | null { return currentSide; },
  set side(s: Side | null) { currentSide = s; hooks.side?.(s); },
  /** último StreamsUpdate del video del panel. */
  update: null as StreamsUpdate | null,
  /** clave de video → fila de la biblioteca del núcleo. */
  library: new Map<string, LibraryRow>(),
};
/** Lo que cambia de la vista del catálogo (antes `let` sueltos en catalog.js): un objeto para que
 *  todos los módulos lo lean y escriban igual. */
export const view = {
  /** El último panel pedido gana: abrir otro o cerrarlo invalida la ficha pendiente. */
  sideSeq: 0,
  /** Durante un redibujo de la lista (`renderStreamsOnly`): la biblioteca indexada por info_hash y la
   *  calibración de la salud, armadas una vez y no por fila (con 200+ opciones se notaba). Fuera, null. */
  libByHash: null as Map<string, LibraryRow[]> | null,
  renderCal: null as ReturnType<typeof healthCalibration> | null,
  /** Orden elegido arriba de la lista: 'quality' = Mejor imagen, 'fast' = Arranca más rápido. */
  optSort: (safeGet('streamonte.catalog.sort') === 'fast' ? 'fast' : 'quality') as 'quality' | 'fast',
  /** Filtros de la lista (HDR y Subs ES): apagados al abrir cada video (`loadStreams`). */
  onlyHdr: false,
  onlyEs: false,
  /** Espacio libre del disco de descargas (bytes); null = no se sabe (todo entra). */
  freeBytes: null as number | null,
  /** Redibujo pendiente (`scheduleRender`) y si hay que redibujar al volver a mostrarse la ventana. */
  liveRender: null as ReturnType<typeof setTimeout> | null,
  renderOnShow: false,
  /** Filas dibujadas del grupo abierto (de a `PAGE_ROWS`, "Mostrar más"). */
  shownRows: 25,
  /** Opción (info hash) con los subtítulos abiertos (una a la vez). */
  subsMenu: null as string | null,
  /** Hay key de TorBox: null = todavía no se sabe (se pregunta al arrancar). */
  torboxKey: null as boolean | null,
  /** Resolución de la lista (paso 'list' de `catalog-flow.ts`); '' = todavía en los pasos. */
  openRes: null as string | null,
};
