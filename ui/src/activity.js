// Actividad de fondo (2026-11-14, rev. 2 del usuario: "una bubble minimal abajo con el último
// comando o proceso que se está haciendo").
// - Burbuja flotante abajo a la derecha, sobre la barra de estado: mientras algo corre (o hasta
//   8 s después de lo último que pasó) muestra spinner + qué se está haciendo; después se achica a
//   un circulito con el contador de novedades. No tapa la barra ni se abre sola.
// - Al tocarla se abre hacia arriba el log completo; Escape, tocar afuera o "Achicar" lo cierran
//   (salvo fijado). Las líneas del mismo trabajo (`key`) o repetidas se actualizan en su lugar.

const KEEP = 300;
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

// Íconos por área (trazo 2, 24×24).
const AREA = {
  analisis: ['Análisis', '<path d="M4.6 18.5a9 9 0 1 1 14.8 0"/><path d="M12 14.5l4.2-5"/>'],
  motor: ['Torrent', '<path d="M12 3v12"/><path d="M7 10l5 5 5-5"/><path d="M5 20h14"/>'],
  reproduccion: ['Reproducción', '<path d="M8 5.5v13l10-6.5z"/>'],
  subtitulos: ['Subtítulos', '<rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="M7 14h4M13 14h4M7 10h10"/>'],
  catalogo: ['Catálogo', '<circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.3 15.3L20 20"/>'],
  limpieza: ['Limpieza', '<path d="M5 7h14M10 7V4.5h4V7M7 7l1 13h8l1-13"/>'],
  red: ['Red', '<path d="M5 12.5a10 10 0 0 1 14 0M8 15.5a5.5 5.5 0 0 1 8 0"/><circle cx="12" cy="19" r="1.2" fill="currentColor"/>'],
  portapapeles: ['Portapapeles', '<rect x="6" y="4.5" width="12" height="16" rx="2"/><path d="M9.5 4.5V3h5v1.5"/>'],
  general: ['General', '<circle cx="12" cy="12" r="8"/><path d="M12 8v4.5l3 2"/>'],
  error: ['Error', '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5v5.5"/><circle cx="12" cy="16.5" r="1.1" fill="currentColor"/>'],
};
const svg = (paths, size = 14) => `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
const ICON = {
  pin: '<path d="M9 4h6l-1 5 3 3H7l3-3z"/><path d="M12 15v5"/>',
  clear: '<path d="M5 7h14M10 7V4.5h4V7M7 7l1 13h8l1-13"/>',
  min: '<path d="M6 9l6 6 6-6"/>',
};

function h(tag, attrs = {}, html = '') {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') n.className = v; else n.setAttribute(k, v);
  }
  if (html) n.innerHTML = html;
  return n;
}
const hhmmss = (d) => d.toLocaleTimeString('es-AR', { hour12: false });

const root = h('div', { id: 'act', class: 'act', 'data-state': 'hidden' });
const line = h('button', { type: 'button', class: 'act-line', 'aria-expanded': 'false', 'aria-controls': 'act-panel' });
const lineDot = h('i', { class: 'act-dot', 'aria-hidden': 'true' });
const lineIc = h('span', { class: 'act-ic' });
const lineSum = h('span', { class: 'act-sum' });
const lineN = h('b', { class: 'act-n' });
const lineChev = h('span', { class: 'act-chev', 'aria-hidden': 'true' }, svg('<path d="M6 15l6-6 6 6"/>', 12));
line.append(lineDot, lineIc, lineSum, lineN, lineChev);
const panel = h('div', { class: 'act-panel', id: 'act-panel', role: 'region', 'aria-labelledby': 'act-title' });
const head = h('div', { class: 'act-h' });
const title = h('span', { class: 'act-title', id: 'act-title' }, 'Actividad');
const headSum = h('span', { class: 'act-sum' });
const btn = (label, icon, extra = {}) => h('button', { type: 'button', class: 'act-b', 'aria-label': label, 'data-tip': label, ...extra }, svg(ICON[icon]));
const pinBtn = btn('Fijar: que no se cierre al tocar afuera', 'pin', { 'aria-pressed': 'false' });
const clearBtn = btn('Vaciar la lista', 'clear');
const minBtn = btn('Cerrar', 'min');
head.append(title, headSum, pinBtn, clearBtn, minBtn);
const list = h('ol', { class: 'act-list', tabindex: '0', 'aria-label': 'Lo que está pasando, lo más nuevo abajo', 'aria-live': 'off' });
const newChip = h('button', { type: 'button', class: 'act-new' }, '↓ nuevas');
newChip.hidden = true;
const live = h('div', { class: 'sr', 'aria-live': 'polite' });
panel.append(head, list, newChip);
root.append(panel, line, live);
document.body.append(root);
// Justo encima de la barra de estado.
function place() {
  const bar = document.querySelector('.statusbar');
  root.style.bottom = `${Math.round((bar?.getBoundingClientRect().height ?? 28) + 10)}px`;
}
place();
window.addEventListener('resize', place);

let state = 'hidden';
let pinned = false;
let busy = '';
let unseen = 0;
let lastSaidAt = 0;
let lastAt = 0;
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
/** @type {{key: string, li: HTMLElement, n: number, text: string, area: string, level: string}[]} */
let lines = [];

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
  line.setAttribute('aria-label', `Actividad: ${text || 'nada en curso'}${unseen ? `, ${unseen} nuevas` : ''}. ${state === 'open' ? 'Cerrar' : 'Ver detalle'}`);
  line.dataset.tip = state === 'open' ? 'Cerrar la actividad' : 'Ver todo lo que pasa de fondo';
  root.dataset.state = state;
}

const atBottom = () => list.scrollHeight - list.scrollTop - list.clientHeight < 12;
function stickToBottom(force) {
  if (force || atBottom()) {
    list.scrollTop = list.scrollHeight;
    newChip.hidden = true;
  } else {
    newChip.hidden = false;
  }
}

/** Anuncio para lectores de pantalla: solo resúmenes, como mucho uno cada 4 s. */
function say(text) {
  const now = Date.now();
  if (now - lastSaidAt < 4000) return;
  lastSaidAt = now;
  live.textContent = text;
}

/**
 * Agrega (o actualiza) una línea.
 * @param {{text: string, area?: string, level?: 'info'|'warn'|'error', key?: string, at?: Date, announce?: boolean}} l
 * `key`: misma clave = mismo trabajo (p. ej. la velocidad en vivo): se actualiza en su lugar.
 */
function push(l) {
  const level = l.level ?? 'info';
  const area = level === 'error' ? 'error' : (l.area in AREA ? l.area : 'general');
  const key = l.key ?? `${area}|${l.text}`;
  const at = l.at ?? new Date();
  const lastLine = lines[lines.length - 1];
  const same = l.key ? lines.slice(-25).find((x) => x.key === key) : lastLine?.key === key ? lastLine : null;
  const keepBottom = atBottom();
  if (same) {
    same.n = l.key ? same.n : same.n + 1;
    Object.assign(same, { text: l.text, level, area });
    same.li.querySelector('time').textContent = hhmmss(at);
    same.li.querySelector('.act-msg').textContent = l.text;
    same.li.querySelector('.act-rep').textContent = same.n > 1 ? `×${same.n}` : '';
    same.li.className = `act-l ${level}`;
    // La línea compacta muestra lo último que se movió.
    if (same !== lastLine) { lines.splice(lines.indexOf(same), 1); lines.push(same); }
  } else {
    const li = h('li', { class: `act-l ${level}${reduceMotion ? '' : ' in'}` });
    const ic = h('span', { class: `act-ic ${area}`, role: 'img', 'aria-label': AREA[area][0] }, svg(AREA[area][1]));
    const t = h('time', { datetime: at.toISOString() });
    t.textContent = hhmmss(at);
    const msg = h('span', { class: 'act-msg' });
    msg.textContent = l.text;
    li.append(t, ic, msg, h('span', { class: 'act-rep' }));
    list.append(li);
    lines.push({ key, li, n: 1, text: l.text, area, level });
    while (lines.length > KEEP) lines.shift().li.remove();
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
function setBusy(text) {
  if (busy === text) return;
  busy = text;
  renderLine();
  settle();
}

function close(refocus) {
  setState('line');
  settle();
  if (refocus) line.focus();
}
line.addEventListener('click', () => {
  if (state === 'open') close(false);
  else { setState('open'); list.focus({ preventScroll: true }); }
});
minBtn.addEventListener('click', () => close(true));
pinBtn.addEventListener('click', () => {
  pinned = !pinned;
  pinBtn.setAttribute('aria-pressed', String(pinned));
  const tip = pinned ? 'Fijada: tocá para que se cierre al tocar afuera' : 'Fijar: que no se cierre al tocar afuera';
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
  if (state === 'open' && !pinned && !root.contains(ev.target)) close(false);
}, true);

export const activity = { push, setBusy };
