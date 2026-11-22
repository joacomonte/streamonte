// @ts-check
// Barra superior: el botón del magnet copiado (2026-11-16) y el menú Descargas (en un solo lugar:
// lo que se reproduce o baja de fondo, lo pausado, el análisis y el espacio en disco, con todo lo
// que se puede detener, borrar o limpiar).
import { api } from './api.js';
import { play } from './audio-picker.js';
import { cleanTemp, clearDataCache, openLog, stopAllAndClean } from './dialogs.js';
import { $, el, icon, showError } from './dom.js';
import { t as tr } from './i18n.js';
import { humanBytes, mbps, playbackText } from './format.js';
import { state, titleOf } from './state.js';

const pop = el('div', { id: 'top-pop', class: 'top-pop', role: 'dialog', hidden: true });
document.body.append(pop);
/** Menú abierto: `{ btn, render }`, o `null`. @type {{btn: HTMLElement, render: () => unknown}|null} */
let open = null;

function closePop() {
  if (!open) return;
  open.btn.setAttribute('aria-expanded', 'false');
  open.btn.classList.remove('active');
  open = null;
  pop.hidden = true;
  pop.replaceChildren();
}

/** Abre (o cierra, si ya estaba) el menú de `btn`; `render` llena `pop`. También lo usa `speed.js`. */
/** @param {HTMLElement} btn @param {() => unknown} render */
export async function togglePop(btn, render) {
  if (open?.btn === btn) { closePop(); return; }
  closePop();
  open = { btn, render };
  btn.setAttribute('aria-expanded', 'true');
  btn.classList.add('active');
  pop.setAttribute('aria-label', (btn.textContent ?? '').trim());
  const r = btn.getBoundingClientRect();
  pop.style.top = `${r.bottom + 8}px`;
  pop.style.right = `${Math.max(12, window.innerWidth - r.right)}px`;
  pop.hidden = false;
  await render();
}

document.addEventListener('pointerdown', (ev) => {
  const target = /** @type {Element} */ (ev.target);
  if (open && !pop.contains(target) && !open.btn.contains(target) && !target.closest('dialog')) closePop();
});
document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && open && !document.querySelector('dialog[open]')) closePop(); });
window.addEventListener('resize', closePop);

/** El elemento del menú abierto si es el de `btnId` (para redibujarlo), o null. */
/** @param {string} btnId @returns {HTMLElement|null} */
export const popFor = (btnId) => (open?.btn.id === btnId ? pop : null);

/** @param {string} title @param {import('./dom.js').ElChild[]} children */
const section = (title, ...children) => el('section', { class: 'pop-section' }, el('h4', {}, title), ...children);

// ---------- Magnet copiado (2026-11-16) ----------
// El botón aparece solo si lo último copiado es un magnet, y lo reproduce directo, sin análisis ni
// preguntas: es la app usada como reproductor de magnets.
/** @type {import('./types.js').CopiedMagnet|null} */
let copied = null;

export async function refreshCopied() {
  copied = await api.copiedMagnet().catch(() => null);
  const btn = $('#btn-clipboard');
  btn.hidden = !copied;
  if (!copied) return;
  btn.replaceChildren(icon('play', 15), el('span', {}, 'Reproducir magnet copiado'),
    ...(copied.name ? [el('span', { class: 'top-size play-copied-name' }, `· ${copied.name}`)] : []));
  btn.title = `Reproducir ${copied.name ?? 'el magnet copiado'} (Ctrl+V)`;
}

export async function playCopied() {
  if (!copied) return;
  const { raw, info_hash: key } = copied;
  const btn = /** @type {HTMLButtonElement} */ ($('#btn-clipboard'));
  btn.disabled = true;
  try {
    await api.addSelected([raw]);
    // Como cualquier ▶: pregunta con qué reproductor (y audio, si se sabe) antes de abrir.
    await play(key, btn);
  } catch (e) { showError(e); } finally { btn.disabled = false; }
}

// ---------- Descargas ----------
/** TempUsage al abrir el menú (y después de limpiar). @type {import('./types.js').TempUsage|null} */
let usage = null;
/** Tamaño de la caché de datos, igual que `usage`. @type {number|null} */
let dataBytes = null;
/** @param {import('./types.js').PlaybackRow} r */
const ACTIVE = (r) => !['paused', 'failed'].includes(r.state.kind);
/** @param {import('./types.js').PlaybackRow} r @param {import('./types.js').PlaybackAction} action */
const act = (r, action) => () => api.playbackAction(r.id, action).catch(showError);

/** @param {import('./types.js').PlaybackRow} r */
function playbackItem(r) {
  const pct = Math.floor((r.progress ?? 0) * 100);
  const speed = r.speed_bps > 0 ? ` · ${mbps(r.speed_bps)}` : '';
  const paused = r.state.kind === 'paused';
  const sub = paused || r.state.kind === 'failed' ? playbackText(r) : `${playbackText(r)} · ${pct} %${speed}${r.peers ? ` · ${r.peers} peers` : ''}`;
  return el('li', { class: 'pop-item' },
    el('div', { class: 'pop-item-text' },
      el('span', { class: 'pop-item-title' }, titleOf(r.key)),
      el('span', { class: 'pop-item-sub' }, sub),
      paused || r.state.kind === 'failed' ? null : el('span', { class: 'pop-bar' }, el('i', { style: `width:${pct}%` }))),
    el('div', { class: 'pop-actions' },
      paused ? el('button', { id: `dl-resume-${r.id}`, class: 'pop-btn', onclick: () => play(r.key, null) }, 'Retomar') : null,
      ACTIVE(r) ? el('button', { id: `dl-stop-${r.id}`, class: 'pop-btn', title: 'Cierra mpv y el motor; lo bajado queda guardado', onclick: act(r, 'stop') }, 'Detener') : null,
      el('button', { id: `dl-folder-${r.id}`, class: 'pop-btn icon', title: 'Abrir carpeta', 'aria-label': 'Abrir carpeta', onclick: act(r, 'open-folder') }, '📂'),
      el('button', { id: `dl-log-${r.id}`, class: 'pop-btn icon', title: 'Ver log', 'aria-label': 'Ver log', onclick: () => openLog(r) }, '≡'),
      el('button', { id: `dl-delete-${r.id}`, class: 'pop-btn danger', title: 'Detener y borrar lo descargado', onclick: act(r, 'stop-and-delete') }, 'Borrar')));
}

function analyzerSection() {
  const s = state.analyzerState;
  if (!s || s.kind === 'idle') return null;
  const queued = state.queued?.length ?? 0;
  const what = s.kind === 'paused' ? tr('En pausa')
    : s.kind === 'measuring' ? tr('Midiendo {a}', { a: titleOf(s.current ?? '') })
      : s.kind === 'scraping' ? tr('Consultando trackers') : tr('Leyendo metadatos');
  return section(tr('Análisis'),
    el('div', { class: 'pop-item' },
      el('div', { class: 'pop-item-text' },
        el('span', { class: 'pop-item-title' }, what),
        el('span', { class: 'pop-item-sub' }, tr('{queued} en cola · cada medición usa un motor propio', { queued }))),
      el('div', { class: 'pop-actions' },
        s.kind === 'paused'
          ? el('button', { id: 'dl-analyzer-resume', class: 'pop-btn', onclick: () => api.analyzerResume().catch(showError) }, tr('Reanudar'))
          : el('button', { id: 'dl-analyzer-pause', class: 'pop-btn', title: tr('Corta lo que se está midiendo y pausa la cola'), onclick: () => api.analyzerPause().catch(showError) }, tr('Pausar')))));
}

function renderDownloads() {
  const rows = [...state.playbacks.values()];
  const running = rows.filter(ACTIVE);
  const kept = rows.filter((r) => !ACTIVE(r));
  /** @param {() => Promise<unknown>} fn */
  const afterClean = async (fn) => {
    await fn();
    [usage, dataBytes] = await Promise.all([api.tempUsage().catch(() => usage), api.dataCacheSize().catch(() => dataBytes)]);
    refreshCache();
    if (open?.btn.id === 'btn-downloads') renderDownloads();
  };
  const total = usage && dataBytes != null ? humanBytes(usage.bytes + dataBytes) : '…';
  pop.replaceChildren(.../** @type {(HTMLElement|null)[]} */ ([
    el('div', { class: 'pop-head' },
      el('div', {}, el('h3', {}, tr('Descargas')), el('p', { class: 'pop-sub' }, tr('{total} en disco', { total }))),
      el('button', { id: 'dl-open-folder', class: 'pop-btn', onclick: () => api.openDownloadsFolder().catch(showError) }, icon('folder', 15), tr('Abrir carpeta'))),
    el('ul', { class: 'disk-list' },
      el('li', { class: 'disk-row' },
        el('span', { class: 'disk-row-text' }, el('b', {}, tr('Caché')), el('span', {}, tr('Lo analizado y restos sin uso'))),
        el('span', { class: 'disk-row-size' }, usage ? humanBytes(usage.bytes) : '…'),
        el('button', { id: 'dl-clean', class: 'pop-btn', title: tr('Borra lo analizado y los restos que no están en uso (no toca lo activo ni lo guardado)'), disabled: usage?.bytes === 0, onclick: () => afterClean(cleanTemp) }, tr('Borrar')))),
    // Datos guardados: discreto a propósito, sirven para abrir todo más rápido y no conviene
    // invitar a borrarlos (se vuelven a bajar si se borran).
    el('p', { class: 'pop-data-line' },
      tr('Datos guardados · {a} · aceleran el catálogo, no hace falta borrarlos · ', { a: dataBytes == null ? '…' : humanBytes(dataBytes) }),
      el('button', { id: 'dl-clear-data', type: 'button', title: tr('Borra fichas, portadas y puntajes guardados (se vuelven a bajar cuando hagan falta)'), onclick: () => afterClean(clearDataCache) }, tr('borrar'))),
    // Las secciones vacías no se muestran (2026-11-17).
    running.length ? section(tr('En curso · {n}', { n: running.length }), el('ul', { class: 'pop-list' }, running.map(playbackItem))) : null,
    kept.length ? section(tr('Guardadas · {n}', { n: kept.length }), el('ul', { class: 'pop-list' }, kept.map(playbackItem))) : null,
    analyzerSection(),
    // Solo hace algo distinto de "Borrar caché" cuando hay reproducciones o descargas guardadas.
    rows.length ? el('div', { class: 'pop-foot' },
      el('button', { id: 'dl-stop-all', class: 'pop-btn danger', title: tr('Detiene todo y borra todo lo descargado, también lo pausado'), onclick: () => afterClean(stopAllAndClean) }, tr('Detener y borrar todo'))) : null,
  ]).filter(/** @returns {x is HTMLElement} */ (x) => x != null));
}

export async function toggleDownloads() {
  await togglePop($('#btn-downloads'), async () => {
    renderDownloads();
    [usage, dataBytes] = await Promise.all([api.tempUsage().catch(() => null), api.dataCacheSize().catch(() => null)]);
    if (open?.btn.id === 'btn-downloads') renderDownloads();
  });
}

/** Bytes ya bajados de todas las descargas (en curso y guardadas): progreso × tamaño del video,
 *  o lo que el núcleo midió en disco para ese video si es más. Sin tamaño conocido no suma. */
function downloadedBytes() {
  let total = 0;
  for (const r of state.playbacks.values()) {
    const e = state.entries.get(r.key);
    const size = e?.video_size ?? e?.live?.file_size ?? 0;
    total += Math.max(e?.downloaded_bytes ?? 0, (r.progress ?? 0) * size);
  }
  return total;
}

// ---------- Caché en el botón Descargas (2026-11-16) ----------
/** Lo que se puede borrar sin tocar lo activo ni lo guardado (lo analizado y restos), en el botón
 *  Descargas. Recorre carpetas en disco: se pide al abrir, cada 30 s y después de limpiar. */
export async function refreshCache() {
  const u = await api.tempUsage().catch(() => null);
  const cache = $('#downloads-cache');
  cache.hidden = !u || u.bytes < 1024 ** 2;
  if (u) cache.textContent = tr('· {a} de caché', { a: humanBytes(u.bytes) });
}

/** Estados en que de verdad baja datos (pausada o "solo reproduciendo lo bajado" no). */
const TRANSFER = new Set(['fetching-metadata', 'preparing', 'playing', 'background']);
/** Si algo está bajando, la velocidad total en el botón Descargas y una barra al pie del toolbar
 *  (2026-11-17): antes solo había un número y no se notaba que bajaba de fondo. */
function showTransfer() {
  const rows = [...state.playbacks.values()].filter((r) => TRANSFER.has(r.state.kind) && (r.progress ?? 0) < 1);
  const speed = $('#downloads-speed'), bar = $('#top-dl');
  speed.hidden = bar.hidden = !rows.length;
  if (!rows.length) return;
  const bps = rows.reduce((t, r) => t + (r.speed_bps || 0), 0);
  const pct = Math.round((rows.reduce((t, r) => t + (r.progress ?? 0), 0) / rows.length) * 100);
  speed.textContent = `↓ ${mbps(bps)}`;
  bar.classList.toggle('waiting', pct === 0); // conectando o sin metadatos: barra que corre
  /** @type {HTMLElement} */ (bar.firstElementChild).style.width = `${Math.max(pct, 2)}%`;
  bar.setAttribute('aria-valuenow', String(pct));
  bar.title = tr('Bajando {a} · {pct} % · {b}', { a: rows.length === 1 ? rows[0].name : `${rows.length} videos`, pct, b: mbps(bps) });
}

/** Lo que baja de fondo (2026-11-17), siempre a la vista en la barra de arriba: nombre, % y ▶ para
 *  verlo ya. Con varios, el más avanzado y "+N". */
function showBackground() {
  const box = $('#top-bg');
  const rows = [...state.playbacks.values()].filter((r) => r.state.kind === 'background')
    .sort((a, b) => (b.progress ?? 0) - (a.progress ?? 0));
  box.hidden = !rows.length;
  if (!rows.length) return;
  const r = rows[0];
  const pct = Math.floor((r.progress ?? 0) * 100);
  box.replaceChildren(
    el('span', { class: 'top-bg-info', title: tr('Bajando de fondo: {a} · {pct} %{b}', { a: titleOf(r.key), pct, b: r.speed_bps > 0 ? ` · ${mbps(r.speed_bps)}` : '' }) },
      icon('download', 14), el('span', { class: 'top-bg-name' }, titleOf(r.key)), el('b', {}, `${pct} %`),
      rows.length > 1 ? el('span', { class: 'top-bg-more' }, `+${rows.length - 1}`) : null,
      el('span', { class: 'top-bg-bar', 'aria-hidden': 'true' }, el('i', { style: `width:${Math.max(pct, 2)}%` }))),
    el('button', { id: 'top-bg-play', class: 'top-bg-play', 'aria-label': tr('Ver {a}', { a: titleOf(r.key) }), title: tr('Verla ahora (sigue bajando mientras la ves)'),
      onclick: (ev) => play(r.key, ev.currentTarget) }, icon('play', 14)));
}

/** Lo llama app.js con cada evento de reproducción o análisis: tamaño, badge y menú abierto al día. */
export function refreshDownloads() {
  const bytes = downloadedBytes();
  const size = $('#downloads-size');
  size.hidden = bytes < 1024 ** 2;
  size.textContent = tr('· {a} bajados', { a: humanBytes(bytes) });
  const n = [...state.playbacks.values()].filter(ACTIVE).length;
  showTransfer();
  showBackground();
  const badge = $('#downloads-badge');
  badge.hidden = n === 0;
  badge.textContent = String(n);
  if (open?.btn.id === 'btn-downloads') renderDownloads();
}
