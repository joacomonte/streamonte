// @ts-check
// Actividad de fondo (2026-11-14, rev. 2 del usuario: "una bubble minimal con el último comando
// o proceso que se está haciendo"; 2026-11-15: va en la barra inferior y abre un panel grande con
// dos vistas: "Resumen" (lo amigable, filtrable por tipo) y "Detallado" (el log del núcleo,
// filtrable por nivel), más "Descargar logs" para debuguear).
// - Píldora en la barra: mientras algo corre (o hasta 8 s después de lo último que pasó) muestra
//   spinner + qué se está haciendo; después se achica a un circulito con el contador de novedades.
// - Al tocarla se despliega abajo el log completo; Escape, tocar afuera o "Cerrar" lo cierran
//   (salvo fijado). Las líneas del mismo trabajo (`key`) o repetidas se actualizan en su lugar.

import { api } from './api.js';
import { t as tr } from './i18n.js';

/** Elemento hijo que tiene que existir. @param {Element} parent @param {string} sel @returns {HTMLElement} */
const $in = (parent, sel) => /** @type {HTMLElement} */ (parent.querySelector(sel));

const KEEP = 300;
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

/** @typedef {'info'|'warn'|'error'} Level */
/** @typedef {'hidden'|'mini'|'line'|'open'} PanelState */
/** @typedef {'friendly'|'detail'} View */
/** @typedef {{key: string, li: HTMLElement, n: number, text: string, area: string, level: string}} Line */

// Íconos por área (trazo 2, 24×24).
/** @type {Record<string, [string, string]>} */
const AREA = {
  analisis: [tr('Análisis'), '<path d="M4.6 18.5a9 9 0 1 1 14.8 0"/><path d="M12 14.5l4.2-5"/>'],
  motor: ['Torrent', '<path d="M12 3v12"/><path d="M7 10l5 5 5-5"/><path d="M5 20h14"/>'],
  reproduccion: [tr('Reproducción'), '<path d="M8 5.5v13l10-6.5z"/>'],
  subtitulos: [tr('Subtítulos'), '<rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="M7 14h4M13 14h4M7 10h10"/>'],
  catalogo: [tr('Catálogo'), '<circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.3 15.3L20 20"/>'],
  limpieza: [tr('Limpieza'), '<path d="M5 7h14M10 7V4.5h4V7M7 7l1 13h8l1-13"/>'],
  red: [tr('Red'), '<path d="M5 12.5a10 10 0 0 1 14 0M8 15.5a5.5 5.5 0 0 1 8 0"/><circle cx="12" cy="19" r="1.2" fill="currentColor"/>'],
  portapapeles: [tr('Portapapeles'), '<rect x="6" y="4.5" width="12" height="16" rx="2"/><path d="M9.5 4.5V3h5v1.5"/>'],
  general: [tr('General'), '<circle cx="12" cy="12" r="8"/><path d="M12 8v4.5l3 2"/>'],
  error: [tr('Error'), '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5v5.5"/><circle cx="12" cy="16.5" r="1.1" fill="currentColor"/>'],
};
/** @param {string} paths @param {number=} size @returns {string} */
const svg = (paths, size = 14) => `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
/** @type {Record<string, string>} */
const ICON = {
  pin: '<path d="M9 4h6l-1 5 3 3H7l3-3z"/><path d="M12 15v5"/>',
  clear: '<path d="M5 7h14M10 7V4.5h4V7M7 7l1 13h8l1-13"/>',
  min: '<path d="M6 9l6 6 6-6"/>',
  download: '<path d="M12 4v11"/><path d="M7 10l5 5 5-5"/><path d="M5 20h14"/>',
  refresh: '<path d="M20 12a8 8 0 1 1-2.34-5.66L20 8.5"/><path d="M20 4v4.5h-4.5"/>',
};

/** @template {keyof HTMLElementTagNameMap} K @param {K} tag @param {Record<string, string>=} attrs @param {string=} html @returns {HTMLElementTagNameMap[K]} */
function h(tag, attrs = {}, html = '') {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') n.className = v; else n.setAttribute(k, v);
  }
  if (html) n.innerHTML = html;
  return n;
}
/** @param {Date} d @returns {string} */
const hhmmss = (d) => d.toLocaleTimeString('es-AR', { hour12: false });

const root = h('div', { id: 'act', class: 'act', 'data-state': 'hidden' });
const line = h('button', { type: 'button', id: 'btn-activity', class: 'act-line', 'aria-expanded': 'false', 'aria-controls': 'act-panel' });
const lineDot = h('i', { class: 'act-dot', 'aria-hidden': 'true' });
const lineIc = h('span', { class: 'act-ic' });
const lineSum = h('span', { class: 'act-sum' });
const lineN = h('b', { class: 'act-n' });
const lineChev = h('span', { class: 'act-chev', 'aria-hidden': 'true' }, svg('<path d="M6 9l6 6 6-6"/>', 12));
line.append(lineDot, lineIc, lineSum, lineN, lineChev);
const panel = h('div', { class: 'act-panel', id: 'act-panel', role: 'region', 'aria-labelledby': 'act-title' });
const head = h('div', { class: 'act-h' });
const title = h('span', { class: 'act-title', id: 'act-title' }, tr('Actividad'));
const headSum = h('span', { class: 'act-sum' });
/** @param {string} label @param {string} icon @param {Record<string, string>=} extra */
const btn = (label, icon, extra = {}) => h('button', { type: 'button', class: 'act-b', 'aria-label': label, 'data-tip': label, ...extra }, svg(ICON[icon]));
/** @param {string} id @param {string} label */
const tabBtn = (id, label) => h('button', { type: 'button', id, class: 'act-tab', role: 'tab' }, label);
const tabFriendly = tabBtn('act-tab-friendly', tr('Resumen'));
const tabDetail = tabBtn('act-tab-detail', tr('Detallado'));
const tabs = h('div', { class: 'act-tabs', role: 'tablist' });
tabs.append(tabFriendly, tabDetail);
// Filtro: por tipo (Resumen) o por nivel (Detallado). Las opciones se arman al cambiar de vista.
const filter = h('select', { id: 'act-filter', class: 'act-filter', 'aria-label': tr('Filtrar') });
const refreshBtn = btn(tr('Actualizar el log detallado'), 'refresh', { id: 'act-refresh' });
const exportBtn = btn(tr('Descargar logs (para debuguear)'), 'download', { id: 'act-export' });
const pinBtn = btn(tr('Fijar: que no se cierre al tocar afuera'), 'pin', { id: 'act-pin', 'aria-pressed': 'false' });
const clearBtn = btn(tr('Vaciar la lista'), 'clear', { id: 'act-clear' });
const minBtn = btn(tr('Cerrar'), 'min', { id: 'act-close' });
head.append(title, tabs, headSum, filter, refreshBtn, exportBtn, pinBtn, clearBtn, minBtn);
const list = h('ol', { class: 'act-list', tabindex: '0', 'aria-label': tr('Lo que está pasando, lo más nuevo abajo'), 'aria-live': 'off' });
const detail = h('ol', { class: 'act-list act-detail', tabindex: '0', 'aria-label': tr('Log detallado del núcleo, lo más nuevo abajo') });
detail.hidden = true;
const newChip = h('button', { type: 'button', id: 'act-new', class: 'act-new' }, tr('↓ nuevas'));
newChip.hidden = true;
const live = h('div', { class: 'sr', 'aria-live': 'polite' });
panel.append(head, list, detail, newChip);
root.append(line, panel, live);
// En la barra inferior, a la derecha del estado (2026-11-15).
/** @type {HTMLElement} */ (document.querySelector('.statusbar')).append(root); // sin importar dom.js: dom.js importa este módulo

/** @type {PanelState} */
let state = 'hidden';
let pinned = false;
let busy = '';
let unseen = 0;
let lastSaidAt = 0;
let lastAt = 0;
/** @type {ReturnType<typeof setTimeout>|undefined} */
let settleT;
const RECENT_MS = 8000;

/** Línea con texto mientras algo corre o pasó hace poco; si no, circulito (o nada si no hubo nada). */
function settle() {
  clearTimeout(settleT);
  if (state === 'open') return;
  const recent = Date.now() - lastAt < RECENT_MS;
  setState(busy || recent ? 'line' : lines.length ? 'mini' : 'hidden');
  renderLine(); // pasados los 8 s, del último mensaje al resumen de lo que corre
  if (!busy && recent) settleT = setTimeout(settle, RECENT_MS - (Date.now() - lastAt) + 50);
}
/** @type {Line[]} */
let lines = [];

/** @param {PanelState} s */
function setState(s) {
  if (state === s) return;
  state = s;
  root.dataset.state = s;
  line.setAttribute('aria-expanded', String(s === 'open'));
  if (s === 'open') { unseen = 0; requestAnimationFrame(() => stickToBottom(true)); }
  renderLine();
}

function renderLine() {
  const last = lines[lines.length - 1];
  // Lo último que pasó (si fue hace poco); si no, el resumen de lo que corre.
  const text = (Date.now() - lastAt < RECENT_MS && last?.text) || busy || last?.text || '';
  const area = last?.area ?? 'general';
  lineSum.textContent = text;
  lineIc.innerHTML = busy ? '' : svg(AREA[area][1], 13);
  lineIc.className = `act-ic ${area}`;
  headSum.textContent = busy;
  lineN.textContent = unseen > 99 ? '99+' : String(unseen);
  lineN.hidden = !unseen || state === 'open';
  root.classList.toggle('is-busy', Boolean(busy)); // no `busy`: esa clase apaga los clics (botones con spinner)
  root.classList.toggle('warn', !busy && last?.level === 'warn');
  root.classList.toggle('error', !busy && last?.level === 'error');
  line.setAttribute('aria-label', tr('Actividad: {a}{b}. {c}', { a: text || tr('nada en curso'), b: unseen ? tr(', {unseen} nuevas', { unseen }) : '', c: state === 'open' ? tr('Cerrar') : tr('Ver detalle') }));
  line.dataset.tip = state === 'open' ? tr('Cerrar la actividad') : tr('Ver todo lo que pasa de fondo');
  root.dataset.state = state;
}

const atBottom = () => list.scrollHeight - list.scrollTop - list.clientHeight < 12;
/** @param {boolean} force */
function stickToBottom(force) {
  if (force || atBottom()) {
    list.scrollTop = list.scrollHeight;
    newChip.hidden = true;
  } else {
    newChip.hidden = false;
  }
}

/** Anuncio para lectores de pantalla: solo resúmenes, como mucho uno cada 4 s. */
/** @param {string} text */
function say(text) {
  const now = Date.now();
  if (now - lastSaidAt < 4000) return;
  lastSaidAt = now;
  live.textContent = text;
}

/**
 * Agrega (o actualiza) una línea.
 * @param {{text: string, area?: string, level?: Level, key?: string, at?: Date, announce?: boolean}} l
 * `key`: misma clave = mismo trabajo (p. ej. la velocidad en vivo): se actualiza en su lugar.
 */
function push(l) {
  const level = l.level ?? 'info';
  const area = level === 'error' ? 'error' : (l.area && l.area in AREA ? l.area : 'general');
  const key = l.key ?? `${area}|${l.text}`;
  const at = l.at ?? new Date();
  const lastLine = lines[lines.length - 1];
  const same = l.key ? lines.slice(-25).find((x) => x.key === key) : lastLine?.key === key ? lastLine : null;
  const keepBottom = atBottom();
  if (same) {
    same.n = l.key ? same.n : same.n + 1;
    Object.assign(same, { text: l.text, level, area });
    $in(same.li, 'time').textContent = hhmmss(at);
    $in(same.li, '.act-msg').textContent = l.text;
    $in(same.li, '.act-rep').textContent = same.n > 1 ? `×${same.n}` : '';
    same.li.className = `act-l ${level}`;
    same.li.dataset.area = area;
    // La línea compacta muestra lo último que se movió.
    if (same !== lastLine) { lines.splice(lines.indexOf(same), 1); lines.push(same); }
  } else {
    const li = h('li', { class: `act-l ${level}${reduceMotion ? '' : ' in'}`, 'data-area': area });
    li.hidden = view === 'friendly' && filter.value !== 'all' && filter.value !== area;
    const ic = h('span', { class: `act-ic ${area}`, role: 'img', 'aria-label': AREA[area][0] }, svg(AREA[area][1]));
    const t = h('time', { datetime: at.toISOString() });
    t.textContent = hhmmss(at);
    const msg = h('span', { class: 'act-msg' });
    msg.textContent = l.text;
    li.append(t, ic, msg, h('span', { class: 'act-rep' }));
    list.append(li);
    lines.push({ key, li, n: 1, text: l.text, area, level });
    while (lines.length > KEEP) lines.shift()?.li.remove();
    if (state !== 'open') unseen++;
    lastAt = Date.now();
    if (l.announce || level !== 'info') say(l.text);
    // Señal visual chica de que llegó algo nuevo (sin abrir nada).
    if (!reduceMotion) { line.classList.remove('bump'); void line.offsetWidth; line.classList.add('bump'); }
  }
  if (state === 'open') stickToBottom(keepBottom);
  renderLine();
  settle();
}

/** Resumen de lo que está corriendo ('' = nada): spinner + texto de la línea compacta. */
/** @param {string} text */
function setBusy(text) {
  if (busy === text) return;
  busy = text;
  renderLine();
  settle();
}

// ---------- vistas: Resumen (amigable) y Detallado (log del núcleo) ----------
/** @type {View} */
let view = 'friendly';
const LEVELS = [['all', tr('Todos los niveles')], ['warn', tr('Avisos y errores')], ['info', tr('Info')], ['debug', tr('Debug / verbose')]];
/** Nivel de una línea del log de tracing ("2026-…Z  INFO streamonte_core::…: mensaje"). */
/** @param {string} l */
const levelOf = (l) => (/\b(ERROR|WARN)\b/.test(l) ? 'warn' : /\b(DEBUG|TRACE)\b/.test(l) ? 'debug' : 'info');

/** @param {View} v */
function setView(v) {
  view = v;
  tabFriendly.setAttribute('aria-selected', String(v === 'friendly'));
  tabDetail.setAttribute('aria-selected', String(v === 'detail'));
  list.hidden = v !== 'friendly';
  detail.hidden = v !== 'detail';
  refreshBtn.hidden = v !== 'detail';
  clearBtn.hidden = v !== 'friendly';
  /** @type {string[][]} */
  const opts = v === 'friendly'
    ? [['all', tr('Todos los tipos')], ...Object.entries(AREA).filter(([a]) => lines.some((x) => x.area === a)).map(([a, [name]]) => [a, name])]
    : LEVELS;
  filter.replaceChildren(...opts.map(([value, label]) => { const o = h('option', { value }); o.textContent = label; return o; }));
  applyFilter();
  if (v === 'detail') loadDetail();
}

function applyFilter() {
  if (view === 'friendly') {
    for (const x of lines) x.li.hidden = filter.value !== 'all' && x.area !== filter.value;
    stickToBottom(true);
  } else {
    for (const li of /** @type {HTMLElement[]} */ ([...detail.children])) li.hidden = filter.value !== 'all' && li.dataset.level !== filter.value;
    detail.scrollTop = detail.scrollHeight;
  }
}

/** Trae el log del núcleo; las líneas seguidas con el mismo mensaje se agrupan en una con ×N. */
async function loadDetail() {
  const raw = await api.logsTail(2000).catch(() => []);
  /** @param {string} l */
  const msg = (l) => l.replace(/^\S+\s+/, ''); // sin la fecha: así se ven iguales las repetidas
  /** @type {{line: string, n: number}[]} */
  const groups = [];
  for (const l of raw) {
    const last = groups[groups.length - 1];
    if (last && msg(last.line) === msg(l)) { last.n += 1; last.line = l; } else groups.push({ line: l, n: 1 });
  }
  detail.replaceChildren(...groups.map(({ line: l, n }) => {
    const li = h('li', { class: `act-d ${levelOf(l)}`, 'data-level': levelOf(l) });
    li.textContent = l;
    if (n > 1) li.append(h('span', { class: 'act-rep' }, ` ×${n}`));
    return li;
  }));
  applyFilter();
}

/** "Descargar logs": el núcleo copia sus logs y esto (lo que se ve en Resumen) a Descargas. */
async function exportLogs() {
  const friendly = lines.map((x) => `${$in(x.li, 'time').textContent} [${AREA[x.area][0]}] ${x.text}${x.n > 1 ? ` ×${x.n}` : ''}`).join('\n');
  try {
    const dir = await api.exportLogs(friendly);
    push({ area: 'general', text: tr('Logs guardados en {dir}', { dir }) });
  } catch (e) {
    push({ area: 'general', level: 'error', text: /** @type {{message?: string}} */ (e)?.message ?? String(e) });
  }
}

tabFriendly.addEventListener('click', () => setView('friendly'));
tabDetail.addEventListener('click', () => setView('detail'));
filter.addEventListener('change', applyFilter);
refreshBtn.addEventListener('click', loadDetail);
exportBtn.addEventListener('click', exportLogs);

/** @param {boolean} refocus */
function close(refocus) {
  setState('line');
  settle();
  if (refocus) line.focus();
}
line.addEventListener('click', () => {
  if (state === 'open') close(false);
  else { setState('open'); setView(view); (view === 'friendly' ? list : detail).focus({ preventScroll: true }); }
});
minBtn.addEventListener('click', () => close(true));
pinBtn.addEventListener('click', () => {
  pinned = !pinned;
  pinBtn.setAttribute('aria-pressed', String(pinned));
  const tip = pinned ? tr('Fijada: tocá para que se cierre al tocar afuera') : tr('Fijar: que no se cierre al tocar afuera');
  pinBtn.dataset.tip = tip;
  pinBtn.setAttribute('aria-label', tip);
});
clearBtn.addEventListener('click', () => { lines = []; list.replaceChildren(); unseen = 0; newChip.hidden = true; renderLine(); list.focus(); });
newChip.addEventListener('click', () => stickToBottom(true));
list.addEventListener('scroll', () => { if (atBottom()) newChip.hidden = true; }, { passive: true });
root.addEventListener('keydown', (ev) => {
  if (ev.key === 'Escape' && state === 'open') { ev.stopPropagation(); close(true); }
});
document.addEventListener('pointerdown', (ev) => {
  if (state === 'open' && !pinned && !root.contains(/** @type {Node} */ (ev.target))) close(false);
}, true);

export const activity = { push, setBusy };
