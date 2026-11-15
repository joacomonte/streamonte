// UI de F3: lista mínima de magnets (para poder reproducir), panel de reproducciones con acciones
// (FR-14/15), "Detener todo y limpiar" (FR-16), "Limpiar temporales" con tamaño (FR-19),
// abrir carpeta (FR-18) y diálogo al cerrar con reproducciones activas (FR-17).
// Layout final, menú contextual, atajos y tooltips completos: F4.
import { api, onCoreEvent } from './api.js';
import { activity } from './activity.js';

const $ = (sel) => document.querySelector(sel);
const tauri = window.__TAURI__;

/** @type {Map<string, any>} info_hash → entrada de la biblioteca */
const entries = new Map();
/** @type {Map<number, any>} id → fila de reproducción */
const playbacks = new Map();
/** @type {Map<number, string[]>} id → líneas de log recibidas en vivo */
const logs = new Map();
let selected = null;
let logOpenFor = null;

// ---------- utilidades ----------
function setStatus(message) {
  $('#status').textContent = message;
}

function showError(err) {
  // UiError {message, detail}: mostrar `message`, nunca el detalle técnico (NFR-12).
  const msg = err?.message ?? String(err);
  setStatus(msg);
  activity.push({ area: 'general', level: 'error', text: msg });
}

function humanBytes(b) {
  if (b >= 1024 ** 3) return `${(b / 1024 ** 3).toFixed(1).replace('.', ',')} GB`;
  return `${Math.round(b / 1024 ** 2)} MB`;
}

function mbps(bytesPerSec) {
  return `${((bytesPerSec * 8) / 1e6).toFixed(1).replace('.', ',')} Mbps`;
}

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'disabled') node.disabled = Boolean(v);
    else if (k === 'class') node.className = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v);
  }
  node.append(...children.filter((c) => c != null));
  return node;
}

// Íconos dibujados (trazo 2, 24×24), no glifos Unicode.
const ICONS = {
  play: '<path d="M7 4.8v14.4a1 1 0 0 0 1.5.86l11.5-7.2a1 1 0 0 0 0-1.72L8.5 3.94A1 1 0 0 0 7 4.8z" fill="currentColor" stroke="none"/>',
  pause: '<rect x="6" y="5" width="4" height="14" rx="1.2" fill="currentColor" stroke="none"/><rect x="14" y="5" width="4" height="14" rx="1.2" fill="currentColor" stroke="none"/>',
  resume: '<path d="M8 5.5v13l10-6.5z"/>',
  refresh: '<path d="M20 12a8 8 0 1 1-2.34-5.66L20 8.5"/><path d="M20 4v4.5h-4.5"/>',
  // Filas (diseño cards-v3)
  chev: '<path d="M6 9l6 6 6-6"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5" stroke-width="2.4"/>',
  gauge: '<path d="M4.6 18.5a9 9 0 1 1 14.8 0"/><path d="M12 14.5l4.2-5"/><path d="M7 10.5l.9.6M12 6.8v1M17 10.5l-.9.6"/><circle cx="12" cy="14.5" r="1.6" fill="currentColor"/>',
  speaker: '<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2.5"/><path d="M16 8V6.5A2.5 2.5 0 0 0 13.5 4h-7A2.5 2.5 0 0 0 4 6.5v7A2.5 2.5 0 0 0 6.5 16H8"/>',
  stop: '<rect x="6.5" y="6.5" width="11" height="11" rx="2" fill="currentColor" stroke="none"/>',
  quick: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.3 15.3L20 20"/><path d="M11.5 6.8L9 10.8h3l-2.3 3.6"/>',
};
function icon(name, size = 16) {
  const s = el('span', { class: 'ico', 'aria-hidden': 'true' });
  s.innerHTML = `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[name]}</svg>`;
  return s;
}

/** Diálogo de confirmación con botones; devuelve el `value` del botón elegido (o null). */
function confirmDialog(title, text, buttons) {
  const dlg = $('#dlg-confirm');
  $('#dlg-confirm-title').textContent = title;
  $('#dlg-confirm-text').textContent = text;
  const actions = $('#dlg-confirm-actions');
  actions.replaceChildren();
  return new Promise((resolve) => {
    for (const b of buttons) {
      actions.append(
        el('button', { class: b.primary ? 'primary' : '', onclick: () => { dlg.close(); resolve(b.value); } }, b.label),
      );
    }
    dlg.onclose = () => resolve(null);
    dlg.showModal();
  });
}

// ---------- biblioteca (mínima; vista completa en F4) ----------
/** Orden por defecto calculado por el núcleo (FR-07: medidos por margen → seeders → leechers). */
let order = { now: [], prev: [] };
let refreshTimer = null;

async function refreshLibrary() {
  const view = await api.library();
  entries.clear();
  for (const e of [...view.pasted_now, ...view.previous]) entries.set(e.info_hash, e);
  order = { now: view.pasted_now.map((e) => e.info_hash), prev: view.previous.map((e) => e.info_hash) };
  renderLibrary();
}

/** Muchas mediciones seguidas → un solo pedido de orden (~300 ms). */
function scheduleRefresh() {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => refreshLibrary().catch(showError), 300);
}

function ordered(hashes, group) {
  const known = hashes.filter((h) => entries.get(h)?.group === group).map((h) => entries.get(h));
  const extra = [...entries.values()].filter((e) => e.group === group && !hashes.includes(e.info_hash));
  return [...extra, ...known]; // los recién llegados arriba hasta el próximo orden
}

function renderLibrary() {
  const now = ordered(order.now, 'pasted-now');
  const prev = ordered(order.prev, 'previous');
  $('#empty').hidden = entries.size > 0;
  renderGroup($('#group-now'), now);
  renderGroup($('#group-prev'), prev);
  $('#btn-play').disabled = !selected || !entries.has(selected);
  $('#lib-toolbar').hidden = entries.size === 0;
  renderToolbar();
  renderActivity();
}

/** Nombre corto de un magnet para los mensajes. */
function titleOf(h) {
  const e = entries.get(h);
  return e ? (e.release?.title || fullName(e)) : 'un torrent';
}

/** Resumen de lo que corre de fondo para la píldora de la burbuja de actividad. */
function renderActivity() {
  const title = titleOf;
  const parts = [];
  for (const r of playbacks.values()) {
    const k = r.state.kind;
    if (k === 'fetching-metadata' || k === 'preparing') parts.push(`Preparando ${title(r.info_hash)}${k === 'preparing' ? ` ${Math.round((r.state.fraction ?? 0) * 100)} %` : ''}`);
    else if (k === 'playing' && r.progress < 0.999) parts.push(`Bajando ${title(r.info_hash)} · ${Math.floor(r.progress * 100)} %`);
    else if (k === 'background') parts.push(`Bajando ${title(r.info_hash)} de fondo · ${Math.floor(r.progress * 100)} %`);
    else if (k === 'stopping') parts.push(`Cerrando ${title(r.info_hash)}`);
  }
  const s = analyzerState;
  if (s.kind === 'scraping') parts.push('Consultando trackers');
  else if (s.kind === 'quick-scan') parts.push(`Leyendo datos de ${s.total}`);
  else if (s.kind === 'measuring' && s.current) parts.push(`Midiendo ${title(s.current)}`);
  else if (pending.size) parts.push(`Preparando ${pending.size === 1 ? titleOf([...pending.keys()][0]) : `${pending.size} análisis`}`);
  const waiting = queued.filter((h) => !(s.kind === 'measuring' && s.current === h)).length;
  if (waiting && s.kind !== 'paused') parts.push(`${waiting} en cola`);
  activity.setBusy(parts.join(' · '));
}

/** Eventos del núcleo → líneas de la burbuja. Se llama ANTES de actualizar el estado, para
 *  comparar con lo anterior y contar solo los cambios (no cada tic). */
function logEvent(ev) {
  const A = (area, text, more = {}) => activity.push({ area, text, ...more });
  switch (ev.type) {
    case 'activity':
      A(ev.area, ev.message, { level: ev.level, at: new Date(ev.at) });
      break;
    case 'status':
      A('general', ev.message, { level: ev.level });
      break;
    case 'clipboard-history-unavailable':
      A('portapapeles', 'El historial del portapapeles (Win+V) está apagado: solo se ve lo último copiado.', { level: 'warn' });
      break;
    case 'analyzer-progress': {
      const s = ev.state;
      const p = analyzerState;
      if (s.kind === 'scraping' && p.kind !== 'scraping') A('analisis', `Consultando trackers de ${s.total} magnet(s)`);
      else if (s.kind === 'quick-scan' && p.kind !== 'quick-scan') A('analisis', `Leyendo datos rápidos de ${s.total}: nombre, duración, audios, seeds`);
      else if (s.kind === 'measuring' && s.current) {
        if (p.kind !== 'measuring' || p.current !== s.current) A('analisis', `Midiendo la velocidad de ${titleOf(s.current)} (${s.done + 1} de ${s.total})`, { announce: true });
        if (s.live) {
          const ph = s.live.phase;
          const txt = ph in PHASE_TEXT ? `preparando · ${PHASE_TEXT[ph]}`
            : ph === 'probing' ? `${mb(s.live.speed_bps)} Mbps · leyendo duración y audios`
              : `${mb(s.live.speed_bps)} Mbps · ${Math.round(s.live.secs)} s · ${s.live.peers} peers${s.live.stable ? ' · ya estable' : ''}`;
          A('analisis', `${titleOf(s.current)}: ${txt}`, { key: `spd:${s.current}` });
        }
      } else if (s.kind === 'paused' && p.kind !== 'paused') A('analisis', 'Análisis en pausa');
      else if (s.kind === 'idle' && !['idle', 'paused'].includes(p.kind)) A('analisis', 'Análisis terminado: la lista quedó ordenada de mejor a peor', { announce: true });
      break;
    }
    case 'analyzer-queue':
      if (ev.queued.length && ev.queued.length !== queued.length) A('analisis', `${ev.queued.length} en cola para analizar`, { key: 'queue' });
      for (const hsh of ev.held) if (!held.has(hsh)) A('analisis', `Pausado el análisis de ${titleOf(hsh)}`);
      break;
    case 'library-entry-updated': {
      const e = ev.entry;
      const old = entries.get(e.info_hash);
      const t = e.release?.title || fullName(e);
      if (!old) { A('portapapeles', `Agregado: ${t}`); break; }
      if (!old.torrent_name && e.torrent_name) A('motor', `Metadatos de ${t}: ${e.torrent_name}`);
      if (!old.live && e.live) {
        const size = e.video_size ?? e.live.file_size;
        A('analisis', `Datos leídos de ${t}: ${size ? humanBytes(size) : ''}${e.live.duration_secs ? ` · ${hms(e.live.duration_secs)}` : ''}${e.languages?.length ? ` · ${e.languages.map((l) => l.short).join('/')}` : ''}`);
      }
      if (e.live?.avg_speed_bps > 0 && e.live.avg_speed_bps !== old.live?.avg_speed_bps) {
        A('analisis', `${t}: ${mb(e.live.avg_speed_bps)} Mbps reales${e.score?.margin != null ? ` (${nf(e.score.margin)}×)` : ''}`, { announce: true });
      }
      if (e.status?.kind === 'failed' && old.status?.kind !== 'failed') A('analisis', `Falló el análisis de ${t}: ${e.status.reason ?? 'sin detalle'}`, { level: 'error' });
      break;
    }
    case 'library-entry-removed':
      A('general', `Quitado de la lista: ${titleOf(ev.info_hash)}`);
      break;
    case 'library-cleared':
      A('general', 'Lista vaciada');
      break;
    case 'playback-updated': {
      const r = ev.row;
      const k = r.state.kind;
      const old = playbacks.get(r.id);
      const t = titleOf(r.info_hash);
      if (old?.state.kind !== k || k === 'preparing') {
        const text = {
          'fetching-metadata': `Buscando metadatos de ${t}`,
          preparing: `Preparando ${t}: ${Math.round((r.state.fraction ?? 0) * 100)} % (principio y final del video)`,
          playing: `Reproduciendo ${t} en mpv`,
          'download-paused': `Descarga de ${t} en pausa`,
          stopping: `Cerrando ${t}`,
          paused: `${t} quedó pausada${r.state.position_secs != null ? ` en ${hms(r.state.position_secs)}` : ''}: lo bajado queda guardado`,
          failed: `No se pudo reproducir ${t}: ${r.state.message}`,
          'ask-after-close': `Cerraste el reproductor de ${t}: ¿seguir bajando de fondo o pausar?`,
          background: `${t} sigue bajando de fondo, sin reproductor`,
        }[k];
        if (text) A('reproduccion', text, { key: k === 'preparing' ? `prep:${r.id}` : undefined, level: k === 'failed' ? 'error' : 'info', announce: k === 'playing' || k === 'failed' });
      }
      if ((k === 'playing' || k === 'background') && r.progress < 0.999) {
        A('motor', `Bajando ${t}: ${Math.floor(r.progress * 100)} % · ${mb(r.speed_bps ?? 0)} Mbps · ${r.peers} peers`, { key: `dl:${r.id}` });
      }
      break;
    }
    case 'playback-removed': {
      const r = playbacks.get(ev.id);
      if (r) A('limpieza', `Descarga de ${titleOf(r.info_hash)} borrada`);
      break;
    }
    case 'catalog-streams': {
      const u = ev.update;
      const failed = u.addons.filter((x) => x.message).length;
      A('catalogo', `Catálogo: ${u.candidates.length} streams de ${u.addons.length} addons${u.done ? '' : ' (llegando…)'}${failed ? ` · ${failed} sin respuesta` : ''}`, { key: `cat:${u.video_id}` });
      break;
    }
    default:
      break;
  }
}

// Veredicto: velocidad real contra lo que consume el video (bitrate = tamaño ÷ duración).
const LIGHT_LABEL = { green: 'Sobrado', yellow: 'Justo', red: 'Mal', unknown: 'Sin medir' };
const LIGHT_HELP = {
  green: 'Baja bastante más rápido de lo que el video consume (≥ 1,5×): no se corta.',
  yellow: 'Baja apenas por encima de lo que consume (1–1,5×), o la duración es estimada: puede cortarse en algún momento.',
  red: 'Baja más lento de lo que el video consume: se va a cortar.',
  unknown: 'Todavía no se midió la velocidad real.',
};
const STATUS_LABEL = {
  new: 'Sin analizar',
  scraping: 'Consultando trackers…',
  scraped: 'Trackers consultados',
  measuring: 'Midiendo velocidad real…',
  measured: 'Medido',
  failed: 'Falló la medición',
};

function duration(secs, estimated) {
  if (secs == null) return null;
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = Math.floor(secs % 60);
  const txt = h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
  return estimated ? `~${txt}` : txt;
}

function ago(iso) {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return 'recién';
  if (mins < 60) return `hace ${mins} min`;
  const h = Math.round(mins / 60);
  return h < 48 ? `hace ${h} h` : `hace ${Math.round(h / 24)} días`;
}

/** Nombre completo para saber qué torrent se copió: el de los metadatos (se busca al pegar),
 *  si no el `dn` del magnet (Torrentio pone uno genérico). */
function fullName(e) {
  return e.torrent_name || e.live?.torrent_name || e.name;
}

// ---------- filas (FR-29b): diseño aprobado design/cards-v3.html, "Fracción y sello" ----------
// Fila de 50 px: título limpio + nombre crudo, peso · duración, idiomas, velocidad real / lo que
// consume el video con el × como sello, acciones de análisis, Ver y el chevron del detalle.
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const nf = (n) => n.toLocaleString('es-AR', { maximumFractionDigits: 1 });
const nf1 = (n) => n.toLocaleString('es-AR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
/** bytes/s → Mbps redondeado como en el diseño ("78", "7,2"). */
const mb = (bps) => { const v = (bps * 8) / 1e6; return nf(v >= 10 ? Math.round(v) : v); };
const LIGHT_CLS = { green: 'g', yellow: 'y', red: 'r' };
const SCALE = ' Verde desde 1,5×, amarillo entre 1 y 1,5×, rojo debajo de 1×.';
const TIP = {
  quick: 'Análisis rápido: trae el nombre, la duración, los idiomas de audio, la calidad y los seeds en unos segundos. Se pueden analizar varios a la vez.',
  speed: 'Medir velocidad: baja un pedazo durante unas decenas de segundos para saber la velocidad real y si se va a cortar. Se mide un torrent por vez; con Listo la cortás antes.',
  re: 'Medir de nuevo: vuelve a bajar un pedazo unas decenas de segundos para medir la velocidad real, por si cambiaron los seeds. Un torrent por vez; con Listo la cortás antes.',
  done: 'Listo: corta la medición ahora y se queda con lo que midió hasta acá.',
  pause: 'Pausar el análisis de este sin perder lo medido (los demás siguen).',
  resume: 'Seguir analizando: retoma el análisis de este.',
  watch: 'Ver: elegí el idioma del audio y se abre en mpv.',
  more: 'Mostrar u ocultar el detalle del análisis.',
  seeds: 'Seeds conectados: usuarios con el archivo completo que te están mandando datos ahora.',
  peers: 'Peers conectados: todos los que están conectados con vos ahora, tengan el archivo completo o no.',
  tseed: 'Seeders del tracker: cuántos usuarios con el archivo completo anuncia el tracker en total. No todos se conectan con vos.',
  tleech: 'Leechers del tracker: cuántos lo están bajando según el tracker.',
  when: 'Cuándo se midió la velocidad por última vez.',
  copy: 'Copiar nombre del torrent',
};
const PHASE_TEXT = { connecting: 'conectando', metadata: 'buscando metadatos', preload: 'precargando' };
const BUSY_TEXT = {
  'quick-req': 'leyendo datos…', quick: 'leyendo datos…', scraping: 'consultando trackers…', prep: 'preparando…',
  held: 'en pausa', 'paused-all': 'análisis en pausa',
};

/** Filas abiertas / con "Más datos" abierto (sobreviven al redibujo). */
const openRows = new Set();
/** "Análisis rápido" pedido y todavía sin datos (la fase rápida no pasa por la cola visible). */
/** Pedidos de análisis recién tocados (antes de que el núcleo los ponga en cola): la fila
 *  muestra "preparando…" al instante y el botón queda deshabilitado (2026-11-14). */
const pending = new Map();
/** Marca `hashes` como pedidos y manda el pedido; si falla, vuelve atrás y muestra el error. */
/** "Reiniciar análisis" (2026-11-14): desde cero aunque ya esté en cola, pausado o midiéndose
 *  (si se trabó). `quick`: solo la fase rápida; si no, también la medición de velocidad. */
function restartAnalysis(h, quick) {
  pending.set(h, quick ? 'quick' : 'speed');
  activity.push({ area: 'analisis', text: `Reiniciaste ${quick ? 'el análisis rápido' : 'la medición de velocidad'} de ${titleOf(h)}` });
  renderLibrary();
  return api.analyzerRestart(h, quick).catch((err) => { pending.delete(h); renderLibrary(); showError(err); });
}
/** Qué reinicia el botón de la fila: lo que está corriendo, o lo último que se hizo. */
function restartIsQuick(e, a) {
  if (['quick', 'quick-req'].includes(a.kind)) return true;
  if (['measuring', 'prep', 'queued', 'scraping', 'held', 'paused-all'].includes(a.kind)) return false;
  return !(e.live?.avg_speed_bps > 0);
}

function requestAnalysis(kind, hashes, scope, note) {
  const fresh = hashes.filter((h) => !isBusy(h));
  if (!fresh.length) return Promise.resolve();
  for (const h of fresh) pending.set(h, kind);
  activity.push({ area: 'analisis', text: note });
  renderLibrary();
  return api.analyze(scope).catch((err) => {
    for (const h of fresh) pending.delete(h);
    renderLibrary();
    showError(err);
  });
}
/** ¿Ya se está analizando (pedido, en cola, pausado o midiéndose)? */
function isBusy(h) {
  return pending.has(h) || queued.includes(h) || held.has(h)
    || (analyzerState.kind === 'measuring' && analyzerState.current === h);
}
/** info_hash → { sig, node }: una fila solo se rehace si cambió algo de lo que muestra. */
const rowCache = new Map();

function renderGroup(container, list) {
  container.hidden = list.length === 0;
  const ul = container.querySelector('ul');
  const nodes = list.map(rowNode);
  if (nodes.length !== ul.children.length || nodes.some((n, i) => ul.children[i] !== n)) ul.replaceChildren(...nodes);
  patchLive();
  markOverflow();
}

/** Lo bajado del video: lo que hay en disco (análisis FR-06d o reproducción pausada, el núcleo
 *  da el máximo), lo verificado en vivo mientras se mide, y dónde se pausó la reproducción. */
function downloadInfo(e, liveBytes = 0) {
  const size = e.video_size ?? e.live?.file_size;
  const p = [...playbacks.values()].find((r) => r.info_hash === e.info_hash && r.state.kind === 'paused');
  const bytes = Math.max(e.downloaded_bytes ?? 0, liveBytes, p && size ? p.progress * size : 0);
  return size ? { bytes, size, pct: Math.min(100, Math.floor((bytes / size) * 100)), pos: p?.state.position_secs ?? null } : null;
}

/** Reproducción en curso de ese magnet (no las pausadas ni las fallidas). */
function activePlayback(hash) {
  return [...playbacks.values()].find((r) => r.info_hash === hash && !['paused', 'failed'].includes(r.state.kind)) ?? null;
}
const PB_LOADING = new Set(['fetching-metadata', 'preparing', 'stopping']);
function pbText(pb) {
  const k = pb.state.kind;
  if (k === 'fetching-metadata') return 'buscando metadatos…';
  if (k === 'preparing') return `preparando ${Math.round((pb.state.fraction ?? 0) * 100)} %`;
  if (k === 'stopping') return 'cerrando…';
  if (k === 'download-paused') return 'reproduciendo · descarga en pausa';
  if (k === 'ask-after-close') return 'cerraste el reproductor…';
  if (k === 'background') return `bajando de fondo · ${Math.floor((pb.progress ?? 0) * 100)} %`;
  return 'reproduciendo';
}

/** Botón con spinner mientras el pedido viaja; se va solo cuando la fila se rehace (o a los 4 s). */
const run = (fn) => (ev) => {
  ev.stopPropagation();
  const b = ev.currentTarget;
  b.classList.add('busy');
  b.setAttribute('aria-busy', 'true');
  const done = () => { b.classList.remove('busy'); b.removeAttribute('aria-busy'); };
  fn().then(() => setTimeout(done, 4000), (err) => { done(); showError(err); });
};

function rowState(e, a) {
  if (a.kind === 'measuring') return 'live';
  if (e.live?.avg_speed_bps > 0) return 'done';
  return e.live ? 'quick' : 'none';
}

function rowNode(e) {
  const a = rowAnalysis(e);
  const pb = activePlayback(e.info_hash);
  const pbSig = pb && [pb.id, pb.state.kind, Math.round((pb.state.fraction ?? 0) * 20)];
  const sig = JSON.stringify([e, { ...a, live: a.live?.phase }, downloadInfo(e), pbSig, Math.floor(Date.now() / 60000)]);
  const hit = rowCache.get(e.info_hash);
  let node = hit?.sig === sig ? hit.node : null;
  if (!node) {
    if (hit) mqStop(hit.node);
    node = card(e, a);
    rowCache.set(e.info_hash, { sig, node });
  }
  node.classList.toggle('selected', e.info_hash === selected);
  node.querySelector('.row-check').checked = checked.has(e.info_hash);
  return node;
}

function hms(secs) {
  const s = Math.floor(secs);
  return `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

/** "2 h 46" corto y "2 h 46 min" largo; estimada: "~45 min" / "unos 45 min". */
function durTexts(d) {
  const h = Math.floor(d.secs / 3600), m = Math.round((d.secs % 3600) / 60);
  const short = h ? `${h} h${m ? ` ${String(m).padStart(2, '0')}` : ''}` : `${m} min`;
  const long = h ? `${h} h${m ? ` ${m} min` : ''}` : `${m} min`;
  return d.estimated ? [`~${short}`, `unos ${long}`] : [short, long];
}

const tipAttrs = (tip) => ({ 'data-tip': tip });
function ib(iconName, label, tip, onclick, extra = {}) {
  return el('button', { class: 'ib', type: 'button', 'aria-label': label, ...tipAttrs(tip), onclick, ...extra }, icon(iconName, 16));
}

const LANG_RANK = { lat: 0, en: 1, cast: 2 };
function langBadges(e) {
  const langs = (e.languages ?? []).filter((l) => l.code !== '?')
    .sort((x, y) => (LANG_RANK[x.code] ?? 9) - (LANG_RANK[y.code] ?? 9));
  return langs.map((l) => {
    const tip = l.confirmed
      ? `${l.label}: confirmado, el torrent trae una pista de audio en ${l.label.toLowerCase()}.${l.detail ? ` ${l.detail}` : ''}`
      : `${l.label}: adivinado por el nombre del torrent. Todavía no leímos las pistas de audio reales.`;
    return el('span', { class: `lang ${l.code in LANG_RANK ? l.code : ''} ${l.confirmed ? '' : 'guess'}`, role: 'img', tabindex: '0', 'aria-label': tip, 'data-tip': tip }, l.short);
  });
}

function card(e, a) {
  const h = e.info_hash;
  const state = rowState(e, a);
  const live = e.live;
  const need = e.score?.needed_bps;
  const busy = ['queued', 'quick', 'quick-req', 'prep', 'scraping', 'paused-all', 'held'].includes(a.kind);
  const phase = state === 'live' ? (a.live?.phase ?? 'connecting') : null;
  const stop = (ev) => ev.stopPropagation();
  const analyze = (ev) => {
    stop(ev);
    requestAnalysis('speed', [h], { kind: 'one', hash: h }, `Pediste medir la velocidad de ${titleOf(h)}`);
  };
  const pb = activePlayback(h);
  const pbLoading = pb && PB_LOADING.has(pb.state.kind);

  // Título limpio + año / episodio; abajo el nombre crudo con copiar.
  const r = e.release;
  const sub = r?.season != null ? `T${r.season}${r.episode != null ? ` · E${r.episode}` : ''}` : r?.year ?? null;
  const raw = fullName(e);
  const copyBtn = state === 'none' ? null : ib('copy', TIP.copy, TIP.copy, (ev) => { stop(ev); copyRaw(ev.currentTarget, raw); }, { class: 'ib cp' });
  const id = el('div', { class: 'id' },
    el('div', { class: 'ttl' }, el('span', { class: 'tn' }, r?.title || raw), sub ? el('span', { class: 'yr' }, String(sub)) : null),
    el('div', { class: 'rw' }, el('div', { class: 'raw' }, el('span', {}, raw)), copyBtn));

  // Peso · duración.
  const size = e.video_size ?? live?.file_size;
  const dur = e.score?.duration;
  let meta = el('div', {});
  if (state !== 'none' && (size || dur)) {
    const [ds, dl] = dur ? durTexts(dur) : [null, null];
    const tip = `${size ? `Pesa ${humanBytes(size)}` : ''}${size && dl ? ' y ' : ''}${dl ? `dura ${dl}${dur.estimated ? ' (estimada por el tamaño)' : ''}` : ''}.`;
    meta = el('div', { class: 'mt', 'data-tip': tip.charAt(0).toUpperCase() + tip.slice(1) },
      size ? humanBytes(size) : '', size && ds ? el('span', { class: 'sep', 'aria-hidden': 'true' }, '·') : null, ds ?? '');
  }

  // Velocidad real / lo que consume el video, con el × como sello.
  let speed;
  const fraction = (val) => el('span', { class: 'fr' }, el('b', {}, val), need ? el('span', { class: 'nd' }, `/ ${mb(need)} `) : null, 'Mbps');
  if (pb) {
    speed = el('span', { class: `ph work${pbLoading ? ' ld' : ''}`, role: 'status', tabindex: '0',
      'data-tip': pbLoading ? 'Preparando la reproducción: baja el principio y el final del video antes de abrir mpv. Con el botón cuadrado la cancelás.' : 'Se está viendo en mpv. Con el botón cuadrado cerrás el reproductor; lo bajado queda guardado.' },
    el('i', { class: pbLoading ? 'spin' : 'pulse', 'aria-hidden': 'true' }), pbText(pb));
  } else if (state === 'live' && !['measuring', 'probing'].includes(phase)) {
    speed = el('span', { class: 'ph work', role: 'status', tabindex: '0', 'data-tip': 'Preparando la medición: arranca el motor, busca los metadatos y precarga el principio del video. Después mide unas decenas de segundos.' },
      el('i', { class: 'spin', 'aria-hidden': 'true' }), `preparando · ${PHASE_TEXT[phase]}`);
  } else if (state === 'live') {
    const now = a.live ?? { speed_bps: 0, secs: 0 };
    const tip = `Midiendo: la velocidad y el × son provisorios hasta que termine.${need ? ` El video consume unos ${mb(need)} Mbps.` : ''}${SCALE}`;
    speed = el('div', { class: 'u u2', tabindex: '0', role: 'group', 'aria-label': tip, 'data-tip': tip },
      el('span', { class: 'u2-l' },
        fraction(el('span', { 'data-live': 'spd' }, mb(now.speed_bps))),
        el('small', {}, el('i', { class: 'pulse' }), ...(phase === 'probing' ? ['leyendo duración y audios'] : ['midiendo · ', el('span', { 'data-live': 'sec' }, String(Math.round(now.secs))), ' s']))),
      need ? el('span', { class: 'xb prov' }, '≈', el('span', { 'data-live': 'ratio' }, nf1(now.speed_bps / need)), '×') : null);
  } else if (state === 'done' && a.kind !== 'prep') {
    const ratio = e.score?.margin;
    const cls = LIGHT_CLS[e.score?.light] ?? 'prov';
    const approx = live.partial ? '≈' : '';
    let tip = `${mb(live.avg_speed_bps)} Mbps reales.`;
    if (ratio != null) {
      const verdict = ratio >= 1.5 ? 'Sobra margen: no se corta.' : ratio >= 1 ? 'Justo: puede cortarse si la velocidad cae.' : 'No llega: se va a cortar. Conviene dejarlo bajar un rato antes de ver.';
      tip = `${nf(ratio)}× = ${mb(live.avg_speed_bps)} Mbps reales ÷ ${mb(need)} Mbps que consume el video. ${verdict}${SCALE}`;
    }
    if (live.partial) tip += ` Medición parcial (${Math.round(live.measured_secs)} s): menos precisa.`;
    speed = el('div', { class: 'u u2', tabindex: '0', role: 'group', 'aria-label': tip, 'data-tip': tip },
      fraction(`${approx}${mb(live.avg_speed_bps)}`),
      ratio != null ? el('span', { class: `xb ${cls}${live.partial ? ' part' : ''}` }, `${approx}${nf(ratio)}×`) : null);
  } else if (busy) {
    speed = el('span', { class: 'ph' }, a.kind === 'queued' ? `en cola #${a.pos}` : BUSY_TEXT[a.kind]);
  } else if (e.status?.kind === 'failed') {
    speed = el('span', { class: 'ph bad', tabindex: '0', 'data-tip': `Falló el análisis: ${e.status.reason ?? 'sin detalle'}` }, 'falló');
  } else {
    speed = el('span', { class: 'ph' }, state === 'quick' ? 'sin medir' : 'sin analizar');
  }

  // Acciones: Listo + pausa al medir; pausa / seguir en cola; si no, análisis rápido y medir.
  let acts;
  if (state === 'live') {
    acts = [
      ib('check', 'Listo', TIP.done, run(() => api.analyzerFinish())),
      ib('pause', 'Pausar medición', TIP.pause, run(() => api.analyzerPauseOne(h))),
    ];
  } else if (a.kind === 'held') {
    acts = [ib('play', 'Seguir analizando', TIP.resume, run(() => api.analyzerResumeOne(h)), { 'aria-pressed': 'true' })];
  } else if (busy && !['quick-req', 'prep'].includes(a.kind)) {
    acts = [ib('pause', 'Pausar análisis', TIP.pause, run(() => api.analyzerPauseOne(h)))];
  } else {
    acts = [];
    if (state === 'none') {
      acts.push(ib('quick', 'Análisis rápido', TIP.quick, (ev) => {
        stop(ev);
        requestAnalysis('quick', [h], { kind: 'quick', hash: h }, `Pediste el análisis rápido de ${titleOf(h)}`);
      }));
    }
    acts.push(state === 'done'
      ? ib('gauge', 'Medir de nuevo', TIP.re, analyze)
      : ib('gauge', 'Medir velocidad', TIP.speed, analyze));
    // Ya pedido: el botón queda con spinner y deshabilitado (no se puede pedir dos veces).
    if (['quick-req', 'prep'].includes(a.kind)) {
      for (const b of acts) {
        b.disabled = true;
        b.setAttribute('aria-disabled', 'true');
        b.dataset.tip = 'Ya se está analizando';
      }
      const spinning = acts[a.kind === 'quick-req' ? 0 : acts.length - 1];
      spinning.classList.add('busy');
      spinning.setAttribute('aria-busy', 'true');
    }
  }
  const bg = pb?.state.kind === 'background';
  if (bg) {
    acts = [ib('pause', 'Pausar descarga', 'Pausar descarga: deja de bajar de fondo; lo bajado queda guardado para retomar.', run(() => api.playbackAction(pb.id, 'stop')))];
  }
  const watch = pb && !bg ? el('button', {
    class: `play stopb${pbLoading ? ' loading' : ''}`, type: 'button', 'aria-label': pbLoading ? 'Cancelar' : 'Detener',
    'data-tip': pbLoading ? `${pbText(pb)[0].toUpperCase()}${pbText(pb).slice(1)}: tocá para cancelar (lo bajado queda guardado).` : 'Detener: cierra mpv; lo bajado queda guardado para retomar.',
    disabled: pb.state.kind === 'stopping',
    onclick: run(() => api.playbackAction(pb.id, 'stop')),
  }, icon('stop', 14)) : state === 'none' ? null : el('button', {
    class: 'play', type: 'button', 'data-watch': '', 'aria-haspopup': 'dialog', 'aria-expanded': 'false', 'aria-label': 'Ver', 'data-tip': TIP.watch,
    onclick: (ev) => { stop(ev); play(h, ev.currentTarget); },
  }, icon('play', 15));

  const open = openRows.has(h) && state !== 'none';
  const exp = state === 'none' ? null : el('button', {
    class: 'ib exp', type: 'button', 'aria-expanded': String(open), 'aria-controls': `more-${h}`, 'aria-label': 'Detalles', 'data-tip': TIP.more,
    onclick: (ev) => { stop(ev); toggleRow(ev.currentTarget.closest('.row')); },
  }, icon('chev', 16));

  const cb = el('input', { type: 'checkbox', class: 'row-check', 'aria-label': 'Seleccionar para analizar', 'data-tip': 'Marcar para "Analizar seleccionados"' });
  cb.addEventListener('click', (ev) => {
    ev.stopPropagation();
    if (cb.checked) checked.add(h); else checked.delete(h);
    renderToolbar();
  });

  const row = el('li', {
    class: `row${open ? ' open' : ''}${a.kind === 'held' ? ' paused' : ''}${pbLoading || ['measuring', 'quick', 'quick-req', 'prep', 'scraping'].includes(a.kind) ? ' working' : ''}`, 'data-hash': h, 'data-state': state,
    onclick: (ev) => onRowClick(ev, e),
    ondblclick: (ev) => { if (!ev.target.closest('button, input, .more')) play(h); },
    oncontextmenu: (ev) => { ev.preventDefault(); select(h); openMenu(ev, e); },
    onpointerenter: (ev) => mqStart(ev.currentTarget),
    onpointerleave: (ev) => { if (!ev.currentTarget.contains(document.activeElement)) mqStop(ev.currentTarget); },
    onfocusin: (ev) => mqStart(ev.currentTarget),
    onfocusout: (ev) => { const r2 = ev.currentTarget; if (!r2.contains(ev.relatedTarget) && !r2.matches(':hover')) mqStop(r2); },
  },
  el('div', { class: 'hd' }, cb, id, meta, el('div', { class: 'lgs' }, ...langBadges(e)), el('div', { class: 'cell-r' }, speed),
    el('div', { class: 'ac' }, ...acts, watch), el('div', { class: 'ex' }, exp)));
  if (state !== 'none') row.append(detail(e, a, state, open));
  return row;
}

/** Detalle desplegable: lo bajado o un resumen + calidad, y debajo el enjambre. */
function restartBtn(e, a) {
  const quick = restartIsQuick(e, a);
  return el('button', {
    class: 'rs', type: 'button',
    'data-tip': `Reiniciar análisis: vuelve a hacer ${quick ? 'el análisis rápido' : 'la medición de velocidad'} desde cero, aunque esté en cola o a mitad de camino. Para cuando se trabó.`,
    onclick: (ev) => { ev.stopPropagation(); restartAnalysis(e.info_hash, quick); },
  }, icon('refresh', 14), 'Reiniciar análisis');
}

function detail(e, a, state, open) {
  const h = e.info_hash;
  const live = e.live;
  const dl = downloadInfo(e, a.live?.downloaded_bytes);
  let top;
  // Midiendo: la línea está siempre, para que `patchLive` haga crecer la barra.
  if (dl && (dl.bytes > 0 || state === 'live')) {
    top = el('span', {}, el('b', { 'data-live': 'pct' }, `${dl.pct} %`), ' bajado',
      el('span', { class: 'bar', role: 'progressbar', 'aria-label': 'Descargado', 'aria-valuenow': String(dl.pct), 'aria-valuemin': '0', 'aria-valuemax': '100' }, el('i', { 'data-live': 'bar', style: `width:${dl.pct}%` })),
      el('span', { 'data-live': 'got' }, gotOf(dl.bytes, dl.size)),
      dl.pos != null ? el('span', { class: 'sep', 'aria-hidden': 'true' }, '·') : null,
      dl.pos != null ? `pausaste en ${hms(dl.pos)}` : null);
  } else {
    const sum = state === 'live' ? 'Midiendo la velocidad ahora: el × es provisorio'
      : state === 'quick' ? `Datos leídos ${ago(live.measured_at)}: falta medir la velocidad`
        : `Medido ${ago(live.measured_at)}${live.partial ? ' (medición parcial)' : ''}`;
    top = el('span', {}, sum);
  }
  const quality = e.release?.quality ?? [];
  const chips = el('span', { class: 'chips' }, ...quality.map((q) => el('span', { class: `chip${/^(4K|\d+p)$/.test(q) ? ' q' : ''}` }, q)));
  const now = state === 'live' ? a.live : null;
  const sw = (k, v, tip, key) => el('span', { class: 'sw', tabindex: '0', 'data-tip': tip }, el('span', { class: 'dim' }, k), el('b', key ? { 'data-live': key } : {}, String(v ?? '–')));
  const xtra = el('div', { class: 'xtra-in' },
    sw('Seeds conectados', now?.seeds ?? live?.seeds, TIP.seeds, 'seeds'),
    sw('Peers conectados', now?.peers ?? live?.peers, TIP.peers, 'peers'),
    sw('Seeders del tracker', e.scrape?.seeders, TIP.tseed),
    sw('Leechers del tracker', e.scrape?.leechers, TIP.tleech),
    dl?.bytes > 0 && live?.avg_speed_bps > 0 ? sw('Medido', ago(live.measured_at), TIP.when) : null);
  const more = el('div', { class: 'more', id: `more-${h}` }, el('div', {},
    el('div', { class: 'det' }, el('div', { class: 'top' }, top, chips, restartBtn(e, a)), xtra)));
  more.inert = !open;
  return more;
}

/** "2,8 de 23,4 GB" (la unidad una sola vez si coincide). */
function gotOf(got, total) {
  const g = humanBytes(got);
  const t = humanBytes(total);
  return `${g.slice(-2) === t.slice(-2) ? g.slice(0, -3) : g} de ${t}`;
}

function select(hash) {
  selected = hash;
  document.querySelectorAll('.row.selected').forEach((n) => n.classList.remove('selected'));
  document.querySelector(`.row[data-hash="${hash}"]`)?.classList.add('selected');
  $('#btn-play').disabled = !entries.has(hash);
}

function onRowClick(ev, e) {
  select(e.info_hash);
  if (ev.target.closest('button, input, .more') || String(getSelection())) return;
  if (ev.detail > 1) return; // el doble clic reproduce: no abrir y cerrar
  toggleRow(ev.currentTarget);
}

function toggleRow(row) {
  const more = row.querySelector('.more');
  if (!more) return;
  const open = row.classList.toggle('open');
  more.inert = !open;
  row.querySelector('.exp')?.setAttribute('aria-expanded', String(open));
  if (open) openRows.add(row.dataset.hash); else openRows.delete(row.dataset.hash);
  markOverflow();
}

/** Velocidad en vivo (cada ~2 s) sin rehacer la fila: solo los números. */
function patchLive() {
  const s = analyzerState;
  if (s.kind !== 'measuring' || !s.current || !s.live) return;
  const row = document.querySelector(`.row[data-hash="${s.current}"]`);
  if (!row) return;
  const need = entries.get(s.current)?.score?.needed_bps;
  const set = (k, v) => row.querySelectorAll(`[data-live="${k}"]`).forEach((n) => (n.textContent = v));
  set('spd', mb(s.live.speed_bps));
  set('sec', String(Math.round(s.live.secs)));
  if (need) set('ratio', nf1(s.live.speed_bps / need));
  set('seeds', String(s.live.seeds));
  set('peers', String(s.live.peers));
  const e = entries.get(s.current);
  const dl = e && downloadInfo(e, s.live.downloaded_bytes);
  if (dl) {
    set('pct', `${dl.pct} %`);
    set('got', gotOf(dl.bytes, dl.size));
    row.querySelectorAll('[data-live="bar"]').forEach((n) => (n.style.width = `${dl.pct}%`));
    row.querySelector('.bar')?.setAttribute('aria-valuenow', String(dl.pct));
  }
}

async function copyRaw(b, text) {
  try { await navigator.clipboard.writeText(text); } catch { setStatus('No se pudo copiar: seleccioná el nombre y copialo a mano.'); return; }
  b.classList.add('ok');
  b.replaceChildren(icon('check', 16));
  srSay('Copiado');
  clearTimeout(b._t);
  b._t = setTimeout(() => { b.classList.remove('ok'); b.replaceChildren(icon('copy', 16)); }, 1500);
}

// Título cortado: tooltip con el texto entero. Nombre crudo largo: marquesina al pasar por la fila
// (con movimiento reducido, tooltip con el nombre entero).
function markOverflow() {
  requestAnimationFrame(() => {
    document.querySelectorAll('.row .tn').forEach((n) => {
      if (n.scrollWidth > n.clientWidth + 1) { n.dataset.tip = n.textContent; n.tabIndex = 0; } else { delete n.dataset.tip; n.removeAttribute('tabindex'); }
    });
    document.querySelectorAll('.row .raw').forEach((n) => {
      const ov = n.firstElementChild.scrollWidth > n.clientWidth + 1;
      n.classList.toggle('ov', ov);
      if (ov && reduceMotion) { n.dataset.tip = `Nombre del torrent: ${n.textContent}`; n.tabIndex = 0; } else { delete n.dataset.tip; n.removeAttribute('tabindex'); }
    });
  });
}
window.addEventListener('resize', markOverflow);

const MQ = new Map();
const MQ_PX_S = 32;
function mqStart(row) {
  const raw = row.querySelector('.raw');
  const t = raw?.firstElementChild;
  if (!t || reduceMotion || MQ.has(row)) return;
  const d = t.scrollWidth - raw.clientWidth;
  if (d <= 1) return;
  const st = {};
  const dur = Math.max(1.5, d / MQ_PX_S);
  MQ.set(row, st);
  const go = (x, next) => {
    t.style.transition = `transform ${dur}s linear`;
    t.style.transform = `translateX(${x}px)`;
    raw.classList.toggle('end', x !== 0);
    st.t = setTimeout(next, dur * 1000 + 1400);
  };
  const fwd = () => go(-d, back);
  const back = () => go(0, fwd);
  st.t = setTimeout(fwd, 700);
}
function mqStop(row) {
  const st = MQ.get(row);
  if (!st) return;
  clearTimeout(st.t);
  MQ.delete(row);
  const raw = row.querySelector('.raw');
  const t = raw.firstElementChild;
  t.style.transition = 'transform .5s var(--out)';
  t.style.transform = '';
  raw.classList.remove('end');
}

// ---------- tooltip propio: burbuja animada en hover y foco de teclado (2026-11-14) ----------
// Reemplaza también los `title` nativos de toda la app (los pasa a `data-tip` al pasar por
// encima, antes de que el sistema muestre el suyo). Formato: "Título: explicación" → título en
// negrita + texto; "\n" separa párrafos; atajos "(Ctrl+V)", "(F5)", "(Enter)" van como teclas.
// Va en la capa superior (popover) para verse también sobre los diálogos.
const tip = el('div', { id: 'tip', class: 'tip', role: 'tooltip' });
const canPopover = typeof tip.showPopover === 'function';
if (canPopover) tip.setAttribute('popover', 'manual'); else tip.hidden = true;
const sr = el('div', { class: 'sr', 'aria-live': 'polite' });
document.body.append(tip, sr);
function srSay(msg) { sr.textContent = msg; setTimeout(() => (sr.textContent = ''), 1500); }
let tipT;
let tipOffT;
let tipEl = null;
let tipFor = null;
const tipOpen = () => (canPopover ? tip.matches(':popover-open') : !tip.hidden);
function showTipLayer() { if (canPopover) { if (!tipOpen()) tip.showPopover(); } else tip.hidden = false; }
function hideTipLayer() { if (canPopover) { if (tipOpen()) tip.hidePopover(); } else tip.hidden = true; }
function hideTip() {
  clearTimeout(tipT);
  tip.classList.remove('on');
  clearTimeout(tipOffT);
  tipOffT = setTimeout(() => { if (!tip.classList.contains('on')) hideTipLayer(); }, 160);
  tipFor?.removeAttribute('aria-describedby');
  tipFor = null;
}

const KEY_RE = /\((Ctrl\+[^)]{1,12}|Shift\+[^)]{1,12}|Alt\+[^)]{1,12}|F\d{1,2}|Enter|Esc|Supr|Espacio)\)/g;
/** Texto con atajos de teclado como <kbd> (siempre como texto: puede traer nombres de torrents). */
function withKeys(text) {
  const out = [];
  let last = 0;
  for (const m of text.matchAll(KEY_RE)) {
    out.push(text.slice(last, m.index), el('kbd', {}, m[1]));
    last = m.index + m[0].length;
  }
  out.push(text.slice(last));
  return out.filter((x) => x !== '');
}
function fillTip(text) {
  const paras = text.split('\n').map((p) => p.trim()).filter(Boolean);
  const m = paras[0]?.match(/^([^:\n]{2,42}):\s+(.+)$/);
  const parts = [];
  if (m && !/https?$/.test(m[1])) {
    parts.push(el('strong', { class: 'tip-h' }, ...withKeys(m[1])));
    paras[0] = m[2].charAt(0).toUpperCase() + m[2].slice(1);
  }
  for (const p of paras) parts.push(el('p', {}, ...withKeys(p)));
  tip.classList.toggle('mini', !m && paras.length === 1 && text.length <= 48);
  tip.replaceChildren(el('span', { class: 'tip-arrow', 'aria-hidden': 'true' }), ...parts);
}

/** `title` nativo → `data-tip` (y nombre accesible si el botón es solo un ícono). */
function adoptTitle(n) {
  const t = n.getAttribute('title');
  if (t == null) return;
  n.removeAttribute('title');
  if (!t.trim()) return;
  n.dataset.tip = t;
  if (!n.hasAttribute('aria-label') && n.textContent.trim().length <= 2) n.setAttribute('aria-label', t);
}

function wantTip(target) {
  if (target === tipEl) return;
  tipEl = target;
  clearTimeout(tipT);
  if (!target) { hideTip(); return; }
  tipT = setTimeout(() => {
    if (pkBtn || !target.isConnected || !target.dataset.tip) return;
    clearTimeout(tipOffT);
    tipFor?.removeAttribute('aria-describedby');
    const switching = tip.classList.contains('on');
    fillTip(target.dataset.tip);
    showTipLayer();
    if (!switching) tip.classList.remove('on');
    tip.classList.remove('below');
    const r = target.getBoundingClientRect();
    const w = tip.offsetWidth;
    const hgt = tip.offsetHeight;
    let y = r.top - hgt - 10;
    if (y < 8) { y = r.bottom + 10; tip.classList.add('below'); }
    const x = Math.max(8, Math.min(innerWidth - w - 8, r.left + r.width / 2 - w / 2));
    tip.style.left = `${x}px`;
    tip.style.top = `${y}px`;
    // La flecha apunta al centro del elemento aunque la burbuja se corra por el borde.
    tip.style.setProperty('--ax', `${Math.max(14, Math.min(w - 14, r.left + r.width / 2 - x))}px`);
    if (!target.hasAttribute('aria-label')) { target.setAttribute('aria-describedby', 'tip'); tipFor = target; }
    requestAnimationFrame(() => tip.classList.add('on'));
  }, tip.classList.contains('on') ? 60 : 380);
}
function tipScope(t) {
  const n = t.closest?.('[data-tip], [title]');
  if (n?.hasAttribute('title')) adoptTitle(n);
  return n?.dataset.tip ? n : null;
}
document.addEventListener('pointerover', (ev) => wantTip(tipScope(ev.target)));
document.addEventListener('pointerout', (ev) => { if (!ev.relatedTarget) wantTip(null); });
document.addEventListener('pointerdown', () => wantTip(null), true);
document.addEventListener('focusin', (ev) => { const t = tipScope(ev.target); wantTip(t && t.matches(':focus-visible') ? t : null); });
document.addEventListener('focusout', () => wantTip(null));
document.addEventListener('scroll', () => wantTip(null), { capture: true, passive: true });

// ---------- análisis por fila (2026-11-14) ----------
/** Magnets esperando análisis y pausados uno por uno (evento `analyzer-queue`). */
let queued = [];
let held = new Set();
/** Marcados con la casilla para "Analizar seleccionados". */
const checked = new Set();

/** Estado del análisis de UNA fila. */
function langSummary(e) {
  const langs = e.languages ?? [];
  if (!langs.length) return e.live?.audio ? 'sin pistas de audio con idioma' : null;
  const src = langs[0].confirmed ? '' : ' (según el nombre, sin confirmar)';
  return langs.map((l) => `${l.label}${l.detail ? ` — ${l.detail}` : ''}`).join('\n') + src;
}

function rowAnalysis(e) {
  const h = e.info_hash;
  const s = analyzerState;
  if (s.kind === 'measuring' && s.current === h) return { kind: 'measuring', live: s.live };
  if (held.has(h)) return { kind: 'held' };
  const pos = queued.indexOf(h);
  if (pos >= 0) {
    if (s.kind === 'paused') return { kind: 'paused-all' };
    if (s.kind === 'quick-scan' && !e.live) return { kind: 'quick' };
    if (e.status?.kind === 'scraping') return { kind: 'scraping' };
    return { kind: 'queued', pos: pos + 1 };
  }
  if (e.status?.kind === 'scraping') return { kind: 'scraping' };
  if (pending.has(h)) return { kind: pending.get(h) === 'quick' ? 'quick-req' : 'prep' };
  return { kind: 'idle' };
}

// ---------- barra de análisis: seleccionar / analizar / pausar todo ----------
function renderToolbar() {
  for (const h of [...checked]) if (!entries.has(h)) checked.delete(h);
  const n = checked.size;
  document.body.classList.toggle('selecting', n > 0);
  const all = $('#check-all');
  all.checked = n > 0 && n === entries.size;
  all.indeterminate = n > 0 && n < entries.size;
  const idle = [...checked].filter((h) => !isBusy(h)).length;
  $('#btn-analyze-selected').disabled = idle === 0;
  $('#btn-analyze-selected').textContent = n ? `Analizar seleccionados (${idle})` : 'Analizar seleccionados';
  const busyN = [...entries.keys()].filter(isBusy).length;
  const allBtn = $('#btn-analyze');
  allBtn.disabled = entries.size > 0 && busyN === entries.size;
  // Sin "1 de 2": lo que se analiza no tiene por qué ser toda la lista (pedido 2026-11-14).
  allBtn.textContent = allBtn.disabled ? 'Analizando todo…' : 'Analizar todo';
  allBtn.title = allBtn.disabled ? 'Ya se están analizando todos' : 'Analizar todos los magnets (F5)';
  const s = analyzerState.kind;
  const running = ['scraping', 'quick-scan', 'measuring'].includes(s);
  const pauseBtn = $('#btn-pause-all');
  pauseBtn.hidden = !(running || s === 'paused');
  pauseBtn.replaceChildren(...(s === 'paused' ? [icon('resume', 13), 'Reanudar todo'] : [icon('pause', 12), 'Pausar todo']));
}


// ---------- menú contextual (FR-30) y "Ver análisis" ----------
function openMenu(ev, e) {
  const menu = $('#ctx-menu');
  const item = (label, fn) => el('button', { class: 'ctx-item', onclick: () => { closeMenu(); fn(); } }, label);
  const copy = (text, what) => navigator.clipboard.writeText(text).then(() => setStatus(`${what} copiado.`), showError);
  // Lo que antes estaba en el panel "Reproducciones" (FR-14/15): ahora vive en la fila y acá.
  const pbAll = [...playbacks.values()].filter((r) => r.info_hash === e.info_hash);
  const active = pbAll.find((r) => !['paused', 'failed'].includes(r.state.kind));
  const act = (r, action) => () => api.playbackAction(r.id, action).catch(showError);
  const pbItems = [];
  if (active) {
    pbItems.push(item('Detener (lo bajado queda guardado)', act(active, 'stop')));
    if (active.state.kind !== 'background' && active.state.kind !== 'ask-after-close') {
      pbItems.push(active.state.kind === 'download-paused'
        ? item('Reanudar descarga', act(active, 'resume-download'))
        : item('Pausar descarga', act(active, 'pause-download')));
    }
    pbItems.push(item('Ver log de la reproducción', () => openLog(active)));
  }
  if (pbAll[0]) {
    const r = active ?? pbAll[0];
    pbItems.push(item('Abrir carpeta de la descarga', act(r, 'open-folder')));
    pbItems.push(item('Borrar lo descargado…', async () => {
      const ok = await confirmDialog('Borrar descarga', `Se borra lo descargado de "${fullName(e)}" (${Math.round((r.progress ?? 0) * 100)} % bajado). No se puede deshacer.`,
        [{ label: 'Cancelar', value: false }, { label: 'Borrar', value: true, primary: true }]);
      if (ok) act(r, 'stop-and-delete')();
    }));
  }
  menu.replaceChildren(
    item(active ? '▶ Volver a mpv' : pbAll[0] ? '▶ Retomar' : '▶ Reproducir', () => play(e.info_hash)),
    item('Reproducir en VLC', () => api.play(e.info_hash, 'vlc').catch(showError)),
    ...(pbItems.length ? [el('hr'), ...pbItems] : []),
    el('hr'),
    item('Ver análisis', () => showAnalysis(e.info_hash)),
    item(e.live ? 'Re-analizar' : 'Analizar', () => requestAnalysis('speed', [e.info_hash], { kind: 'one', hash: e.info_hash }, `Pediste medir la velocidad de ${titleOf(e.info_hash)}`)),
    item('Reiniciar análisis rápido', () => restartAnalysis(e.info_hash, true)),
    item('Reiniciar medición de velocidad', () => restartAnalysis(e.info_hash, false)),
    el('hr'),
    item('Copiar magnet', () => api.magnet(e.info_hash).then((m) => copy(m, 'Magnet'), showError)),
    item('Copiar nombre', () => copy(fullName(e), 'Nombre')),
    el('hr'),
    item('Quitar de la lista', () => api.remove(e.info_hash).catch(showError)),
  );
  menu.hidden = false;
  const { innerWidth: w, innerHeight: h } = window;
  const r = menu.getBoundingClientRect();
  menu.style.left = `${Math.min(ev.clientX, w - r.width - 8)}px`;
  menu.style.top = `${Math.min(ev.clientY, h - r.height - 8)}px`;
}

function closeMenu() {
  $('#ctx-menu').hidden = true;
}

function showAnalysis(hash) {
  const e = entries.get(hash);
  if (!e) return;
  const s = e.score ?? {};
  const live = e.live;
  const row = (k, v) => (v == null || v === '' ? null : el('tr', {}, el('th', {}, k), el('td', {}, String(v))));
  const status = e.status?.kind ?? 'new';
  $('#dlg-analysis-title').textContent = fullName(e);
  $('#dlg-analysis-body').replaceChildren(
    ...[
      row('Nombre real del torrent', e.torrent_name ?? live?.torrent_name ?? '(todavía no llegaron los metadatos)'),
      row('Nombre en el magnet (dn)', e.name),
      row('Info hash', e.info_hash),
      row('Archivo de video', live?.file_name),
      row('Idiomas de audio', langSummary(e)),
      row('Tamaño', (e.video_size ?? live?.file_size) ? humanBytes(e.video_size ?? live.file_size) : null),
      row('Duración', s.duration ? `${duration(s.duration.secs, s.duration.estimated)}${s.duration.estimated ? ' (estimada: falta medir)' : ' (real)'}` : null),
      row('Seeders / leechers (trackers)', e.scrape ? `${e.scrape.seeders} / ${e.scrape.leechers} · respondieron ${e.scrape.trackers_ok} tracker(s) ${ago(e.scrape.scraped_at)}` : 'sin consultar'),
      row('Seeders conectados (reales)', live ? live.seeds ?? 0 : null),
      row('Peers conectados al medir', live?.peers),
      row('Precisión', live ? (live.partial ? `Parcial: ${Math.round(live.measured_secs)} s medidos (se pausó el análisis)` : `Completa: ${Math.round(live.measured_secs || 0)} s medidos`) : null),
      row('Velocidad real (promedio / máxima)', live ? `${mbps(live.avg_speed_bps)} / ${mbps(live.max_speed_bps)}` : 'sin medir'),
      row('Velocidad que necesita', s.needed_bps ? mbps(s.needed_bps) : null),
      row('Margen', s.margin != null ? `${s.margin.toFixed(2).replace('.', ',')}× (verde ≥ 1,5 · amarillo ≥ 1)` : null),
      row('Semáforo', LIGHT_LABEL[s.light ?? 'unknown']),
      row('Estado', `${STATUS_LABEL[status] ?? status}${status === 'failed' && e.status.reason ? `: ${e.status.reason}` : ''}`),
      row('Medido', live ? ago(live.measured_at) : null),
      row('Agregado', ago(e.added_at)),
    ].filter(Boolean),
  );
  $('#dlg-analysis').showModal();
}

// ---------- análisis (FR-05–08): progreso en la barra de estado ----------
let analyzerState = { kind: 'idle' };

function renderAnalyzer() {
  const s = analyzerState;
  const progress = $('#progress');
  progress.hidden = s.kind === 'idle';
  renderToolbar();
  if (s.kind === 'scraping') {
    progress.removeAttribute('value');
    setStatus(`Consultando trackers de ${s.total} magnet(s)…`);
  } else if (s.kind === 'quick-scan') {
    progress.removeAttribute('value');
    setStatus(`Datos rápidos de ${s.total} magnet(s) a la vez: nombre, duración, seeds y peers conectados…`);
  } else if (s.kind === 'measuring') {
    progress.value = s.total ? s.done / s.total : 0;
    const cur = s.current ? entries.get(s.current) : null;
    const live = s.live ? ` · ${Math.round(s.live.secs)} s${s.live.stable ? ', ya estable' : ''}` : '';
    setStatus(`Velocidad real ${s.done + 1} de ${s.total}${cur ? `: ${fullName(cur)}` : ''}${live} — de a uno para no repartir tu conexión. "Listo" corta con lo medido.`);
  } else if (s.kind === 'paused') {
    progress.value = s.total ? s.done / s.total : 0;
    setStatus(`Análisis en pausa (${s.done} de ${s.total} medidos).`);
  }
}

async function onAnalyzeAll() {
  if (entries.size === 0) {
    setStatus('No hay magnets para analizar: copiá alguno primero.');
    return;
  }
  await requestAnalysis('speed', [...entries.keys()], { kind: 'all' }, `Pediste analizar todo (${entries.size})`);
}

async function onPauseAll() {
  try {
    if (analyzerState.kind === 'paused') await api.analyzerResume();
    else await api.analyzerPause();
  } catch (e) {
    showError(e);
  }
}

async function onAnalyzeSelected() {
  const hashes = [...checked].filter((h) => entries.has(h));
  if (!hashes.length) return;
  await requestAnalysis('speed', hashes, { kind: 'selected', hashes }, `Pediste analizar ${hashes.length} seleccionado(s)`);
  checked.clear();
  renderLibrary();
}

function onCheckAll(ev) {
  if (ev.target.checked) for (const h of entries.keys()) checked.add(h);
  else checked.clear();
  renderLibrary();
}

// ---------- "Leer portapapeles": elegir qué magnets agregar ----------
let clipItems = [];

function copiedAt(iso) {
  if (!iso) return 'ahora en el portapapeles';
  const d = new Date(iso);
  const time = d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false });
  const today = new Date().toDateString() === d.toDateString();
  return `${today ? 'hoy' : d.toLocaleDateString('es-AR', { day: 'numeric', month: 'short' })} ${time} · ${ago(iso)}`;
}

function renderClipboardDialog() {
  const boxes = [...document.querySelectorAll('#clip-list input')];
  const n = boxes.filter((b) => b.checked).length;
  const all = $('#clip-all');
  all.checked = n === boxes.length && n > 0;
  all.indeterminate = n > 0 && n < boxes.length;
  $('#clip-count').textContent = `${n} de ${boxes.length} seleccionados`;
  $('#clip-add').disabled = n === 0;
  $('#clip-add').textContent = n ? `Agregar ${n}` : 'Agregar';
}

async function openClipboardDialog() {
  let preview;
  try {
    preview = await api.clipboardPreview();
  } catch (e) {
    showError(e);
    return;
  }
  clipItems = preview.items;
  if (!clipItems.length) {
    setStatus(preview.history_available
      ? 'No hay magnets en el portapapeles ni en su historial.'
      : 'No hay un magnet en el portapapeles. (El historial Win+V está apagado: solo se ve lo último copiado.)');
    return;
  }
  $('#clip-note').textContent = preview.history_available
    ? 'Del historial del portapapeles (Win+V), el más reciente arriba. Elegí cuáles agregar.'
    : 'Solo se ve lo último copiado: el historial del portapapeles (Win+V) está apagado. Activalo en Configuración de Windows › Sistema › Portapapeles para ver todos.';
  $('#clip-list').replaceChildren(...clipItems.map((it, i) => {
    const cb = el('input', { type: 'checkbox', 'data-i': String(i) });
    cb.checked = true;
    cb.addEventListener('change', renderClipboardDialog);
    const title = it.known_name || it.name || `magnet ${it.info_hash.slice(0, 8)}…`;
    return el('li', { class: `clip-item ${it.in_list ? 'in-list' : ''}` },
      el('label', {},
        cb,
        el('span', { class: 'clip-text' },
          el('span', { class: 'clip-name', title }, title),
          el('span', { class: 'clip-meta' },
            copiedAt(it.copied_at),
            it.in_list ? el('span', { class: 'chip queued' }, 'ya está en la lista') : null))));
  }));
  renderClipboardDialog();
  $('#dlg-clipboard').showModal();
}

async function addFromClipboardDialog() {
  const raws = [...document.querySelectorAll('#clip-list input')]
    .filter((b) => b.checked)
    .map((b) => clipItems[Number(b.dataset.i)].raw);
  $('#dlg-clipboard').close();
  if (!raws.length) return;
  try {
    const n = await api.addSelected(raws);
    setStatus(n ? `${n} magnet(s) agregado(s): ya se están analizando.` : 'Esos magnets ya estaban en la lista.');
  } catch (e) {
    showError(e);
  }
}

/** Opciones de audio para preguntar al reproducir: Latino e Inglés primero. "MULTI" sin
 *  detalle → se ofrecen Latino e Inglés igual (mpv elige por idioma). */
function audioOptions(e) {
  const langs = (e?.languages ?? []).filter((l) => l.code !== '?');
  const opts = langs.filter((l) => l.code !== 'multi')
    .map((l) => ({ code: l.code, label: l.label.replace(' (sin saber si latino)', ''), aid: l.aids?.[0] ?? null, confirmed: l.confirmed }));
  if (langs.some((l) => l.code === 'multi')) {
    for (const [code, label] of [['lat', 'Latino'], ['en', 'Inglés']]) {
      if (!opts.some((o) => o.code === code)) opts.push({ code, label, aid: null, confirmed: false });
    }
  }
  const rank = { lat: 0, en: 1 };
  return opts.sort((a, b) => (rank[a.code] ?? 9) - (rank[b.code] ?? 9));
}

// ---------- selector de audio anclado al botón Ver (diseño cards-v3) ----------
const pk = el('div', { id: 'pk', class: 'pk', role: 'dialog', 'aria-labelledby': 'pkh' },
  el('div', { class: 'pk-h', id: 'pkh' }, 'Elegí el audio'), el('div', { class: 'pk-l' }));
pk.hidden = true;
document.body.append(pk);
let pkBtn = null;
let pkT;
let pkDone = null;

function closePk(refocus, instant) {
  if (!pkBtn) return;
  pk.classList.remove('on');
  pkBtn.setAttribute('aria-expanded', 'false');
  if (refocus) pkBtn.focus({ preventScroll: true });
  pkBtn = null;
  clearTimeout(pkT);
  if (instant) pk.hidden = true; else pkT = setTimeout(() => (pk.hidden = true), 160);
  pkDone?.(undefined);
  pkDone = null;
}

/** Abre el selector junto a `anchor`; resuelve con la opción elegida o `undefined` (cancelado). */
function openPk(anchor, opts) {
  if (pkBtn) closePk(false, true);
  wantTip(null);
  pk.querySelector('.pk-l').replaceChildren(...opts.map((o, i) => el('button', {
    class: `pk-o${i ? '' : ' pri'}`, type: 'button', 'data-i': String(i),
    ...(o.code === 'lat' ? { 'data-tip': 'Con Latino, los subtítulos arrancan ocultos (S los muestra).' } : {}),
  }, icon('speaker', 18), el('span', {}, el('b', {}, o.label), el('small', {}, o.confirmed ? 'Pista confirmada' : 'Adivinado por el nombre')), icon('play', 16))));
  clearTimeout(pkT);
  pk.hidden = false;
  pk.classList.remove('on', 'up');
  const r = anchor.getBoundingClientRect();
  const w = pk.offsetWidth;
  const hgt = pk.offsetHeight;
  const left = Math.max(8, Math.min(innerWidth - w - 8, r.right - w));
  const up = r.bottom + 8 + hgt > innerHeight - 8 && r.top - hgt - 8 > 8;
  pk.classList.toggle('up', up);
  pk.style.left = `${left}px`;
  pk.style.top = `${up ? r.top - hgt - 8 : r.bottom + 8}px`;
  pk.style.transformOrigin = `${r.left + r.width / 2 - left}px ${up ? '100%' : '0'}`;
  pkBtn = anchor;
  anchor.setAttribute('aria-expanded', 'true');
  void pk.offsetWidth; // arranca la transición desde el estado cerrado
  pk.classList.add('on');
  pk.querySelector('.pk-o').focus({ preventScroll: true });
  return new Promise((resolve) => { pkDone = resolve; });
}

pk.addEventListener('click', (ev) => {
  const o = ev.target.closest('.pk-o');
  if (!o) return;
  const done = pkDone;
  pkDone = null;
  closePk(true);
  done?.(Number(o.dataset.i));
});
pk.addEventListener('keydown', (ev) => {
  const os = [...pk.querySelectorAll('.pk-o')];
  const i = os.indexOf(document.activeElement);
  if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
    ev.preventDefault();
    os[(i + (ev.key === 'ArrowDown' ? 1 : -1) + os.length) % os.length].focus();
  }
});
pk.addEventListener('focusout', (ev) => { if (pkBtn && ev.relatedTarget && !pk.contains(ev.relatedTarget) && ev.relatedTarget !== pkBtn) closePk(false); });
document.addEventListener('pointerdown', (ev) => { if (pkBtn && !pk.contains(ev.target) && !pkBtn.contains(ev.target)) closePk(false); });
document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') { if (pkBtn) closePk(true); else wantTip(null); } });
document.addEventListener('scroll', () => { if (pkBtn) closePk(false); }, { capture: true, passive: true });

/** Pregunta el idioma si el video trae más de un audio. `null` = nada que elegir; `undefined` = cancelado. */
async function askAudio(e, anchor) {
  const opts = audioOptions(e);
  if (opts.length < 2) return null;
  const at = anchor
    ?? document.querySelector(`.row[data-hash="${e.info_hash}"] [data-watch]`)
    ?? document.querySelector(`.row[data-hash="${e.info_hash}"]`)
    ?? $('#btn-play');
  const i = await openPk(at, opts);
  return i === undefined ? undefined : { code: opts[i].code, aid: opts[i].aid };
}

async function play(hash, anchor) {
  try {
    // Si ya está en el panel (pausada) se retoma con el audio que se eligió la otra vez.
    const resuming = [...playbacks.values()].some((p) => p.info_hash === hash);
    const audio = resuming ? null : await askAudio(entries.get(hash), anchor);
    if (audio === undefined) return;
    anchor?.classList.add('busy');
    activity.push({ area: 'reproduccion', text: `${resuming ? 'Retomando' : 'Abriendo'} ${titleOf(hash)}${audio?.code ? ` con audio ${audio.code === 'lat' ? 'latino' : audio.code === 'en' ? 'en inglés' : audio.code}` : ''}…` });
    await api.play(hash, null, null, audio);
    setStatus('Preparando la reproducción…');
  } catch (e) {
    showError(e);
  } finally {
    anchor?.classList.remove('busy');
  }
}

/** Se cerró mpv sin terminar de bajar: ¿seguir bajando de fondo o pausar? (2026-11-14) */
async function askAfterClose(row) {
  const t = titleOf(row.info_hash);
  const pct = Math.floor((row.progress ?? 0) * 100);
  const choice = await confirmDialog(
    'Cerraste el reproductor',
    `${t} va ${pct} % bajado.\n\n¿Lo sigo bajando de fondo, para que después lo veas sin esperar, o lo pauso? Lo bajado queda guardado en los dos casos.`,
    [
      { label: 'Pausar', value: 'stop' },
      { label: 'Seguir bajando', value: 'keep-downloading', primary: true },
    ],
  );
  // Cerrar el diálogo sin elegir = pausar (lo de siempre). Si ya se resolvió solo, no importa.
  api.playbackAction(row.id, choice ?? 'stop').catch(() => {});
}

async function openLog(row) {
  logOpenFor = row.id;
  $('#dlg-log-title').textContent = `Detalle — ${row.name}`;
  const lines = await api.playbackLog(row.id).catch(() => logs.get(row.id) ?? []);
  logs.set(row.id, lines);
  $('#dlg-log-body').textContent = lines.join('\n');
  $('#dlg-log').showModal();
}

// ---------- limpieza (FR-16, FR-18, FR-19) ----------
async function cleanTemp() {
  try {
    const usage = await api.tempUsage();
    if (usage.bytes === 0) {
      setStatus('No hay temporales para limpiar.');
      return;
    }
    const ok = await confirmDialog(
      'Limpiar temporales',
      `Se van a borrar ${humanBytes(usage.bytes)} de restos que no están en uso. Las reproducciones activas, las pausadas y tu lista no se tocan.`,
      [{ label: 'Cancelar', value: false }, { label: `Borrar ${humanBytes(usage.bytes)}`, value: true, primary: true }],
    );
    if (!ok) return;
    const r = await api.cleanTemp();
    setStatus(`Limpieza: ${r.dirs_removed} carpeta(s), ${humanBytes(r.bytes_freed)} liberados${r.failures.length ? ` · ${r.failures.length} no se pudieron borrar (se reintenta al abrir)` : ''}.`);
  } catch (e) {
    showError(e);
  }
}

async function stopAllAndClean() {
  const ok = await confirmDialog(
    'Borrar todo',
    'Se detienen todas las reproducciones y se borra TODO lo descargado, también lo pausado. Tu lista de magnets no se toca.',
    [{ label: 'Cancelar', value: false }, { label: 'Borrar todo', value: true, primary: true }],
  );
  if (!ok) return;
  try {
    const r = await api.stopAllAndClean();
    setStatus(`Todo borrado.${r.dirs_removed ? ` Restos limpiados: ${humanBytes(r.bytes_freed)}.` : ''}`);
  } catch (e) {
    showError(e);
  }
}

// ---------- Ajustes: API keys de subtítulos ----------
async function openSettings() {
  try {
    for (const k of await api.subtitlesApiKeys()) {
      const badge = document.getElementById(`key-${k.provider}-state`);
      if (badge) {
        badge.textContent = k.configured ? '✔ configurada' : 'sin configurar';
        badge.className = `key-state ${k.configured ? 'ok' : ''}`;
      }
    }
    const { engine } = await api.config();
    $('#set-incoming').checked = engine.incoming;
    $('#set-upnp').checked = engine.upnp;
    $('#set-upnp').disabled = !engine.incoming;
  } catch (e) {
    showError(e);
  }
  $('#dlg-settings').showModal();
}

// ADR-30: entrantes / UPnP. El motor se crea por reproducción, así que aplica en la próxima.
async function saveNetwork() {
  $('#set-upnp').disabled = !$('#set-incoming').checked;
  try {
    const cfg = await api.config();
    await api.setConfig({
      ...cfg,
      engine: { ...cfg.engine, incoming: $('#set-incoming').checked, upnp: $('#set-upnp').checked },
    });
    setStatus('Red guardada: aplica desde la próxima reproducción.');
  } catch (e) {
    showError(e);
  }
}

async function saveKey(provider) {
  const input = document.getElementById(`key-${provider}`);
  try {
    await api.subtitlesSetApiKey(provider, input.value.trim());
    input.value = '';
    setStatus(`Key de ${provider === 'wyzie' ? 'Wyzie' : 'OpenSubtitles'} guardada en el almacén seguro.`);
    await openSettings();
  } catch (e) {
    showError(e);
  }
}

// ---------- cierre (FR-17) ----------
async function onConfirmClose(count) {
  const choice = await confirmDialog(
    'Cerrar Torrent Stream',
    `Hay ${count} reproducción(es) activa(s). En los dos casos la descarga queda pausada y guardada para retomarla al volver a abrir la app.`,
    [
      { label: 'Cancelar', value: null },
      { label: 'Dejar el reproductor abierto', value: 'leave-running' },
      { label: 'Cerrar el reproductor y salir', value: 'stop-all', primary: true },
    ],
  );
  if (choice) {
    setStatus('Cerrando…');
    await api.onClose(choice).catch(showError);
  }
}

// ---------- arranque ----------
async function init() {
  $('#btn-clipboard').addEventListener('click', openClipboardDialog);
  $('#btn-analyze').addEventListener('click', onAnalyzeAll);
  $('#btn-pause-all').addEventListener('click', onPauseAll);
  $('#btn-analyze-selected').addEventListener('click', onAnalyzeSelected);
  $('#check-all').addEventListener('change', onCheckAll);
  $('#clip-all').addEventListener('change', (ev) => {
    document.querySelectorAll('#clip-list input').forEach((b) => (b.checked = ev.target.checked));
    renderClipboardDialog();
  });
  $('#clip-add').addEventListener('click', addFromClipboardDialog);
  $('#btn-folder').addEventListener('click', () => api.openDownloadsFolder().catch(showError));
  $('#btn-clean').addEventListener('click', cleanTemp);
  $('#btn-stop-all').addEventListener('click', stopAllAndClean);
  $('#btn-settings').addEventListener('click', openSettings);
  $('#set-incoming').addEventListener('change', saveNetwork);
  $('#set-upnp').addEventListener('change', saveNetwork);
  document.querySelectorAll('[data-save-key]').forEach((b) => b.addEventListener('click', () => saveKey(b.dataset.saveKey)));
  document.querySelectorAll('[data-key-page]').forEach((b) => b.addEventListener('click', () => api.openKeyPage(b.dataset.keyPage).catch(showError)));
  $('#btn-play').addEventListener('click', (ev) => selected && play(selected, ev.currentTarget));
  document.querySelectorAll('dialog [data-close]').forEach((b) => b.addEventListener('click', () => b.closest('dialog').close()));
  document.addEventListener('click', (ev) => { if (!ev.target.closest('#ctx-menu')) closeMenu(); });
  document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') closeMenu(); });
  window.addEventListener('blur', closeMenu);
  $('#dlg-log').addEventListener('close', () => (logOpenFor = null));

  await onCoreEvent((event) => {
    logEvent(event);
    switch (event.type) {
      case 'status':
        setStatus(event.message);
        break;
      case 'analyzer-progress': {
        const wasRunning = analyzerState.kind !== 'idle' && analyzerState.kind !== 'paused';
        analyzerState = event.state;
        if (event.state.kind === 'idle') pending.clear();
        if (event.state.kind === 'measuring' && event.state.current) pending.delete(event.state.current);
        renderAnalyzer();
        renderLibrary(); // velocidad en vivo, "Listo", "en cola"
        if (wasRunning && event.state.kind === 'idle') setStatus('Análisis terminado: la lista quedó ordenada de mejor a peor.');
        break;
      }
      case 'analyzer-queue':
        // Ya en la cola: el estado real reemplaza al optimista (el rápido sigue hasta tener datos).
        for (const h of [...event.queued, ...event.held]) if (pending.get(h) === 'speed') pending.delete(h);
        queued = event.queued;
        held = new Set(event.held);
        renderLibrary();
        break;
      case 'library-entry-updated':
        // El evento no trae lo bajado en disco (lo calcula `library()`): se conserva hasta el refresco.
        event.entry.downloaded_bytes ??= entries.get(event.entry.info_hash)?.downloaded_bytes;
        entries.set(event.entry.info_hash, event.entry);
        if (event.entry.live && pending.get(event.entry.info_hash) === 'quick') pending.delete(event.entry.info_hash);
        renderLibrary();
        scheduleRefresh();
        break;
      case 'library-entry-removed':
        entries.delete(event.info_hash);
        rowCache.delete(event.info_hash);
        renderLibrary();
        break;
      case 'library-cleared':
        entries.clear();
        rowCache.clear();
        renderLibrary();
        break;
      case 'playback-updated':
        if (event.row.state.kind === 'failed' && playbacks.get(event.row.id)?.state.kind !== 'failed') setStatus(`No se pudo reproducir: ${event.row.state.message}`);
        if (event.row.state.kind === 'ask-after-close' && playbacks.get(event.row.id)?.state.kind !== 'ask-after-close') askAfterClose(event.row);
        playbacks.set(event.row.id, event.row);
        renderLibrary(); // "% bajado · pausaste en…" del detalle
        break;
      case 'playback-removed':
        playbacks.delete(event.id);
        logs.delete(event.id);
        renderLibrary();
        break;
      case 'playback-log': {
        const lines = logs.get(event.id) ?? [];
        lines.push(event.line);
        logs.set(event.id, lines);
        if (logOpenFor === event.id) {
          const pre = $('#dlg-log-body');
          pre.textContent = lines.join('\n');
          pre.scrollTop = pre.scrollHeight;
        }
        break;
      }
      default:
        break;
    }
  });
  await tauri.event.listen('core://confirm-close', (e) => onConfirmClose(e.payload));

  // Estado inicial.
  await refreshLibrary();
  for (const r of await api.playbacks()) playbacks.set(r.id, r);
  renderLibrary();
}

init().catch(showError);
