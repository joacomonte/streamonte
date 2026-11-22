// @ts-check
// Estado compartido del catálogo (2026-11-17, root-fix): lo que leen y cambian la búsqueda, el panel,
// las opciones y las pruebas. Sin importar otros módulos del catálogo (evita ciclos al cargar).

// Ojo: `reportError` también existe como función global del navegador; sin este import se usaría esa.

import { showError as reportError } from './dom.js';

/** Errores del catálogo: solo en la barra de estado (no en la burbuja) y sin los "Cancelado." de
 *  pedidos pisados por otro más nuevo. */
export const showError = (/** @type {unknown} */ e) => reportError(e, { activity: false, ignoreCancelled: true });

// ---------- estado ----------
/** localStorage puede fallar (vista previa, almacenamiento bloqueado): nunca rompe la UI. */
export const safeGet = (/** @type {string} */ k) => { try { return localStorage.getItem(k); } catch { return null; } };
export const safeSet = (/** @type {string} */ k, /** @type {string} */ v) => { try { localStorage.setItem(k, v); } catch { /* sin almacenamiento */ } };

/** @typedef {import('./types.js').Meta} Meta */
/** @typedef {import('./types.js').DetailsView} DetailsView */
/** @typedef {import('./types.js').Similar} Similar */
/** @typedef {import('./types.js').EpisodeText} EpisodeText */
/** @typedef {import('./types.js').SeasonRatings} SeasonRatings */
/** @typedef {import('./types.js').StreamsUpdate} StreamsUpdate */
/** @typedef {import('./types.js').LibraryRow} LibraryRow */
/** @typedef {import('./catalog-tests.ts').VideoTests} VideoTests */
/** @typedef {import('./catalog-tests.ts').Deep} Deep */
/** @typedef {import('./catalog-flow.ts').Flow} Flow */
/** Lo que se eligió en el panel lateral. Los campos opcionales se van llenando al abrir la ficha, las temporadas, etc.
 *  `similar`: undefined = sin pedir, null = cargando.
 *  @typedef {{kind: import('./types.js').MediaKind, id: string, name: string, meta: Meta|null, season: number|null, episode: number|null,
 *   videoId: string|null, details?: DetailsView, runtime?: number|null, seasonRatings?: SeasonRatings|null,
 *   epTexts?: Record<number, Map<number, EpisodeText>>, similar?: Similar[]|null, similarOpen?: boolean, aboutOpen?: boolean,
 *   providersOpen?: boolean,
 *   tests?: VideoTests, deep?: Deep, flow?: Flow,
 *   torbox?: null|'checking'|'done'|'error'}} Side */
/** Actor o director elegido en las sugerencias (lo guarda el catálogo compartido). @typedef {{id: number, name: string, photo: string|null, role: 'cast'|'director'}} PickedPerson */

/** Gancho de `catalog-mount.ts`: avisa al catálogo compartido qué título tiene el panel abierto (para resaltar su tarjeta). */
/** @type {{side: ((side: Side|null) => void)|null}} */
export const hooks = { side: null };
/** @type {Side|null} */
let currentSide = null;

export const state = {
  // Panel lateral: lo que se eligió. Serie: `meta` (episodios) → `season` → `episode`/`videoId`.
  get side() { return currentSide; },
  set side(/** @type {Side|null} */ s) { currentSide = s; hooks.side?.(s); },
  /** último StreamsUpdate del video del panel. @type {StreamsUpdate|null} */
  update: null,
  /** clave de video → fila de la biblioteca del núcleo. @type {Map<string, LibraryRow>} */
  library: new Map(),
};
/** Lo que cambia de la vista del catálogo (antes `let` sueltos en catalog.js): un objeto para que
 *  todos los módulos lo lean y escriban igual. */
export const view = {
  /** El último panel pedido gana: abrir otro o cerrarlo invalida la ficha pendiente. */
  sideSeq: 0,
  /** Durante un redibujo de la lista (`renderStreamsOnly`): la biblioteca indexada por info_hash y la
   *  calibración de la salud, armadas una vez y no por fila (con 200+ opciones se notaba). Fuera, null. */
  /** @type {Map<string, LibraryRow[]>|null} */
  libByHash: null,
  /** @type {ReturnType<typeof import('./health-store.ts').healthCalibration>|null} */
  renderCal: null,
  /** Orden elegido arriba de la lista: 'quality' = Mejor imagen, 'fast' = Arranca más rápido. */
  optSort: /** @type {'quality'|'fast'} */ (safeGet('streamonte.catalog.sort') === 'fast' ? 'fast' : 'quality'),
  /** Filtros de la lista (HDR y Subs ES): apagados al abrir cada video (`loadStreams`). */
  onlyHdr: false,
  onlyEs: false,
  /** Espacio libre del disco de descargas (bytes); null = no se sabe (todo entra). */
  /** @type {number|null} */
  freeBytes: null,
  /** Redibujo pendiente (`scheduleRender`) y si hay que redibujar al volver a mostrarse la ventana. */
  /** @type {ReturnType<typeof setTimeout>|null} */
  liveRender: null,
  renderOnShow: false,
  /** Filas dibujadas del grupo abierto (de a `PAGE_ROWS`, "Mostrar más"). */
  shownRows: 25,
  /** Opción (info hash) con los subtítulos abiertos (una a la vez). */
  /** @type {string|null} */
  subsMenu: null,
  /** Hay key de TorBox: null = todavía no se sabe (se pregunta al arrancar). */
  /** @type {boolean|null} */
  torboxKey: null,
  /** Resolución de la lista (paso 'list' de `catalog-flow.ts`); '' = todavía en los pasos. */
  /** @type {string|null} */
  openRes: null,
};
