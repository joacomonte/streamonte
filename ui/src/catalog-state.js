// Estado compartido del catálogo (2026-11-17, root-fix): lo que leen y cambian la búsqueda, el panel,
// las opciones y las pruebas. Sin importar otros módulos del catálogo (evita ciclos al cargar).

// Ojo: `reportError` también existe como función global del navegador; sin este import se usaría esa.

import { showError as reportError } from './dom.js';

/** Errores del catálogo: solo en la barra de estado (no en la burbuja) y sin los "Cancelado." de
 *  pedidos pisados por otro más nuevo. */
export const showError = (e) => reportError(e, { activity: false, ignoreCancelled: true });

// ---------- estado ----------
/** localStorage puede fallar (vista previa, almacenamiento bloqueado): nunca rompe la UI. */
export const safeGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
export const safeSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* sin almacenamiento */ } };
export const state = {
  results: null,          // MetaPreview[] ya ordenadas
  searching: false,       // tipeando / esperando la búsqueda: cards de carga
  excluded: new Set(),    // ids anime/japonés (FR-40)
  hideJapanese: true,
  // Panel lateral: lo que se eligió. Serie: `meta` (episodios) → `season` → `episode`/`videoId`.
  side: null,             // {kind, id, name, meta, season, episode, videoId}
  update: null,           // último StreamsUpdate del video del panel
  library: new Map(),     // clave de video → fila de la biblioteca del núcleo
};
/** Lo que cambia de la vista del catálogo (antes `let` sueltos en catalog.js): un objeto para que
 *  todos los módulos lo lean y escriban igual. */
export const view = {
  /** El último panel pedido gana: abrir otro o cerrarlo invalida la ficha pendiente. */
  sideSeq: 0,
  /** Durante un redibujo de la lista (`renderStreamsOnly`): la biblioteca indexada por info_hash y la
   *  calibración de la salud, armadas una vez y no por fila (con 200+ opciones se notaba). Fuera, null. */
  libByHash: null,
  renderCal: null,
  /** Orden elegido arriba de la lista: 'quality' = Mejor imagen, 'fast' = Arranca más rápido. */
  optSort: safeGet('streamonte.catalog.sort') === 'fast' ? 'fast' : 'quality',
  /** Filtro de la lista: apagado al abrir cada video (`loadStreams`). */
  onlyHdr: false,
  /** Espacio libre del disco de descargas (bytes); null = no se sabe (todo entra). */
  freeBytes: null,
  /** Redibujo pendiente (`scheduleRender`) y si hay que redibujar al volver a mostrarse la ventana. */
  liveRender: null,
  renderOnShow: false,
  /** Filas dibujadas del grupo abierto (de a `PAGE_ROWS`, "Mostrar más"). */
  shownRows: 25,
  /** Opción (info hash) con los subtítulos abiertos (una a la vez). */
  subsMenu: null,
  /** Hay key de TorBox: null = todavía no se sabe (se pregunta al arrancar). */
  torboxKey: null,
  /** Resolución de la lista (paso 'list' de `catalog-flow.js`); '' = todavía en los pasos. */
  openRes: null,
};
