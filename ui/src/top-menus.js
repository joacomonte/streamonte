// Barra superior: el botón del magnet copiado (2026-11-16) y el menú Descargas (en un solo lugar:
// lo que se reproduce o baja de fondo, lo pausado, el análisis y el espacio en disco, con todo lo
// que se puede detener, borrar o limpiar).
import { api } from './api.js';
import { play } from './audio-picker.js';
import { cleanTemp, clearDataCache, openLog, stopAllAndClean } from './dialogs.js';
import { $, el, icon, setStatus, showError } from './dom.js';
import { humanBytes, mbps, playbackText } from './format.js';
import { state, titleOf } from './state.js';

const pop = el('div', { id: 'top-pop', class: 'top-pop', role: 'dialog', hidden: true });
document.body.append(pop);
/** Menú abierto: `{ btn, render }`, o `null`. */
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
export async function togglePop(btn, render) {
  if (open?.btn === btn) { closePop(); return; }
  closePop();
  open = { btn, render };
  btn.setAttribute('aria-expanded', 'true');
  btn.classList.add('active');
  pop.setAttribute('aria-label', btn.textContent.trim());
  const r = btn.getBoundingClientRect();
  pop.style.top = `${r.bottom + 8}px`;
  pop.style.right = `${Math.max(12, window.innerWidth - r.right)}px`;
  pop.hidden = false;
  await render();
}

document.addEventListener('pointerdown', (ev) => {
  if (open && !pop.contains(ev.target) && !open.btn.contains(ev.target) && !ev.target.closest('dialog')) closePop();
});
document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && open && !document.querySelector('dialog[open]')) closePop(); });
window.addEventListener('resize', closePop);

/** El elemento del menú abierto si es el de `btnId` (para redibujarlo), o null. */
export const popFor = (btnId) => (open?.btn.id === btnId ? pop : null);

const section = (title, ...children) => el('section', { class: 'pop-section' }, el('h4', {}, title), ...children);

// ---------- Magnet copiado (2026-11-16) ----------
// El botón aparece solo si lo último copiado es un magnet, y lo reproduce directo, sin análisis ni
// preguntas: es la app usada como reproductor de magnets.
let copied = null; // {raw, info_hash, name} o null

export async function refreshCopied() {
  copied = await api.copiedMagnet().catch(() => null);
  const btn = $('#btn-clipboard');
  btn.hidden = !copied;
  if (!copied) return;
  btn.replaceChildren(icon('play', 15), el('span', {}, 'Reproducir magnet copiado'),
    copied.name ? el('span', { class: 'top-size play-copied-name' }, `· ${copied.name}`) : null);
  btn.title = `Reproducir ${copied.name ?? 'el magnet copiado'} (Ctrl+V)`;
}

export async function playCopied() {
  if (!copied) return;
  const { raw, info_hash: key, name } = copied;
  const btn = $('#btn-clipboard');
  btn.disabled = true;
  try {
    await api.addSelected([raw]);
    await api.play(key);
    setStatus(`Abriendo ${name ?? 'el magnet copiado'}…`);
  } catch (e) { showError(e); } finally { btn.disabled = false; }
}

// ---------- Descargas ----------
let usage = null; // TempUsage al abrir el menú (y después de limpiar)
let dataBytes = null; // tamaño de la caché de datos, igual que `usage`
const ACTIVE = (r) => !['paused', 'failed'].includes(r.state.kind);
const act = (r, action) => () => api.playbackAction(r.id, action).catch(showError);

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
  const what = s.kind === 'paused' ? 'En pausa'
    : s.kind === 'measuring' ? `Midiendo ${titleOf(s.current)}`
      : s.kind === 'scraping' ? 'Consultando trackers' : 'Leyendo metadatos';
  return section('Análisis',
    el('div', { class: 'pop-item' },
      el('div', { class: 'pop-item-text' },
        el('span', { class: 'pop-item-title' }, what),
        el('span', { class: 'pop-item-sub' }, `${queued} en cola · cada medición usa un motor propio`)),
      el('div', { class: 'pop-actions' },
        s.kind === 'paused'
          ? el('button', { id: 'dl-analyzer-resume', class: 'pop-btn', onclick: () => api.analyzerResume().catch(showError) }, 'Reanudar')
          : el('button', { id: 'dl-analyzer-pause', class: 'pop-btn', title: 'Corta lo que se está midiendo y pausa la cola', onclick: () => api.analyzerPause().catch(showError) }, 'Pausar'))));
}

function renderDownloads() {
  const rows = [...state.playbacks.values()];
  const running = rows.filter(ACTIVE);
  const kept = rows.filter((r) => !ACTIVE(r));
  const afterClean = async (fn) => {
    await fn();
    [usage, dataBytes] = await Promise.all([api.tempUsage().catch(() => usage), api.dataCacheSize().catch(() => dataBytes)]);
    refreshCache();
    if (open?.btn.id === 'btn-downloads') renderDownloads();
  };
  const total = usage && dataBytes != null ? humanBytes(usage.bytes + dataBytes) : '…';
  pop.replaceChildren(...[
    el('div', { class: 'pop-head' },
      el('div', {}, el('h3', {}, 'Descargas'), el('p', { class: 'pop-sub' }, `${total} en disco`)),
      el('button', { id: 'dl-open-folder', class: 'pop-btn', onclick: () => api.openDownloadsFolder().catch(showError) }, icon('folder', 15), 'Abrir carpeta')),
    el('ul', { class: 'disk-list' },
      el('li', { class: 'disk-row' },
        el('span', { class: 'disk-row-text' }, el('b', {}, 'Caché'), el('span', {}, 'Lo analizado y restos sin uso')),
        el('span', { class: 'disk-row-size' }, usage ? humanBytes(usage.bytes) : '…'),
        el('button', { id: 'dl-clean', class: 'pop-btn', title: 'Borra lo analizado y los restos que no están en uso (no toca lo activo ni lo guardado)', disabled: usage?.bytes === 0, onclick: () => afterClean(cleanTemp) }, 'Borrar'))),
    // Datos guardados: discreto a propósito, sirven para abrir todo más rápido y no conviene
    // invitar a borrarlos (se vuelven a bajar si se borran).
    el('p', { class: 'pop-data-line' },
      `Datos guardados · ${dataBytes == null ? '…' : humanBytes(dataBytes)} · aceleran el catálogo, no hace falta borrarlos · `,
      el('button', { id: 'dl-clear-data', type: 'button', title: 'Borra fichas, portadas y puntajes guardados (se vuelven a bajar cuando hagan falta)', onclick: () => afterClean(clearDataCache) }, 'borrar')),
    // Las secciones vacías no se muestran (2026-11-17).
    running.length ? section(`En curso · ${running.length}`, el('ul', { class: 'pop-list' }, running.map(playbackItem))) : null,
    kept.length ? section(`Guardadas · ${kept.length}`, el('ul', { class: 'pop-list' }, kept.map(playbackItem))) : null,
    analyzerSection(),
    // Solo hace algo distinto de "Borrar caché" cuando hay reproducciones o descargas guardadas.
    rows.length ? el('div', { class: 'pop-foot' },
      el('button', { id: 'dl-stop-all', class: 'pop-btn danger', title: 'Detiene todo y borra todo lo descargado, también lo pausado', onclick: () => afterClean(stopAllAndClean) }, 'Detener y borrar todo')) : null,
  ].filter(Boolean));
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
  if (u) cache.textContent = `· ${humanBytes(u.bytes)} de caché`;
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
  bar.firstElementChild.style.width = `${Math.max(pct, 2)}%`;
  bar.setAttribute('aria-valuenow', String(pct));
  bar.title = `Bajando ${rows.length === 1 ? rows[0].name : `${rows.length} videos`} · ${pct} % · ${mbps(bps)}`;
}

/** Lo llama app.js con cada evento de reproducción o análisis: tamaño, badge y menú abierto al día. */
export function refreshDownloads() {
  const bytes = downloadedBytes();
  const size = $('#downloads-size');
  size.hidden = bytes < 1024 ** 2;
  size.textContent = `· ${humanBytes(bytes)} bajados`;
  const n = [...state.playbacks.values()].filter(ACTIVE).length;
  showTransfer();
  const badge = $('#downloads-badge');
  badge.hidden = n === 0;
  badge.textContent = String(n);
  if (open?.btn.id === 'btn-downloads') renderDownloads();
}
